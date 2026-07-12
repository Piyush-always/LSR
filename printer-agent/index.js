const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const { generateKeychainImage } = require('./generate-image');
const { imageToGcode } = require('./image-to-gcode');
const { textToGcode, POSITION } = require('./text-to-gcode');

// Engraving mode: 'vector' (filled letters via opentype) or 'raster' (pixel scan)
const ENGRAVING_MODE = process.env.ENGRAVING_MODE || 'vector';
const { connect, sendGcodeFile, listPorts, disconnect, getCurrentPosition, SERIAL_CONFIG } = require('./laser-sender');

// ===== CONFIGURATION =====
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'service-account.json');
const RECONNECT_INTERVAL_MS = 10000; // 10 seconds
const BETWEEN_JOBS_DELAY_MS = 5000;  // pause before pulling the next queued order (operator swap time)
// Cloud Storage bucket that holds uploaded image-order bitmaps. Must match the
// project's Storage bucket (js/firebase-config.js → storageBucket).
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'laser-inv.firebasestorage.app';

// Initialize Firebase Admin
const serviceAccount = require(SERVICE_ACCOUNT_PATH);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: STORAGE_BUCKET,
});

const db = admin.firestore();

// State
let laserConnected = false;
let isProcessing = false;
let firestoreUnsubscribe = null;

// ===== STARTUP =====
async function start() {
    console.log('========================================');
    console.log('  LASER KEYCHAIN PRINTER AGENT');
    console.log('  Creality CV-01 Pro');
    console.log('========================================');
    console.log('');

    await listPorts();

    // Block until the laser is connected. Without it, we do not touch the queue.
    await ensureLaserConnected();

    // Print the configured reference points so the operator can verify them.
    printConfigBanner();

    // Once connected, start listening for orders
    startQueueListener();
}

function printConfigBanner() {
    const sx = POSITION.startOffsetX.toFixed(3);
    const sy = POSITION.startOffsetY.toFixed(3);
    console.log(`[CONFIG] HOME    = (0.000, 0.000)               (laser's position at connect time)`);
    console.log(`[CONFIG] START   = HOME + (${sx}, ${sy}) mm`);
    console.log(`[CONFIG] After each print the laser returns to HOME.`);
    console.log(`[CONFIG] Edit START in printer-agent/text-to-gcode.js  POSITION block.`);
    console.log('');
}

// ===== LASER CONNECTION MANAGEMENT =====
async function ensureLaserConnected() {
    while (!laserConnected) {
        try {
            console.log(`[SERIAL] Attempting to connect to ${SERIAL_CONFIG.port}...`);
            await connect();
            laserConnected = true;
            console.log('[READY] ✓ Laser printer connected!\n');
            return;
        } catch (err) {
            console.error(`[WARN] Could not connect: ${err.message}`);
            console.error(`[WARN] Make sure the Creality CV-01 Pro is plugged in.`);
            console.error(`[WARN] Current port: ${SERIAL_CONFIG.port}`);
            console.error(`[WARN] Set correct port with: set LASER_PORT=COMx`);
            console.error(`[WARN] Retrying in ${RECONNECT_INTERVAL_MS / 1000} seconds...\n`);
            await sleep(RECONNECT_INTERVAL_MS);
        }
    }
}

// ===== QUEUE LISTENER =====
function startQueueListener() {
    if (firestoreUnsubscribe) return; // already listening

    console.log('Listening for new orders...\n');

    firestoreUnsubscribe = db.collection('orders')
        .where('status', '==', 'queued')
        .orderBy('queue_position', 'asc')
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const order = { id: change.doc.id, ...change.doc.data() };
                    console.log(`[QUEUE] New order: "${order.name}" (Position #${order.queue_position})`);
                    processQueue();
                }
            });
        }, (error) => {
            console.error('[ERROR] Firestore listener failed:', error);
        });
}

// ===== QUEUE PROCESSOR =====
async function processQueue() {
    if (isProcessing) return;
    if (!laserConnected) {
        console.log('[SKIP] Laser not connected — orders will wait.');
        return;
    }

    isProcessing = true;
    let firstJob = true;

    try {
        while (laserConnected) {
            const snapshot = await db.collection('orders')
                .where('status', '==', 'queued')
                .orderBy('queue_position', 'asc')
                .limit(1)
                .get();

            if (snapshot.empty) {
                console.log('[QUEUE] No more orders. Waiting...\n');
                break;
            }

            // Give the operator a few seconds to swap the keychain blank
            // before the next job starts. Skipped for the very first job
            // of a batch (laser already idle / blank already in place).
            if (!firstJob && BETWEEN_JOBS_DELAY_MS > 0) {
                console.log(`[QUEUE] Pausing ${BETWEEN_JOBS_DELAY_MS / 1000}s before next job — swap the keychain now.\n`);
                await sleep(BETWEEN_JOBS_DELAY_MS);
            }
            firstJob = false;

            const doc = snapshot.docs[0];
            const order = { id: doc.id, ...doc.data() };

            try {
                await processOrder(order);
            } catch (err) {
                // processOrder failed — revert order back to queued and stop the loop.
                console.error(`\n[FAIL] Printing failed: ${err.message}`);
                console.error('[FAIL] Reverting order back to queued...');

                await db.collection('orders').doc(order.id).update({ status: 'queued' });

                // If it was a serial/connection error, mark laser disconnected and reconnect
                if (isSerialError(err)) {
                    laserConnected = false;
                    console.error('[FAIL] Laser connection lost. Will try to reconnect...\n');
                    reconnectInBackground();
                }
                break; // exit processing loop
            }
        }
    } finally {
        isProcessing = false;
    }
}

// ===== PROCESS SINGLE ORDER =====
// Throws on any failure — caller is responsible for reverting the order.
async function processOrder(order) {
    const sx = POSITION.startOffsetX.toFixed(3);
    const sy = POSITION.startOffsetY.toFixed(3);
    const displayName = order.name || (order.mode === 'image' ? 'image upload' : 'keychain');

    console.log(`\n[PRINT] ============================`);
    console.log(`[PRINT] Printing: "${displayName}" (${order.mode || 'text'})`);
    console.log(`[PRINT] Queue Position: #${order.queue_position}`);
    console.log(`[PRINT] Start position: (${sx}, ${sy}) mm    (returns to HOME after)`);
    console.log(`[PRINT] ============================`);

    // Mark as printing
    await db.collection('orders').doc(order.id).update({ status: 'printing' });

    // Sanity: where is the laser physically right now?
    await logCurrentPosition('Current position');

    // Generate G-code — branch on the order type.
    let gcodePath;
    if (order.mode === 'image') {
        // Uploaded-image order: fetch the pre-processed black/white bitmap from
        // Cloud Storage and rasterise it into the keychain's image area.
        console.log('[STEP 1] Downloading uploaded image...');
        const localImage = await downloadPrintImage(order);
        console.log('[STEP 2] Generating raster G-code from image...');
        gcodePath = await imageToGcode(localImage, order.id);
    } else {
        // Text/name order (mode 'text' or legacy orders with no mode field).
        const label = order.name || '(unnamed)';
        console.log('[STEP 1] Generating keychain image...');
        generateKeychainImage(label, order.id);

        if (ENGRAVING_MODE === 'vector') {
            const fontId = order.fontId || 'pixel';
            console.log(`[STEP 2] Generating vector G-code (font=${fontId})...`);
            gcodePath = await textToGcode(label, order.id, fontId);
        } else {
            console.log('[STEP 2] Generating raster G-code...');
            const imagePath = generateKeychainImage(label, order.id);
            gcodePath = await imageToGcode(imagePath, order.id);
        }
    }

    // Step 3: Send to laser — must succeed or we throw
    console.log('[STEP 3] Sending to laser printer...');
    await sendGcodeFile(gcodePath, (current, total) => {
        const percent = Math.round((current / total) * 100);
        process.stdout.write(`\r[LASER] Progress: ${percent}% (${current}/${total} commands)`);
    });
    console.log(''); // newline after progress

    // Sanity: did the laser actually return to HOME?
    await logCurrentPosition('Position after print');

    // Only reached if laser actually finished
    await db.collection('orders').doc(order.id).update({
        status: 'done',
        printed_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[DONE] ✓ Keychain for "${displayName}" completed!\n`);
}

// Download an image order's pre-processed B&W bitmap from Cloud Storage to a
// local file for rasterising. Throws on missing path / download failure (the
// caller reverts the order to queued and retries).
async function downloadPrintImage(order) {
    if (!order.printImagePath) {
        throw new Error('Image order is missing printImagePath');
    }
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const localPath = path.join(outputDir, `upload_${order.id}.png`);
    await admin.storage().bucket().file(order.printImagePath).download({ destination: localPath });
    console.log(`[IMAGE] Downloaded ${order.printImagePath} → ${localPath}`);
    return localPath;
}

// Best-effort position log — never throws, just prints a warning if GRBL
// doesn't respond in time. Used purely for operator visibility.
async function logCurrentPosition(label) {
    try {
        const { x, y } = await getCurrentPosition();
        console.log(`[LASER] ${label}: (${x.toFixed(3)}, ${y.toFixed(3)}) mm`);
    } catch (err) {
        console.log(`[LASER] ${label}: (unable to read — ${err.message})`);
    }
}

// ===== HELPERS =====
function isSerialError(err) {
    const msg = (err.message || '').toLowerCase();
    return msg.includes('com') ||
           msg.includes('port') ||
           msg.includes('serial') ||
           msg.includes('not connected');
}

async function reconnectInBackground() {
    await ensureLaserConnected();
    processQueue(); // resume any pending orders
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGINT', () => {
    console.log('\n[EXIT] Shutting down...');
    if (firestoreUnsubscribe) firestoreUnsubscribe();
    disconnect();
    process.exit(0);
});

// Start the agent
start();

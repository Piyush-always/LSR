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

<<<<<<< Updated upstream
=======
// Load MACHINE_ID configuration (config.json, env variable, or default 'laser-001')
let CONFIG = {};
try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
        CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
} catch (e) {
    console.warn('[CONFIG] Could not read config.json:', e.message);
}
const MACHINE_ID = process.env.MACHINE_ID || CONFIG.machineId || 'laser-001';
// Load SERVICE_ACCOUNT and initialize Firebase Admin
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'service-account.json');
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'laser-keychain-official.firebasestorage.app';
const RECONNECT_INTERVAL_MS = 5000;

if (admin.apps.length === 0) {
    const serviceAccount = require(SERVICE_ACCOUNT_PATH);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: STORAGE_BUCKET,
    });
}
>>>>>>> Stashed changes
const db = admin.firestore();

// State
let laserConnected = false;
let isProcessing = false;
let firestoreUnsubscribe = null;
let currentJob = null;     // { orderId, name, mode, position, startedAt, progress }
let lastProgressAt = 0;    // throttle for progress heartbeats

// ===== SYSTEM STATUS (published to Firestore for the website debug panel) =====
// The website can't see this laptop directly, so we publish printer connection,
// current job, and a rolling log to system/printer. Heartbeat lets the website
// detect "agent offline" when updates go stale. All writes are best-effort and
// must never block or break printing.
const STATUS_DOC = db.doc('system/printer');
const HEARTBEAT_MS = 15000;   // ~5.8k writes/day if run 24h — within free tier
const MAX_EVENTS = 20;
const recentEvents = [];      // rolling in-memory log tail, newest first
let heartbeatTimer = null;

async function publishStatus(fields) {
    try {
        await STATUS_DOC.set({
            ...fields,
            connected: laserConnected,
            port: SERIAL_CONFIG.port,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (err) {
        console.error(`[STATUS] publish failed: ${err.message}`);
    }
}

function logEvent(msg) {
    recentEvents.unshift({ t: Date.now(), msg });
    if (recentEvents.length > MAX_EVENTS) recentEvents.length = MAX_EVENTS;
    publishStatus({ events: recentEvents });
}

function startHeartbeat() {
    if (heartbeatTimer) return;
    publishStatus({});   // immediate first beat
    heartbeatTimer = setInterval(() => publishStatus({}), HEARTBEAT_MS);
}

// ===== STARTUP =====
async function start() {
    console.log('========================================');
    console.log('  LASER KEYCHAIN PRINTER AGENT');
    console.log('  Creality CV-01 Pro');
    console.log('========================================');
    console.log('');

    // Start reporting status to the website right away (shows "connecting").
    startHeartbeat();
    logEvent('Agent started');

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
            logEvent(`Laser connected on ${SERIAL_CONFIG.port}`);
            await publishStatus({ lastError: null });
            return;
        } catch (err) {
            console.error(`[WARN] Could not connect: ${err.message}`);
            await publishStatus({ lastError: err.message });
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

<<<<<<< Updated upstream
    firestoreUnsubscribe = db.collection('orders')
        .where('status', '==', 'queued')
        .orderBy('queue_position', 'asc')
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const order = { id: change.doc.id, ...change.doc.data() };
                    console.log(`[QUEUE] New order: "${order.name}" (Position #${order.queue_position})`);
=======
    const handleDocs = (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const order = { id: change.doc.id, ...change.doc.data() };
                const orderMachine = order.machineId || 'laser-001';
                if (orderMachine === MACHINE_ID) {
                    console.log(`[QUEUE] New order for ${MACHINE_ID}: "${order.name}" (Position #${order.queue_position})`);
>>>>>>> Stashed changes
                    processQueue();
                }
            }
        });
    };

    try {
        firestoreUnsubscribe = db.collection('orders')
            .where('status', '==', 'queued')
            .orderBy('queue_position', 'asc')
            .onSnapshot(handleDocs, (error) => {
                console.warn('[WARN] Ordered listener failed, trying fallback:', error.message);
                firestoreUnsubscribe = db.collection('orders')
                    .where('status', '==', 'queued')
                    .onSnapshot(handleDocs);
            });
    } catch (err) {
        firestoreUnsubscribe = db.collection('orders')
            .where('status', '==', 'queued')
            .onSnapshot(handleDocs);
    }
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
<<<<<<< Updated upstream
            const snapshot = await db.collection('orders')
                .where('status', '==', 'queued')
                .orderBy('queue_position', 'asc')
                .limit(1)
                .get();

            if (snapshot.empty) {
                console.log('[QUEUE] No more orders. Waiting...\n');
=======
            let snapshot;
            try {
                snapshot = await db.collection('orders')
                    .where('status', '==', 'queued')
                    .orderBy('queue_position', 'asc')
                    .get();
            } catch (e) {
                // Fallback if index building
                snapshot = await db.collection('orders')
                    .where('status', '==', 'queued')
                    .get();
            }

            // Filter docs matching THIS machine ID and sort in-memory
            const matchingDocs = snapshot.docs
                .filter(doc => (doc.data().machineId || 'laser-001') === MACHINE_ID)
                .sort((a, b) => (a.data().queue_position || 0) - (b.data().queue_position || 0));

            if (matchingDocs.length === 0) {
                console.log(`[QUEUE] No more orders for machine ${MACHINE_ID}. Waiting...\n`);
>>>>>>> Stashed changes
                break;
            }

            const matchingDoc = matchingDocs[0];

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
                currentJob = null;
                await publishStatus({ current: null, lastError: err.message });
                logEvent(`Failed: ${err.message}`);

                // If it was a serial/connection error, mark laser disconnected and reconnect
                if (isSerialError(err)) {
                    laserConnected = false;
                    console.error('[FAIL] Laser connection lost. Will try to reconnect...\n');
                    logEvent('Laser connection lost — reconnecting');
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
    currentJob = {
        orderId: order.id,
        name: displayName,
        mode: order.mode || 'text',
        position: order.queue_position || null,
        startedAt: Date.now(),
        progress: 0,
    };
    lastProgressAt = 0;
    await publishStatus({ current: currentJob });
    logEvent(`Printing #${order.queue_position} — ${displayName}`);

    // Sanity: where is the laser physically right now?
    await logCurrentPosition('Current position');

    const shape = order.shape || 'rectangle';

    // Generate G-code — branch on the order type.
    let gcodePath;
    if (order.mode === 'image') {
        // Uploaded-image order: fetch the pre-processed black/white bitmap from
        // Cloud Storage and rasterise it into the keychain's image area.
        console.log('[STEP 1] Downloading uploaded image...');
        const localImage = await downloadPrintImage(order);
        console.log(`[STEP 2] Generating raster G-code from image (shape=${shape})...`);
        gcodePath = await imageToGcode(localImage, order.id);
    } else {
        // Text/name order (mode 'text' or legacy orders with no mode field).
        const label = order.name || '(unnamed)';
        console.log('[STEP 1] Generating keychain image...');
        generateKeychainImage(label, order.id);

        if (ENGRAVING_MODE === 'vector') {
            const fontId = order.fontId || 'pixel';
            console.log(`[STEP 2] Generating vector G-code (font=${fontId}, shape=${shape})...`);
            gcodePath = await textToGcode(label, order.id, fontId, shape);
        } else {
            console.log(`[STEP 2] Generating raster G-code (shape=${shape})...`);
            const imagePath = generateKeychainImage(label, order.id);
            gcodePath = await imageToGcode(imagePath, order.id);
        }
    }

    // Step 3: Send to laser — must succeed or we throw
    console.log('[STEP 3] Sending to laser printer...');
    await sendGcodeFile(gcodePath, (current, total) => {
        const percent = Math.round((current / total) * 100);
        process.stdout.write(`\r[LASER] Progress: ${percent}% (${current}/${total} commands)`);
        // Publish progress to the website (throttled: at most every 2s, plus 100%).
        if (currentJob) {
            currentJob.progress = percent;
            const now = Date.now();
            if (percent >= 100 || now - lastProgressAt > 2000) {
                lastProgressAt = now;
                publishStatus({ current: currentJob }); // fire-and-forget
            }
        }
    });
    console.log(''); // newline after progress

    // Sanity: did the laser actually return to HOME?
    await logCurrentPosition('Position after print');

    // Only reached if laser actually finished
    await db.collection('orders').doc(order.id).update({
        status: 'done',
        printed_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    currentJob = null;
    await publishStatus({ current: null });
    logEvent(`Done — ${displayName}`);
    console.log(`[DONE] ✓ Keychain for "${displayName}" completed!\n`);
}

// Download an image order's pre-processed B&W bitmap from Cloud Storage to a
// local file for rasterising. Throws on missing path / download failure (the
// caller reverts the order to queued and retries).
async function downloadPrintImage(order) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const localPath = path.join(outputDir, `upload_${order.id}.png`);

    if (order.printImageBase64) {
        const base64Data = order.printImageBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(localPath, buffer);
        console.log(`[IMAGE] Decoded Base64 image → ${localPath}`);
        return localPath;
    }

    if (!order.printImagePath) {
        throw new Error('Image order is missing printImagePath');
    }
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
process.on('SIGINT', async () => {
    console.log('\n[EXIT] Shutting down...');
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (firestoreUnsubscribe) firestoreUnsubscribe();
    laserConnected = false;
    // Best-effort: mark the agent offline so the website updates immediately.
    try { await publishStatus({ current: null }); } catch (e) { /* ignore */ }
    disconnect();
    process.exit(0);
});

// Start the agent
start();

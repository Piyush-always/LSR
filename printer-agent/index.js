const admin = require('firebase-admin');
const path = require('path');
const { generateKeychainImage } = require('./generate-image');
const { imageToGcode } = require('./image-to-gcode');
const { connect, sendGcodeFile, listPorts, disconnect, SERIAL_CONFIG } = require('./laser-sender');

// ===== CONFIGURATION =====
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'service-account.json');
const RECONNECT_INTERVAL_MS = 10000; // 10 seconds

// Initialize Firebase Admin
const serviceAccount = require(SERVICE_ACCOUNT_PATH);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
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

    // Once connected, start listening for orders
    startQueueListener();
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
    console.log(`\n[PRINT] ============================`);
    console.log(`[PRINT] Printing: "${order.name}"`);
    console.log(`[PRINT] Queue Position: #${order.queue_position}`);
    console.log(`[PRINT] ============================`);

    // Mark as printing
    await db.collection('orders').doc(order.id).update({ status: 'printing' });

    // Step 1: Generate keychain image
    console.log('[STEP 1] Generating keychain image...');
    const imagePath = generateKeychainImage(order.name, order.id);

    // Step 2: Convert to G-code
    console.log('[STEP 2] Converting to G-code...');
    const gcodePath = await imageToGcode(imagePath, order.id);

    // Step 3: Send to laser — must succeed or we throw
    console.log('[STEP 3] Sending to laser printer...');
    await sendGcodeFile(gcodePath, (current, total) => {
        const percent = Math.round((current / total) * 100);
        process.stdout.write(`\r[LASER] Progress: ${percent}% (${current}/${total} commands)`);
    });
    console.log(''); // newline after progress

    // Only reached if laser actually finished
    await db.collection('orders').doc(order.id).update({
        status: 'done',
        printed_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[DONE] ✓ Keychain for "${order.name}" completed!\n`);
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

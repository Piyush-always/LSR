const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const { generateKeychainImage } = require('./generate-image');
const { imageToGcode } = require('./image-to-gcode');
const { textToGcode } = require('./text-to-gcode');
const { holderCentre } = require('./holders');
const readline = require('readline');

// Engraving mode: 'vector' (filled letters via opentype) or 'raster' (pixel scan)
const ENGRAVING_MODE = process.env.ENGRAVING_MODE || 'vector';
const { connect, sendGcodeFile, listPorts, disconnect, getCurrentPosition, SERIAL_CONFIG } = require('./laser-sender');

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
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'service-account.json');
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'laser-keychain-official.firebasestorage.app';
const RECONNECT_INTERVAL_MS = 5000;
const CONFIRM_FRESH_BLANK = CONFIG.confirmFreshBlank !== false;   // ask before a holder is reused

if (admin.apps.length === 0) {
    if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
        const serviceAccount = require(SERVICE_ACCOUNT_PATH);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: STORAGE_BUCKET,
        });
    } else {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            storageBucket: STORAGE_BUCKET,
        });
    }
}

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
    console.log(`[CONFIG] HOME = (0, 0): where the head was when the agent connected.`);
    for (const shape of ['rectangle', 'circle', 'heart']) {
        const c = holderCentre(shape);
        console.log(`[CONFIG] ${shape.padEnd(9)} holder: ` + (c
            ? `centre (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) mm from HOME`
            : 'NOT CALIBRATED, engraves at HOME. Use Laser Queue > Calibrate holders.'));
    }
    console.log(`[CONFIG] After each keychain the head returns to HOME.`);
    if (CONFIRM_FRESH_BLANK) {
        console.log(`[CONFIG] Put a fresh blank in every holder now. Before a holder is used again you'll be asked to reload it.`);
    }
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

    const handleDocs = (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const order = { id: change.doc.id, ...change.doc.data() };
                const orderMachine = order.machineId || 'laser-001';
                if (orderMachine === MACHINE_ID) {
                    console.log(`[QUEUE] New order for ${MACHINE_ID}: "${order.name || 'image'}" (Position #${order.queue_position})`);
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

    try {
        while (laserConnected) {
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
                break;
            }

            const matchingDoc = matchingDocs[0];

            const order = { id: matchingDoc.id, ...matchingDoc.data() };

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

// ===== PROCESS ONE ORDER =====
// An order is one keychain, or a cart of several (each engraved at its own
// shape's holder). Throws on any failure; the caller puts the order back in the
// queue. A cart resumes from items_done, so finished keychains are never
// engraved twice.
async function processOrder(order) {
    const units = printUnits(order);
    const isCart = order.mode === 'cart';
    const startAt = isCart ? Math.min(order.items_done || 0, units.length) : 0;
    const displayName = order.name || (order.mode === 'image' ? 'image upload' : 'keychain');

    console.log(`\n[PRINT] ============================`);
    console.log(`[PRINT] Printing: "${displayName}" (${order.mode || 'text'})`);
    console.log(`[PRINT] Queue Position: #${order.queue_position}`);
    if (units.length > 1) {
        console.log(`[PRINT] Keychains: ${units.length}${startAt ? `, resuming at ${startAt + 1}` : ''}`);
    }
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
    await publishStatus({ current: currentJob });
    logEvent(`Printing #${order.queue_position} — ${displayName}`);

    for (let i = startAt; i < units.length; i++) {
        const label = units.length > 1 ? `${displayName} (${i + 1} of ${units.length})` : displayName;
        await ensureFreshBlank(units[i].shape);
        await engraveUnit(units[i], units.length > 1 ? `${order.id}_${i + 1}` : order.id, label);
        if (isCart) {
            await db.collection('orders').doc(order.id).update({ items_done: i + 1 });
        }
    }

    // Only reached if the laser actually finished every keychain
    await db.collection('orders').doc(order.id).update({
        status: 'done',
        printed_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    currentJob = null;
    await publishStatus({ current: null });
    logEvent(`Done — ${displayName}`);
    console.log(`[DONE] ✓ Keychain for "${displayName}" completed!\n`);
}

// The keychains to engrave for an order, one entry per physical keychain.
function printUnits(order) {
    if (order.mode === 'cart') {
        const units = [];
        for (const item of order.items || []) {
            const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
            for (let n = 0; n < quantity; n++) units.push({ ...item, shape: item.shape || 'rectangle' });
        }
        if (units.length === 0) throw new Error('Cart order has no keychains');
        return units;
    }
    return [{
        mode: order.mode === 'image' ? 'image' : 'text',
        shape: order.shape || 'rectangle',
        name: order.name,
        fontId: order.fontId,
        textPos: order.textPos || null,
        printImageBase64: order.printImageBase64 || null,
        printImagePath: order.printImagePath || null,
    }];
}

// Engrave one keychain on its shape's holder; the G-code returns to HOME at the end.
async function engraveUnit(unit, fileId, label) {
    const centre = holderCentre(unit.shape);
    console.log(`[PRINT] ${label}: ${unit.shape.toUpperCase()} holder ` + (centre
        ? `at (${centre.x.toFixed(1)}, ${centre.y.toFixed(1)}) mm`
        : '(not calibrated: engraving at HOME)'));
    currentJob.name = label;
    currentJob.progress = 0;
    lastProgressAt = 0;
    await publishStatus({ current: currentJob });

    // Sanity: where is the laser physically right now?
    await logCurrentPosition('Current position');

    let gcodePath;
    if (unit.mode === 'image') {
        console.log('[STEP 1] Preparing the photo...');
        const localImage = await downloadPrintImage(unit, fileId);
        console.log(`[STEP 2] Generating raster G-code from image (shape=${unit.shape})...`);
        gcodePath = await imageToGcode(localImage, fileId, unit.shape);
    } else {
        const text = unit.name || '(unnamed)';
        console.log('[STEP 1] Generating keychain image...');
        generateKeychainImage(text, fileId);

        if (ENGRAVING_MODE === 'vector') {
            const fontId = unit.fontId || 'pixel';
            const at = unit.textPos || {};
            const where = unit.textPos ? `, text at (${at.x}, ${at.y}) mm` : '';
            console.log(`[STEP 2] Generating vector G-code (font=${fontId}, shape=${unit.shape}${where})...`);
            gcodePath = await textToGcode(text, fileId, fontId, unit.shape, at.x ?? null, at.y ?? null);
        } else {
            console.log(`[STEP 2] Generating raster G-code (shape=${unit.shape})...`);
            const imagePath = generateKeychainImage(text, fileId);
            gcodePath = await imageToGcode(imagePath, fileId, unit.shape);
        }
    }

    // Step 3: Send to laser — must succeed or we throw
    console.log('[STEP 3] Sending to laser printer...');
    usedHolders.add(unit.shape);   // from the first burn, this blank is no longer fresh
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
}

// ===== FRESH BLANKS =====
// Every holder is assumed loaded when the agent starts. Once a holder has been
// engraved, the next keychain on it waits until the operator confirms a fresh
// blank: Enter in this window, or "Fresh blank loaded" in Laser Queue (which
// sends "next").
const usedHolders = new Set();
let operatorInput = null;

function waitForOperator() {
    if (!operatorInput) operatorInput = readline.createInterface({ input: process.stdin });
    return new Promise((resolve) => {
        const onLine = (line) => {
            if (/stop/i.test(line)) return;   // a stop request is handled by SIGINT, not as a confirmation
            operatorInput.off('line', onLine);
            resolve();
        };
        operatorInput.on('line', onLine);
    });
}

async function ensureFreshBlank(shape) {
    if (!CONFIRM_FRESH_BLANK || !usedHolders.has(shape)) return;
    const holder = shape.toUpperCase();
    console.log(`\n[BLANK] Load a fresh ${holder} blank, then press Enter (or "Fresh blank loaded" in Laser Queue).`);
    logEvent(`Waiting for a fresh ${shape} blank`);
    await publishStatus({ waitingFor: { holder: shape, since: Date.now() } });
    await waitForOperator();
    usedHolders.delete(shape);
    await publishStatus({ waitingFor: null });
    console.log(`[BLANK] ${holder} blank loaded. Continuing.`);
}

// Write a photo keychain's black/white print image to a local file for
// rasterising. Throws on missing image / download failure (the caller puts the
// order back in the queue).
async function downloadPrintImage(unit, fileId) {
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const localPath = path.join(outputDir, `upload_${fileId}.png`);

    if (unit.printImageBase64) {
        const base64Data = unit.printImageBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(localPath, buffer);
        console.log(`[IMAGE] Decoded Base64 image → ${localPath}`);
        return localPath;
    }

    if (!unit.printImagePath) {
        throw new Error('Image order is missing printImagePath');
    }
    await admin.storage().bucket().file(unit.printImagePath).download({ destination: localPath });
    console.log(`[IMAGE] Downloaded ${unit.printImagePath} → ${localPath}`);
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
    // Put an unfinished order back in the queue so it isn't left stuck in "printing"
    // (a cart keeps items_done, so it resumes at the keychain that was interrupted).
    if (currentJob && currentJob.orderId) {
        try {
            await db.collection('orders').doc(currentJob.orderId).update({ status: 'queued' });
            console.log(`[EXIT] Order ${currentJob.orderId} put back in the queue`);
        } catch (e) {
            console.error(`[EXIT] Could not put the order back in the queue: ${e.message}`);
        }
    }
    // Best-effort: mark the agent offline so the website updates immediately.
    try { await publishStatus({ current: null, waitingFor: null }); } catch (e) { /* ignore */ }
    await disconnect();   // laser off, back to HOME, then close
    process.exit(0);
});

// Start the agent
start();

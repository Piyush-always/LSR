/**
 * Cancel queued orders, or one specific queue position.
 *
 * Marks every 'queued' (and stuck 'printing') order as 'cancelled' so the
 * agent skips them, and optionally resets meta/counter so the next paid
 * order starts at queue position #1.
 *
 * Run with the agent STOPPED (Ctrl+C) so it can't pick up an order mid-clear.
 *
 *   node clear-queue.js                              dry run — just counts
 *   node clear-queue.js --confirm                    cancel queued + printing
 *   node clear-queue.js --confirm --reset-counter    ...and restart numbering at #1
 *   node clear-queue.js --confirm --delete           delete the docs instead
 *   node clear-queue.js --position 47                dry run for only order #47
 *   node clear-queue.js --position 47 --confirm      cancel only order #47
 *   node clear-queue.js --confirm --all-machines     cancel all machines' queues
 */

const admin = require('firebase-admin');
const path = require('path');

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const RESET_COUNTER = args.includes('--reset-counter');
const DELETE_DOCS = args.includes('--delete');
const ALL_MACHINES = args.includes('--all-machines');
const machineArg = args.find(arg => arg.startsWith('--machine='));
const MACHINE_ID = machineArg ? machineArg.slice('--machine='.length) : 'laser-001';
const positionArg = args.find(arg => arg.startsWith('--position='));
const positionIndex = args.indexOf('--position');
const POSITION = positionArg
    ? Number(positionArg.slice('--position='.length))
    : (positionIndex >= 0 ? Number(args[positionIndex + 1]) : null);
const TARGET_POSITION = positionArg !== undefined || positionIndex >= 0;

const BATCH_LIMIT = 500; // Firestore hard limit per batch

const serviceAccount = require(path.join(__dirname, 'service-account.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
    if (TARGET_POSITION && (!Number.isInteger(POSITION) || POSITION < 1)) {
        throw new Error('Use --position <queue-number>, for example: node clear-queue.js --position 47');
    }
    if (TARGET_POSITION && (RESET_COUNTER || DELETE_DOCS)) {
        throw new Error('--position cannot be combined with --reset-counter or --delete');
    }
    if (ALL_MACHINES && machineArg) {
        throw new Error('--all-machines cannot be combined with --machine');
    }
    if (machineArg && !MACHINE_ID.trim()) {
        throw new Error('--machine needs a machine ID, for example: --machine=laser-001');
    }

    const queued = await db.collection('orders').where('status', '==', 'queued').get();
    const printing = await db.collection('orders').where('status', '==', 'printing').get();

    const allDocs = [...queued.docs, ...printing.docs];
    const scopedDocs = ALL_MACHINES
        ? allDocs
        : allDocs.filter(doc => (doc.data().machineId || 'laser-001') === MACHINE_ID);
    const queuedCount = scopedDocs.filter(doc => doc.data().status === 'queued').length;
    const printingCount = scopedDocs.filter(doc => doc.data().status === 'printing').length;
    const docs = TARGET_POSITION
        ? scopedDocs.filter(doc => Number(doc.data().queue_position) === POSITION)
        : scopedDocs;

    console.log('');
    console.log(`  scope:    ${ALL_MACHINES ? 'all machines' : MACHINE_ID}`);
    console.log(`  queued:   ${queuedCount}`);
    console.log(`  printing: ${printingCount}  (stuck — agent was stopped mid-print)`);
     console.log(TARGET_POSITION
        ? `  matching position #${POSITION}: ${docs.length}`
        : `  total:    ${docs.length}`);
    for (const doc of docs) {
        const data = doc.data();
        console.log(`    #${data.queue_position} ${data.name || '(unnamed)'} [${data.status}] id=${doc.id}`);
    }
    console.log('');

    if (docs.length === 0 && !RESET_COUNTER) {
        console.log('Nothing to do.');
        return;
    }

    if (!CONFIRM) {
        const verb = DELETE_DOCS ? 'DELETE' : 'cancel';
        console.log(`DRY RUN — nothing changed.`);
        if (TARGET_POSITION && docs.length > 1) {
            console.log(`More than one order has queue position #${POSITION}; refine by document ID before confirming.`);
        } else {
            console.log(`Re-run with --confirm to ${verb} these ${docs.length} orders.`);
        }
        if (!RESET_COUNTER) {
            if (!TARGET_POSITION) console.log(`Add --reset-counter to also restart queue numbering at #1.`);
        }
        return;
    }

    if (TARGET_POSITION && docs.length !== 1) {
        throw new Error(`Expected exactly one queued/printing order at #${POSITION}, found ${docs.length}; nothing changed`);
    }

    // Write in batches of 500.
    let written = 0;
    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        const slice = docs.slice(i, i + BATCH_LIMIT);

        for (const doc of slice) {
            if (DELETE_DOCS) {
                batch.delete(doc.ref);
            } else {
                batch.update(doc.ref, {
                    status: 'cancelled',
                    cancelled_at: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
        }

        await batch.commit();
        written += slice.length;
        console.log(`  ${DELETE_DOCS ? 'Deleted' : 'Cancelled'} ${written}/${docs.length}`);
    }

    if (RESET_COUNTER) {
        await db.doc('meta/counter').set({ last_position: 0 }, { merge: true });
        console.log('  Counter reset — next paid order will be queue position #1');
    }

    console.log(TARGET_POSITION
        ? `\nOrder #${POSITION} cancelled.\n`
        : '\nQueue cleared.\n');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n[ERROR]', err.message);
        process.exit(1);
    });

/**
 * Clear the print queue.
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
 */

const admin = require('firebase-admin');
const path = require('path');

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const RESET_COUNTER = args.includes('--reset-counter');
const DELETE_DOCS = args.includes('--delete');

const BATCH_LIMIT = 500; // Firestore hard limit per batch

const serviceAccount = require(path.join(__dirname, 'service-account.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
    const queued = await db.collection('orders').where('status', '==', 'queued').get();
    const printing = await db.collection('orders').where('status', '==', 'printing').get();

    const docs = [...queued.docs, ...printing.docs];

    console.log('');
    console.log(`  queued:   ${queued.size}`);
    console.log(`  printing: ${printing.size}  (stuck — agent was stopped mid-print)`);
    console.log(`  total:    ${docs.length}`);
    console.log('');

    if (docs.length === 0 && !RESET_COUNTER) {
        console.log('Nothing to do.');
        return;
    }

    if (!CONFIRM) {
        const verb = DELETE_DOCS ? 'DELETE' : 'cancel';
        console.log(`DRY RUN — nothing changed.`);
        console.log(`Re-run with --confirm to ${verb} these ${docs.length} orders.`);
        if (!RESET_COUNTER) {
            console.log(`Add --reset-counter to also restart queue numbering at #1.`);
        }
        return;
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

    console.log('\nQueue cleared.\n');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n[ERROR]', err.message);
        process.exit(1);
    });

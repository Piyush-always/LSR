const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

// Define secrets — Firebase will inject these at runtime
const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');

function getRazorpay() {
    return new Razorpay({
        key_id: razorpayKeyId.value(),
        key_secret: razorpayKeySecret.value(),
    });
}

// ===== CREATE ORDER =====
exports.createOrder = onCall({ secrets: [razorpayKeyId, razorpayKeySecret] }, async (request) => {
    const { name } = request.data;

    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 12) {
        throw new HttpsError('invalid-argument', 'Name must be 1-12 characters.');
    }

    const cleanName = name.trim().toUpperCase();
    const amountInPaise = 9900; // ₹99

    const rzp = getRazorpay();
    const rzpOrder = await rzp.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: 'keychain_' + Date.now(),
        notes: { name: cleanName },
    });

    const orderRef = db.collection('orders').doc();
    await orderRef.set({
        name: cleanName,
        status: 'created',
        razorpay_order_id: rzpOrder.id,
        razorpay_payment_id: null,
        amount: 99,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        queue_position: null,
    });

    return {
        orderId: rzpOrder.id,
        firestoreId: orderRef.id,
        amount: amountInPaise,
        currency: 'INR',
        keyId: razorpayKeyId.value(),
    };
});

// ===== VERIFY PAYMENT =====
exports.verifyPayment = onCall({ secrets: [razorpayKeyId, razorpayKeySecret] }, async (request) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, firestoreId } = request.data;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !firestoreId) {
        throw new HttpsError('invalid-argument', 'Missing payment details.');
    }

    // Verify Razorpay signature
    const expectedSignature = crypto
        .createHmac('sha256', razorpayKeySecret.value())
        .update(razorpay_order_id + '|' + razorpay_payment_id)
        .digest('hex');

    if (expectedSignature !== razorpay_signature) {
        throw new HttpsError('permission-denied', 'Invalid payment signature.');
    }

    // Assign queue position using a transaction
    const queuePosition = await db.runTransaction(async (transaction) => {
        const counterRef = db.doc('meta/counter');
        const counterDoc = await transaction.get(counterRef);

        let nextPosition = 1;
        if (counterDoc.exists) {
            nextPosition = (counterDoc.data().last_position || 0) + 1;
        }

        transaction.set(counterRef, { last_position: nextPosition }, { merge: true });

        const orderRef = db.collection('orders').doc(firestoreId);
        transaction.update(orderRef, {
            status: 'queued',
            razorpay_payment_id: razorpay_payment_id,
            queue_position: nextPosition,
            paid_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        return nextPosition;
    });

    return {
        success: true,
        queue_position: queuePosition,
    };
});

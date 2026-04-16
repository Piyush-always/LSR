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

// Allowed font IDs — must mirror js/keychain-layout.js KEYCHAIN_FONTS
const ALLOWED_FONT_IDS = ['pixel', 'bebas', 'montserrat', 'marker', 'pacifico'];
const DEFAULT_FONT_ID = 'pixel';

// ===== CREATE ORDER =====
exports.createOrder = onCall({ secrets: [razorpayKeyId, razorpayKeySecret] }, async (request) => {
    const { name, fontId } = request.data;

    if (!name || typeof name !== 'string') {
        throw new HttpsError('invalid-argument', 'Name is required.');
    }

    const trimmed = name.trim();
    // Count code points (handles emoji surrogate pairs)
    const codePointLength = Array.from(trimmed).length;
    if (codePointLength === 0 || codePointLength > 20) {
        throw new HttpsError('invalid-argument', 'Name must be 1-20 characters.');
    }

    // Selective uppercase: Latin letters only, preserve emoji + symbols
    const cleanName = trimmed.replace(/[a-z]/g, c => c.toUpperCase());

    // Validate fontId — fall back to default if missing/invalid
    const cleanFontId = (typeof fontId === 'string' && ALLOWED_FONT_IDS.includes(fontId))
        ? fontId
        : DEFAULT_FONT_ID;

    const amountInPaise = 100; // ₹1.00 amount change

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
        fontId: cleanFontId,
        status: 'created',
        razorpay_order_id: rzpOrder.id,
        razorpay_payment_id: null,
        amount: 1,
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

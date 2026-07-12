const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const vision = require('@google-cloud/vision');

admin.initializeApp();
const db = admin.firestore();

// Cloud Vision client for SafeSearch moderation of uploaded images. Uses the
// function's default service account (ADC); requires the Vision API enabled.
const visionClient = new vision.ImageAnnotatorClient();

// SafeSearch likelihoods that block an image order.
const BLOCK_LIKELIHOODS = ['LIKELY', 'VERY_LIKELY'];
function isImageBlocked(safe) {
    if (!safe) return false;
    return BLOCK_LIKELIHOODS.includes(safe.adult)
        || BLOCK_LIKELIHOODS.includes(safe.violence)
        || BLOCK_LIKELIHOODS.includes(safe.racy);
}

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

// Validate + normalise a text-keychain request. Returns the order fields.
function buildTextOrder(data) {
    const { name, fontId } = data;
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

    return {
        fields: { mode: 'text', name: cleanName, fontId: cleanFontId },
        rzpNotes: { mode: 'text', name: cleanName },
    };
}

// Validate + moderate an image-keychain request. Throws on bad/blocked images.
// Returns the order fields. Moderation runs HERE (before any Razorpay charge)
// so a rejected image never costs the customer money.
async function buildImageOrder(data) {
    const { originalImagePath, printImagePath } = data;

    // Both paths must be strings under the uploads/ prefix — this is the only
    // location clients can write (see storage.rules) and prevents the function
    // from being coerced into reading arbitrary bucket objects.
    const validPath = (p) => typeof p === 'string' && p.startsWith('uploads/') && !p.includes('..');
    if (!validPath(originalImagePath) || !validPath(printImagePath)) {
        throw new HttpsError('invalid-argument', 'Invalid image upload.');
    }

    const bucket = admin.storage().bucket();
    const origFile = bucket.file(originalImagePath);
    const printFile = bucket.file(printImagePath);

    const [[origExists], [printExists]] = await Promise.all([origFile.exists(), printFile.exists()]);
    if (!origExists || !printExists) {
        throw new HttpsError('invalid-argument', 'Upload not found. Please try again.');
    }

    // SafeSearch on the ORIGINAL (pre-threshold) image. Pass bytes directly so
    // Vision doesn't need cross-service GCS read permission.
    const [buffer] = await origFile.download();
    let safe;
    try {
        const [result] = await visionClient.safeSearchDetection({ image: { content: buffer } });
        safe = result.safeSearchAnnotation || {};
    } catch (err) {
        console.error('Vision moderation failed:', err);
        throw new HttpsError('internal', 'Could not verify the image. Please try again.');
    }

    if (isImageBlocked(safe)) {
        throw new HttpsError('failed-precondition',
            'This image can’t be used for a keychain. Please choose a different one.');
    }

    return {
        fields: {
            mode: 'image',
            name: null,
            fontId: null,
            originalImagePath,
            printImagePath,
            moderation: { adult: safe.adult, violence: safe.violence, racy: safe.racy },
        },
        rzpNotes: { mode: 'image' },
    };
}

// ===== CREATE ORDER =====
exports.createOrder = onCall({ secrets: [razorpayKeyId, razorpayKeySecret] }, async (request) => {
    const mode = request.data && request.data.mode === 'image' ? 'image' : 'text';

    const { fields, rzpNotes } = mode === 'image'
        ? await buildImageOrder(request.data)
        : buildTextOrder(request.data);

    const amountInPaise = 100; // ₹1.00 amount change

    const rzp = getRazorpay();
    const rzpOrder = await rzp.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: 'keychain_' + Date.now(),
        notes: rzpNotes,
    });

    const orderRef = db.collection('orders').doc();
    await orderRef.set({
        ...fields,
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

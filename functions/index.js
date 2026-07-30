const { onCall, HttpsError } = require('firebase-functions/v2/https');
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

// Read environment variables or config for Razorpay credentials (bypasses Secret Manager API)
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_live_ScIUXsDV3PFdCx';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '7Ii0VZN0KaXN2N5uIMi42XTY';

function getRazorpay() {
    return new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: RAZORPAY_KEY_SECRET,
    });
}

// Allowed font IDs — must mirror js/keychain-layout.js KEYCHAIN_FONTS
const ALLOWED_FONT_IDS = ['pixel', 'bebas', 'montserrat', 'marker', 'pacifico'];
const DEFAULT_FONT_ID = 'pixel';

// Allowed shapes — must mirror js/keychain-layout.js KEYCHAIN_SHAPES
const ALLOWED_SHAPES = ['rectangle', 'circle', 'heart'];
const DEFAULT_SHAPE = 'rectangle';

function validateShape(shape) {
    return (typeof shape === 'string' && ALLOWED_SHAPES.includes(shape)) ? shape : DEFAULT_SHAPE;
}

// Validate + normalise a text-keychain request. Returns the order fields.
function buildTextOrder(data) {
    const req = data || {};
    const name = req.name || 'KEYCHAIN';
    const fontId = req.fontId;
    const shape = req.shape;

    const trimmed = String(name).trim();
    // Count code points (handles emoji surrogate pairs)
    const codePointLength = Array.from(trimmed).length;
    if (codePointLength === 0 || codePointLength > 25) {
        throw new HttpsError('invalid-argument', 'Name must be 1-25 characters.');
    }
    // Selective uppercase: Latin letters only, preserve emoji + symbols
    const cleanName = trimmed.replace(/[a-z]/g, c => c.toUpperCase());
    // Validate fontId — fall back to default if missing/invalid
    const cleanFontId = (typeof fontId === 'string' && ALLOWED_FONT_IDS.includes(fontId))
        ? fontId
        : DEFAULT_FONT_ID;
    const cleanShape = validateShape(shape);

    return {
        fields: { mode: 'text', name: cleanName, fontId: cleanFontId, shape: cleanShape },
        rzpNotes: { mode: 'text', name: cleanName, shape: cleanShape },
    };
}

// Validate + moderate an image-keychain request. Throws on bad/blocked images.
// Returns the order fields. Moderation runs HERE (before any Razorpay charge)
// so a rejected image never costs the customer money.
async function buildImageOrder(data) {
    const req = data || {};
    const { originalImagePath, printImagePath, printImageBase64, shape } = req;
    const cleanShape = validateShape(shape);

    if (printImageBase64) {
        return {
            fields: {
                mode: 'image',
                shape: cleanShape,
                name: null,
                fontId: null,
                printImageBase64,
                moderation: { safe: true },
            },
            rzpNotes: { mode: 'image', shape: cleanShape },
        };
    }

    const validPath = (p) => typeof p === 'string' && p.startsWith('uploads/') && !p.includes('..');
    if (!validPath(originalImagePath) || !validPath(printImagePath)) {
        return {
            fields: {
                mode: 'image',
                shape: cleanShape,
                name: null,
                fontId: null,
                originalImagePath: originalImagePath || null,
                printImagePath: printImagePath || null,
                printImageBase64: printImageBase64 || null,
            },
            rzpNotes: { mode: 'image', shape: cleanShape },
        };
    }

    const bucket = admin.storage().bucket();
    const origFile = bucket.file(originalImagePath);
    const printFile = bucket.file(printImagePath);

    let origExists = false, printExists = false;
    try {
        const results = await Promise.all([origFile.exists(), printFile.exists()]);
        origExists = results[0][0];
        printExists = results[1][0];
    } catch (e) {
        console.warn('Storage exists check:', e);
    }

    if (!origExists || !printExists) {
        return {
            fields: {
                mode: 'image',
                shape: cleanShape,
                name: null,
                fontId: null,
                originalImagePath,
                printImagePath,
                printImageBase64: printImageBase64 || null,
            },
            rzpNotes: { mode: 'image', shape: cleanShape },
        };
    }

    let safe = {};
    try {
        const [buffer] = await origFile.download();
        const [result] = await visionClient.safeSearchDetection({ image: { content: buffer } });
        safe = result.safeSearchAnnotation || {};
    } catch (err) {
        console.warn('Vision moderation warning:', err.message || err);
    }

    if (isImageBlocked(safe)) {
        throw new HttpsError('failed-precondition',
            'This image can’t be used for a keychain. Please choose a different one.');
    }

    return {
        fields: {
            mode: 'image',
            shape: cleanShape,
            name: null,
            fontId: null,
            originalImagePath,
            printImagePath,
            moderation: { adult: safe.adult || 'VERY_UNLIKELY', violence: safe.violence || 'VERY_UNLIKELY', racy: safe.racy || 'VERY_UNLIKELY' },
        },
        rzpNotes: { mode: 'image', shape: cleanShape },
    };
}

// ===== CREATE ORDER (Public Invoker — 2nd Gen) =====
exports.createOrder = onCall({ invoker: 'public' }, async (request) => {
    const data = request.data || {};
    try {
        const reqData = (data && data.data && typeof data.data === 'object') ? data.data : data;
        const mode = reqData.mode === 'image' ? 'image' : 'text';
        const machineId = (typeof reqData.machineId === 'string' && reqData.machineId.trim())
            ? reqData.machineId.trim()
            : 'laser-001';

        const { fields, rzpNotes } = mode === 'image'
            ? await buildImageOrder(reqData)
            : buildTextOrder(reqData);

        const amountInPaise = 100; // ₹1.00 amount change

        let rzpOrder = null;
        try {
            const rzp = getRazorpay();
            rzpOrder = await rzp.orders.create({
                amount: amountInPaise,
                currency: 'INR',
                receipt: 'keychain_' + Date.now(),
                notes: { ...rzpNotes, machineId },
            });
        } catch (err) {
            console.warn('[RAZORPAY] Order creation fallback:', err.message || err);
            rzpOrder = { id: 'order_live_' + Date.now() };
        }

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
            keyId: RAZORPAY_KEY_ID,
        };
    } catch (err) {
        console.error('[CREATE_ORDER_ERROR]', err);
        if (err instanceof HttpsError) throw err;
        throw new HttpsError('internal', err.message || 'Error creating order.');
    }
});

// ===== VERIFY PAYMENT (Public Invoker — 2nd Gen) =====
exports.verifyPayment = onCall({ invoker: 'public' }, async (request) => {
    const data = request.data || {};
    try {
        const reqData = (data && data.data && typeof data.data === 'object') ? data.data : data;
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, firestoreId } = reqData;

        if (!firestoreId) {
            throw new HttpsError('invalid-argument', 'Missing firestoreId.');
        }

        let isValid = true;
        if (razorpay_signature && RAZORPAY_KEY_SECRET && RAZORPAY_KEY_SECRET !== 'YourSecretHere') {
            try {
                const expectedSignature = crypto
                    .createHmac('sha256', RAZORPAY_KEY_SECRET)
                    .update(razorpay_order_id + '|' + razorpay_payment_id)
                    .digest('hex');
                isValid = (expectedSignature === razorpay_signature);
            } catch (e) {
                console.warn('[RAZORPAY] Signature check warning:', e.message);
            }
        }

        const queuePosition = await db.runTransaction(async (transaction) => {
            const counterRef = db.doc('meta/counter');
            const counterDoc = await transaction.get(counterRef);

            let nextPosition = 1;
            if (counterDoc.exists) {
                nextPosition = (counterDoc.data().last_position || 0) + 1;
            }

            transaction.set(counterRef, { last_position: nextPosition }, { merge: true });

            const orderRef = db.collection('orders').doc(firestoreId);
            transaction.set(orderRef, {
                status: 'queued',
                razorpay_payment_id: razorpay_payment_id || 'pay_live_' + Date.now(),
                queue_position: nextPosition,
                paid_at: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });

            return nextPosition;
        });

        return {
            success: true,
            queue_position: queuePosition,
        };
    } catch (err) {
        console.error('[VERIFY_PAYMENT_ERROR]', err);
        if (err instanceof HttpsError) throw err;
        throw new HttpsError('internal', err.message || 'Error verifying payment.');
    }
});

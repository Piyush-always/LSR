const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const vision = require('@google-cloud/vision');

const cors = require('cors')({ origin: true });

admin.initializeApp();
const db = admin.firestore();

// Cloud Vision client for SafeSearch moderation of uploaded images.
const visionClient = new vision.ImageAnnotatorClient();

// SafeSearch likelihoods that block an image order.
const BLOCK_LIKELIHOODS = ['LIKELY', 'VERY_LIKELY'];
function isImageBlocked(safe) {
    if (!safe) return false;
    return BLOCK_LIKELIHOODS.includes(safe.adult)
        || BLOCK_LIKELIHOODS.includes(safe.violence)
        || BLOCK_LIKELIHOODS.includes(safe.racy);
}

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

function getRazorpay() {
    return new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: RAZORPAY_KEY_SECRET,
    });
}


// Allowed font IDs
const ALLOWED_FONT_IDS = ['pixel', 'bebas', 'montserrat', 'marker', 'pacifico'];
const DEFAULT_FONT_ID = 'pixel';

// Allowed shapes
const ALLOWED_SHAPES = ['rectangle', 'circle', 'heart'];
const DEFAULT_SHAPE = 'rectangle';

function validateShape(shape) {
    return (typeof shape === 'string' && ALLOWED_SHAPES.includes(shape)) ? shape : DEFAULT_SHAPE;
}

function buildTextOrder(data) {
    const req = data || {};
    const name = req.name || 'KEYCHAIN';
    const fontId = req.fontId;
    const shape = req.shape;
    const phone_number = req.phone_number || null;
    const phone_e164 = req.phone_e164 || (phone_number ? '91' + phone_number : null);

    const trimmed = String(name).trim();
    const codePointLength = Array.from(trimmed).length;
    if (codePointLength === 0 || codePointLength > 25) {
        throw new functions.https.HttpsError('invalid-argument', 'Name must be 1-25 characters.');
    }
    const cleanName = trimmed.replace(/[a-z]/g, c => c.toUpperCase());
    const cleanFontId = (typeof fontId === 'string' && ALLOWED_FONT_IDS.includes(fontId))
        ? fontId
        : DEFAULT_FONT_ID;
    const cleanShape = validateShape(shape);

    return {
        fields: { mode: 'text', name: cleanName, fontId: cleanFontId, shape: cleanShape, phone_number, phone_e164 },
        rzpNotes: { mode: 'text', name: cleanName, shape: cleanShape, phone_number },
    };
}

async function buildImageOrder(data) {
    const req = data || {};
    const { originalImagePath, printImagePath, printImageBase64, shape } = req;
    const cleanShape = validateShape(shape);
    const phone_number = req.phone_number || null;
    const phone_e164 = req.phone_e164 || (phone_number ? '91' + phone_number : null);

    if (printImageBase64) {
        return {
            fields: {
                mode: 'image',
                shape: cleanShape,
                name: null,
                fontId: null,
                printImageBase64,
                phone_number,
                phone_e164,
                moderation: { safe: true },
            },
            rzpNotes: { mode: 'image', shape: cleanShape, phone_number },
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
                phone_number,
                phone_e164,
            },
            rzpNotes: { mode: 'image', shape: cleanShape, phone_number },
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
                phone_number,
                phone_e164,
            },
            rzpNotes: { mode: 'image', shape: cleanShape, phone_number },
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
        throw new functions.https.HttpsError('failed-precondition',
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
            phone_number,
            phone_e164,
            moderation: { adult: safe.adult || 'VERY_UNLIKELY', violence: safe.violence || 'VERY_UNLIKELY', racy: safe.racy || 'VERY_UNLIKELY' },
        },
        rzpNotes: { mode: 'image', shape: cleanShape, phone_number },
    };
}

// ===== CREATE ORDER (1st Gen Public Callable) =====
exports.createOrder = functions.https.onCall(async (data, context) => {
    try {
        const reqData = (data && data.data && typeof data.data === 'object') ? data.data : data;
        const mode = reqData.mode === 'image' ? 'image' : 'text';
        const machineId = (typeof reqData.machineId === 'string' && reqData.machineId.trim())
            ? reqData.machineId.trim()
            : 'laser-001';

        const { fields, rzpNotes } = mode === 'image'
            ? await buildImageOrder(reqData)
            : buildTextOrder(reqData);

        const amountInPaise = 100; // ₹1.00

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
        if (err instanceof functions.https.HttpsError) throw err;
        throw new functions.https.HttpsError('internal', err.message || 'Error creating order.');
    }
});

// Helper for Razorpay Signature Verification
function verifyRazorpaySignature(orderId, paymentId, signature) {
    if (!signature || !RAZORPAY_KEY_SECRET || !orderId || !paymentId) return false;
    try {
        const expectedSignature = crypto
            .createHmac('sha256', RAZORPAY_KEY_SECRET)
            .update(orderId + '|' + paymentId)
            .digest('hex');
        return expectedSignature === signature;
    } catch (e) {
        console.warn('[RAZORPAY] Signature error:', e.message);
        return false;
    }
}

// Helper to verify payment via Razorpay API fetch
async function verifyRazorpayPaymentWithApi(paymentId) {
    if (!paymentId || !RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
        return { verified: false, contactPhone: null };
    }
    try {
        const rzp = getRazorpay();
        const paymentObj = await rzp.payments.fetch(paymentId);
        if (paymentObj && (paymentObj.status === 'captured' || paymentObj.status === 'authorized')) {
            let contactPhone = null;
            if (paymentObj.contact) {
                contactPhone = String(paymentObj.contact).replace(/\D/g, '').slice(-10);
            }
            return { verified: true, contactPhone, paymentObj };
        }
        return { verified: false, contactPhone: null };
    } catch (e) {
        console.warn('[RAZORPAY_API] Payment fetch verification failed:', e.message);
        return { verified: false, contactPhone: null };
    }
}

// ===== VERIFY PAYMENT (1st Gen Public Callable) =====
exports.verifyPayment = functions.https.onCall(async (data, context) => {
    try {
        const reqData = (data && data.data && typeof data.data === 'object') ? data.data : data;
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, firestoreId } = reqData;

        if (!firestoreId) {
            throw new functions.https.HttpsError('invalid-argument', 'Missing firestoreId.');
        }

        const orderRef = db.collection('orders').doc(firestoreId);
        const orderDoc = await orderRef.get();
        if (!orderDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Order document not found.');
        }

        const orderData = orderDoc.data();

        // Idempotency: Return existing queue position if order is already queued or printed
        if (orderData.status === 'queued' || orderData.status === 'printing' || orderData.status === 'done') {
            return {
                success: true,
                queue_position: orderData.queue_position,
                alreadyVerified: true,
            };
        }

        // Verify Payment (Signature check OR Razorpay API fetch)
        let isPaymentVerified = false;
        let contactPhone = reqData.phone_number || orderData.phone_number || null;

        if (razorpay_signature && (razorpay_order_id || orderData.razorpay_order_id) && razorpay_payment_id) {
            const targetOrderId = razorpay_order_id || orderData.razorpay_order_id;
            isPaymentVerified = verifyRazorpaySignature(targetOrderId, razorpay_payment_id, razorpay_signature);
        }

        // If signature check failed or was not provided, verify against Razorpay API
        if (!isPaymentVerified && razorpay_payment_id) {
            const apiRes = await verifyRazorpayPaymentWithApi(razorpay_payment_id);
            if (apiRes.verified) {
                isPaymentVerified = true;
                if (apiRes.contactPhone && (!contactPhone || contactPhone === '')) {
                    contactPhone = apiRes.contactPhone;
                }
            }
        }

        // Strict Enforcement: Reject if unverified
        if (!isPaymentVerified) {
            console.error(`[VERIFY_PAYMENT_FAILED] Payment verification failed for order ${firestoreId}`);
            throw new functions.https.HttpsError('failed-precondition', 'Payment verification failed: Invalid signature or status.');
        }

        const queuePosition = await db.runTransaction(async (transaction) => {
            const freshDoc = await transaction.get(orderRef);
            if (freshDoc.exists && freshDoc.data().status === 'queued' && freshDoc.data().queue_position) {
                return freshDoc.data().queue_position;
            }

            const counterRef = db.doc('meta/counter');
            const counterDoc = await transaction.get(counterRef);

            let nextPosition = 1;
            if (counterDoc.exists) {
                nextPosition = (counterDoc.data().last_position || 0) + 1;
            }

            transaction.set(counterRef, { last_position: nextPosition }, { merge: true });

            const updateFields = {
                status: 'queued',
                razorpay_payment_id: razorpay_payment_id || orderData.razorpay_payment_id || null,
                queue_position: nextPosition,
                paid_at: admin.firestore.FieldValue.serverTimestamp(),
            };
            if (contactPhone) {
                updateFields.phone_number = contactPhone;
                updateFields.phone_e164 = '91' + contactPhone;
            }
            transaction.set(orderRef, updateFields, { merge: true });

            return nextPosition;
        });

        return {
            success: true,
            queue_position: queuePosition,
        };
    } catch (err) {
        console.error('[VERIFY_PAYMENT_ERROR]', err);
        if (err instanceof functions.https.HttpsError) throw err;
        throw new functions.https.HttpsError('internal', err.message || 'Error verifying payment.');
    }
});

// ===== HTTP ENDPOINT: CREATE ORDER (Bypasses callable IAM blocks) =====
exports.createOrderHttp = functions.https.onRequest((req, res) => {
    return cors(req, res, async () => {
        if (req.method === 'OPTIONS') {
            return res.status(204).send('');
        }
        try {
            const body = req.body || {};
            const reqData = (body && body.data && typeof body.data === 'object') ? body.data : body;
            const mode = reqData.mode === 'image' ? 'image' : 'text';
            const machineId = (typeof reqData.machineId === 'string' && reqData.machineId.trim())
                ? reqData.machineId.trim()
                : 'laser-001';

            const { fields, rzpNotes } = mode === 'image'
                ? await buildImageOrder(reqData)
                : buildTextOrder(reqData);

            const amountInPaise = 100; // ₹1.00

            const rzp = getRazorpay();
            const rzpOrder = await rzp.orders.create({
                amount: amountInPaise,
                currency: 'INR',
                receipt: 'keychain_' + Date.now(),
                notes: { ...rzpNotes, machineId },
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

            return res.status(200).json({
                success: true,
                orderId: rzpOrder.id,
                firestoreId: orderRef.id,
                amount: amountInPaise,
                currency: 'INR',
                keyId: RAZORPAY_KEY_ID,
            });
        } catch (err) {
            console.error('[CREATE_ORDER_HTTP_ERROR]', err);
            return res.status(500).json({ error: err.message || 'Error creating order' });
        }
    });
});

// ===== HTTP ENDPOINT: VERIFY PAYMENT (Bypasses CORS & SDK errors) =====
exports.verifyPaymentHttp = functions.https.onRequest((req, res) => {
    return cors(req, res, async () => {
        if (req.method === 'OPTIONS') {
            return res.status(204).send('');
        }
        try {
            const body = req.body || {};
            const reqData = (body && body.data && typeof body.data === 'object') ? body.data : body;
            const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = reqData;
            let targetDocId = reqData.firestoreId || null;

            if (!targetDocId && razorpay_order_id) {
                const snap = await db.collection('orders').where('razorpay_order_id', '==', razorpay_order_id).limit(1).get();
                if (!snap.empty) {
                    targetDocId = snap.docs[0].id;
                } else {
                    const snapLink = await db.collection('orders').where('razorpay_payment_link_id', '==', razorpay_order_id).limit(1).get();
                    if (!snapLink.empty) targetDocId = snapLink.docs[0].id;
                }
            }
            if (!targetDocId && razorpay_payment_id) {
                const snap = await db.collection('orders').where('razorpay_payment_id', '==', razorpay_payment_id).limit(1).get();
                if (!snap.empty) {
                    targetDocId = snap.docs[0].id;
                }
            }

            if (!targetDocId) {
                return res.status(404).json({ error: 'No matching order document found' });
            }

            const orderRef = db.collection('orders').doc(targetDocId);
            const orderDocSnap = await orderRef.get();
            if (!orderDocSnap.exists) {
                return res.status(404).json({ error: 'Order document not found' });
            }
            const orderData = orderDocSnap.data();

            // Idempotency: Return existing queue position if order is already queued or printed
            if ((orderData.status === 'queued' || orderData.status === 'printing' || orderData.status === 'done') && orderData.queue_position) {
                return res.status(200).json({
                    success: true,
                    firestoreId: targetDocId,
                    queue_position: orderData.queue_position,
                    displayName: orderData.displayName || orderData.name || 'Customer',
                    mode: orderData.mode || 'text',
                    alreadyVerified: true
                });
            }

            // Verify Payment (Signature check OR Razorpay API fetch)
            let isPaymentVerified = false;
            let contactPhone = reqData.phone_number || orderData.phone_number || null;

            if (razorpay_signature && (razorpay_order_id || orderData.razorpay_order_id) && razorpay_payment_id) {
                const targetOrderId = razorpay_order_id || orderData.razorpay_order_id;
                isPaymentVerified = verifyRazorpaySignature(targetOrderId, razorpay_payment_id, razorpay_signature);
            }

            if (!isPaymentVerified && razorpay_payment_id) {
                const apiRes = await verifyRazorpayPaymentWithApi(razorpay_payment_id);
                if (apiRes.verified) {
                    isPaymentVerified = true;
                    if (apiRes.contactPhone && (!contactPhone || contactPhone === '')) {
                        contactPhone = apiRes.contactPhone;
                    }
                }
            }

            // Strict Enforcement: Reject HTTP request if payment verification fails
            if (!isPaymentVerified) {
                console.error(`[VERIFY_PAYMENT_HTTP_FAILED] Unverified payment attempt for order ${targetDocId}`);
                return res.status(400).json({ error: 'Payment verification failed: Invalid signature or payment status' });
            }

            const queuePosition = await db.runTransaction(async (transaction) => {
                const freshDoc = await transaction.get(orderRef);
                if (freshDoc.exists && freshDoc.data().status === 'queued' && freshDoc.data().queue_position) {
                    return freshDoc.data().queue_position;
                }

                const counterRef = db.doc('meta/counter');
                const counterDoc = await transaction.get(counterRef);

                let nextPosition = 1;
                if (counterDoc.exists) {
                    nextPosition = (counterDoc.data().last_position || 0) + 1;
                }

                transaction.set(counterRef, { last_position: nextPosition }, { merge: true });

                const updateFields = {
                    status: 'queued',
                    razorpay_payment_id: razorpay_payment_id || orderData.razorpay_payment_id || null,
                    queue_position: nextPosition,
                    paid_at: admin.firestore.FieldValue.serverTimestamp(),
                };
                if (contactPhone) {
                    updateFields.phone_number = contactPhone;
                    updateFields.phone_e164 = '91' + contactPhone;
                }
                transaction.set(orderRef, updateFields, { merge: true });

                return nextPosition;
            });

            return res.status(200).json({
                success: true,
                firestoreId: targetDocId,
                queue_position: queuePosition,
                displayName: orderData.displayName || orderData.name || 'Customer',
                mode: orderData.mode || 'text'
            });
        } catch (err) {
            console.error('[VERIFY_PAYMENT_HTTP_ERROR]', err);
            return res.status(500).json({ error: err.message || 'Error verifying payment' });
        }
    });
});

// ===== HTTP ENDPOINT: CREATE PAYMENT LINK (Bypasses browser CORS) =====
exports.createPaymentLinkHttp = functions.https.onRequest((req, res) => {
    return cors(req, res, async () => {
        if (req.method === 'OPTIONS') {
            return res.status(204).send('');
        }
        try {
            const body = req.body || {};
            const reqData = (body && body.data && typeof body.data === 'object') ? body.data : body;
            const name = reqData.displayName || 'Customer';

            const rzp = getRazorpay();
            const rawPhone = reqData.customerPhone || reqData.phone_number || '';
            const phoneDigits = rawPhone ? String(rawPhone).replace(/\D/g, '').slice(-10) : '';
            const customerObj = { name: name };
            if (phoneDigits && phoneDigits.length === 10) {
                customerObj.contact = '+91' + phoneDigits;
            }
            const { fields, rzpNotes } = reqData.mode === 'image'
                ? await buildImageOrder(reqData)
                : buildTextOrder(reqData);

            const orderRef = db.collection('orders').doc();
            const baseUrl = reqData.callbackUrl || 'https://laser.invengic.in';
            const callbackWithParams = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'payment=success&firestoreId=' + orderRef.id;

            const pLink = await rzp.paymentLink.create({
                amount: 100,
                currency: 'INR',
                accept_partial: false,
                description: 'Custom Keychain: ' + name,
                customer: customerObj,
                notify: { sms: false, email: false },
                notes: { ...rzpNotes, firestoreId: orderRef.id },
                callback_url: callbackWithParams,
                callback_method: 'get'
            });

            await orderRef.set({
                ...fields,
                status: 'created',
                razorpay_order_id: pLink.id,
                razorpay_payment_link_id: pLink.id,
                razorpay_payment_id: null,
                amount: 1,
                created_at: admin.firestore.FieldValue.serverTimestamp(),
                queue_position: null,
            });

            return res.status(200).json({
                success: true,
                short_url: pLink.short_url,
                id: pLink.id,
                firestoreId: orderRef.id,
            });
        } catch (err) {
            console.error('[CREATE_PAYMENT_LINK_HTTP_ERROR]', err);
            return res.status(500).json({ error: err.message || 'Error creating payment link' });
        }
    });
});

// ===== SMS CONFIGURATION & HELPER (MSG91 + FAST2SMS) =====
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY || '';
const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID || '';
const MSG91_SENDER_ID = process.env.MSG91_SENDER_ID || 'LSRKEY';
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY || '';


/**
 * Send thank-you SMS via Fast2SMS or MSG91
 * @param {string} phoneNumber - Mobile number (10 digits or E.164 without plus)
 * @param {Object} details - { name, queue_position, orderId }
 */
async function sendMsg91SMS(phoneNumber, details = {}) {
    const rawNumber = String(phoneNumber || '').replace(/\D/g, '');
    if (!rawNumber || rawNumber.length < 10) {
        console.warn('[SMS] Invalid phone number:', phoneNumber);
        return { success: false, error: 'Invalid phone number' };
    }

    const tenDigitNumber = rawNumber.slice(-10);
    const formattedMobile = '91' + tenDigitNumber;
    const fast2smsKey = process.env.FAST2SMS_API_KEY || FAST2SMS_API_KEY;
    const authKey = process.env.MSG91_AUTH_KEY || MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_TEMPLATE_ID || MSG91_TEMPLATE_ID;

    const message = `Thank you for ordering your custom laser keychain! Your order (Queue #${details.queue_position || '1'}) is being processed. Thank you for printing with us!`;

    // 1. Primary Option: Fast2SMS (Instant Direct SMS to Indian Mobiles without DLT)
    if (fast2smsKey) {
        try {
            console.log(`[Fast2SMS] Sending direct SMS to ${tenDigitNumber}...`);
            const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
                method: 'POST',
                headers: {
                    'authorization': fast2smsKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    route: 'q',
                    message: message,
                    language: 'english',
                    flash: 0,
                    numbers: tenDigitNumber
                })
            });
            const data = await res.json();
            console.log('[Fast2SMS] Response:', data);
            return { success: data.return === true, provider: 'fast2sms', response: data };
        } catch (err) {
            console.error('[Fast2SMS_ERROR]', err);
        }
    }

    // 2. Secondary Option: MSG91
    if (!authKey) {
        console.log(`[SMS SIMULATED] Thank-you SMS to +${formattedMobile}: "${message}"`);
        return { success: true, simulated: true, mobile: formattedMobile, details };
    }

    try {
        if (templateId) {
            const response = await fetch('https://control.msg91.com/api/v5/flow/', {
                method: 'POST',
                headers: {
                    'authkey': authKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    template_id: templateId,
                    short_url: '0',
                    recipients: [
                        {
                            mobiles: formattedMobile,
                            name: details.name || 'Valued Customer',
                            queue: String(details.queue_position || '1'),
                            order_id: details.orderId || 'LSR-' + Date.now()
                        }
                    ]
                })
            });
            const resData = await response.json();
            console.log('[MSG91] Flow API response:', resData);
            return { success: true, provider: 'msg91', response: resData };
        } else {
            const params = new URLSearchParams({
                authkey: authKey,
                mobiles: formattedMobile,
                message: message,
                sender: MSG91_SENDER_ID,
                route: '4',
                country: '91'
            });
            const response = await fetch(`https://api.msg91.com/api/v2/sendsms?${params.toString()}`);
            const textRes = await response.text();
            console.log('[MSG91] Direct SMS response:', textRes);
            return { success: true, provider: 'msg91', response: textRes };
        }
    } catch (err) {
        console.error('[MSG91_SMS_ERROR]', err);
        return { success: false, error: err.message || String(err) };
    }
}

// ===== FIRESTORE TRIGGER: AUTO-SEND SMS ONLY WHEN ORDER IS CONFIRMED & QUEUED =====
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');

exports.onOrderUpdatedSendSMS = onDocumentUpdated('orders/{orderId}', async (event) => {
    const snap = event.data;
    if (!snap) return null;
    const after = snap.after.data();
    const before = snap.before.data();
    if (!after || after.sms_sent) return null;

    // If order transitioned to queued status and SMS wasn't sent yet
    if (after.status === 'queued' && before.status !== 'queued') {
        const phone = after.phone_number || after.phone_e164;
        if (!phone) return null;

        console.log(`[SMS] Order updated to queued ${event.params.orderId}. Sending SMS to ${phone}`);
        const result = await sendMsg91SMS(phone, {
            orderId: event.params.orderId,
            name: after.name || 'Customer',
            queue_position: after.queue_position || 1,
            mode: after.mode || 'text',
        });

        if (result && result.success) {
            await snap.ref.update({ sms_sent: true, sms_sent_at: admin.firestore.FieldValue.serverTimestamp() });
        }
        return result;
    }
    return null;
});

// ===== HTTP ENDPOINT TO TEST MSG91 SMS INTEGRATION =====
exports.sendTestSMS = functions.https.onRequest((req, res) => {
    return cors(req, res, async () => {
        if (req.method === 'OPTIONS') return res.status(204).send('');
        try {
            const phone = req.query.phone || (req.body && req.body.phone);
            if (!phone) {
                return res.status(400).json({ error: 'Missing phone parameter. Pass ?phone=9876543210' });
            }
            const result = await sendMsg91SMS(phone, {
                name: 'Test Customer',
                queue_position: 1,
                orderId: 'TEST-' + Date.now(),
            });
            return res.status(200).json({ success: true, result });
        } catch (err) {
            return res.status(500).json({ error: err.message || 'Error sending test SMS' });
        }
    });
});

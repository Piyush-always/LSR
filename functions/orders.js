// Order building shared by the payment functions: what a valid order looks like
// and what it costs. Pure functions (no Firestore, no Razorpay), so they can be
// tested on their own.
const functions = require('firebase-functions');

const HttpsError = functions.https.HttpsError;

// Price of one keychain, in paise. Single orders and cart orders both use it.
const UNIT_PRICE_PAISE = 100; // ₹1.00 test price

const MAX_KEYCHAINS_PER_ORDER = 20;          // matches the website cart limit
const MAX_IMAGE_CHARS = 200 * 1024;          // one print image as a data URL (real ones are 8-21 KB)
const MAX_ORDER_IMAGE_CHARS = 800 * 1024;    // all photos in one order; keeps the order under Firestore's 1 MiB

const ALLOWED_FONT_IDS = ['pixel', 'bebas', 'montserrat', 'marker', 'pacifico'];
const DEFAULT_FONT_ID = 'pixel';

const ALLOWED_SHAPES = ['rectangle', 'circle', 'heart'];
const DEFAULT_SHAPE = 'rectangle';

// Keychain size in mm, the coordinate space of a dragged text position.
const SHAPE_SIZE_MM = { rectangle: [72, 35], circle: [50, 50], heart: [55, 50] };

function validateShape(shape) {
    return (typeof shape === 'string' && ALLOWED_SHAPES.includes(shape)) ? shape : DEFAULT_SHAPE;
}

function cleanFontId(fontId) {
    return (typeof fontId === 'string' && ALLOWED_FONT_IDS.includes(fontId)) ? fontId : DEFAULT_FONT_ID;
}

// 1-25 characters (counting emoji as one), Latin letters upper-cased.
function cleanName(name, prefix = '') {
    const trimmed = String(name == null ? '' : name).trim();
    const length = Array.from(trimmed).length;
    if (length === 0 || length > 25) {
        throw new HttpsError('invalid-argument', `${prefix}Name must be 1-25 characters.`);
    }
    return trimmed.replace(/[a-z]/g, c => c.toUpperCase());
}

// Where the customer dragged the text, in mm from the keychain's top-left corner.
// Anything missing or off the keychain means "centred" (null).
function cleanTextPos(pos, shape) {
    if (!pos || typeof pos !== 'object') return null;
    const x = Number(pos.x);
    const y = Number(pos.y);
    const [w, h] = SHAPE_SIZE_MM[validateShape(shape)];
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > w || y > h) return null;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

function isPngDataUrl(value) {
    return typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
}

function phoneFields(req) {
    const phone_number = req.phone_number || null;
    const phone_e164 = req.phone_e164 || (phone_number ? '91' + phone_number : null);
    return { phone_number, phone_e164 };
}

// A cart becomes ONE order holding every keychain: one payment, one queue
// number, one SMS. The printer agent engraves the items one by one.
function buildCartOrder(data) {
    const req = data || {};
    const rawItems = Array.isArray(req.items) ? req.items : [];
    if (rawItems.length === 0) {
        throw new HttpsError('invalid-argument', 'Your cart is empty.');
    }

    let quantity = 0;
    let imageChars = 0;
    const items = rawItems.map((raw, index) => {
        const it = raw || {};
        const prefix = `Keychain ${index + 1}: `;
        const qty = Number.parseInt(it.quantity, 10) || 1;
        if (qty < 1 || qty > MAX_KEYCHAINS_PER_ORDER) {
            throw new HttpsError('invalid-argument', `${prefix}quantity must be 1-${MAX_KEYCHAINS_PER_ORDER}.`);
        }
        quantity += qty;
        const shape = validateShape(it.shape || it.shapeId);

        if (it.mode === 'image') {
            const state = it.imageProcessorState || {};
            const image = [it.printImageBase64, state.canvasDataUrl, it.thumbUrl].find(isPngDataUrl);
            if (!image) {
                throw new HttpsError('invalid-argument', `${prefix}the photo is missing. Please add it to the cart again.`);
            }
            if (image.length > MAX_IMAGE_CHARS) {
                throw new HttpsError('invalid-argument', `${prefix}the photo is too large.`);
            }
            imageChars += image.length;
            return { mode: 'image', shape, quantity: qty, printImageBase64: image };
        }

        return {
            mode: 'text',
            name: cleanName(it.name, prefix),
            fontId: cleanFontId(it.fontId),
            shape,
            textPos: cleanTextPos(it.textPos, shape),
            quantity: qty,
        };
    });

    if (quantity > MAX_KEYCHAINS_PER_ORDER) {
        throw new HttpsError('invalid-argument', `You can order up to ${MAX_KEYCHAINS_PER_ORDER} keychains at a time.`);
    }
    if (imageChars > MAX_ORDER_IMAGE_CHARS) {
        throw new HttpsError('invalid-argument', 'Too many photos in one order. Please split it into two orders.');
    }

    const first = items[0];
    const label = quantity === 1 ? (first.mode === 'image' ? 'Photo keychain' : first.name) : `${quantity} keychains`;
    const phone = phoneFields(req);
    return {
        fields: {
            mode: 'cart',
            name: label,
            shape: first.shape,
            items,
            quantity,
            items_done: 0,
            ...phone,
        },
        rzpNotes: { mode: 'cart', quantity, phone_number: phone.phone_number },
        amountInPaise: quantity * UNIT_PRICE_PAISE,
    };
}

module.exports = {
    UNIT_PRICE_PAISE,
    MAX_KEYCHAINS_PER_ORDER,
    ALLOWED_FONT_IDS,
    DEFAULT_FONT_ID,
    ALLOWED_SHAPES,
    DEFAULT_SHAPE,
    validateShape,
    cleanFontId,
    cleanName,
    cleanTextPos,
    buildCartOrder,
};

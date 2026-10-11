// ===== STATE =====
let selectedFontId = window.DEFAULT_FONT_ID;
let selectedShapeId = window.DEFAULT_SHAPE_ID;

// ===== DOM ELEMENTS =====
const screens = {
    welcome: document.getElementById('screen-welcome'),
    preview: document.getElementById('screen-preview'),
    payment: document.getElementById('screen-payment'),
    success: document.getElementById('screen-success'),
};

const btnStart = document.getElementById('btn-start');
const btnPay = document.getElementById('btn-pay');
const nameInput = document.getElementById('name-input');
const charCurrent = document.getElementById('char-current');
const keychainText = document.getElementById('keychain-text');
const fontChips = document.getElementById('font-chips');
const shapeChips = document.getElementById('shape-chips');
const shapePreview = document.getElementById('keychain-shape');
const previewDimensions = document.getElementById('preview-dimensions');
const queueNumber = document.getElementById('queue-number');
const successName = document.getElementById('success-name');

// ===== SCREEN NAVIGATION =====
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

// ===== WELCOME → PREVIEW =====
btnStart.addEventListener('click', () => {
    showScreen('preview');
    nameInput.focus();
});

// ===== FONT PICKER =====
function buildFontChips() {
    fontChips.innerHTML = '';
    Object.values(window.KEYCHAIN_FONTS).forEach(font => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'font-chip' + (font.id === selectedFontId ? ' selected' : '');
        chip.dataset.fontId = font.id;
        chip.innerHTML = `
            <span class="font-chip-sample" style="font-family: ${font.family};">Aa</span>
            <span class="font-chip-name">${font.label}</span>
        `;
        chip.addEventListener('click', () => selectFont(font.id));
        fontChips.appendChild(chip);
    });
}

function selectFont(fontId) {
    if (!window.KEYCHAIN_FONTS[fontId]) return;
    selectedFontId = fontId;
    fontChips.querySelectorAll('.font-chip').forEach(c => {
        c.classList.toggle('selected', c.dataset.fontId === fontId);
    });
    renderKeychainText();
}

function buildShapeChips() {
    shapeChips.innerHTML = '';
    Object.values(window.KEYCHAIN_SHAPES).forEach(shape => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'shape-chip' + (shape.id === selectedShapeId ? ' selected' : '');
        chip.dataset.shapeId = shape.id;
        chip.textContent = `${shape.label} · ${shape.width} × ${shape.height} mm`;
        chip.addEventListener('click', () => selectShape(shape.id));
        shapeChips.appendChild(chip);
    });
}

function selectShape(shapeId) {
    const shape = window.KEYCHAIN_SHAPES[shapeId];
    if (!shape) return;
    selectedShapeId = shapeId;
    shapeChips.querySelectorAll('.shape-chip').forEach(chip => {
        chip.classList.toggle('selected', chip.dataset.shapeId === shapeId);
    });
    const scale = 68 / Math.max(shape.width, shape.height);
    const w = shape.width * scale;
    const h = shape.height * scale;
    const x = 40 - w / 2;
    const y = 17.5 - h / 2;
    let d;
    if (shape.id === 'circle') {
        d = `M ${40} ${y} a ${w / 2} ${h / 2} 0 1 1 0 ${h} a ${w / 2} ${h / 2} 0 1 1 0 -${h}`;
    } else if (shape.id === 'heart') {
        d = `M 40 ${y + h * 0.9} C ${x - w * 0.1} ${y + h * 0.55}, ${x} ${y + h * 0.1}, ${x + w * 0.28} ${y + h * 0.15} C ${x + w * 0.42} ${y + h * 0.16}, 40 ${y + h * 0.35}, 40 ${y + h * 0.35} C 40 ${y + h * 0.35}, ${x + w * 0.58} ${y + h * 0.16}, ${x + w * 0.72} ${y + h * 0.15} C ${x + w} ${y + h * 0.1}, ${x + w * 1.1} ${y + h * 0.55}, 40 ${y + h * 0.9} Z`;
    } else {
        d = `M ${x + 1} ${y} H ${x + w - 1} Q ${x + w} ${y} ${x + w} ${y + 1} V ${y + h - 1} Q ${x + w} ${y + h} ${x + w - 1} ${y + h} H ${x + 1} Q ${x} ${y + h} ${x} ${y + h - 1} V ${y + 1} Q ${x} ${y} ${x + 1} ${y} Z`;
    }
    shapePreview.setAttribute('d', d);
    shapePreview.setAttribute('class', `preview-outline preview-${shape.id}`);
    document.getElementById('keychain-svg').setAttribute('viewBox', `${x - 7} ${y - 7} ${w + 14} ${h + 14}`);
    previewDimensions.textContent = `Actual size · ${shape.width} × ${shape.height} mm`;
}

// ===== LIVE KEYCHAIN PREVIEW =====
function renderKeychainText() {
    const raw = nameInput.value.trim();
    // Auto-uppercase Latin letters only — preserve emoji + symbols
    const display = raw.replace(/[a-z]/g, c => c.toUpperCase()) || 'YOUR NAME';
    const font = window.KEYCHAIN_FONTS[selectedFontId];

    keychainText.textContent = display;
    keychainText.setAttribute('font-family', font.family);
    keychainText.setAttribute('font-size', font.fixedCapHeight);
}

nameInput.addEventListener('input', () => {
    // Count code points (handles emoji surrogate pairs)
    const len = Array.from(nameInput.value).length;
    charCurrent.textContent = len;

    renderKeychainText();

    btnPay.disabled = nameInput.value.trim().length === 0;
});

// Initialize chips on load
buildFontChips();
buildShapeChips();
selectShape(selectedShapeId);
renderKeychainText();

// ===== PAYMENT FLOW =====
btnPay.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    btnPay.disabled = true;
    initiatePayment(name);
});

async function initiatePayment(name) {
    showScreen('payment');

    try {
        // Step 1: Create order via Cloud Function
        const createOrder = functions.httpsCallable('createOrder');
        const result = await createOrder({ name, fontId: selectedFontId, shapeId: selectedShapeId });
        const { orderId, firestoreId, amount, currency, keyId } = result.data;

        // Step 2: Open Razorpay checkout
        const options = {
            key: keyId,
            amount: amount,
            currency: currency,
            name: 'Laser Keychain',
            description: 'Custom keychain: "' + name + '"',
            order_id: orderId,
            prefill: {
                name: name,
                email: 'test@example.com',
                contact: '9999999999',
            },
            theme: {
                color: '#00e5ff',
            },
            handler: async function (response) {
                await handlePaymentSuccess(response, firestoreId, name);
            },
            modal: {
                ondismiss: function () {
                    showScreen('preview');
                    btnPay.disabled = false;
                },
            },
        };

        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function () {
            showScreen('preview');
            btnPay.disabled = false;
            alert('Payment failed. Please try again.');
        });
        rzp.open();

    } catch (error) {
        console.error('Order creation failed:', error);
        showScreen('preview');
        btnPay.disabled = false;
        alert('Something went wrong. Please try again.');
    }
}

async function handlePaymentSuccess(response, firestoreId, name) {
    try {
        const verifyPayment = functions.httpsCallable('verifyPayment');
        const result = await verifyPayment({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            firestoreId: firestoreId,
        });

        const { queue_position } = result.data;

        successName.textContent = name;
        queueNumber.textContent = '#' + queue_position;
        showScreen('success');

    } catch (error) {
        console.error('Payment verification failed:', error);
        alert('Payment received but verification failed. Please contact support.');
        showScreen('preview');
        btnPay.disabled = false;
    }
}

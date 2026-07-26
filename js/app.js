// ===== STATE =====
let selectedFontId = window.DEFAULT_FONT_ID;
let currentMode = 'text';           // 'text' | 'image' — which flow the user is in
const MAX_CODEPOINTS = 20;

// In-flight order tracking — used by `beforeunload` warning + recovery on reload.
// Set when the order is placed, cleared once status === 'done'.
let activeOrder = null; // { firestoreId, name, queue_position, mode }
let liveQueueUnsub = null;
let ownOrderUnsub = null;
let notifyOnTurn = false;
let notifyOnDone = false;
let suppressPushState = false; // prevents pushState during popstate handling

// Client-side image processor (image mode).
const imageProcessor = new window.KeychainImageProcessor();

// ===== DOM ELEMENTS =====
const screens = {
    welcome: document.getElementById('screen-welcome'),
    choose: document.getElementById('screen-choose'),
    name: document.getElementById('screen-name'),
    image: document.getElementById('screen-image'),
    payment: document.getElementById('screen-payment'),
    success: document.getElementById('screen-success'),
};

const btnStart = document.getElementById('btn-start');
const typeName = document.getElementById('type-name');
const typeImage = document.getElementById('type-image');
const btnPay = document.getElementById('btn-pay');
const btnPayImage = document.getElementById('btn-pay-image');
const btnHome = document.getElementById('home-btn');
const btnNotify = document.getElementById('btn-notify');
const nameInput = document.getElementById('name-input');
const charCurrent = document.getElementById('char-current');
const keychainText = document.getElementById('keychain-text');
const fontChips = document.getElementById('font-chips');
const queueNumber = document.getElementById('queue-number');
const successName = document.getElementById('success-name');
const successFor = document.getElementById('success-for');
const liveQueue = document.getElementById('live-queue');
const liveQueueText = document.getElementById('live-queue-text');
const liveQueueSub = document.getElementById('live-queue-sub');
const nowPrintingEl = document.getElementById('now-printing');
const verifyBanner = document.getElementById('verify-banner');
const successFooter = document.getElementById('success-footer-text');
const emojiToggle = document.getElementById('emoji-toggle');
const emojiPanel = document.getElementById('emoji-panel');
const paymentTitle = document.getElementById('payment-title');
const paymentSub = document.getElementById('payment-sub');

// Image-design elements
const imgKeychain = document.getElementById('img-keychain');
const imgCanvas = document.getElementById('img-canvas');
const imgDropzone = document.getElementById('img-dropzone');
const imgFile = document.getElementById('img-file');
const imgError = document.getElementById('img-error');
const imgControls = document.getElementById('img-controls');
const imgThreshold = document.getElementById('img-threshold');
const thresholdValue = document.getElementById('threshold-value');
const imgInvert = document.getElementById('img-invert');
const imgReplace = document.getElementById('img-replace');
const imgCoverage = document.getElementById('img-coverage');

// ===== CAMERA =====
const cameraOpen = document.getElementById('camera-open');
const removeImage = document.getElementById('remove-image');
const cameraPanel = document.getElementById('camera-panel');
const cameraVideo = document.getElementById('camera-video');
const cameraCanvas = document.getElementById('camera-canvas');
const cameraCapture = document.getElementById('camera-capture');
const cameraRetake = document.getElementById('camera-retake');
const cameraCancel = document.getElementById('camera-cancel');

let cameraStream = null;

// ===== ORDER PROGRESS =====
const stepPayment = document.getElementById("step-payment");
const stepQueue = document.getElementById("step-queue");
const stepPrinting = document.getElementById("step-printing");
const stepDone = document.getElementById("step-done");

// ===== CROP =====
const cropModal = document.getElementById('crop-modal');
const cropImage = document.getElementById('crop-image');
const cropConfirm = document.getElementById('crop-confirm');
const cropClose = document.getElementById('crop-close');
const rotateLeft = document.getElementById('rotate-left');
const rotateRight = document.getElementById('rotate-right');

let cropper = null;

// ===== SCREEN NAVIGATION (with browser-back support) =====
function showScreen(screenName) {
    showScreenInternal(screenName);
    if (suppressPushState) return;
    const state = history.state;
    if (!state || state.screen !== screenName) {
        history.pushState({ screen: screenName }, '', '#' + screenName);
    }
}

function showScreenInternal(screenName) {
    if (!screens[screenName]) return;
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
    document.body.dataset.screen = screenName;

    // Manage live listeners — only run while we're on the success screen.
    if (screenName === 'success') {
        startLiveQueueListener();
    } else {
        stopLiveQueueListener();
    }

    // The image preview needs to be positioned once its screen is laid out.
    if (screenName === 'image') positionImageCanvas();
}

window.addEventListener('popstate', (e) => {
    const target = (e.state && e.state.screen) || readScreenFromHash() || 'welcome';
    suppressPushState = true;
    showScreenInternal(target);
    suppressPushState = false;
});

function readScreenFromHash() {
    const h = (location.hash || '').replace('#', '');
    return screens[h] ? h : null;
}

// ===== HOME BUTTON =====
btnHome.addEventListener('click', () => {
    const onSuccess = document.body.dataset.screen === 'success';
    const hasInput = nameInput.value.trim().length > 0 || imageProcessor.hasImage;
    if (onSuccess && activeOrder) {
        const ok = confirm("Your order is still being printed. Leave this page anyway? You'll lose live status updates.");
        if (!ok) return;
    } else if (hasInput) {
        const ok = confirm('Discard your design and go back to home?');
        if (!ok) return;
    }
    resetTextState();
    resetImageState();
    showScreen('welcome');
});

// ===== WELCOME → CHOOSE TYPE =====
btnStart.addEventListener('click', () => {
    showScreen('choose');
});

// ===== CHOOSE TYPE → DESIGN =====
typeName.addEventListener('click', () => {
    currentMode = 'text';
    showScreen('name');
    nameInput.focus();
});

typeImage.addEventListener('click', () => {
    currentMode = 'image';
    showScreen('image');
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

// ===== EMOJI PICKER =====
const EMOJI_CATEGORIES = [
    { name: 'Hearts & Stars', emojis: ['❤', '★', '☆', '✦', '✧', '✨', '♡', '♥'] },
    { name: 'Faces',          emojis: ['😀', '😎', '😂', '😍', '🤩', '😜', '🥳', '😇'] },
    { name: 'Hands',          emojis: ['✌', '👍', '👌', '🙏', '👋', '✊', '🤘', '🤞'] },
    { name: 'Symbols',        emojis: ['🔥', '⚡', '🚀', '🎮', '🎯', '💎', '🎵', '☮'] },
    { name: 'Animals',        emojis: ['🐶', '🐱', '🦄', '🐼', '🦊', '🐧', '🦁', '🐢'] },
    { name: 'Nature',         emojis: ['☀', '☂', '☃', '⛄', '🌙', '🌈', '🌸', '🍀'] },
    { name: 'Sports',         emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏆', '🎱', '🎳'] },
    { name: 'Food',           emojis: ['🍕', '☕', '🍔', '🍩', '🍦', '🍫', '🍺', '🍎'] },
];

function buildEmojiPanel() {
    emojiPanel.innerHTML = '';
    EMOJI_CATEGORIES.forEach(cat => {
        const wrap = document.createElement('div');
        wrap.className = 'emoji-cat';
        const heading = document.createElement('div');
        heading.className = 'emoji-cat-name';
        heading.textContent = cat.name;
        wrap.appendChild(heading);

        const grid = document.createElement('div');
        grid.className = 'emoji-grid';
        cat.emojis.forEach(e => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'emoji-btn';
            btn.textContent = e;
            btn.addEventListener('click', () => insertEmoji(e));
            grid.appendChild(btn);
        });
        wrap.appendChild(grid);
        emojiPanel.appendChild(wrap);
    });
}

emojiToggle.addEventListener('click', () => {
    const expanded = emojiToggle.getAttribute('aria-expanded') === 'true';
    emojiToggle.setAttribute('aria-expanded', !expanded);
    emojiPanel.hidden = expanded;
});

function insertEmoji(emoji) {
    const before = nameInput.value;
    const cps = Array.from(before);
    if (cps.length >= MAX_CODEPOINTS) return; // already at limit
    const pos = nameInput.selectionStart ?? before.length;
    const next = before.slice(0, pos) + emoji + before.slice(pos);
    nameInput.value = Array.from(next).slice(0, MAX_CODEPOINTS).join('');
    nameInput.focus();
    nameInput.dispatchEvent(new Event('input'));
}

// ===== LIVE KEYCHAIN PREVIEW (text) =====
function renderKeychainText() {
    const raw = nameInput.value.trim();
    const display = raw.replace(/[a-z]/g, c => c.toUpperCase()) || 'YOUR NAME';
    const font = window.KEYCHAIN_FONTS[selectedFontId];

    keychainText.textContent = display;
    keychainText.setAttribute('font-family', font.family);
    keychainText.setAttribute('font-size', font.fixedCapHeight);
}

function updateCharCount() {
    charCurrent.textContent = Array.from(nameInput.value).length;
}

nameInput.addEventListener('input', () => {
    const cps = Array.from(nameInput.value);
    if (cps.length > MAX_CODEPOINTS) {
        nameInput.value = cps.slice(0, MAX_CODEPOINTS).join('');
    }
    updateCharCount();
    renderKeychainText();
    btnPay.disabled = nameInput.value.trim().length === 0;
});

function resetTextState() {
    nameInput.value = '';
    btnPay.disabled = true;
    renderKeychainText();
    updateCharCount();
}
// ===== CAMERA FUNCTIONS =====

async function openCamera() {

    try {

        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "environment"
            }
        });

        cameraVideo.srcObject = cameraStream;

        cameraPanel.hidden = false;

        cameraRetake.hidden = true;

    } catch (err) {

        alert("Unable to access the camera.");

        console.error(err);

    }

}

function stopCamera() {

    if (!cameraStream) return;

    cameraStream.getTracks().forEach(track => track.stop());

    cameraStream = null;

    cameraVideo.srcObject = null;

    cameraPanel.hidden = true;

}

async function openCropEditor(file) {

    if (cropper) {
        cropper.destroy();
        cropper = null;
    }

    cropImage.src = URL.createObjectURL(file);

    cropModal.hidden = false;

    cropImage.onload = () => {

    
    cropper = new Cropper(cropImage, {
    aspectRatio: NaN,

    viewMode: 0,

    autoCropArea: 0.9,

    dragMode: "crop",

    cropBoxResizable: true,
    cropBoxMovable: true,

    movable: true,
    zoomable: true,
    rotatable: true,

    guides: true,
    center: true,
    highlight: true,
    background: false
});

    };

}

rotateLeft.addEventListener('click', () => {

    if (cropper)
        cropper.rotate(-90);

});

rotateRight.addEventListener('click', () => {

    if (cropper)
        cropper.rotate(90);

});

cropClose.addEventListener('click', () => {

    if (cropper) {

        cropper.destroy();
        cropper = null;

    }

    cropModal.hidden = true;

});

cropConfirm.addEventListener('click', async () => {

    if (!cropper) return;

    const canvas = cropper.getCroppedCanvas({
        imageSmoothingQuality: 'high'
    });

    const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/png')
    );

    const file = new File(
        [blob],
        'cropped-image.png',
        {
            type: 'image/png'
        }
    );

    cropper.destroy();
    cropper = null;

    cropModal.hidden = true;

    await handleImageFile(file);

});

// ===== IMAGE DESIGN =====
// Position the processed-bitmap canvas over the keychain's engrave area, using
// the shared KEYCHAIN_IMAGE_AREA (so preview placement == engrave placement).
function positionImageCanvas() {
    const area = window.KEYCHAIN_IMAGE_AREA;
    const L = window.KEYCHAIN_LAYOUT;
    imgCanvas.style.left = (area.x / L.width * 100) + '%';
    imgCanvas.style.top = (area.y / L.height * 100) + '%';
    imgCanvas.style.width = (area.width / L.width * 100) + '%';
    imgCanvas.style.height = (area.height / L.height * 100) + '%';
}

function renderImageCanvas() {
    // The visible canvas mirrors the processor's print bitmap (white = burn);
    // CSS `filter: invert(1)` flips it to a realistic dark-on-light preview.
    imgCanvas.width = imageProcessor.width;
    imgCanvas.height = imageProcessor.height;
    const ctx = imgCanvas.getContext('2d');
    ctx.clearRect(0, 0, imgCanvas.width, imgCanvas.height);
    ctx.drawImage(imageProcessor.canvas, 0, 0);
}

async function handleImageFile(file) {
    imgError.hidden = true;
    try {
        await imageProcessor.loadFile(file);
    } catch (err) {
        imgError.textContent = err.message || 'Could not load that image.';
        imgError.hidden = false;
        return;
    }
    positionImageCanvas();
renderImageCanvas();

imgKeychain.classList.add('has-image');
removeImage.hidden = false;

imgControls.hidden = false;

imgThreshold.value = String(imageProcessor.threshold);
thresholdValue.textContent = imageProcessor.threshold;
imgInvert.checked = imageProcessor.invert;

btnPayImage.disabled = false;

updateCoverageWarning();
}

function updateCoverageWarning() {
    const cov = imageProcessor.coverage();
    if (cov > 0.6) {
        imgCoverage.textContent =
            'This design is very dense, so it will take longer to engrave. A simpler logo or line drawing works best.';
        imgCoverage.hidden = false;
    } else {
        imgCoverage.hidden = true;
    }
}

imgDropzone.addEventListener('click', () => imgFile.click());
if (imgReplace) {
    imgReplace.addEventListener('click', () => imgFile.click());
}
// ===== CAMERA BUTTON =====

cameraOpen.addEventListener('click', () => {

    openCamera();

});


cameraCancel.addEventListener('click', () => {

    stopCamera();

});
cameraRetake.addEventListener('click', () => {

    stopCamera();

    openCamera();

});
imgFile.addEventListener('change', () => {

    const file = imgFile.files && imgFile.files[0];

    if (file)
        openCropEditor(file);

    imgFile.value = '';

});

// ===== CAMERA CAPTURE =====

cameraCapture.addEventListener('click', async () => {

    if (!cameraStream) return;

    const video = cameraVideo;
    const canvas = cameraCanvas;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');

    ctx.drawImage(video, 0, 0);

    const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/png')
    );

    const file = new File(
        [blob],
        'camera-photo.png',
        { type: 'image/png' }
    );

    stopCamera();

    openCropEditor(file);

});

imgThreshold.addEventListener('input', () => {

    thresholdValue.textContent = imgThreshold.value;

    imageProcessor.setThreshold(parseInt(imgThreshold.value, 10));

    renderImageCanvas();

    updateCoverageWarning();

});

imgInvert.addEventListener('change', () => {
    imageProcessor.setInvert(imgInvert.checked);
    renderImageCanvas();
    updateCoverageWarning();
});

removeImage.addEventListener('click', () => {
    resetImageState();
});

function resetImageState() {
    stopCamera();

    imageProcessor.originalFile = null;
    imageProcessor.source = null;

    imgKeychain.classList.remove('has-image');

    imgControls.hidden = true;
    imgError.hidden = true;
    imgCoverage.hidden = true;

    imgThreshold.value = '128';
    thresholdValue.textContent = '128';
    imgInvert.checked = false;

    imgFile.value = '';

    removeImage.hidden = true;

    btnPayImage.disabled = true;
}

// Upload the original + processed bitmaps to Storage. Returns their paths.
async function uploadImageBlobs() {
    const sessionId = (self.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : (Date.now().toString(36) + Math.random().toString(16).slice(2));

    const original = imageProcessor.originalFile;
    const printBlob = await imageProcessor.toPrintBlob();
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[original.type] || 'png';

    const originalImagePath = `uploads/${sessionId}/original.${ext}`;
    const printImagePath = `uploads/${sessionId}/print.png`;

    const root = storage.ref();
    await root.child(originalImagePath).put(original, { contentType: original.type });
    await root.child(printImagePath).put(printBlob, { contentType: 'image/png' });

    return { originalImagePath, printImagePath };
}

// ===== PAYMENT FLOW =====
btnPay.addEventListener('click', () => {
    if (nameInput.value.trim().length === 0) return;
    btnPay.disabled = true;
    initiatePayment('text');
});

btnPayImage.addEventListener('click', () => {
    if (!imageProcessor.hasImage) return;
    btnPayImage.disabled = true;
    initiatePayment('image');
});

function setPaymentMessage(title, sub) {
    paymentTitle.textContent = title;
    paymentSub.textContent = sub;
}

async function initiatePayment(mode) {
    showScreen('payment');

    try {
        let payload, displayName;

        if (mode === 'image') {
            setPaymentMessage('Checking your image…', 'Uploading and reviewing your design.');
            const paths = await uploadImageBlobs();
            payload = { mode: 'image', ...paths };
            displayName = 'your image';
        } else {
            const name = nameInput.value.trim();
            payload = { mode: 'text', name, fontId: selectedFontId };
            displayName = name;
        }

        setPaymentMessage('Processing Payment...', 'Please complete the payment in the Razorpay window.');

        const createOrder = functions.httpsCallable('createOrder');
        const result = await createOrder(payload);
        const { orderId, firestoreId, amount, currency, keyId } = result.data;

        openRazorpayCheckout({ orderId, firestoreId, amount, currency, keyId, displayName, mode });
    } catch (error) {
        handleOrderError(error, mode);
    }
}

function openRazorpayCheckout({ orderId, firestoreId, amount, currency, keyId, displayName, mode }) {
    const options = {
        key: keyId,
        amount: amount,
        currency: currency,
        name: 'Laser Keychain',
        description: mode === 'image' ? 'Custom image keychain' : ('Custom keychain: "' + displayName + '"'),
        order_id: orderId,
        prefill: {
            name: mode === 'image' ? 'Customer' : displayName,
            email: 'test@example.com',
            contact: '9999999999',
        },
        theme: { color: '#00e5ff' },
        handler: function (response) {
            handlePaymentSuccess(response, firestoreId, displayName, mode);
        },
        modal: {
            ondismiss: function () {
                returnToDesign(mode);
            },
        },
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function () {
        returnToDesign(mode);
        alert('Payment failed. Please try again.');
    });
    rzp.open();
}

// Return the user to whichever design screen they came from, re-enabling the
// pay button.
function returnToDesign(mode) {
    if (mode === 'image') {
        showScreen('image');
        btnPayImage.disabled = !imageProcessor.hasImage;
    } else {
        showScreen('name');
        btnPay.disabled = nameInput.value.trim().length === 0;
    }
}

// Errors from createOrder — moderation blocks + validation are user-actionable
// (safe to show their message); anything else is a generic failure.
function handleOrderError(error, mode) {
    console.error('Order creation failed:', error);
    const code = String(error && error.code || '');
    const actionable = code.includes('failed-precondition') || code.includes('invalid-argument');
    returnToDesign(mode);
    if (actionable && error.message) {
        alert(error.message);
    } else {
        alert('Something went wrong. Please try again.');
    }
}

// Optimistic UI: show the success screen immediately, verify in the background.
function handlePaymentSuccess(response, firestoreId, displayName, mode) {
    const payload = {
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature,
        firestoreId: firestoreId,
        name: displayName,
        mode: mode,
    };
    localStorage.setItem('pendingVerify', JSON.stringify(payload));

    renderSuccessIdentity(displayName, mode);
    queueNumber.textContent = '#…';
    verifyBanner.hidden = true;
    activeOrder = { firestoreId, name: displayName, queue_position: null, mode };
    updateOrderProgress("queued");
    showScreen('success');

    runVerify(payload);
}

// Success screen copy — "for NAME" only for text orders.
function renderSuccessIdentity(displayName, mode) {
    if (mode === 'image') {
        successFor.hidden = true;
    } else {
        successFor.hidden = false;
        successName.textContent = displayName;
    }
}

async function runVerify(payload) {
    try {
        const verifyPayment = functions.httpsCallable('verifyPayment');
        const result = await verifyPayment({
            razorpay_order_id: payload.razorpay_order_id,
            razorpay_payment_id: payload.razorpay_payment_id,
            razorpay_signature: payload.razorpay_signature,
            firestoreId: payload.firestoreId,
        });
        const { queue_position } = result.data;

        localStorage.removeItem('pendingVerify');
        activeOrder = { firestoreId: payload.firestoreId, name: payload.name, queue_position, mode: payload.mode };
        localStorage.setItem('activeOrder', JSON.stringify(activeOrder));

        renderSuccessIdentity(payload.name, payload.mode);
        queueNumber.textContent = '#' + queue_position;

        if (document.body.dataset.screen === 'success') startLiveQueueListener();
        startOwnOrderListener(payload.firestoreId);
    } catch (error) {
        console.error('Payment verification failed:', error);
        verifyBanner.hidden = false;
        verifyBanner.textContent = 'Payment received but we couldn\'t assign your queue spot. Please contact support with this ID: ' + payload.firestoreId;
    }
}

// On page load, retry any pending verify (handles "user closed tab during verify")
function recoverPendingOrder() {
    const pending = localStorage.getItem('pendingVerify');
    if (pending) {
        try {
            const payload = JSON.parse(pending);
            renderSuccessIdentity(payload.name, payload.mode);
            queueNumber.textContent = '#…';
            activeOrder = { firestoreId: payload.firestoreId, name: payload.name, queue_position: null, mode: payload.mode };
            showScreen('success');
            runVerify(payload);
            return true;
        } catch (e) {
            localStorage.removeItem('pendingVerify');
        }
    }
    const stored = localStorage.getItem('activeOrder');
    if (stored) {
        try {
            const order = JSON.parse(stored);
            const target = readScreenFromHash();
            if (target === 'success' && order.queue_position) {
                activeOrder = order;
                renderSuccessIdentity(order.name, order.mode);
                queueNumber.textContent = '#' + order.queue_position;
                showScreenInternal('success');
                startOwnOrderListener(order.firestoreId);
                return true;
            }
        } catch (e) { /* ignore */ }
    }
    return false;
}

// ===== LIVE QUEUE LISTENER =====
function startLiveQueueListener() {
    if (liveQueueUnsub) return;
    if (typeof db === 'undefined') return;

    liveQueue.hidden = false;
    liveQueueUnsub = db.collection('orders')
        .where('status', '==', 'printing')
        .limit(1)
        .onSnapshot((snap) => {
            if (snap.empty) {
                nowPrintingEl.textContent = 'queue is idle';
                liveQueueSub.textContent = activeOrder && activeOrder.queue_position
                    ? `Yours is #${activeOrder.queue_position} — you may be first up.`
                    : 'No keychain is currently printing.';
                liveQueue.classList.remove('your-turn');
                return;
            }
            const printing = snap.docs[0].data();
            const printingPos = printing.queue_position;
            nowPrintingEl.textContent = '#' + printingPos;

            const yours = activeOrder && activeOrder.queue_position;
            if (yours && printingPos === yours) {
                liveQueueSub.textContent = "It's your turn! Watch the laser.";
                liveQueue.classList.add('your-turn');
                fireNotificationOnTurn(printing.name || (activeOrder && activeOrder.name));
            } else if (yours) {
                const ahead = yours - printingPos;
                liveQueueSub.textContent =
                    ahead > 0
                        ? `Yours is #${yours} — ${ahead} ahead of you.`
                        : `Yours is #${yours} — already printed.`;
                liveQueue.classList.remove('your-turn');
            } else {
                liveQueueSub.textContent = '';
                liveQueue.classList.remove('your-turn');
            }
        }, (err) => {
            console.error('Live queue listener failed:', err);
            liveQueueSub.textContent = 'Live updates unavailable.';
        });
}

function stopLiveQueueListener() {
    if (liveQueueUnsub) { liveQueueUnsub(); liveQueueUnsub = null; }
    liveQueue.classList.remove('your-turn');
}

function updateOrderProgress(status) {

    // Reset everything
    [stepPayment, stepQueue, stepPrinting, stepDone].forEach(step => {
        step.classList.remove("completed");
        step.classList.remove("active");
    });

    switch (status) {

        case "queued":

            stepPayment.classList.add("completed");
            stepQueue.classList.add("active");

            break;

        case "printing":

            stepPayment.classList.add("completed");
            stepQueue.classList.add("completed");
            stepPrinting.classList.add("active");

            break;

        case "done":

            stepPayment.classList.add("completed");
            stepQueue.classList.add("completed");
            stepPrinting.classList.add("completed");
            stepDone.classList.add("completed");

            break;

        default:

            stepPayment.classList.add("completed");
            stepQueue.classList.add("active");

    }

}

function startOwnOrderListener(firestoreId) {
    if (ownOrderUnsub) { ownOrderUnsub(); ownOrderUnsub = null; }
    if (typeof db === 'undefined') return;

    ownOrderUnsub = db.collection('orders').doc(firestoreId)
        .onSnapshot((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            updateOrderProgress(data.status);
            if (data.status === 'done') {
                successFooter.textContent = 'Ready for pickup ✨';
                fireNotificationOnDone(data.name || (activeOrder && activeOrder.name) || 'Your keychain');
                activeOrder = null;
                localStorage.removeItem('activeOrder');
                if (ownOrderUnsub) { ownOrderUnsub(); ownOrderUnsub = null; }
            }
        }, (err) => console.error('Own order listener failed:', err));
}

// ===== NOTIFICATIONS =====
btnNotify.addEventListener('click', async () => {
    if (!('Notification' in window)) {
        alert('This browser does not support notifications.');
        return;
    }
    if (Notification.permission === 'granted') {
        btnNotify.querySelector('span').textContent = 'Notifications enabled';
        btnNotify.disabled = true;
        return;
    }
    try {
        const result = await Notification.requestPermission();
        if (result === 'granted') {
            btnNotify.classList.add('enabled');
            btnNotify.querySelector('span').textContent = 'Notifications enabled';
            btnNotify.disabled = true;
        }
    } catch (e) {
        console.error('Notification permission failed:', e);
    }
});

function fireNotificationOnTurn(name) {
    if (notifyOnTurn) return;
    notifyOnTurn = true;
    if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('Your keychain is printing now! 🔥', { body: name ? `Engraving "${name}"` : '' }); } catch (e) { /* ignore */ }
    }
}

function fireNotificationOnDone(name) {
    if (notifyOnDone) return;
    notifyOnDone = true;
    if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('Done! Pick up your keychain ✨', { body: name ? `"${name}" is ready` : '' }); } catch (e) { /* ignore */ }
    }
}

// ===== BEFOREUNLOAD WARNING =====
window.addEventListener('beforeunload', (e) => {
    const onSuccess = document.body.dataset.screen === 'success';
    const pending = localStorage.getItem('pendingVerify');
    if (pending || (onSuccess && activeOrder)) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});

// ===== INITIAL BOOT =====
buildFontChips();
buildEmojiPanel();
renderKeychainText();
updateCharCount();
positionImageCanvas();
resetImageState();

(function bootScreen() {
    if (recoverPendingOrder()) return; // showed success already
    const target = readScreenFromHash() || 'welcome';
    suppressPushState = true;
    showScreenInternal(target);
    suppressPushState = false;
    history.replaceState({ screen: target }, '', '#' + target);
})();

// 1. Turn ON the laser.
// 2. ls /dev/cu.*
// 3. export LASER_PORT=/dev/cu.usbmodem1234561
// 4. cd ~/Downloads/LSR-1-TEXT-CREATION
//  cd printer-agent
// 5. lsof /dev/cu.usbmodem1234561
// 6. If no node process → npm start
// 7. If node process exists → printer-agent is already running.
// 8. Place keychain.
// 9. Submit order from the website.
// 10. Engraving starts automatically.
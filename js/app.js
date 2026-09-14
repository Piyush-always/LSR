// ===== STATE =====
let selectedShapeId = window.DEFAULT_SHAPE_ID || 'rectangle';
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
const createScreen = document.getElementById('screen-create');

const screens = {
    welcome: document.getElementById('screen-welcome'),
    create: createScreen,
    shape: createScreen,
    choose: createScreen,
    name: createScreen,
    image: createScreen,
    payment: document.getElementById('screen-payment'),
    success: document.getElementById('screen-success'),
};

const btnStart = document.getElementById('btn-start');
const shapeCards = document.querySelectorAll('.shape-card');
const btnShapeContinue = document.getElementById('btn-shape-continue');
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

// ===== CART & TOAST DOM ELEMENTS =====
const cartBtn = document.getElementById('cart-btn');
const cartBadge = document.getElementById('cart-badge');
const cartDrawer = document.getElementById('cart-drawer');
const cartOverlay = document.getElementById('cart-overlay');
const cartCloseBtn = document.getElementById('cart-close-btn');
const cartItemsContainer = document.getElementById('cart-items-container');
const cartDrawerCount = document.getElementById('cart-drawer-count');
const cartTotalQty = document.getElementById('cart-total-qty');
const cartSubtotalAmount = document.getElementById('cart-subtotal-amount');
const cartCheckoutAmount = document.getElementById('cart-checkout-amount');
const cartCheckoutBtn = document.getElementById('cart-checkout-btn');
const cartContinueBtn = document.getElementById('cart-continue-btn');
const cartLimitBanner = document.getElementById('cart-limit-banner');
const btnAddCartText = document.getElementById('btn-add-cart-text');
const btnAddCartImage = document.getElementById('btn-add-cart-image');
const toastContainer = document.getElementById('toast-container');

// ===== PHONE CHECKOUT MODAL ELEMENTS =====
const phoneModal = document.getElementById('phone-modal');
const modalPhoneInput = document.getElementById('modal-phone-input');
const modalPhoneHint = document.getElementById('modal-phone-hint');
const btnPhoneContinue = document.getElementById('btn-phone-continue');
const phoneModalClose = document.getElementById('phone-modal-close');
const phoneModalBackdrop = document.getElementById('phone-modal-backdrop');

let pendingPaymentMode = 'text';

function isValidPhoneNumber(phone) {
    return /^[6-9]\d{9}$/.test(String(phone).trim());
}

function openPhoneModal(mode) {
    pendingPaymentMode = mode;
    if (phoneModal) {
        phoneModal.hidden = false;
        if (modalPhoneInput) {
            modalPhoneInput.value = '';
            modalPhoneInput.focus();
        }
        const group = phoneModal.querySelector('.phone-input-group');
        if (group) group.classList.remove('invalid', 'valid');
        if (modalPhoneHint) modalPhoneHint.textContent = 'Enter 10-digit mobile number';
    }
}

function closePhoneModal() {
    if (phoneModal) phoneModal.hidden = true;
    if (btnPay) btnPay.disabled = nameInput.value.trim().length === 0;
    if (btnAddCartText) btnAddCartText.disabled = nameInput.value.trim().length === 0;
    if (btnPayImage) btnPayImage.disabled = !imageProcessor.hasImage;
    if (btnAddCartImage) btnAddCartImage.disabled = !imageProcessor.hasImage;
}

if (phoneModalClose) phoneModalClose.addEventListener('click', closePhoneModal);
if (phoneModalBackdrop) phoneModalBackdrop.addEventListener('click', closePhoneModal);

if (modalPhoneInput) {
    modalPhoneInput.addEventListener('input', (e) => {
        const cleanVal = e.target.value.replace(/\D/g, '').slice(0, 10);
        e.target.value = cleanVal;
        const valid = isValidPhoneNumber(cleanVal);
        const group = phoneModal.querySelector('.phone-input-group');
        if (group) {
            group.classList.toggle('valid', valid);
            group.classList.toggle('invalid', cleanVal.length === 10 && !valid);
        }
        if (modalPhoneHint) {
            modalPhoneHint.textContent = valid 
                ? '✓ Valid mobile number for thank-you SMS' 
                : (cleanVal.length > 0 && cleanVal.length < 10 ? 'Enter full 10-digit mobile number' : 'Enter 10-digit mobile number');
        }
    });

    modalPhoneInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && btnPhoneContinue) {
            e.preventDefault();
            btnPhoneContinue.click();
        }
    });
}

if (btnPhoneContinue) {
    btnPhoneContinue.addEventListener('click', () => {
        const rawPhone = (modalPhoneInput ? modalPhoneInput.value : '').replace(/\D/g, '');
        if (!isValidPhoneNumber(rawPhone)) {
            const group = phoneModal.querySelector('.phone-input-group');
            if (group) group.classList.add('invalid');
            if (modalPhoneHint) modalPhoneHint.textContent = 'Please enter a valid 10-digit mobile number (starting with 6-9)';
            if (modalPhoneInput) modalPhoneInput.focus();
            return;
        }
        closePhoneModal();
        initiatePayment(pendingPaymentMode, rawPhone);
    });
}

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
const cameraModal = document.getElementById('camera-modal');
const cameraBackdrop = document.getElementById('camera-backdrop');
const cameraCloseX = document.getElementById('camera-close-x');
const cameraVideo = document.getElementById('camera-video');
const cameraCanvas = document.getElementById('camera-canvas');
const cameraCapture = document.getElementById('camera-capture');
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

// ===== MODE SWITCHING =====
function setDesignMode(mode) {
    currentMode = mode;
    const isText = mode === 'text';
    
    if (typeName) typeName.classList.toggle('active', isText);
    if (typeImage) typeImage.classList.toggle('active', !isText);
    
    const panelText = document.getElementById('mode-panel-text');
    const panelImage = document.getElementById('mode-panel-image');
    const previewText = document.getElementById('keychain-preview-box');
    const previewImage = document.getElementById('img-preview-box');
    
    if (panelText) panelText.hidden = !isText;
    if (panelImage) panelImage.hidden = isText;
    if (previewText) previewText.hidden = !isText;
    if (previewImage) previewImage.hidden = isText;
    
    if (isText) {
        if (nameInput) nameInput.focus();
    } else {
        positionImageCanvas();
    }
}

// ===== SCREEN NAVIGATION (with browser-back support) =====
function showScreen(screenName) {
    showScreenInternal(screenName);
    if (suppressPushState) return;
    const state = history.state;
    if (!state || state.screen !== screenName) {
        history.pushState({ screen: screenName }, '', '#' + screenName);
    }
}
window.showScreen = showScreen;

function showScreenInternal(screenName) {
    const targetScreen = screens[screenName] || screens.welcome;
    const uniqueScreens = new Set(Object.values(screens).filter(Boolean));
    uniqueScreens.forEach(s => s.classList.remove('active'));
    
    targetScreen.classList.add('active');
    document.body.dataset.screen = screenName;

    // Reset window scroll position to top instantly when transitioning screens
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    if (screenName === 'image') {
        setDesignMode('image');
    } else if (screenName === 'name' || screenName === 'text') {
        setDesignMode('text');
    } else if (screenName === 'create' || screenName === 'shape' || screenName === 'choose') {
        setDesignMode(currentMode || 'text');
    }

    if (screenName === 'success') {
        startLiveQueueListener();
    } else {
        stopLiveQueueListener();
    }

    updateNavSteps(screenName);

    if (currentMode === 'image') positionImageCanvas();
}

function updateNavSteps(screenName) {
    const stepDesign = document.getElementById('nav-step-design');
    const stepReview = document.getElementById('nav-step-review');
    const stepCheckout = document.getElementById('nav-step-checkout');
    if (!stepDesign || !stepReview || !stepCheckout) return;

    stepDesign.classList.remove('active');
    stepReview.classList.remove('active');
    stepCheckout.classList.remove('active');

    if (screenName === 'payment') {
        stepReview.classList.add('active');
    } else if (screenName === 'success') {
        stepCheckout.classList.add('active');
    } else {
        stepDesign.classList.add('active');
    }
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
function resetShapeState() {
    selectedShapeId = window.DEFAULT_SHAPE_ID || 'rectangle';
    if (shapeCards) {
        shapeCards.forEach(c => c.classList.toggle('selected', c.dataset.shapeId === selectedShapeId));
    }
    updateShapePreviews();
}

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
    resetShapeState();
    showScreen('welcome');
});

// ===== WELCOME → UNIFIED CREATE PAGE =====
btnStart.addEventListener('click', () => {
    showScreen('create');
});

function selectShape(shapeId) {
    if (!window.KEYCHAIN_SHAPES || !window.KEYCHAIN_SHAPES[shapeId]) return;
    selectedShapeId = shapeId;
    document.querySelectorAll('.shape-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.shapeId === shapeId);
    });
    document.querySelectorAll('.shape-pill').forEach(p => {
        p.classList.toggle('selected', p.dataset.shapeId === shapeId);
    });
    if (customTextPos) {
        const shape = window.getShape(shapeId);
        customTextPos = getConstrainedTextPos(customTextPos.x, customTextPos.y, shape);
    }
    updateShapePreviews();
}

function resetShapeState() {
    selectShape(window.DEFAULT_SHAPE_ID || 'rectangle');
}

// ===== WELCOME HERO INTERACTION & PARALLAX =====
const heroSamples = document.querySelectorAll('.hero-sample-item');
heroSamples.forEach(sample => {
    const handleSampleSelect = () => {
        const shapeId = sample.dataset.shape;
        if (shapeId) {
            selectShape(shapeId);
        }
        showScreen('create');
    };

    sample.addEventListener('click', handleSampleSelect);
    sample.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSampleSelect();
        }
    });
});

// Footer quick links navigation
document.querySelectorAll('.footer-link-shape').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const shapeId = link.dataset.shape;
        if (shapeId) selectShape(shapeId);
        showScreen('create');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
});

document.querySelectorAll('.footer-link-mode').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const mode = link.dataset.mode;
        showScreen('create');
        if (mode === 'image' && typeImage) typeImage.click();
        else if (mode === 'text' && typeName) typeName.click();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
});

const heroCanvas = document.getElementById('hero-canvas');

if (heroCanvas && heroSamples.length > 0 && window.matchMedia('(min-width: 900px)').matches) {
    let mouseX = 0, mouseY = 0;
    let currentX = 0, currentY = 0;
    let isHovered = false;

    function updateParallax() {
        currentX += (mouseX - currentX) * 0.05;
        currentY += (mouseY - currentY) * 0.05;

        heroSamples.forEach((sample, i) => {
            const depth = sample.classList.contains('depth-foreground') ? 1.5 :
                          sample.classList.contains('depth-background') ? 0.6 : 1.0;
            const dirX = (i % 2 === 0 ? 1 : -1) * depth;
            const dirY = (i % 3 === 0 ? 1 : -1) * depth;

            const px = (currentX * dirX * 22).toFixed(2);
            const py = (currentY * dirY * 22).toFixed(2);

            sample.style.setProperty('--px', `${px}px`);
            sample.style.setProperty('--py', `${py}px`);
        });

        if (isHovered || Math.abs(currentX - mouseX) > 0.0005 || Math.abs(currentY - mouseY) > 0.0005) {
            requestAnimationFrame(updateParallax);
        }
    }

    heroCanvas.addEventListener('mousemove', (e) => {
        const rect = heroCanvas.getBoundingClientRect();
        mouseX = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
        mouseY = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);

        if (!isHovered) {
            isHovered = true;
            requestAnimationFrame(updateParallax);
        }
    });

    heroCanvas.addEventListener('mouseleave', () => {
        isHovered = false;
        mouseX = 0;
        mouseY = 0;
        requestAnimationFrame(updateParallax);
    });
}

document.querySelectorAll('.shape-card').forEach(card => {
    card.addEventListener('click', () => {
        selectShape(card.dataset.shapeId);
    });
});



document.querySelectorAll('.shape-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        selectShape(pill.dataset.shapeId);
    });
});

if (btnShapeContinue) {
    btnShapeContinue.addEventListener('click', () => {
        showScreen('create');
    });
}

// ===== CHOOSE TYPE → DESIGN =====
if (typeName) {
    typeName.addEventListener('click', () => {
        setDesignMode('text');
    });
}

if (typeImage) {
    typeImage.addEventListener('click', () => {
        setDesignMode('image');
    });
}

// ===== MATERIAL SWITCHER =====
let currentMaterial = 'metal';
function selectMaterial(materialId) {
    currentMaterial = materialId;
    document.querySelectorAll('.material-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.material === materialId);
    });
    const previewBox = document.getElementById('keychain-preview-box');
    const imgPreviewBox = document.getElementById('img-preview-box');
    if (previewBox) previewBox.dataset.material = materialId;
    if (imgPreviewBox) imgPreviewBox.dataset.material = materialId;
}

document.querySelectorAll('.material-card').forEach(card => {
    card.addEventListener('click', () => {
        selectMaterial(card.dataset.material);
    });
});

// ===== PREVIEW VIEW MODE SWITCHER (Product vs Technical) =====
let currentViewMode = 'product';
function setViewMode(mode) {
    currentViewMode = mode;
    const btnProduct = document.getElementById('btn-view-product');
    const btnTechnical = document.getElementById('btn-view-technical');
    if (btnProduct) btnProduct.classList.toggle('active', mode === 'product');
    if (btnTechnical) btnTechnical.classList.toggle('active', mode === 'technical');

    const previewBox = document.getElementById('keychain-preview-box');
    const imgPreviewBox = document.getElementById('img-preview-box');
    [previewBox, imgPreviewBox].forEach(box => {
        if (box) {
            box.classList.toggle('view-product', mode === 'product');
            box.classList.toggle('view-technical', mode === 'technical');
        }
    });
}

const btnProduct = document.getElementById('btn-view-product');
const btnTechnical = document.getElementById('btn-view-technical');
if (btnProduct) btnProduct.addEventListener('click', () => setViewMode('product'));
if (btnTechnical) btnTechnical.addEventListener('click', () => setViewMode('technical'));

// ===== FONT PICKER =====
function buildFontChips() {
    if (!fontChips) return;
    fontChips.innerHTML = '';
    const userText = (nameInput && nameInput.value.trim().toUpperCase()) || 'INVENGIC';
    const displayText = userText.length > 10 ? userText.slice(0, 10) + '…' : userText;

    Object.values(window.KEYCHAIN_FONTS).forEach(font => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'font-chip' + (font.id === selectedFontId ? ' selected' : '');
        chip.dataset.fontId = font.id;
        chip.innerHTML = `
            <span class="font-chip-text" style="font-family: ${font.family};">${displayText}</span>
            <span class="font-chip-name">${font.label}</span>
        `;
        chip.addEventListener('click', () => selectFont(font.id));
        fontChips.appendChild(chip);
    });
}

function updateFontChipsText() {
    if (!fontChips) return;
    const userText = (nameInput && nameInput.value.trim().toUpperCase()) || 'INVENGIC';
    const displayText = userText.length > 10 ? userText.slice(0, 10) + '…' : userText;
    fontChips.querySelectorAll('.font-chip').forEach(chip => {
        const textEl = chip.querySelector('.font-chip-text');
        if (textEl) textEl.textContent = displayText;
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

// ===== DYNAMIC SHAPE PREVIEW UPDATER =====
function updateShapePreviews() {
    const shape = window.getShape(selectedShapeId);
    if (!shape) return;

    window.selectedShapeId = selectedShapeId;

    // 1. Update Text Preview SVG (#keychain-svg)
    const keychainSvg = document.getElementById('keychain-svg');
    if (keychainSvg) {
        keychainSvg.setAttribute('viewBox', shape.viewBox);
        keychainSvg.innerHTML = `
            ${shape.dimensionLines}
            ${shape.outlineSvg}
            ${shape.holeSvg}
            <text id="keychain-text"
                  x="${shape.textArea.x}" y="${shape.textArea.y}"
                  font-family="'Press Start 2P', 'Noto Emoji', monospace"
                  font-size="${(window.KEYCHAIN_FONTS[selectedFontId] ? window.KEYCHAIN_FONTS[selectedFontId].fixedCapHeight : 4) * shape.textArea.fontScale}"
                  text-anchor="${shape.textArea.anchor}"
                  dominant-baseline="${shape.textArea.baseline}"
                  fill="none" stroke="#0a0a0a" stroke-width="0.18"
                  paint-order="stroke"></text>
        `;
        renderKeychainText();
    }

    // Update Text Preview Hint
    const textPreviewHint = document.querySelector('#keychain-preview-box .preview-hint') || document.querySelector('#screen-name .preview-hint');
    if (textPreviewHint) {
        textPreviewHint.textContent = `Actual size · ${shape.dimLabelX} × ${shape.dimLabelY}`;
    }

    // 2. Update Image Preview Container & SVG Overlay
    if (imgKeychain) {
        const viewBoxW = shape.viewBoxW || shape.width;
        const viewBoxH = shape.viewBoxH || shape.height;
        imgKeychain.style.aspectRatio = `${viewBoxW} / ${viewBoxH}`;
    }

    const imgOverlay = document.querySelector('.img-overlay');
    if (imgOverlay) {
        imgOverlay.setAttribute('viewBox', shape.viewBox);
        imgOverlay.innerHTML = `
            ${shape.dimensionLines}
            ${shape.outlineSvg}
            ${shape.holeSvg}
        `;
    }

    // Update Image Preview Hint
    const imgPreviewHint = document.querySelector('#img-preview-box .preview-hint') || document.querySelector('#screen-image .preview-hint');
    if (imgPreviewHint) {
        imgPreviewHint.textContent = `Engraves inside marked area · ${shape.dimLabelX} × ${shape.dimLabelY}`;
    }

    positionImageCanvas();
    if (typeof imageProcessor !== 'undefined' && imageProcessor.hasImage) {
        imageProcessor.reprocess();
        renderImageCanvas();
    }
}

// ===== CUSTOM MOVEABLE TEXT DRAG & DROP POSITIONING =====
let customTextPos = null; // { x: number, y: number } or null for default center

function getConstrainedTextPos(x, y, shape) {
    const bounds = (shape && shape.textArea && shape.textArea.dragBounds) || {
        minX: 10, maxX: (shape ? shape.width : 50) - 10,
        minY: 6, maxY: (shape ? shape.height : 35) - 6
    };
    const clampedX = Math.max(bounds.minX, Math.min(bounds.maxX, x));
    const clampedY = Math.max(bounds.minY, Math.min(bounds.maxY, y));
    return { x: parseFloat(clampedX.toFixed(2)), y: parseFloat(clampedY.toFixed(2)) };
}

function resetTextPosition() {
    customTextPos = null;
    renderKeychainText();
}

// ===== LIVE KEYCHAIN PREVIEW (text) =====
function renderKeychainText() {
    const textEl = document.getElementById('keychain-text');
    if (!textEl) return;
    const raw = nameInput.value.trim();
    const display = raw.replace(/[a-z]/g, c => c.toUpperCase()) || 'INVENGIC';
    const font = window.KEYCHAIN_FONTS[selectedFontId] || window.KEYCHAIN_FONTS.pixel;
    const shape = window.getShape(selectedShapeId);

    textEl.textContent = display;
    textEl.setAttribute('font-family', font.family);
    
    const fontScale = shape.textArea.fontScale || 1.0;
    const baseFontSize = font.fixedCapHeight * fontScale;
    textEl.setAttribute('font-size', baseFontSize);

    let targetX = shape.textArea.x;
    let targetY = shape.textArea.y;
    if (customTextPos) {
        const constrained = getConstrainedTextPos(customTextPos.x, customTextPos.y, shape);
        targetX = constrained.x;
        targetY = constrained.y;
    }

    textEl.setAttribute('x', targetX);
    textEl.setAttribute('y', targetY);
    textEl.setAttribute('text-anchor', shape.textArea.anchor);
    textEl.setAttribute('dominant-baseline', shape.textArea.baseline);

    const maxW = shape.textArea.maxTextWidth || 50;

    // Evaluate payment & add-to-cart button status
    if (btnPay) btnPay.disabled = raw.length === 0;
    if (btnAddCartText) btnAddCartText.disabled = raw.length === 0;

    // Measure rendered text width and scale down if it exceeds shape boundary
    try {
        const bbox = textEl.getBBox();
        if (bbox && bbox.width > maxW && bbox.width > 0) {
            const scale = maxW / bbox.width;
            textEl.setAttribute('font-size', (baseFontSize * scale).toFixed(3));
        }
    } catch (e) {
        const approxWidth = display.length * (baseFontSize * 0.65);
        if (approxWidth > maxW) {
            const scale = maxW / approxWidth;
            textEl.setAttribute('font-size', (baseFontSize * scale).toFixed(3));
        }
    }
}

// SVG Interactive Drag Event Listeners
(function initTextDragEvents() {
    const textEl = document.getElementById('keychain-text');
    const svgEl = document.getElementById('keychain-svg');
    if (!textEl || !svgEl) return;

    let isDraggingText = false;
    let dragOffsetSvg = { x: 0, y: 0 };

    function getSvgCoordinates(e) {
        const pt = svgEl.createSVGPoint();
        const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
        const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
        pt.x = clientX;
        pt.y = clientY;
        const ctm = svgEl.getScreenCTM();
        if (!ctm) return { x: 0, y: 0 };
        return pt.matrixTransform(ctm.inverse());
    }

    function startDrag(e) {
        if (e.target !== textEl) return;
        isDraggingText = true;
        textEl.classList.add('dragging');
        
        const shape = window.getShape(selectedShapeId);
        const currentX = customTextPos ? customTextPos.x : shape.textArea.x;
        const currentY = customTextPos ? customTextPos.y : shape.textArea.y;
        const mouseSvg = getSvgCoordinates(e);

        dragOffsetSvg = {
            x: mouseSvg.x - currentX,
            y: mouseSvg.y - currentY
        };

        e.preventDefault();
    }

    function doDrag(e) {
        if (!isDraggingText) return;
        e.preventDefault();

        const shape = window.getShape(selectedShapeId);
        const mouseSvg = getSvgCoordinates(e);
        const targetX = mouseSvg.x - dragOffsetSvg.x;
        const targetY = mouseSvg.y - dragOffsetSvg.y;

        customTextPos = getConstrainedTextPos(targetX, targetY, shape);
        renderKeychainText();
    }

    function endDrag() {
        if (!isDraggingText) return;
        isDraggingText = false;
        textEl.classList.remove('dragging');
    }

    textEl.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', doDrag);
    window.addEventListener('mouseup', endDrag);

    textEl.addEventListener('touchstart', startDrag, { passive: false });
    window.addEventListener('touchmove', doDrag, { passive: false });
    window.addEventListener('touchend', endDrag);
    window.addEventListener('touchcancel', endDrag);

    const btnCenter = document.getElementById('btn-center-text');
    if (btnCenter) {
        btnCenter.addEventListener('click', resetTextPosition);
    }
})();

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
    updateFontChipsText();
    const hasText = nameInput.value.trim().length > 0;
    if (btnPay) btnPay.disabled = !hasText;
    if (btnAddCartText) btnAddCartText.disabled = !hasText;
});

function resetTextState() {
    nameInput.value = '';
    customTextPos = null;
    if (btnPay) btnPay.disabled = true;
    if (btnAddCartText) btnAddCartText.disabled = true;
    renderKeychainText();
    updateFontChipsText();
    updateCharCount();
}
// ===== CAMERA FUNCTIONS =====

async function openCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "environment",
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });

        if (cameraVideo) {
            cameraVideo.srcObject = cameraStream;
            await cameraVideo.play();
        }

        if (cameraModal) {
            cameraModal.hidden = false;
        }
    } catch (err) {
        alert("Unable to access the camera.");
        console.error(err);
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    if (cameraVideo) {
        cameraVideo.srcObject = null;
    }
    if (cameraModal) {
        cameraModal.hidden = true;
    }
}

async function openCropEditor(file) {
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }

    if (cropModal) {
        cropModal.hidden = false;
        cropModal.classList.remove('crop-shape-rectangle', 'crop-shape-circle', 'crop-shape-heart');
        cropModal.classList.add('crop-shape-' + (selectedShapeId || 'rectangle'));
    }

    const initCropper = () => {
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        const shape = window.getShape(selectedShapeId);
        let aspect = 72 / 35;
        if (shape) {
            if (shape.id === 'circle') aspect = 1;
            else if (shape.id === 'heart') aspect = 55 / 50;
            else aspect = shape.width / shape.height;
        }

        if (typeof Cropper !== 'undefined') {
            cropper = new Cropper(cropImage, {
                aspectRatio: aspect,
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
        }
    };

    cropImage.onload = initCropper;
    cropImage.src = URL.createObjectURL(file);
    if (cropImage.complete) {
        initCropper();
    }
}

rotateLeft.addEventListener('click', () => {
    if (cropper) cropper.rotate(-90);
});

rotateRight.addEventListener('click', () => {
    if (cropper) cropper.rotate(90);
});

cropClose.addEventListener('click', () => {
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }
    if (cropModal) cropModal.hidden = true;
});

if (cropModal) {
    cropModal.addEventListener('click', (e) => {
        if (e.target === cropModal) {
            if (cropper) {
                cropper.destroy();
                cropper = null;
            }
            cropModal.hidden = true;
        }
    });
}

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

    if (cropModal) cropModal.hidden = true;

    await handleImageFile(file);

});

// ===== IMAGE DESIGN =====
// Position the processed-bitmap canvas over the keychain's engrave area, using
// the shape's imageArea (so preview placement == engrave placement).
function positionImageCanvas() {
    const shape = window.getShape(selectedShapeId);
    const area = shape.imageArea;
    const viewBoxW = shape.viewBoxW || shape.width;
    const viewBoxH = shape.viewBoxH || shape.height;
    const originX = shape.originX || 0;
    const originY = shape.originY || 0;

    const left = ((originX + area.x) / viewBoxW) * 100;
    const top = ((originY + area.y) / viewBoxH) * 100;
    const width = (area.width / viewBoxW) * 100;
    const height = (area.height / viewBoxH) * 100;

    imgCanvas.style.left = left + '%';
    imgCanvas.style.top = top + '%';
    imgCanvas.style.width = width + '%';
    imgCanvas.style.height = height + '%';
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
    if (btnAddCartImage) btnAddCartImage.disabled = false;

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

if (cameraOpen) {
    cameraOpen.addEventListener('click', () => {
        openCamera();
    });
}

if (cameraCancel) {
    cameraCancel.addEventListener('click', () => {
        stopCamera();
    });
}

if (cameraCloseX) {
    cameraCloseX.addEventListener('click', () => {
        stopCamera();
    });
}

if (cameraBackdrop) {
    cameraBackdrop.addEventListener('click', () => {
        stopCamera();
    });
}

if (cameraModal) {
    cameraModal.addEventListener('click', (e) => {
        if (e.target === cameraModal) {
            stopCamera();
        }
    });
}

imgFile.addEventListener('change', () => {

    const file = imgFile.files && imgFile.files[0];

    if (file)
        openCropEditor(file);

    imgFile.value = '';

});

// ===== CAMERA CAPTURE =====
if (cameraCapture) {
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
}

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
    if (btnAddCartImage) btnAddCartImage.disabled = true;
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
    handleAddToCart('text');
});

btnPayImage.addEventListener('click', () => {
    if (!imageProcessor.hasImage) return;
    handleAddToCart('image');
});

function setPaymentMessage(title, sub) {
    paymentTitle.textContent = title;
    paymentSub.textContent = sub;
}

const RAZORPAY_LIVE_KEY_ID = 'rzp_live_ScIUXsDV3PFdCx';

function getMachineId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('machineId') || params.get('m') || 'laser-001';
}

let lastPaymentMode = 'text';
let lastPaymentPayload = null;
let lastDisplayName = '';

async function initiatePayment(mode, userPhone) {
    showScreen('payment');

    try {
        let payload, displayName;
        const rawPhone = userPhone || '';
        const phone_number = rawPhone;
        const phone_e164 = rawPhone ? ('91' + rawPhone) : '';

        const cartItems = (window.InvengicCart && window.InvengicCart.getItems()) || [];
        const totalCartQty = (window.InvengicCart && window.InvengicCart.getTotalCount()) || 0;
        const totalAmount = (window.InvengicCart && window.InvengicCart.getSubtotal()) || 1;

        if (mode === 'cart' || (cartItems.length > 0 && mode !== 'single_direct')) {
            setPaymentMessage(`Preparing ${totalCartQty} keychain order…`, 'Packaging custom designs for checkout.');

            payload = {
                mode: 'cart',
                items: cartItems,
                totalQuantity: totalCartQty,
                totalAmount: totalAmount,
                machineId: getMachineId(),
                phone_number,
                phone_e164
            };
            displayName = `${totalCartQty} Custom Keychain${totalCartQty > 1 ? 's' : ''}`;
        } else if (mode === 'image') {
            setPaymentMessage('Processing your image…', 'Preparing design.');
            let printImageBase64 = null;
            try {
                if (imageProcessor && imageProcessor.canvas) {
                    printImageBase64 = imageProcessor.canvas.toDataURL('image/png');
                }
            } catch (e) {
                console.warn('Canvas export warning:', e);
            }

            let paths = {};
            if (!printImageBase64) {
                try {
                    paths = await uploadImageBlobs();
                } catch (e) {
                    console.warn('Storage upload warning:', e);
                }
            }

            payload = { mode: 'image', shape: selectedShapeId, machineId: getMachineId(), printImageBase64, phone_number, phone_e164, ...paths };
            displayName = 'your image';
        } else {
            const name = nameInput.value.trim();
            payload = {
                mode: 'text',
                name,
                fontId: selectedFontId,
                shape: selectedShapeId,
                textPos: customTextPos ? { x: customTextPos.x, y: customTextPos.y } : null,
                machineId: getMachineId(),
                phone_number,
                phone_e164
            };
            displayName = name;
        }

        lastPaymentMode = mode;
        lastPaymentPayload = payload;
        lastDisplayName = displayName;

        setPaymentMessage('Preparing Payment...', 'Redirecting to Razorpay secure checkout.');

        // Save order payload to local storage for recovery on return
        localStorage.setItem('pending_order_payload', JSON.stringify({ ...payload, displayName, mode }));

        // Full-page Razorpay Redirect: Bypasses iframe QR refresh issues & pre-fills customer phone
        try {
            const linkRes = await fetch('https://us-central1-laser-keychain-official.cloudfunctions.net/createPaymentLinkHttp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, displayName, callbackUrl: window.location.origin + window.location.pathname })
            });
            const linkData = await linkRes.json();
            if (linkData && linkData.short_url) {
                if (linkData.firestoreId) {
                    payload.firestoreId = linkData.firestoreId;
                    localStorage.setItem('pending_order_payload', JSON.stringify({ ...payload, displayName, mode }));
                }
                window.location.href = linkData.short_url;
                return;
            }
        } catch (err) {
            console.warn('Payment link creation warning, falling back to popup modal:', err);
        }

        // Secondary Fallback: Create Order ID & open popup modal
        let orderId = null;
        try {
            const httpRes = await fetch('https://us-central1-laser-keychain-official.cloudfunctions.net/createOrderHttp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const httpData = await httpRes.json();
            if (httpData && httpData.orderId) {
                orderId = httpData.orderId;
            }
        } catch (err) {
            console.warn('HTTP order creation warning:', err);
        }

        if (typeof Razorpay !== 'undefined') {
            openRazorpayCheckout({ displayName, mode, payload, orderId });
        } else {
            alert('Razorpay SDK is loading. Please try again in a moment.');
            returnToDesign(mode);
        }

    } catch (error) {
        handleOrderError(error, mode);
    }
}

function openRazorpayCheckout({ displayName, mode, payload, orderId }) {
    const options = {
        key: RAZORPAY_LIVE_KEY_ID,
        name: 'Laser Keychain',
        description: mode === 'image' ? 'Custom image keychain' : ('Custom keychain: "' + displayName + '"'),
        prefill: {
            name: mode === 'image' ? 'Customer' : displayName,
            contact: payload.phone_number ? ('+91' + payload.phone_number.slice(-10)) : '',
        },
        retry: {
            enabled: true,
            max_count: 4,
        },
        theme: { color: '#00e5ff' },
        handler: async function (response) {
            handlePaymentSuccess(response, payload.firestoreId || '', displayName, mode);
        },
        modal: {
            confirm_close: true,
            ondismiss: function () {
                returnToDesign(mode);
            },
        },
    };

    if (orderId && !orderId.startsWith('order_live_')) {
        options.order_id = orderId;
    } else {
        options.amount = (payload.totalAmount || 1) * 100; // Amount in paise (₹1 per keychain)
        options.currency = 'INR';
    }

    try {
        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function () {
            returnToDesign(mode);
            alert('Payment failed. Please try again.');
        });
        rzp.open();
    } catch (e) {
        console.warn('Razorpay checkout modal warning:', e);
        returnToDesign(mode);
        alert('Unable to open Razorpay payment popup. Please click "Pay via Direct Page" below.');
    }
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
    returnToDesign(mode);
    const msg = error && (error.message || (typeof error === 'string' ? error : JSON.stringify(error)));
    alert(msg || 'Something went wrong. Please try again.');
}

// Optimistic UI: show the success screen immediately, verify in the background.
function handlePaymentSuccess(response, firestoreId, displayName, mode) {
    if (window.InvengicCart) {
        window.InvengicCart.clearCart();
    }

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
        let queue_position = null;
        let firestoreId = payload.firestoreId || '';
        let displayName = payload.name || 'Customer';
        let mode = payload.mode || 'text';

        try {
            const httpRes = await fetch('https://us-central1-laser-keychain-official.cloudfunctions.net/verifyPaymentHttp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    razorpay_order_id: payload.razorpay_order_id || '',
                    razorpay_payment_id: payload.razorpay_payment_id || '',
                    razorpay_signature: payload.razorpay_signature || '',
                    firestoreId: payload.firestoreId || '',
                })
            });
            const data = await httpRes.json();
            if (data && data.success) {
                queue_position = data.queue_position;
                if (data.firestoreId) firestoreId = data.firestoreId;
                if (data.displayName) displayName = data.displayName;
                if (data.mode) mode = data.mode;
            }
        } catch (httpErr) {
            console.warn('HTTP verify failed, trying SDK callable:', httpErr);
            if (typeof functions !== 'undefined' && functions.httpsCallable) {
                const verifyCallable = functions.httpsCallable('verifyPayment');
                const result = await verifyCallable(payload);
                queue_position = result.data.queue_position;
            }
        }

        localStorage.removeItem('pendingVerify');
        if (queue_position) {
            activeOrder = { firestoreId, name: displayName, queue_position, mode };
            localStorage.setItem('activeOrder', JSON.stringify(activeOrder));
            renderSuccessIdentity(displayName, mode);
            queueNumber.textContent = '#' + queue_position;
            startOwnOrderListener(firestoreId);
        } else {
            verifyBanner.hidden = false;
            verifyBanner.textContent = 'Payment received! Assigning queue spot...';
        }
        if (document.body.dataset.screen === 'success') startLiveQueueListener();
    } catch (error) {
        console.error('Payment verification failed:', error);
        verifyBanner.hidden = false;
        verifyBanner.textContent = 'Payment received! If queue spot does not update, please refresh.';
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

// ===== PAYMENT FALLBACK BUTTONS =====
const btnReopenModal = document.getElementById('btn-reopen-modal');
const btnOpenDirectLink = document.getElementById('btn-open-direct-link');

if (btnReopenModal) {
    btnReopenModal.addEventListener('click', () => {
        initiatePayment(lastPaymentMode);
    });
}

if (btnOpenDirectLink) {
    btnOpenDirectLink.addEventListener('click', async () => {
        btnOpenDirectLink.disabled = true;
        const originalText = btnOpenDirectLink.textContent;
        btnOpenDirectLink.textContent = 'Generating Direct Page Link...';
        try {
            localStorage.setItem('pending_order_payload', JSON.stringify({ ...lastPaymentPayload, displayName: lastDisplayName, mode: lastPaymentMode }));
            const linkRes = await fetch('https://us-central1-laser-keychain-official.cloudfunctions.net/createPaymentLinkHttp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName: lastDisplayName, callbackUrl: window.location.origin + window.location.pathname })
            });
            const linkData = await linkRes.json();
            if (linkData && linkData.short_url) {
                window.location.href = linkData.short_url;
            } else {
                alert('Could not open direct link. Opening fresh checkout...');
                initiatePayment(lastPaymentMode);
            }
        } catch (e) {
            console.error('Direct link error:', e);
            alert('Opening fresh checkout...');
            initiatePayment(lastPaymentMode);
        } finally {
            btnOpenDirectLink.disabled = false;
            btnOpenDirectLink.textContent = originalText;
        }
    });
}

// Check for return from direct payment link
function checkRedirectPayment() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('payment') || urlParams.has('razorpay_payment_id') || urlParams.has('payment_id') || urlParams.has('razorpay_payment_link_id') || urlParams.has('razorpay_payment_link_status')) {
        // SYNCHRONOUSLY SHOW SUCCESS ENGRAVING SCREEN IMMEDIATELY
        suppressPushState = true;
        showScreenInternal('success');
        suppressPushState = false;
        window.history.replaceState({ screen: 'success' }, document.title, window.location.pathname + '#success');

        let stored = localStorage.getItem('pending_order_payload');
        let payload = null;
        if (stored) {
            try {
                payload = JSON.parse(stored);
            } catch (e) {
                console.warn('Failed to parse pending_order_payload:', e);
            }
        }
        if (!payload) {
            payload = {
                mode: 'text',
                name: 'Custom Keychain',
                fontId: 'pixel',
                shape: 'rectangle',
                machineId: getMachineId(),
                displayName: 'Custom Keychain'
            };
        }
        const firestoreId = urlParams.get('firestoreId') || payload.firestoreId || '';
        const response = {
            razorpay_payment_id: urlParams.get('razorpay_payment_id') || urlParams.get('payment_id') || ('pay_direct_' + Date.now()),
            razorpay_order_id: urlParams.get('razorpay_payment_link_id') || urlParams.get('razorpay_order_id') || '',
            razorpay_signature: urlParams.get('razorpay_signature') || '',
        };
        
        localStorage.removeItem('pending_order_payload');
        handlePaymentSuccess(response, firestoreId, payload.displayName || payload.name || 'Customer', payload.mode || 'text');
        return true;
    }
    return false;
}

// ===== TESTIMONIAL SCROLL OBSERVER =====
function initTestimonialObserver() {
    const testimonialEl = document.getElementById('testimonial-section');
    if (!testimonialEl) return;

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    testimonialEl.classList.add('in-view');
                    observer.unobserve(testimonialEl);
                }
            });
        }, { threshold: 0.15 });

        observer.observe(testimonialEl);
    } else {
        testimonialEl.classList.add('in-view');
    }
}

// ===== TOAST NOTIFICATIONS =====
function showToast(message, type = 'success') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = '✓';
    if (type === 'warning') icon = '⚠️';
    if (type === 'error') icon = '✕';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 4000);
}

// ===== CART DRAWER & CONTROLLER =====
function openCartDrawer() {
    renderCartDrawer();
    if (cartDrawer) {
        cartDrawer.hidden = false;
        cartDrawer.classList.add('active');
    }
    if (cartOverlay) {
        cartOverlay.hidden = false;
        cartOverlay.classList.add('active');
    }
}

function closeCartDrawer() {
    if (cartDrawer) {
        cartDrawer.classList.remove('active');
        setTimeout(() => { cartDrawer.hidden = true; }, 350);
    }
    if (cartOverlay) {
        cartOverlay.classList.remove('active');
        setTimeout(() => { cartOverlay.hidden = true; }, 350);
    }
}

function updateCartBadge() {
    if (!window.InvengicCart) return;
    const totalCount = window.InvengicCart.getTotalCount();
    if (cartBadge) {
        if (totalCount > 0) {
            cartBadge.textContent = totalCount;
            cartBadge.hidden = false;
        } else {
            cartBadge.hidden = true;
        }
    }
}

function updateAddToCartButtonsLabel() {
    const isEditing = window.InvengicCart && window.InvengicCart.getEditingItemId();
    const label = isEditing ? '✓ Update Item' : '🛒 Add to Cart';
    if (btnAddCartText) btnAddCartText.innerHTML = label;
    if (btnAddCartImage) btnAddCartImage.innerHTML = label;
}

function renderCartDrawer() {
    if (!window.InvengicCart || !cartItemsContainer) return;
    const items = window.InvengicCart.getItems();
    const totalCount = window.InvengicCart.getTotalCount();
    const subtotal = window.InvengicCart.getSubtotal();

    if (cartDrawerCount) cartDrawerCount.textContent = `(${totalCount} item${totalCount === 1 ? '' : 's'})`;
    if (cartTotalQty) cartTotalQty.textContent = totalCount;
    if (cartSubtotalAmount) cartSubtotalAmount.textContent = subtotal;
    if (cartCheckoutAmount) cartCheckoutAmount.textContent = subtotal;

    if (cartLimitBanner) {
        cartLimitBanner.hidden = totalCount < 20;
    }

    if (cartCheckoutBtn) {
        cartCheckoutBtn.disabled = totalCount === 0;
    }

    if (items.length === 0) {
        cartItemsContainer.innerHTML = `
            <div class="cart-empty-state">
                <div class="cart-empty-icon">🛒</div>
                <h4>YOUR CART IS EMPTY</h4>
                <p>Customize keychains and add them to your cart!</p>
                <button type="button" class="btn btn-primary" onclick="closeCartDrawer(); showScreen('create');">
                    Start Creating
                </button>
            </div>
        `;
        return;
    }

    cartItemsContainer.innerHTML = '';

    items.forEach((item) => {
        const shapeObj = window.getShape ? window.getShape(item.shapeId) : null;
        const shapeTitle = shapeObj ? shapeObj.title : (item.shapeId || 'Rectangle');
        const fontObj = item.fontId && window.KEYCHAIN_FONTS ? window.KEYCHAIN_FONTS[item.fontId] : null;

        let thumbMarkup = '';
        if (item.mode === 'image' && item.thumbUrl) {
            thumbMarkup = `<img src="${item.thumbUrl}" alt="Custom photo preview" class="cart-item-thumb" />`;
        } else {
            thumbMarkup = `
                <svg viewBox="0 0 72 35" class="cart-item-thumb">
                    <rect x="2" y="2" width="68" height="31" rx="4" fill="none" stroke="#6366f1" stroke-width="2.5" />
                    <text x="36" y="20" font-family="${fontObj ? fontObj.family : 'Inter'}" font-size="10" text-anchor="middle" dominant-baseline="middle" fill="#0f172a" font-weight="bold">
                        ${(item.name || 'CUSTOM').slice(0, 7)}
                    </text>
                </svg>
            `;
        }

        const itemCard = document.createElement('div');
        itemCard.className = 'cart-item-card';
        itemCard.dataset.id = item.id;
        itemCard.innerHTML = `
            <div class="cart-item-thumb-wrap">
                ${thumbMarkup}
            </div>
            <div class="cart-item-info">
                <div class="cart-item-top">
                    <div>
                        <div class="cart-item-title">${item.mode === 'image' ? '📷 Custom Logo / Image' : item.name}</div>
                        <div class="cart-item-details">
                            <span>Shape: <strong>${shapeTitle}</strong></span>
                            ${item.mode === 'text' && fontObj ? `<span>Font: <strong>${fontObj.label}</strong></span>` : ''}
                            <span class="cart-item-badge">Laser Engraved</span>
                        </div>
                    </div>
                    <div class="cart-item-price">₹${item.quantity * item.unitPrice}</div>
                </div>
                <div class="cart-item-bottom">
                    <div class="cart-qty-control">
                        <button type="button" class="cart-qty-btn btn-qty-minus" data-id="${item.id}" aria-label="Decrease quantity">−</button>
                        <span class="cart-qty-num">${item.quantity}</span>
                        <button type="button" class="cart-qty-btn btn-qty-plus" data-id="${item.id}" ${totalCount >= 20 ? 'disabled' : ''} aria-label="Increase quantity">+</button>
                    </div>
                    <div class="cart-item-actions">
                        <button type="button" class="cart-action-btn btn-edit-item" data-id="${item.id}">Edit</button>
                        <button type="button" class="cart-action-btn btn-remove btn-remove-item" data-id="${item.id}">Remove</button>
                    </div>
                </div>
            </div>
        `;

        cartItemsContainer.appendChild(itemCard);
    });

    // Item Action Listeners
    cartItemsContainer.querySelectorAll('.btn-qty-minus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const item = items.find(i => i.id === id);
            if (item) {
                if (item.quantity > 1) {
                    window.InvengicCart.updateQuantity(id, item.quantity - 1);
                } else {
                    if (confirm(`Remove "${item.name}" from cart?`)) {
                        window.InvengicCart.removeItem(id);
                        showToast('Item removed from cart', 'warning');
                    }
                }
            }
        });
    });

    cartItemsContainer.querySelectorAll('.btn-qty-plus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const item = items.find(i => i.id === id);
            if (item) {
                if (!window.InvengicCart.canAddQuantity(1)) {
                    showToast('⚠️ Maximum 20 keychains limit reached!', 'warning');
                    return;
                }
                window.InvengicCart.updateQuantity(id, item.quantity + 1);
            }
        });
    });

    cartItemsContainer.querySelectorAll('.btn-remove-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            window.InvengicCart.removeItem(id);
            showToast('Item removed from cart', 'warning');
        });
    });

    cartItemsContainer.querySelectorAll('.btn-edit-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            editCartItem(id);
        });
    });
}

function editCartItem(itemId) {
    if (!window.InvengicCart) return;
    const item = window.InvengicCart.getItem(itemId);
    if (!item) return;

    window.InvengicCart.setEditingItem(itemId);
    closeCartDrawer();
    showScreen('create');

    if (item.shapeId) {
        const shapeCard = document.querySelector(`.shape-card[data-shape-id="${item.shapeId}"]`);
        if (shapeCard) shapeCard.click();
    }

    if (item.mode === 'text') {
        if (typeName) typeName.click();
        if (nameInput) {
            nameInput.value = item.name || '';
            updateCharCount();
        }
        if (item.fontId && window.KEYCHAIN_FONTS[item.fontId]) {
            selectFont(item.fontId);
        }
        if (item.textPos) {
            customTextPos = { ...item.textPos };
        } else {
            customTextPos = null;
        }
        renderKeychainText();
        updateFontChipsText();
    } else if (item.mode === 'image') {
        if (typeImage) typeImage.click();
        if (item.imageProcessorState && item.imageProcessorState.canvasDataUrl) {
            const img = new Image();
            img.onload = () => {
                imageProcessor.width = img.width;
                imageProcessor.height = img.height;
                imageProcessor.canvas.width = img.width;
                imageProcessor.canvas.height = img.height;
                const ctx = imageProcessor.canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                positionImageCanvas();
                renderImageCanvas();
                imgKeychain.classList.add('has-image');
                removeImage.hidden = false;
                imgControls.hidden = false;
                btnPayImage.disabled = false;
                if (btnAddCartImage) btnAddCartImage.disabled = false;
            };
            img.src = item.imageProcessorState.canvasDataUrl;
        }
    }

    updateAddToCartButtonsLabel();
    showToast('Editing cart item design', 'warning');
}

function handleAddToCart(mode) {
    if (!window.InvengicCart) return;

    const editingId = window.InvengicCart.getEditingItemId();
    if (!editingId && !window.InvengicCart.canAddQuantity(1)) {
        showToast('⚠️ Maximum 20 keychains limit reached per order!', 'warning');
        if (cartLimitBanner) cartLimitBanner.hidden = false;
        openCartDrawer();
        return;
    }

    let spec = { mode };

    if (mode === 'text') {
        const textVal = nameInput.value.trim();
        if (!textVal) {
            showToast('Please enter text for your keychain', 'warning');
            return;
        }
        spec.name = textVal;
        spec.shapeId = selectedShapeId;
        spec.fontId = selectedFontId;
        spec.textPos = customTextPos ? { ...customTextPos } : null;
    } else if (mode === 'image') {
        if (!imageProcessor.hasImage) {
            showToast('Please upload an image or take a photo', 'warning');
            return;
        }
        spec.name = 'Custom Photo / Logo';
        spec.shapeId = selectedShapeId;
        spec.imageProcessorState = {
            threshold: imageProcessor.threshold,
            invert: imageProcessor.invert,
            canvasDataUrl: imageProcessor.canvas ? imageProcessor.canvas.toDataURL('image/png') : null
        };
        spec.thumbUrl = imageProcessor.canvas ? imageProcessor.canvas.toDataURL('image/png') : null;
    }

    if (editingId) {
        spec.id = editingId;
    }

    window.InvengicCart.addItem(spec);
    
    if (editingId) {
        showToast('✓ Cart item updated!', 'success');
    } else {
        showToast('✓ Custom keychain added to cart!', 'success');
    }

    window.InvengicCart.setEditingItem(null);
    updateAddToCartButtonsLabel();

    if (mode === 'text' && !editingId) {
        resetTextState();
    }

    openCartDrawer();
}

// Init Cart Event Listeners
if (cartBtn) cartBtn.addEventListener('click', openCartDrawer);
if (cartCloseBtn) cartCloseBtn.addEventListener('click', closeCartDrawer);
if (cartOverlay) cartOverlay.addEventListener('click', closeCartDrawer);
if (cartContinueBtn) {
    cartContinueBtn.addEventListener('click', () => {
        closeCartDrawer();
        showScreen('create');
    });
}

if (cartCheckoutBtn) {
    cartCheckoutBtn.addEventListener('click', () => {
        const count = window.InvengicCart ? window.InvengicCart.getTotalCount() : 0;
        if (count === 0) {
            showToast('Your cart is empty!', 'warning');
            return;
        }
        closeCartDrawer();
        openPhoneModal('cart');
    });
}

if (btnAddCartText) {
    btnAddCartText.addEventListener('click', () => handleAddToCart('text'));
}
if (btnAddCartImage) {
    btnAddCartImage.addEventListener('click', () => handleAddToCart('image'));
}

if (window.InvengicCart) {
    window.InvengicCart.subscribe(() => {
        updateCartBadge();
        renderCartDrawer();
    });
    updateCartBadge();
}

// ===== INITIAL BOOT =====
buildFontChips();
buildEmojiPanel();
renderKeychainText();
updateCharCount();
positionImageCanvas();
resetImageState();
initTestimonialObserver();

(function bootScreen() {
    if (checkRedirectPayment()) return;
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
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

function showScreenInternal(screenName) {
    const targetScreen = screens[screenName] || screens.welcome;
    const uniqueScreens = new Set(Object.values(screens).filter(Boolean));
    uniqueScreens.forEach(s => s.classList.remove('active'));
    
    targetScreen.classList.add('active');
    document.body.dataset.screen = screenName;

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

const heroCanvas = document.getElementById('hero-canvas');
if (heroCanvas && window.matchMedia('(min-width: 900px)').matches) {
    heroCanvas.addEventListener('mousemove', (e) => {
        const rect = heroCanvas.getBoundingClientRect();
        const offsetX = (e.clientX - rect.left - rect.width / 2) * 0.015;
        const offsetY = (e.clientY - rect.top - rect.height / 2) * 0.015;

        heroSamples.forEach((sample, i) => {
            const factor = (i % 2 === 0 ? 1 : -1) * (0.5 + (i * 0.15));
            sample.style.setProperty('--px', `${(offsetX * factor).toFixed(1)}px`);
            sample.style.setProperty('--py', `${(offsetY * factor).toFixed(1)}px`);
        });
    });

    heroCanvas.addEventListener('mouseleave', () => {
        heroSamples.forEach(sample => {
            sample.style.removeProperty('--px');
            sample.style.removeProperty('--py');
        });
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
    textEl.setAttribute('x', shape.textArea.x);
    textEl.setAttribute('y', shape.textArea.y);
    textEl.setAttribute('text-anchor', shape.textArea.anchor);
    textEl.setAttribute('dominant-baseline', shape.textArea.baseline);

    const maxW = shape.textArea.maxTextWidth || 50;

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
    btnPay.disabled = nameInput.value.trim().length === 0;
});

function resetTextState() {
    nameInput.value = '';
    btnPay.disabled = true;
    renderKeychainText();
    updateFontChipsText();
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

    cropModal.hidden = false;

    const initCropper = () => {
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        const shape = window.getShape(selectedShapeId);
        const aspect = shape ? (shape.width / shape.height) : (72 / 35);
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

const RAZORPAY_LIVE_KEY_ID = 'rzp_live_ScIUXsDV3PFdCx';

function getMachineId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('machineId') || params.get('m') || 'laser-001';
}

let lastPaymentMode = 'text';
let lastPaymentPayload = null;
let lastDisplayName = '';

async function initiatePayment(mode) {
    showScreen('payment');

    try {
        let payload, displayName;

        if (mode === 'image') {
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

            payload = { mode: 'image', shape: selectedShapeId, machineId: getMachineId(), printImageBase64, ...paths };
            displayName = 'your image';
        } else {
            const name = nameInput.value.trim();
            payload = { mode: 'text', name, fontId: selectedFontId, shape: selectedShapeId, machineId: getMachineId() };
            displayName = name;
        }

        lastPaymentMode = mode;
        lastPaymentPayload = payload;
        lastDisplayName = displayName;

        setPaymentMessage('Preparing Payment...', 'Redirecting to Razorpay secure checkout.');

        // Save order payload to local storage for return redirect recovery
        localStorage.setItem('pending_order_payload', JSON.stringify({ ...payload, displayName, mode }));

        // Primary Flow: Create & redirect to Razorpay Payment Link (bypasses iframe QR issues)
        try {
            const linkRes = await fetch('https://us-central1-laser-keychain-official.cloudfunctions.net/createPaymentLinkHttp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName, callbackUrl: window.location.origin + window.location.pathname })
            });
            const linkData = await linkRes.json();
            if (linkData && linkData.short_url) {
                window.location.href = linkData.short_url;
                return;
            }
        } catch (err) {
            console.warn('Payment link creation fallback to modal:', err);
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
            await finalizeOrderAndQueue(payload, displayName, mode);
        }

    } catch (error) {
        handleOrderError(error, mode);
    }
}

function openRazorpayCheckout({ displayName, mode, payload, orderId }) {
    const options = {
        key: RAZORPAY_LIVE_KEY_ID,
        amount: 100, // ₹1.00 = 100 paise
        currency: 'INR',
        name: 'Laser Keychain',
        description: mode === 'image' ? 'Custom image keychain' : ('Custom keychain: "' + displayName + '"'),
        prefill: {
            name: mode === 'image' ? 'Customer' : displayName,
        },
        retry: {
            enabled: true,
            max_count: 4,
        },
        theme: { color: '#00e5ff' },
        handler: async function (response) {
            payload.razorpay_payment_id = response.razorpay_payment_id || ('pay_live_' + Date.now());
            if (response.razorpay_order_id) payload.razorpay_order_id = response.razorpay_order_id;
            await finalizeOrderAndQueue(payload, displayName, mode);
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
    }

    try {
        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function () {
            returnToDesign(mode);
            alert('Payment failed. Please try again.');
        });
        rzp.open();
    } catch (e) {
        console.warn('Razorpay checkout modal warning, finalizing order:', e);
        finalizeOrderAndQueue(payload, displayName, mode);
    }
}

async function finalizeOrderAndQueue(payload, displayName, mode) {
    setPaymentMessage('Placing Order...', 'Adding your order to the live queue.');
    const result = await db.runTransaction(async (transaction) => {
        const counterRef = db.doc('meta/counter');
        const counterDoc = await transaction.get(counterRef);

        let nextPosition = 1;
        if (counterDoc.exists) {
            nextPosition = (counterDoc.data().last_position || 0) + 1;
        }

        transaction.set(counterRef, { last_position: nextPosition }, { merge: true });

        const orderRef = db.collection('orders').doc();
        transaction.set(orderRef, {
            ...payload,
            status: 'queued',
            queue_position: nextPosition,
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });

        return { firestoreId: orderRef.id, queue_position: nextPosition };
    });

    const { firestoreId, queue_position } = result;

    activeOrder = { firestoreId, name: displayName, queue_position, mode };
    localStorage.setItem('activeOrder', JSON.stringify(activeOrder));

    renderSuccessIdentity(displayName, mode);
    queueNumber.textContent = '#' + queue_position;
    verifyBanner.hidden = true;
    updateOrderProgress("queued");
    showScreen('success');
    startLiveQueueListener();
    startOwnOrderListener(firestoreId);
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
        const stored = localStorage.getItem('pending_order_payload');
        if (stored) {
            try {
                const payload = JSON.parse(stored);
                payload.razorpay_payment_id = urlParams.get('razorpay_payment_id') || urlParams.get('payment_id') || ('pay_direct_' + Date.now());
                if (urlParams.has('razorpay_payment_link_id')) {
                    payload.razorpay_order_id = urlParams.get('razorpay_payment_link_id');
                }
                localStorage.removeItem('pending_order_payload');
                window.history.replaceState({}, document.title, window.location.pathname);
                finalizeOrderAndQueue(payload, payload.displayName || 'Customer', payload.mode || 'text');
                return true;
            } catch (e) {
                console.warn('Redirect payment recovery warning:', e);
            }
        }
    }
    return false;
}

// ===== INITIAL BOOT =====
buildFontChips();
buildEmojiPanel();
renderKeychainText();
updateCharCount();
positionImageCanvas();
resetImageState();

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
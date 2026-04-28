// ===== STATE =====
let selectedFontId = window.DEFAULT_FONT_ID;
const MAX_CODEPOINTS = 20;

// In-flight order tracking — used by `beforeunload` warning + recovery on reload.
// Set when the order is placed, cleared once status === 'done'.
let activeOrder = null; // { firestoreId, name, queue_position }
let liveQueueUnsub = null;
let ownOrderUnsub = null;
let notifyOnTurn = false;
let notifyOnDone = false;
let suppressPushState = false; // prevents pushState during popstate handling

// ===== DOM ELEMENTS =====
const screens = {
    welcome: document.getElementById('screen-welcome'),
    preview: document.getElementById('screen-preview'),
    payment: document.getElementById('screen-payment'),
    success: document.getElementById('screen-success'),
};

const btnStart = document.getElementById('btn-start');
const btnPay = document.getElementById('btn-pay');
const btnHome = document.getElementById('home-btn');
const btnNotify = document.getElementById('btn-notify');
const nameInput = document.getElementById('name-input');
const charCurrent = document.getElementById('char-current');
const keychainText = document.getElementById('keychain-text');
const fontChips = document.getElementById('font-chips');
const queueNumber = document.getElementById('queue-number');
const successName = document.getElementById('success-name');
const liveQueue = document.getElementById('live-queue');
const liveQueueText = document.getElementById('live-queue-text');
const liveQueueSub = document.getElementById('live-queue-sub');
const nowPrintingEl = document.getElementById('now-printing');
const verifyBanner = document.getElementById('verify-banner');
const successFooter = document.getElementById('success-footer-text');
const emojiToggle = document.getElementById('emoji-toggle');
const emojiPanel = document.getElementById('emoji-panel');

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
    const hasInput = nameInput.value.trim().length > 0;
    if (onSuccess && activeOrder) {
        const ok = confirm("Your order is still being printed. Leave this page anyway? You'll lose live status updates.");
        if (!ok) return;
    } else if (hasInput) {
        const ok = confirm('Discard your design and go back to home?');
        if (!ok) return;
    }
    nameInput.value = '';
    btnPay.disabled = true;
    renderKeychainText();
    updateCharCount();
    showScreen('welcome');
});

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

// ===== EMOJI PICKER =====
// Curated list — every entry is hand-picked to render acceptably as a Noto Emoji
// outline glyph at small engraving sizes. Add carefully; test before deploying.
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
    // Insert at cursor position if available, else append.
    const pos = nameInput.selectionStart ?? before.length;
    const next = before.slice(0, pos) + emoji + before.slice(pos);
    nameInput.value = Array.from(next).slice(0, MAX_CODEPOINTS).join('');
    nameInput.focus();
    // Trigger the same logic as a manual input event
    nameInput.dispatchEvent(new Event('input'));
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

function updateCharCount() {
    charCurrent.textContent = Array.from(nameInput.value).length;
}

nameInput.addEventListener('input', () => {
    // Truncate by codepoint so emoji surrogate pairs stay intact
    const cps = Array.from(nameInput.value);
    if (cps.length > MAX_CODEPOINTS) {
        nameInput.value = cps.slice(0, MAX_CODEPOINTS).join('');
    }
    updateCharCount();
    renderKeychainText();
    btnPay.disabled = nameInput.value.trim().length === 0;
});

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
        const createOrder = functions.httpsCallable('createOrder');
        const result = await createOrder({ name, fontId: selectedFontId });
        const { orderId, firestoreId, amount, currency, keyId } = result.data;

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
            handler: function (response) {
                handlePaymentSuccess(response, firestoreId, name);
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

// Optimistic UI: show the success screen immediately, verify in the background.
// If the user closes the tab mid-verify, the persisted `pendingVerify` payload
// gets retried on next load.
function handlePaymentSuccess(response, firestoreId, name) {
    const payload = {
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature,
        firestoreId: firestoreId,
        name: name,
    };
    localStorage.setItem('pendingVerify', JSON.stringify(payload));

    // Show the success screen instantly with placeholder
    successName.textContent = name;
    queueNumber.textContent = '#…';
    verifyBanner.hidden = true;
    activeOrder = { firestoreId, name, queue_position: null };
    showScreen('success');

    runVerify(payload);
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
        activeOrder = { firestoreId: payload.firestoreId, name: payload.name, queue_position };
        localStorage.setItem('activeOrder', JSON.stringify(activeOrder));

        successName.textContent = payload.name;
        queueNumber.textContent = '#' + queue_position;

        // Now we know our queue number — start subscriptions
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
            successName.textContent = payload.name;
            queueNumber.textContent = '#…';
            activeOrder = { firestoreId: payload.firestoreId, name: payload.name, queue_position: null };
            showScreen('success');
            runVerify(payload);
            return true;
        } catch (e) {
            localStorage.removeItem('pendingVerify');
        }
    }
    // No pending verify — but maybe an active order from a prior session?
    const stored = localStorage.getItem('activeOrder');
    if (stored) {
        try {
            const order = JSON.parse(stored);
            // Only restore if still on success screen worth showing
            const target = readScreenFromHash();
            if (target === 'success' && order.queue_position) {
                activeOrder = order;
                successName.textContent = order.name;
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
                fireNotificationOnTurn(printing.name || activeOrder.name);
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

function startOwnOrderListener(firestoreId) {
    if (ownOrderUnsub) { ownOrderUnsub(); ownOrderUnsub = null; }
    if (typeof db === 'undefined') return;

    ownOrderUnsub = db.collection('orders').doc(firestoreId)
        .onSnapshot((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            if (data.status === 'done') {
                successFooter.textContent = 'Ready for pickup ✨';
                fireNotificationOnDone(data.name || activeOrder?.name || 'Your keychain');
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
        btnNotify.textContent = 'Notifications enabled';
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

// Wire up initial history state — if the URL has a hash like #preview or
// #success, jump there. Otherwise default to welcome.
(function bootScreen() {
    if (recoverPendingOrder()) return; // showed success already
    const target = readScreenFromHash() || 'welcome';
    suppressPushState = true;
    showScreenInternal(target);
    suppressPushState = false;
    history.replaceState({ screen: target }, '', '#' + target);
})();

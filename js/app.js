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

// ===== LIVE KEYCHAIN PREVIEW =====
nameInput.addEventListener('input', () => {
    const name = nameInput.value.trim();
    charCurrent.textContent = nameInput.value.length;

    // Update SVG preview
    keychainText.textContent = name.toUpperCase() || 'YOUR NAME';

    // Scale text down if too long
    const len = (name || 'YOUR NAME').length;
    if (len > 10) {
        keychainText.setAttribute('font-size', '16');
    } else if (len > 7) {
        keychainText.setAttribute('font-size', '19');
    } else {
        keychainText.setAttribute('font-size', '22');
    }

    // Enable/disable pay button
    btnPay.disabled = name.length === 0;
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
        // Step 1: Create order via Cloud Function
        const createOrder = functions.httpsCallable('createOrder');
        const result = await createOrder({ name });
        const { orderId, firestoreId, amount, currency, keyId } = result.data;

        // Step 2: Open Razorpay checkout
        const options = {
            key: keyId,
            amount: amount,
            currency: currency,
            name: 'Laser Keychain',
            description: 'Custom keychain: "' + name.toUpperCase() + '"',
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
                // Step 3: Verify payment via Cloud Function
                await handlePaymentSuccess(response, firestoreId, name);
            },
            modal: {
                ondismiss: function () {
                    // User closed Razorpay modal — go back
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
        // Verify payment server-side
        const verifyPayment = functions.httpsCallable('verifyPayment');
        const result = await verifyPayment({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            firestoreId: firestoreId,
        });

        const { queue_position } = result.data;

        // Show success screen
        successName.textContent = name.toUpperCase();
        queueNumber.textContent = '#' + queue_position;
        showScreen('success');

    } catch (error) {
        console.error('Payment verification failed:', error);
        alert('Payment received but verification failed. Please contact support.');
        showScreen('preview');
        btnPay.disabled = false;
    }
}

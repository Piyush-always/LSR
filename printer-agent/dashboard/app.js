// ===== DOM ELEMENTS =====
const queueGrid = document.getElementById('queue-grid');
const emptyState = document.getElementById('empty-state');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statQueued = document.getElementById('stat-queued');
const statPrinting = document.getElementById('stat-printing');
const statDone = document.getElementById('stat-done');

// Track all orders
const orders = new Map();

// ===== FIRESTORE REAL-TIME LISTENER =====
db.collection('orders')
    .where('status', 'in', ['queued', 'printing', 'done'])
    .orderBy('queue_position', 'asc')
    .onSnapshot((snapshot) => {
        // Connected
        statusDot.classList.add('connected');
        statusText.textContent = 'Live';

        snapshot.docChanges().forEach((change) => {
            const order = { id: change.doc.id, ...change.doc.data() };

            if (change.type === 'added' || change.type === 'modified') {
                orders.set(order.id, order);
            }

            if (change.type === 'removed') {
                orders.delete(order.id);
            }
        });

        renderQueue();
    }, (error) => {
        console.error('Firestore listener error:', error);
        statusDot.classList.remove('connected');
        statusText.textContent = 'Disconnected';
    });

// ===== RENDER QUEUE =====
function renderQueue() {
    // Sort orders: printing first, then queued, then done
    const statusOrder = { printing: 0, queued: 1, done: 2 };
    const sorted = Array.from(orders.values()).sort((a, b) => {
        const statusDiff = (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
        if (statusDiff !== 0) return statusDiff;
        return (a.queue_position || 0) - (b.queue_position || 0);
    });

    // Update stats
    let queued = 0, printing = 0, done = 0;
    sorted.forEach(o => {
        if (o.status === 'queued') queued++;
        else if (o.status === 'printing') printing++;
        else if (o.status === 'done') done++;
    });
    statQueued.textContent = queued;
    statPrinting.textContent = printing;
    statDone.textContent = done;

    // Show/hide empty state
    if (sorted.length === 0) {
        emptyState.classList.add('visible');
        queueGrid.innerHTML = '';
        return;
    }
    emptyState.classList.remove('visible');

    // Render cards
    queueGrid.innerHTML = sorted.map(order => createCard(order)).join('');
}

function createCard(order) {
    const name = order.name || 'UNKNOWN';
    const position = order.queue_position || '-';
    const status = order.status || 'queued';
    const time = order.created_at ? formatTime(order.created_at.toDate()) : '';

    // Auto-scale text size
    const len = name.length;
    let fontSize = 22;
    if (len > 10) fontSize = 16;
    else if (len > 7) fontSize = 19;

    return `
        <div class="order-card status-${status}">
            <div class="card-header">
                <span class="card-position">#${position}</span>
                <span class="card-status ${status}">${status}</span>
            </div>
            <div class="card-keychain">
                <svg viewBox="0 0 320 140">
                    <rect x="10" y="20" width="300" height="100" rx="12" ry="12" class="card-keychain-body"/>
                    <rect x="14" y="24" width="292" height="92" rx="10" ry="10" class="card-keychain-inner"/>
                    <circle cx="46" cy="70" r="12" class="card-keychain-hole"/>
                    <circle cx="46" cy="70" r="8" class="card-keychain-hole-inner"/>
                    <text x="180" y="78" class="card-keychain-text" text-anchor="middle" font-size="${fontSize}">${escapeHtml(name)}</text>
                </svg>
            </div>
            <div class="card-meta">
                <span class="card-name">${escapeHtml(name)}</span>
                <span class="card-time">${time}</span>
            </div>
        </div>
    `;
}

function formatTime(date) {
    return date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// =====================================================================
//  DEV DEBUG / OPS PANEL
//  A gated, self-contained overlay showing live system status:
//   - printer agent online/offline (via system/printer heartbeat)
//   - laser connected? current job
//   - the live queue (now printing / up next / recently done)
//   - the agent's rolling event log
//
//  GATING: only activates when the site is opened with ?debug=1 (which is
//  remembered in localStorage). Customers never see it. Turn off with ?debug=0.
//  Reads Firestore only — orders + system/printer are world-readable.
// =====================================================================

(function () {
    const params = new URLSearchParams(location.search);
    if (params.get('debug') === '1') localStorage.setItem('laserDebug', '1');
    if (params.get('debug') === '0') localStorage.removeItem('laserDebug');
    if (localStorage.getItem('laserDebug') !== '1') return;      // not enabled
    if (typeof db === 'undefined') { console.warn('[debug] Firestore not available'); return; }

    const STALE_MS = 45000; // agent considered offline if no heartbeat within this

    let system = null;   // system/printer doc data
    let orders = [];     // recent orders
    let backend = null;  // backend health probe result

    // ---- styles ----
    const style = document.createElement('style');
    style.textContent = `
    #dbg-btn{position:fixed;right:14px;bottom:14px;z-index:99999;display:inline-flex;align-items:center;gap:8px;
      padding:9px 14px;border:none;border-radius:100px;background:#111827;color:#e5e7eb;font:600 12px/1 ui-monospace,Menlo,Consolas,monospace;
      cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.28)}
    #dbg-btn .dot{width:9px;height:9px;border-radius:50%;background:#6b7280}
    #dbg-btn .dot.on{background:#22c55e}#dbg-btn .dot.warn{background:#f59e0b}#dbg-btn .dot.off{background:#ef4444}
    #dbg-panel{position:fixed;right:14px;bottom:60px;z-index:99999;width:min(380px,calc(100vw - 28px));max-height:76vh;
      display:none;flex-direction:column;background:#0b1220;color:#e5e7eb;border:1px solid #1f2937;border-radius:14px;
      overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.45);font:12px/1.5 ui-monospace,Menlo,Consolas,monospace}
    #dbg-panel.open{display:flex}
    #dbg-panel .hd{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:#111827;border-bottom:1px solid #1f2937}
    #dbg-panel .hd b{font-size:12px;letter-spacing:.4px;color:#fff}
    #dbg-panel .hd button{background:none;border:none;color:#9ca3af;font-size:18px;cursor:pointer;line-height:1}
    #dbg-panel .body{padding:12px 14px;overflow-y:auto}
    #dbg-panel .sec{margin-bottom:14px}
    #dbg-panel .sec-h{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:6px}
    #dbg-panel .status{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:700}
    #dbg-panel .status .dot{width:10px;height:10px;border-radius:50%}
    #dbg-panel .dot.on{background:#22c55e}#dbg-panel .dot.warn{background:#f59e0b}#dbg-panel .dot.off{background:#ef4444}#dbg-panel .dot.idle{background:#6b7280}
    #dbg-panel .muted{color:#9ca3af}
    #dbg-panel .row{display:flex;justify-content:space-between;gap:10px;padding:3px 0}
    #dbg-panel .pos{color:#38bdf8;font-weight:700}
    #dbg-panel .pill{display:inline-block;padding:1px 7px;border-radius:100px;font-size:10px;background:#1f2937;color:#93c5fd}
    #dbg-panel .pill.img{color:#c4b5fd}
    #dbg-panel .now{background:#0f2a1a;border:1px solid #14532d;border-radius:8px;padding:8px 10px}
    #dbg-panel .err{color:#fca5a5;font-size:11px;margin-top:4px;word-break:break-word}
    #dbg-panel .log{background:#060a12;border:1px solid #1f2937;border-radius:8px;padding:8px 10px;max-height:170px;overflow-y:auto}
    #dbg-panel .log .ev{display:flex;gap:8px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.04)}
    #dbg-panel .log .t{color:#6b7280;flex:0 0 auto}
    #dbg-panel .empty{color:#6b7280;font-style:italic}
    #dbg-panel .bar{height:6px;background:#1f2937;border-radius:4px;overflow:hidden;margin-top:7px}
    #dbg-panel .bar>i{display:block;height:100%;background:#22c55e;transition:width .3s}
    `;
    document.head.appendChild(style);

    // ---- DOM ----
    const btn = document.createElement('button');
    btn.id = 'dbg-btn';
    btn.innerHTML = '<span class="dot"></span><span>Logs</span>';
    const panel = document.createElement('div');
    panel.id = 'dbg-panel';
    panel.innerHTML = '<div class="hd"><b>SYSTEM</b><button id="dbg-x" aria-label="close">×</button></div><div class="body" id="dbg-body"></div>';
    document.body.appendChild(panel);
    document.body.appendChild(btn);
    const body = panel.querySelector('#dbg-body');

    btn.addEventListener('click', () => panel.classList.toggle('open'));
    panel.querySelector('#dbg-x').addEventListener('click', () => panel.classList.remove('open'));

    // ---- helpers ----
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function ago(ms) {
        if (!ms) return '';
        const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (s < 60) return s + 's';
        const m = Math.round(s / 60);
        if (m < 60) return m + 'm';
        return Math.round(m / 60) + 'h';
    }
    const tsMillis = (t) => (t && t.toMillis ? t.toMillis() : null);
    const modePill = (m) => m === 'image' ? '<span class="pill img">image</span>' : '<span class="pill">text</span>';

    // ---- render ----
    function computeStatus() {
        if (!system) return { cls: 'idle', text: 'Agent not reporting', sub: 'Start the printer agent on the laser laptop.' };
        const beat = tsMillis(system.updatedAt);
        const stale = !beat || (Date.now() - beat) > STALE_MS;
        if (stale) return { cls: 'off', text: 'Agent offline', sub: beat ? `Last seen ${ago(beat)} ago` : 'No heartbeat' };
        if (system.connected) return { cls: 'on', text: `Laser connected · ${esc(system.port || '')}`, sub: '' };
        return { cls: 'warn', text: 'Agent online · laser disconnected', sub: system.lastError ? esc(system.lastError) : 'Waiting for the laser…' };
    }

    function render() {
        const st = computeStatus();
        btn.querySelector('.dot').className = 'dot ' + (st.cls === 'idle' ? '' : st.cls);

        const printing = orders.filter(o => o.status === 'printing');
        const queued = orders.filter(o => o.status === 'queued').sort((a, b) => (a.queue_position || 0) - (b.queue_position || 0));
        const done = orders.filter(o => o.status === 'done').slice(0, 6);

        const label = (o) => esc(o.name || (o.mode === 'image' ? 'image upload' : 'keychain'));

        // Now printing — prefer the agent's live "current" (has elapsed + progress).
        let nowHtml;
        const cur = system && system.current;
        if (cur) {
            const prog = (typeof cur.progress === 'number') ? cur.progress : null;
            nowHtml = `<div class="now"><div class="row"><span><span class="pos">#${esc(cur.position)}</span> ${esc(cur.name)} ${modePill(cur.mode)}</span><span class="muted">${ago(cur.startedAt)}</span></div>` +
                (prog != null ? `<div class="bar"><i style="width:${prog}%"></i></div><div class="muted" style="font-size:10px;margin-top:3px">${prog}% engraved</div>` : '') +
                `</div>`;
        } else if (printing.length) {
            nowHtml = printing.map(o => `<div class="now"><span class="pos">#${esc(o.queue_position)}</span> ${label(o)} ${modePill(o.mode)}</div>`).join('');
        } else {
            nowHtml = `<div class="empty">Idle — nothing printing.</div>`;
        }

        const queueHtml = queued.length
            ? queued.map(o => `<div class="row"><span><span class="pos">#${esc(o.queue_position)}</span> ${label(o)}</span>${modePill(o.mode)}</div>`).join('')
            : `<div class="empty">Queue is empty.</div>`;

        const doneHtml = done.length
            ? done.map(o => `<div class="row muted"><span>#${esc(o.queue_position)} ${label(o)}</span>✓</div>`).join('')
            : `<div class="empty">None yet.</div>`;

        const events = (system && Array.isArray(system.events)) ? system.events : [];
        const logHtml = events.length
            ? events.map(e => `<div class="ev"><span class="t">${ago(e.t)}</span><span>${esc(e.msg)}</span></div>`).join('')
            : `<div class="empty">No agent events.</div>`;

        const backendText = backend == null
            ? '<span class="muted">checking…</span>'
            : (backend.ok ? '🟢 healthy' : '🔴 ' + esc(backend.note || 'down'));

        body.innerHTML = `
      <div class="sec">
        <div class="status"><span class="dot ${st.cls}"></span><span>${st.text}</span></div>
        ${st.sub ? `<div class="err">${st.sub}</div>` : ''}
        <div class="row" style="margin-top:8px"><span class="muted">Backend</span><span>${backendText}</span></div>
      </div>
      <div class="sec"><div class="sec-h">Now printing</div>${nowHtml}</div>
      <div class="sec"><div class="sec-h">Up next · ${queued.length}</div>${queueHtml}</div>
      <div class="sec"><div class="sec-h">Recently done</div>${doneHtml}</div>
      <div class="sec"><div class="sec-h">Agent log</div><div class="log">${logHtml}</div></div>
    `;
    }

    // ---- live data ----
    db.doc('system/printer').onSnapshot(
        (doc) => { system = doc.exists ? doc.data() : null; render(); },
        (err) => { console.warn('[debug] system listener:', err); }
    );
    db.collection('orders').orderBy('created_at', 'desc').limit(60).onSnapshot(
        (snap) => { orders = snap.docs.map(d => ({ id: d.id, ...d.data() })); render(); },
        (err) => { console.warn('[debug] orders listener:', err); }
    );

    // ---- backend health (#4) ----
    // Probe createOrder with an invalid payload (no name). A healthy function
    // rejects with invalid-argument (it ran + validated) — and the name check
    // fires BEFORE any Razorpay/Firestore write, so there are no side effects.
    // A down function throws internal/unavailable or a network error.
    async function checkBackend() {
        if (typeof functions === 'undefined') { backend = { ok: false, note: 'sdk missing' }; render(); return; }
        try {
            await functions.httpsCallable('createOrder')({ mode: 'text' });
            backend = { ok: true }; // responded (unexpected success path)
        } catch (e) {
            const code = String((e && e.code) || '');
            backend = code.includes('invalid-argument')
                ? { ok: true }
                : { ok: false, note: (e && e.message) || code || 'unreachable' };
        }
        render();
    }
    checkBackend();
    setInterval(checkBackend, 60000);

    // Refresh relative timestamps every 5s even without data changes.
    setInterval(render, 5000);
    render();
})();

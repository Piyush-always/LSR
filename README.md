# Laser Keychain — Handover & Operations Guide

A QR-triggered web app for selling custom laser-engraved keychains. A customer scans a
QR code, picks a keychain type — **a name** (text + font + emoji) or **an uploaded image**
(logo / line art) — pays via Razorpay, and lands in a live queue. A Node.js agent on the
laptop wired to a **Creality CV-01 Pro** laser picks the order up, turns it into G-code,
and engraves it — hands-free. Uploaded images are auto-moderated (Google Cloud Vision
SafeSearch) before payment.

**This document is written for whoever operates and maintains the system** (e.g. an
intern taking it over). It covers how the whole thing fits together, how to run it, how
to tell if it's healthy, and how to fix the things that actually break in practice.

- **Live site:** https://laser-inv.web.app
- **Firebase project:** `laser-inv`
- **Price:** ₹1 per keychain (`amount: 100` paise — [functions/index.js:48](functions/index.js#L48))

---

## ⚠️ Current status (as of 2026-07-11) — read this first

The website loads, but **paying currently fails.** Two independent things are blocking
payments right now. Neither is a bug in the code — both are account/billing settings:

| Blocker | Effect | Fix | Section |
|---|---|---|---|
| **Firebase project is not on the Blaze plan** | Cloud Functions won't boot → every payment call returns HTTP **503** ("CORS error" in the browser is a symptom of this) | Enable Blaze billing | [§7](#7-the-two-hidden-requirements-that-break-payments) |
| **Razorpay reKYC is pending** | Even once functions boot, live payments/settlements may be blocked | Complete reKYC, **or** use test keys to demo | [§7](#7-the-two-hidden-requirements-that-break-payments) |

Everything else (hosting, database, frontend, printer agent) is fine. Once the two
items above are cleared and the functions are redeployed, the system works end-to-end.
Full runbook in [§10 Health check](#10-health-check--is-it-working-right-now) and
[§11 Troubleshooting](#11-troubleshooting).

---

## 1. End-to-end flow (the whole system on one screen)

```
                            ┌────────────────────────────┐
  [ Customer's phone ]      │  FIREBASE HOSTING (free)    │
        scan QR  ──────────►│  index.html + js/ + css/    │
                            └──────────────┬─────────────┘
                                           │ 1. design keychain (name, font, emoji)
                                           │ 2. tap "Pay"
                                           ▼
                            ┌────────────────────────────┐
                            │  CLOUD FUNCTION createOrder │  ← validates name/font
                            │  (functions/index.js)       │  ← creates Razorpay order
                            └──────────────┬─────────────┘  ← writes order (status:created)
                                           │ returns {orderId, keyId, firestoreId}
                                           ▼
                            ┌────────────────────────────┐
                            │  RAZORPAY CHECKOUT (modal)  │  ← customer pays ₹1
                            └──────────────┬─────────────┘
                                           │ payment success → signature
                                           ▼
                            ┌────────────────────────────┐
                            │ CLOUD FUNCTION verifyPayment│  ← verifies HMAC signature
                            │ (functions/index.js)        │  ← assigns queue_position (txn)
                            └──────────────┬─────────────┘  ← order → status:queued
                                           │
                                           ▼
                            ┌────────────────────────────┐
                            │  FIRESTORE  orders/{id}     │  ◄── single source of truth
                            │  meta/counter               │      for the queue
                            └───────┬──────────────┬──────┘
                    live listeners  │              │  real-time queue listener
              (customer's browser)  │              │  (printer laptop)
                                    ▼              ▼
                       shows queue #,      ┌───────────────────────────┐
                       "now printing",     │  PRINTER AGENT (Node.js)   │
                       "ready for pickup"  │  printer-agent/index.js    │
                                           │  status:queued → printing  │
                                           │   → generate G-code        │
                                           │   → stream to laser (GRBL) │
                                           │   → status:done            │
                                           └─────────────┬─────────────┘
                                                         ▼
                                           ┌───────────────────────────┐
                                           │  Creality CV-01 Pro laser  │
                                           │  (serial / GRBL, 115200)   │
                                           └───────────────────────────┘
```

**The order document in Firestore is the only thing the three parties share.** The
website writes it (via Cloud Functions), the printer agent reads/advances it, and both
the customer's browser and the agent subscribe to it in real time.

---

## 2. The three moving parts

| Part | Lives where | What it does | Who runs it |
|---|---|---|---|
| **Website** | Firebase Hosting (cloud) | Customer designs the keychain + pays | Always on, free |
| **Payment backend** | Firebase Cloud Functions v2 (cloud) | Creates/verifies Razorpay orders, assigns queue spot | Always on, **needs Blaze** |
| **Printer agent** | Node.js on the laptop by the laser | Pulls queued orders, engraves them | You start it each day |

---

## 3. Order lifecycle (`status` field)

Every order is one document in `orders/{id}`. Its `status` walks through four states,
each written by a specific actor:

| `status`   | Set by                   | Meaning                                        |
|------------|--------------------------|------------------------------------------------|
| `created`  | `createOrder` function   | Razorpay order made; payment not yet completed |
| `queued`   | `verifyPayment` function | Payment verified; `queue_position` assigned    |
| `printing` | Printer agent            | Agent pulled it and is engraving now           |
| `done`     | Printer agent            | Laser finished and returned to HOME            |

> On a print failure the agent reverts `printing → queued` so the job retries
> ([printer-agent/index.js:144](printer-agent/index.js#L144)). An order stuck in
> `printing` after a crash must be reset to `queued` by hand in the Firebase console.

---

## 4. Payment backend (the two Cloud Functions)

Both are **Firebase Functions v2 callable functions** ([functions/index.js](functions/index.js)),
region `us-central1`. The browser calls them with `functions.httpsCallable(...)`. Razorpay
secrets stay server-side — the client never sees the key secret.

**`createOrder(name, fontId)` → `{ orderId, firestoreId, amount, currency, keyId }`**
1. Validates `name` (1–20 code points, emoji-aware).
2. Uppercases Latin letters; validates `fontId` (`pixel`, `bebas`, `montserrat`, `marker`, `pacifico`; falls back to `pixel`).
3. Creates a **Razorpay order** for `100` paise (₹1).
4. Writes `orders/{id}` with `status: 'created'`.
5. Returns the Razorpay `orderId` + public `keyId` so the browser can open Checkout.

**`verifyPayment(order_id, payment_id, signature, firestoreId)` → `{ success, queue_position }`**
1. Recomputes the **HMAC-SHA256** signature of `order_id|payment_id` with the Razorpay
   key secret and compares it — mismatch → `permission-denied` (blocks forged payments).
2. In a **Firestore transaction**: increments `meta/counter.last_position` and sets the
   order to `status: 'queued'` with the new `queue_position`, `razorpay_payment_id`,
   `paid_at`. The transaction guarantees unique queue numbers.
3. Returns the assigned `queue_position`.

**Client robustness** ([js/app.js](js/app.js)): the success screen shows optimistically;
a pending-verify payload is saved to `localStorage` and retried on reload if the tab
closes mid-verify; after verify the browser subscribes to Firestore for the live
"now printing #N" indicator and flips to "Ready for pickup ✨" at `done`.

---

## 5. Printing backend (the printer agent)

A long-running Node.js process on the laptop physically connected to the laser
([printer-agent/index.js](printer-agent/index.js)). It authenticates to Firestore with
`service-account.json` and talks to the laser over a serial GRBL connection.

- **Startup:** list serial ports → **block until the laser connects** (retries every
  10 s; it never touches the queue without a laser) → print HOME/START banner → start
  the queue listener.
- **Queue listener:** subscribes to `orders where status == 'queued' orderBy
  queue_position asc`. A new order triggers `processQueue()`, which drains the queue one
  job at a time with a **5 s pause between jobs** so you can swap the blank.
- **Per order:** mark `printing` → generate preview PNG → generate G-code (`vector` via
  `opentype.js` by default, or `raster`) → stream to the laser with a live progress bar
  → mark `done` + `printed_at`. Any failure reverts the order to `queued`; a serial
  error also reconnects and resumes.

**Positioning:** `HOME (0,0)` is wherever the head sits when the agent connects (it
returns there after every job). `START = HOME + (startOffsetX, startOffsetY)` is where
engraving happens — edit the `POSITION` block in
[printer-agent/text-to-gcode.js](printer-agent/text-to-gcode.js#L19); calibrate with
`jog-tool.py`.

**Configured values:** port `COM8` (`LASER_PORT` env), 115200 baud, engrave feedrate
800 mm/min, travel 3000 mm/min, max power 1000, keychain 72×35 mm.

> **Full operator runbook** (daily start/stop, calibration, on-site troubleshooting):
> [printer-agent/OPERATOR-GUIDE.md](printer-agent/OPERATOR-GUIDE.md).

---

## 6. Firestore data model & security

```
orders/{orderId}
  ├─ mode:                string     — 'text' | 'image'
  ├─ status:              string     — created → queued → printing → done
  ├─ razorpay_order_id:   string
  ├─ razorpay_payment_id: string     — null until verifyPayment
  ├─ amount:              number     — 1 (₹)
  ├─ queue_position:      number     — null until verifyPayment (assigned via txn)
  ├─ created_at:          timestamp  — createOrder
  ├─ paid_at:             timestamp  — verifyPayment
  ├─ printed_at:          timestamp  — printer agent (on done)
  │
  ├─ (mode 'text')
  │   ├─ name:            string     — cleaned, uppercased name
  │   └─ fontId:          string     — pixel | bebas | montserrat | marker | pacifico
  │
  └─ (mode 'image')
      ├─ name:            null
      ├─ originalImagePath: string   — Storage path of the raw upload (moderation/record)
      ├─ printImagePath:    string   — Storage path of the processed B&W bitmap (engrave source)
      └─ moderation:        map      — { adult, violence, racy } SafeSearch likelihoods

meta/counter
  └─ last_position:       number     — monotonic queue counter
```

**Image keychains** (`mode: 'image'`): the browser fits the upload into the keychain's
engrave rectangle and thresholds it to **black/white in-browser** (white = burn), so the
on-screen preview is exactly what engraves. Both the original and the processed bitmap are
uploaded to Cloud Storage under `uploads/{session}/`. `createOrder` runs **Cloud Vision
SafeSearch on the original before charging** — a flagged image is rejected with no payment.
The printer agent downloads `printImagePath` and rasterises it via
[printer-agent/image-to-gcode.js](printer-agent/image-to-gcode.js) into the shared
`KEYCHAIN_IMAGE_AREA` (kept in sync between [js/keychain-layout.js](js/keychain-layout.js)
and the agent). Storage access: clients may only **create** under `uploads/`
([storage.rules](storage.rules)); the function + agent read via the Admin SDK.

**Security rules** ([firestore.rules](firestore.rules)): `orders` are world-**readable**
(so browsers and the printer can watch the queue live) but **not client-writable** —
every write goes through a Cloud Function or the Admin SDK. `meta/counter` is server-only.

---

## 7. The two "hidden" requirements that break payments

Neither of these is visible in the code, and both will silently break payments. **An
intern taking this over must understand both.**

### 7a. Firebase must be on the Blaze (pay-as-you-go) plan
This project uses **Cloud Functions v2**, which run on Google Cloud Run and **cannot run
on the free Spark plan.** With no active billing, the functions return HTTP **503**
("service not available yet"), which the browser reports as a *CORS / Missing Allow
Origin* error. It is **not** a CORS bug — do not touch CORS.

- You **can't avoid** Blaze: the function calls the external Razorpay API, which the free
  plan blocks entirely (even for v1 functions).
- Blaze includes the **same free tier** — at this project's volume the real cost is ≈ ₹0.
  You're attaching a card to unlock paid-capable services, not committing to a bill.
- **Fix:** https://console.firebase.google.com/project/laser-inv/usage/details →
  **Modify plan → Blaze** → attach a billing account. Then set a **budget alert** (e.g.
  ₹500) on the same page. Then redeploy ([§9](#9-deploy--run)).

### 7b. Razorpay account must be able to accept payments
The backend talks to **Razorpay**. Two things about the Razorpay account matter:

- **KYC / reKYC:** if reKYC is **pending**, Razorpay may hold settlements and eventually
  block live payment acceptance — `createOrder` would then throw and the customer sees
  "Something went wrong." Complete the pending reKYC in the **Razorpay Dashboard** (KYC
  banner / Account & Settings → KYC). Check the dashboard banner for the exact current
  restriction level.
- **Live vs Test keys:** the Razorpay keys are stored as Secret Manager secrets
  (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`).
  - **Live keys** (`rzp_live_...`) — real money, **require KYC to be clear.**
  - **Test keys** (`rzp_test_...`) — **KYC-independent**, use Razorpay
    [test cards](https://razorpay.com/docs/payments/payments/test-card-details/). Use
    these to prove the whole system works without real money or waiting on reKYC. Swap
    back to live keys once KYC is approved.

To set/rotate the keys and redeploy:
```powershell
firebase functions:secrets:set RAZORPAY_KEY_ID       # paste rzp_live_... or rzp_test_...
firebase functions:secrets:set RAZORPAY_KEY_SECRET   # paste the matching secret
firebase deploy --only functions
```
Check what's currently set: https://console.cloud.google.com/security/secret-manager?project=laser-inv

---

## 8. Accounts & access an intern needs

| Thing | Where | Notes |
|---|---|---|
| Firebase Console | https://console.firebase.google.com/project/laser-inv | Hosting, Functions, Firestore, logs, billing |
| Google Cloud Console | https://console.cloud.google.com/?project=laser-inv | Secret Manager, Cloud Run logs, billing |
| Razorpay Dashboard | https://dashboard.razorpay.com | KYC status, live/test API keys, payments |
| `service-account.json` | `printer-agent/` (NOT committed) | Firebase Admin key for the printer agent — Firebase Console → Project settings → Service accounts → Generate new private key |
| The laser laptop | on-site | Runs the printer agent; needs Node.js + the laser plugged in |

---

## 9. Deploy & run

### Tooling (one-time on the maintainer's machine)
- **Node.js LTS** — https://nodejs.org. Verify in a **fresh** terminal: `node --version`.
- **Firebase CLI** — `npm install -g firebase-tools`, then `firebase login`.

> Gotcha we hit before: a Python **`.venv`** PowerShell session can strip Node/npm/firebase
> off the PATH. If `firebase`/`npm` say "not recognized", open a plain PowerShell (not the
> venv one) and try again.

### Deploy the web + functions
```powershell
cd C:\Users\Lenovo\component\laser-proj
firebase deploy                      # hosting + functions + firestore + storage rules
# or just one piece:
firebase deploy --only functions
firebase deploy --only hosting
firebase deploy --only storage       # deploy storage.rules
```

**One-time setup for image keychains:**
- **Enable the Cloud Vision API** (moderation): https://console.cloud.google.com/apis/library/vision.googleapis.com?project=laser-inv
- **Enable Cloud Storage** for the project (Firebase console → Storage → Get started) and
  deploy `storage.rules` (above). Bucket must match `storageBucket` in
  [js/firebase-config.js](js/firebase-config.js) (`laser-inv.firebasestorage.app`).
- `functions/` gained the `@google-cloud/vision` dependency — `firebase deploy --only
  functions` installs it automatically.

### Run the printer agent (on the laser laptop)
```powershell
cd printer-agent
npm install                          # first time only
# put service-account.json in this folder
$env:LASER_PORT = "COM8"             # match Device Manager → Ports (COM & LPT)
node index.js
```
Leave that terminal open all day. Full details:
[printer-agent/OPERATOR-GUIDE.md](printer-agent/OPERATOR-GUIDE.md).

---

## 10. Health check — "is it working right now?"

Run these from a normal PowerShell to check each layer. (In PowerShell, use **`curl.exe`**,
not `curl` — the bare `curl` is an alias that won't accept these flags.)

**1. Website up?**
```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://laser-inv.web.app     # expect 200
```

**2. Payment backend up?**
```powershell
curl.exe -X POST -H "Content-Type: application/json" --data '{\"data\":{}}' `
  https://us-central1-laser-inv.cloudfunctions.net/createOrder
```
- `{"error":{"message":"Name is required.",...}}` (HTTP **400**) → ✅ backend healthy.
- 503 HTML "service not available yet" → ❌ **Blaze/billing** ([§7a](#7a-firebase-must-be-on-the-blaze-pay-as-you-go-plan)).
- `internal` / Razorpay error after Blaze is fixed → ❌ **Razorpay KYC/keys** ([§7b](#7b-razorpay-account-must-be-able-to-accept-payments)).

**3. Read the real error** (definitive):
```powershell
firebase functions:log --only createOrder
```

**4. Printer agent up?** On the laser laptop the terminal should show
`Listening for new orders...`. If not, see the OPERATOR-GUIDE.

**Full manual test:** place a real ₹1 order (live) or a test-card order (test keys) on
https://laser-inv.web.app and watch it walk `created → queued → printing → done` in the
Firestore console.

---

## 11. Troubleshooting

| Symptom | Real cause | Fix |
|---|---|---|
| Browser console: *CORS Missing Allow Origin*, status **503** | Functions can't boot — **not** a CORS bug | Enable Blaze ([§7a](#7a-firebase-must-be-on-the-blaze-pay-as-you-go-plan)), redeploy |
| `FirebaseError: internal` / "Something went wrong" on pay | Function crashed at runtime | `firebase functions:log` — usually Razorpay (KYC/keys) or a missing secret |
| Function returns **503** to the curl probe | Blaze not enabled, or no healthy revision | Enable Blaze + `firebase deploy --only functions` |
| Function returns **404** | Not deployed | `firebase deploy --only functions` |
| Payments blocked / settlements on hold | Razorpay reKYC pending | Complete reKYC, or switch to test keys ([§7b](#7b-razorpay-account-must-be-able-to-accept-payments)) |
| `firebase`/`npm` "not recognized" | PATH stripped (often a Python venv shell) | Use a plain PowerShell; reinstall Node if truly missing |
| Order stuck in `printing` | Agent crashed mid-job | Firestore console → set that doc's `status` back to `queued` |
| Orders pay but never engrave | Printer agent not running / laser unplugged | Start the agent; see OPERATOR-GUIDE |
| Laser drifts / engraves in the wrong spot | Mechanical step loss or wrong START offset | OPERATOR-GUIDE §5–6 (calibration) |

---

## 12. Project structure

```
laser-proj/
├── index.html                 ← single-page frontend
├── css/style.css              ← dark tech-minimal theme
├── js/
│   ├── app.js                 ← screen flow, payment calls, live queue listeners
│   ├── firebase-config.js     ← Firebase web config + SDK init
│   └── keychain-layout.js     ← fonts + layout (mirror of text-to-gcode.js)
├── functions/
│   ├── index.js               ← createOrder + verifyPayment (payment backend)
│   └── package.json           ← Node 22, firebase-functions v2, razorpay
├── printer-agent/             ← runs on the laser laptop
│   ├── index.js               ← queue listener + print dispatcher
│   ├── text-to-gcode.js       ← vector engraving (opentype) + POSITION config
│   ├── image-to-gcode.js      ← raster engraving
│   ├── generate-image.js      ← preview PNG
│   ├── laser-sender.js        ← serial/GRBL transport
│   ├── jog-tool.py            ← head calibration helper
│   ├── service-account.json   ← Firebase Admin key (NOT committed)
│   └── OPERATOR-GUIDE.md      ← on-site operator runbook
├── qr-codes/                  ← QR generation for the physical stand
├── firebase.json              ← hosting + functions + firestore config
├── firestore.rules            ← security rules
└── .firebaserc                ← project alias → laser-inv
```

---

## 13. Cost

| Layer | Service | Cost |
|---|---|---|
| Frontend | HTML/CSS/JS (no framework) | Free |
| Hosting | Firebase Hosting | Free |
| Database | Firestore | Free (under free-tier limits) |
| Payment | Razorpay | ~2% per transaction |
| Backend | Cloud Functions v2 (Blaze) | ≈ Free (free tier; card required) |
| Printer agent | Node.js on local laptop | Runs locally |

Blaze requires a card on file but stays within the free tier at this volume — set a
budget alert to be safe.

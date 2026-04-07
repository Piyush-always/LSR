# Laser Keychain QR Ordering System

A QR-code-triggered web app for ordering custom laser-engraved keychains. Scan, customize, pay, and print — fully automated.

## How It Works

```
QR Code Scan → Website → Enter Name → Pay ₹99 → Joins Print Queue → Laser Printer Prints It
```

## System Architecture

```
[QR Code Scan]
      ↓
[Firebase Hosted Website]         ← FREE
      ↓
[Razorpay Checkout]               ← ~2% per transaction
      ↓
[Firebase Cloud Function]         ← FREE (verifies payment, writes to DB)
      ↓
[Firestore Database]              ← FREE (stores orders + queue)
      ↓
[Printer Agent on Laptop]         ← Node.js script, real-time Firestore listener
      ↓
[Laser Printer Software]
```

## Tech Stack

| Layer | Technology | Cost |
|-------|-----------|------|
| Frontend | HTML/CSS/JS (single page, no framework) | Free |
| Hosting | Firebase Hosting | Free |
| Database | Google Firestore | Free (under 20K writes/day) |
| Payment | Razorpay | ~2% per transaction |
| Backend | Firebase Cloud Functions | Free (under 2M calls/month) |
| Printer Agent | Node.js with Firestore real-time listener | Runs locally |

**Total monthly infra cost: ₹0** (within Firebase free tiers)

## User Flow

1. **Welcome Screen** — "Welcome! Create Your Custom Laser-Printed Keychain"
2. **Preview + Name Input** — Live keychain preview updates as user types their name
3. **Payment** — Razorpay checkout (₹99)
4. **Confirmation** — "You're in queue! Position #X"

## Firestore Data Model

```
Collection: orders/{orderId}
  ├── name: string              — user's custom name
  ├── status: string            — "created" | "paid" | "queued" | "printing" | "done"
  ├── razorpay_order_id: string
  ├── razorpay_payment_id: string
  ├── amount: number
  ├── created_at: timestamp
  └── queue_position: number
```

## Project Structure

```
laser-proj/
├── index.html                  ← Single page frontend
├── css/
│   └── style.css               ← Dark tech-minimal theme
├── js/
│   └── app.js                  ← Frontend logic
├── assets/
│   └── keychain-template.png   ← Keychain preview image
├── firebase.json               ← Firebase config
├── firestore.rules             ← Security rules
├── .firebaserc
├── functions/
│   ├── index.js                ← Cloud Functions (createOrder, verifyPayment)
│   ├── package.json
│   └── .env                    ← Razorpay keys (not committed)
├── printer-agent/
│   ├── index.js                ← Queue listener + print dispatcher
│   ├── generate-image.js       ← Renders name onto keychain template
│   ├── service-account.json    ← Firebase admin credentials (not committed)
│   └── package.json
└── .gitignore
```

## Setup

### Prerequisites
- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)
- Razorpay account (test mode for development)
- A laptop connected to a laser printer

### 1. Firebase Setup
```bash
firebase login
firebase init  # Select Firestore, Hosting, Functions
```

### 2. Configure Environment
Create `functions/.env`:
```
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=xxxxx
```

### 3. Deploy
```bash
firebase deploy
```

### 4. Run Printer Agent
```bash
cd printer-agent
npm install
node index.js
```

## Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Frontend (welcome, preview, name input) | Pending |
| Phase 2 | Firebase setup (Firestore, Hosting) | Pending |
| Phase 3 | Razorpay + Cloud Functions | Pending |
| Phase 4 | Printer Agent (queue listener + image generation) | Pending |

## Design

- Dark background (#0a0a0a) with cyan/electric blue accents
- Monospace/tech fonts
- Mobile-first (QR code = phone users)
- Smooth transitions between screens
- Minimal, clean UI

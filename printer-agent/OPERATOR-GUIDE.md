# Laser Printer Operator Guide

This guide walks you through setting up the laser keychain printing system on the laptop connected to the **Creality CV-01 Pro** laser printer.

---

## What You're Setting Up

```
Customer scans QR → pays on website → order lands in queue
                                            ↓
                    This laptop runs an agent that
                    automatically picks up the order,
                    generates G-code, and sends it to
                    the laser printer to engrave.
```

Your job: keep the agent running and the laser plugged in. The rest is automatic.

---

## What You Need

| # | Item | Notes |
|---|------|-------|
| 1 | Windows laptop | Node.js 18 or newer installed |
| 2 | Creality CV-01 Pro laser printer | Connected via USB |
| 3 | Internet connection | For Firestore (the order database) |
| 4 | The `printer-agent` folder | Copy this from the main project |
| 5 | `service-account.json` file | Firebase credentials (see below) |

---

## Step 1 — Install Node.js

If Node.js isn't already installed:

1. Go to https://nodejs.org
2. Download the **LTS version**
3. Install it with default settings
4. Verify in PowerShell/Command Prompt:
   ```
   node --version
   ```
   You should see something like `v20.x.x`.

---

## Step 2 — Copy the Printer Agent Folder

Copy the entire `printer-agent/` folder to this laptop. Place it somewhere easy to find, e.g.:

```
C:\laser-keychain\printer-agent\
```

The folder should contain:

```
printer-agent/
├── index.js
├── generate-image.js
├── image-to-gcode.js
├── laser-sender.js
├── package.json
├── dashboard/
└── output/   (will be created automatically)
```

---

## Step 3 — Get the Firebase Service Account Key

This file lets the agent talk to the order database.

1. Go to https://console.firebase.google.com
2. Open the **laser-inv** project
3. Click the gear icon → **Project Settings**
4. Go to **Service accounts** tab
5. Click **"Generate new private key"** → confirm → downloads a `.json` file
6. **Rename** the downloaded file to exactly: `service-account.json`
7. **Move** it into the `printer-agent/` folder

> ⚠️ This file is a secret — do not share it or upload it anywhere public.

---

## Step 4 — Install Dependencies

Open **Command Prompt** or **PowerShell** and navigate to the printer-agent folder:

```bash
cd C:\laser-keychain\printer-agent
```

Then install the required packages:

```bash
npm install
```

This will take 1-3 minutes. You'll see progress messages. When it finishes, you'll have a `node_modules` folder.

---

## Step 5 — Find Your Laser Printer's COM Port

1. Plug the Creality CV-01 Pro into the laptop via USB
2. Turn the printer on
3. Open **Device Manager** (right-click Start → Device Manager)
4. Expand **"Ports (COM & LPT)"**
5. You'll see something like:
   - `USB-SERIAL CH340 (COM3)`
   - Or similar — note the **COM number** (could be COM3, COM4, COM5, etc.)

---

## Step 6 — Run the Agent

In the same terminal, run:

```bash
set LASER_PORT=COM3
node index.js
```

Replace `COM3` with whatever COM port you found in Step 5.

You should see:

```
========================================
  LASER KEYCHAIN PRINTER AGENT
  Creality CV-01 Pro
========================================

[SERIAL] Available ports:
  COM3 — USB-SERIAL CH340

[SERIAL] Attempting to connect to COM3...
[READY] ✓ Laser printer connected!

Listening for new orders...
```

**If the laser isn't connecting**, the agent will keep retrying every 10 seconds. Check:
- Is the printer plugged in?
- Is the printer turned on?
- Did you use the correct COM port?

---

## Step 7 — Test the Full Flow

Now let's make sure everything works end-to-end.

### 7.1 — Open the customer website

On your **phone** (or another device), open:

**https://laser-inv.web.app**

### 7.2 — Create a test order

1. Tap **"Get Started"**
2. Type a short name like `TEST` or `PIYUSH`
3. Tap **"Proceed to Pay"**

### 7.3 — Pay using the Razorpay test UPI

When Razorpay opens, choose **UPI** and enter this test UPI ID:

```
success@razorpay
```

Tap continue and approve. This is a **fake test payment** — no real money is charged. It will succeed instantly in test mode.

### 7.4 — Watch the agent process the order

Switch back to the agent terminal. Within a few seconds you should see:

```
[QUEUE] New order: "TEST" (Position #1)

[PRINT] ============================
[PRINT] Printing: "TEST"
[PRINT] Queue Position: #1
[PRINT] ============================
[STEP 1] Generating keychain image...
[IMAGE] Generated: ...output\keychain_xxxxx_TEST.png
[STEP 2] Converting to G-code...
[GCODE] Generated: ...output\keychain_xxxxx.gcode (3000+ lines)
[STEP 3] Sending to laser printer...
[LASER] Progress: 10% (300/3000 commands)
[LASER] Progress: 50% (1500/3000 commands)
[LASER] Progress: 100% (3000/3000 commands)
[DONE] ✓ Keychain for "TEST" completed!
```

### 7.5 — Verify the laser actually engraved

The laser should physically engrave the keychain. If the terminal says **"Progress: 100%"** but nothing engraved, check:

- Is the laser head moving?
- Is the keychain positioned correctly under the laser?
- Is the laser focus correct?
- Is the laser safety key / button enabled?

---

## Daily Operation

Each morning:

1. Plug in and turn on the laser printer
2. Open terminal, go to the folder:
   ```bash
   cd C:\laser-keychain\printer-agent
   ```
3. Start the agent:
   ```bash
   set LASER_PORT=COM3
   node index.js
   ```
4. Leave this terminal window open all day
5. Orders will print automatically as customers pay

At the end of the day:
- Press **Ctrl + C** in the terminal to stop the agent
- Turn off the printer

---

## Troubleshooting

### "Error: Cannot find module 'firebase-admin'"
You skipped Step 4. Run `npm install` in the `printer-agent` folder.

### "Opening COMx: File not found"
- Wrong COM port. Re-check in Device Manager.
- Printer is not plugged in or not powered on.

### "Cannot find module './service-account.json'"
You skipped Step 3. Download the service account key from Firebase and save it as `service-account.json` in the `printer-agent` folder.

### The agent runs but orders aren't appearing
- Is the laptop connected to the internet?
- Check the terminal — it should say "Listening for new orders..."
- Make sure you paid via test UPI `success@razorpay` on the website

### Laser says "Progress: 100%" but nothing engraved
- Laser safety interlock not released (button/key)
- Laser head focus is wrong
- Laser power setting too low (contact dev)

### An order got stuck in "printing" but the agent was stopped
The order will stay as "printing" in the database. You can manually change it back to "queued" via the Firebase console, or leave it — it won't affect new orders.

---

## What to Share with the Dev if Something Breaks

If you hit a problem, share these with the dev team:

1. **Screenshot of the terminal** — the exact error message
2. **Order name** that failed (if applicable)
3. **What you were doing** when it happened
4. **Did the laser printer respond at all?** (head moved, power on, etc.)

---

## Quick Reference

| Thing | Value |
|-------|-------|
| Customer website | https://laser-inv.web.app |
| Firebase Console | https://console.firebase.google.com |
| Test UPI for payments | `success@razorpay` |
| Start command | `set LASER_PORT=COM3 && node index.js` |
| Stop command | `Ctrl + C` |
| Price per keychain | ₹99 |
| Laser printer | Creality CV-01 Pro |
| Baud rate | 115200 |

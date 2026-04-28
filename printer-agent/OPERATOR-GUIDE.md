# Laser Printer Operator Guide

This guide is everything you need to run the laser keychain system on the laptop connected to the **Creality CV-01 Pro** laser.

---

## 1. What this agent does

```
Customer scans QR → pays ₹1 on the website → order lands in the queue
                                                       ↓
                                  This laptop runs an agent that
                                  picks up the order, generates the
                                  G-code from the customer's name +
                                  font choice, and engraves it on the
                                  laser. After every print the laser
                                  returns to HOME automatically.
```

Your job is simply: **keep the agent running** and **keep the laser plugged in**. Everything else is automatic.

---

## 2. Daily operation (TL;DR)

Each morning:

1. Plug in and turn on the **Creality CV-01 Pro** laser.
2. Open Command Prompt or PowerShell.
3. ```
   cd C:\laser-keychain\printer-agent
   set LASER_PORT=COM8
   node index.js
   ```
   (replace `COM8` with whatever number your laser shows up as — see Section 3.5).
4. Leave that terminal window open all day.
5. Orders print automatically as customers pay.

End of day:

- Press `Ctrl + C` in the terminal.
- Turn off the printer.

That's it. Sections 3 onwards are only for first-time setup, calibration, and troubleshooting.

---

## 3. First-time setup

### 3.1 Install Node.js

If `node --version` doesn't print `v18.x.x` or higher in a fresh terminal:

1. Go to https://nodejs.org → download the **LTS** version.
2. Install with default settings (just keep clicking Next).
3. Open a **new** terminal and confirm: `node --version`.

### 3.2 Copy the printer-agent folder

Copy the whole `printer-agent/` folder onto this laptop. The path used throughout this guide is:

```
C:\laser-keychain\printer-agent\
```

The folder should contain (at least):

```
printer-agent/
├── index.js
├── text-to-gcode.js
├── laser-sender.js
├── jog-tool.py
├── generate-image.js
├── package.json
├── fonts/
└── output/   (created automatically the first time)
```

### 3.3 Get the Firebase service-account key

The agent needs this file to read orders from the database.

1. Go to https://console.firebase.google.com → open the **laser-inv** project.
2. Click the gear icon → **Project Settings** → **Service accounts** tab.
3. Click **Generate new private key** → confirm. A `.json` file downloads.
4. Rename the file to **exactly** `service-account.json`.
5. Move it into `C:\laser-keychain\printer-agent\`.

> ⚠️ This file is a secret. Don't share it, don't commit it to GitHub, don't email it.

### 3.4 Install dependencies (only once)

```bash
cd C:\laser-keychain\printer-agent
npm install
```

Takes 1–3 minutes. When it's done you'll have a `node_modules/` folder.

### 3.5 Find the COM port

1. Plug in and turn on the laser.
2. Open **Device Manager** (right-click Start → Device Manager).
3. Expand **Ports (COM & LPT)**.
4. The laser shows up as something like `USB Serial Device (COM8)`. Note the number (could be COM3, COM5, COM8…).

Use that number in the start command (Section 2 step 3).

---

## 4. Expected behaviour during a print

When you start the agent fresh, you should see:

```
========================================
  LASER KEYCHAIN PRINTER AGENT
  Creality CV-01 Pro
========================================

[SERIAL] Available ports:
  COM8      USB Serial Device (COM8)

[SERIAL] Connecting to COM8 at 115200 baud...
[SERIAL] Port opened. Waiting for GRBL banner...
[SERIAL] GRBL banner received
[SERIAL] Init sequence sent
[READY] ✓ Laser printer connected!

[CONFIG] HOME    = (0.000, 0.000)               (laser's position at connect time)
[CONFIG] START   = HOME + (0.000, 0.000) mm
[CONFIG] After each print the laser returns to HOME.
[CONFIG] Edit START in printer-agent/text-to-gcode.js  POSITION block.

Listening for new orders...
```

When a customer pays, you'll see:

```
[QUEUE] New order: "PIYUSH" (Position #4)

[PRINT] ============================
[PRINT] Printing: "PIYUSH"
[PRINT] Queue Position: #4
[PRINT] Start position: (0.000, 0.000) mm    (returns to HOME after)
[PRINT] ============================
[LASER] Current position: (0.000, 0.000) mm
[STEP 1] Generating keychain image...
[STEP 2] Generating vector G-code (font=pixel)...
[GCODE] Generated: ...keychain_xxxxx.gcode (~120 lines)
[STEP 3] Sending to laser printer...
[SERIAL] Sending 120 G-code commands...
[LASER] Progress: 100% (120/120 commands)
[LASER] Position after print: (0.000, 0.000) mm
[DONE] ✓ Keychain for "PIYUSH" completed!
```

The two key sanity numbers to watch:

- **Current position** before STEP 1 — should match HOME (`0, 0`). If it doesn't, the gantry was bumped or drifted.
- **Position after print** — should also match HOME. If it doesn't, the laser didn't return cleanly; flag this to the dev.

### What's normal vs what to flag

| Moment | What happens | Is it normal? |
|--------|--------------|---------------|
| Agent starts | Lists ports, connects, prints `[CONFIG]`, then "Listening for new orders..." | Yes |
| First job after start | Laser jumps to START, engraves keychain, returns to HOME | Yes |
| Job 2, 3, 4… | Each new job starts from HOME (where the last one ended). Reproducible — unless the gantry was bumped or motors lost steps | Yes |
| Laser drifts ~1–2 mm over many prints | Mechanical step loss — needs belt tension or slower travel | **Not normal — flag to dev** |
| Order disappears from queue mid-print | Network blip — agent reverts it to `queued`. If status stays `printing`, manually change it back in Firebase console | Sometimes |
| You unplug the laser USB during a print | Agent reverts the order, retries every 10 s, resumes when reconnected | Yes |
| `[LASER] Progress: 100%` shows but the laser is still moving | Normal! GRBL says `ok` when a command is **queued**, not when it's executed. Wait a few seconds for the head to actually finish. | Yes |

---

## 5. The two reference points: HOME and START

```
                  +Y (back / away from you)
                       ↑
                       |
              HOME ────►      ← where the head sits when the agent connects.
        (0, 0)       │            After every job the head returns here.
                       |
                  ◄──── (engrave path)
                       |
                       |
                       └────► START
                              (HOME + startOffsetX, startOffsetY)
                              ← where the keychain is actually engraved
                                +X (right) →
```

- **HOME** is set automatically when the agent connects to the laser. Whatever spot the head is in at that moment becomes (0, 0) for the rest of the session.
- **START** is HOME shifted by `startOffsetX` and `startOffsetY` (millimeters). These two numbers live at the top of `printer-agent/text-to-gcode.js` in the `POSITION` block.

To change HOME, jog the head to a new spot, **stop the agent (Ctrl+C)**, and restart `node index.js`. The next launch will use the new spot as HOME.

---

## 6. Calibrating with the jog tool

Use this when you need to find the right `startOffsetX/Y` for your keychain jig.

1. Stop the agent: `Ctrl + C`.
2. Run the jog tool:
   ```
   python jog-tool.py COM8
   ```
   (use your COM number).
3. Use **arrow keys** to move the head. Step size cycles with `+` / `-` (1 → 5 → 10 → 25 mm).
4. Press **`L`** to turn the laser on at low power for sighting (don't put your eye near the beam).
5. Move the head to the spot where you want engraving to start. Read the X/Y values off the live status line.
6. Open `printer-agent/text-to-gcode.js`, find the `POSITION` block at the top, and plug those numbers into:
   ```js
   startOffsetX: <your X>,
   startOffsetY: <your Y>,
   ```
7. Save the file. Press **`Q`** in the jog tool to quit.
8. Restart the agent: `node index.js`. The new START values are now active.

Python missing? `pip install pyserial pynput` (one-time).

---

## 7. Troubleshooting

### `Error: Cannot find module 'firebase-admin'`
You skipped `npm install`. Run it inside `printer-agent/` (Section 3.4).

### `Opening COM8: File not found` or `Access denied`
- Wrong COM port. Re-check Device Manager (Section 3.5).
- Laser is unplugged or powered off.
- Another program is holding the port (LightBurn, an old `node` process, the jog tool). Close them.

### `Cannot find module './service-account.json'`
You skipped Section 3.3. Download the key from Firebase and put it in `printer-agent/`.

### Agent runs but no orders ever appear
- Is the laptop actually on the internet?
- The terminal should say `Listening for new orders...`. If it says something else, share the screenshot with the dev.
- Place a real ₹1 test order yourself via UPI/card on https://laser-inv.web.app to confirm.

### Laser says `Progress: 100%` but nothing engraved
- Safety interlock not released — check the key/button on the printer.
- Laser focus is wrong — re-focus the head.
- Laser power configured too low — flag to dev.

### Drift between prints (engraving slowly walks across the bed)
Mechanical step loss. Two fixes:
1. Tighten X belt, Y belt, and motor pulley grub screws.
2. Lower `travelRate` in `text-to-gcode.js` from `3000` to `2000` mm/min.

### An order is stuck in `printing` because the agent crashed
Open the Firebase console → Firestore → `orders` → find the doc → change `status` from `printing` back to `queued`. The agent will pick it up next time.

### Laser fires once and stops mid-print
GRBL "laser mode" got disabled. The init sequence already sets `$32=1` on every connect — restarting the agent should re-enable it. If it persists, flag to dev.

---

## 8. What to share with the dev when something breaks

1. **Screenshot of the terminal** — the exact error and the lines just before it.
2. **Order name** that failed (if applicable).
3. **What you were doing** at the moment.
4. **Did the laser physically respond at all?** (head moved, beam fired, etc.)

The position logging (`[LASER] Current position: …` and `[LASER] Position after print: …`) is gold — those numbers tell the dev whether drift is the issue.

---

## 9. Quick reference

| Thing | Value |
|-------|-------|
| Customer website | https://laser-inv.web.app |
| Firebase Console | https://console.firebase.google.com |
| Price per keychain | **₹1 (real payment, live mode)** |
| Start command | `set LASER_PORT=COM8 && node index.js` |
| Stop command | `Ctrl + C` |
| Jog tool command | `python jog-tool.py COM8` |
| Laser printer | Creality CV-01 Pro (ESP32 USB) |
| Baud rate | 115200 |
| START offset config | `printer-agent/text-to-gcode.js` → `POSITION` block at the top |

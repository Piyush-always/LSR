# Start the printer agent

Steps for the printer laptop (the one connected to the Creality CV-01 Pro laser).

## First time only

1. Install **Node.js LTS** from https://nodejs.org.
2. Get the code. In the repo folder: `git fetch`, then `git checkout position-and-shape-check` (until it's merged into `main`).
3. Install the agent's packages: open Command Prompt in the `printer-agent` folder and run `npm install`.
4. Put the database key in the `printer-agent` folder:
   - https://console.firebase.google.com → project **laser-keychain-official** → gear icon → **Project settings** → **Service accounts** → **Generate new private key**.
   - Rename the downloaded file to `service-account.json` and move it into `printer-agent`. Never commit or share it.
5. **LaserQueue.exe** is in the repo folder itself (it comes with `git pull`). Double-click it there.
6. The holder positions and blank sizes are in `printer-agent/machine.json` (Tejas's tested values), and the laser homes itself. To check or correct them: LaserQueue.exe → **Test holders** (Trace / Draw each holder, Save here to fix one).

## Every time

1. Pull the latest code: `git pull` in the repo folder.
2. Turn the laser on and plug in its USB cable.
3. Put a blank keychain in each holder: rectangle, circle and heart.
4. Open **LaserQueue.exe**. In **Run on this PC**:
   1. All checks are green (if it asks, **Choose agent folder** and select `printer-agent`).
   2. **Laser port:** pick the laser's port (unplug the USB if unsure: the port that disappears is the laser).
   4. Clear the bed around the holders, then tick **The bed is clear**. On start the laser homes itself.
   5. Press **Start printing** and wait for *Ready, waiting for orders*.
5. Leave it running. When it says **Load a fresh blank**, put a new blank in the holder it names and press **Fresh blank loaded**.

To stop: press **Stop printing**. The head returns to HOME.

Run only one agent at a time. Laser Queue won't start a second one while another is online.

## Without Laser Queue (Command Prompt)

Do steps 1–3 above and clear the bed (the laser homes itself when the agent starts), then:

```
cd <repo folder>\printer-agent
set LASER_PORT=COM8
node index.js
```

Replace `COM8` with the laser's port. When it says `Load a fresh … blank`, load one and press **Enter**. To stop, press **Ctrl + C** (the head returns to HOME).

## Check the three holders

With the agent stopped, in the `printer-agent` folder: `node all-shapes-test.js` homes the laser and draws the heart, rectangle and circle outlines at low power (S20) exactly where and how big every keychain is engraved (`node all-shapes-test.js heart` for one). The same outlines and positions are in `machine.json`.

The positions are machine coordinates, the same numbers Tejas's `auto-position-test.py` moves to with `G53`. After homing the laser reports HOME as about −30,−30; the agent reads that and goes to the same spot. If a holder moves: LaserQueue.exe → **Test holders** → jog onto its new centre → **Save here**.

## Test print without a website order

LaserQueue.exe → **Local print** tab: pick the heart, rectangle or circle, type any text and pick a font, or choose a photo, and the preview shows exactly what will burn. **Print on the … holder** homes the laser, engraves it like a website order and returns HOME; **Stop** turns the laser off and returns HOME. It prints only while the printer agent is stopped (the agent uses the laser's port).

Or with the agent stopped, in the `printer-agent` folder: `node print-test.js all INVENGIC bebas` engraves the name on all three holders (or use `heart`, `rectangle` or `circle` instead of `all`). The laser homes first and returns HOME after each one.

# Start the printer agent

Steps for the printer laptop (the one connected to the Creality CV-01 Pro laser).

## First time only

1. Install **Node.js LTS** from https://nodejs.org.
2. Get the code. In the repo folder: `git fetch`, then `git checkout feature/holders-and-cart` (until it's merged into `main`).
3. Install the agent's packages: open Command Prompt in the `printer-agent` folder and run `npm install`.
4. Put the database key in the `printer-agent` folder:
   - https://console.firebase.google.com → project **laser-keychain-official** → gear icon → **Project settings** → **Service accounts** → **Generate new private key**.
   - Rename the downloaded file to `service-account.json` and move it into `printer-agent`. Never commit or share it.
5. Get **LaserQueue.exe**: copy it from a PC that has it, or build it (see `queue-monitor/README.md`).
6. Calibrate the holders: open LaserQueue.exe, pick the laser's port, then **Holders → Calibrate** (steps are on the screen). Do this again only if a holder moves.

## Every time

1. Pull the latest code: `git pull` in the repo folder.
2. Turn the laser on and plug in its USB cable.
3. Put a blank keychain in each holder: rectangle, circle and heart.
4. Open **LaserQueue.exe**. In **Run on this PC**:
   1. All checks are green (if it asks, **Choose agent folder** and select `printer-agent`).
   2. **Laser port:** pick the laser's port (unplug the USB if unsure: the port that disappears is the laser).
   3. **Holders** says *All 3 calibrated*.
   4. Move the laser head into the HOME corner by hand, then tick **The laser head is at HOME**.
   5. Press **Start printing** and wait for *Ready, waiting for orders*.
5. Leave it running. When it says **Load a fresh blank**, put a new blank in the holder it names and press **Fresh blank loaded**.

To stop: press **Stop printing**. The head returns to HOME.

Run only one agent at a time. Laser Queue won't start a second one while another is online.

## Without Laser Queue (Command Prompt)

Do steps 1–3 above, move the head into the HOME corner, then:

```
cd <repo folder>\printer-agent
set LASER_PORT=COM8
node index.js
```

Replace `COM8` with the laser's port. When it says `Load a fresh … blank`, load one and press **Enter**. To stop, press **Ctrl + C** (the head returns to HOME). Calibrating holders needs Laser Queue.

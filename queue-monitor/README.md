# Laser Queue

A read-only desktop monitor for the laser keychain print queue (`laser-keychain-official`).

Source only is in git: the `.exe`, the build files and the Python environment are ignored (see `.gitignore`).

## Run it

Build it once (below), then double-click **`dist\LaserQueue.exe`**. It's a single file with no installer and no Python needed, so you can copy it to any Windows PC, including the printer laptop.

The first launch takes a few seconds while it unpacks. Windows SmartScreen may warn about an unrecognised app because the file isn't code-signed. Click **More info → Run anyway**.

## What it shows

- **Cards across the top:** waiting to print, in printing (and whether it's stuck), printed, unpaid, and all orders. Click a card to filter the table.
- **Printer:** online or offline, when the agent last reported, whether the laser is connected, the port, the last error, the limit switches, and recent events.
- **COM ports on this PC:** helps you find which port the laser is on. The list only reads port names and never opens one, so it can't interfere with the printer agent.
- **Order details:** click a row to see the engraving (with a preview for image orders), the order's progress from created to printed, the phone number with a copy button, times, and payment IDs.

It refreshes every 15 seconds. `F5` refreshes immediately and `Ctrl+F` jumps to search.

## Run the printer (on the printer laptop)

The **Run on this PC** panel starts the printer agent for you, so Command Prompt isn't needed:

1. It checks the setup first: agent folder, agent version, a key for the live project, packages and Node.js. Anything wrong shows up with the exact fix.
2. Pick the laser's port (unplug the laser's USB if unsure: the port that disappears is the laser).
3. Check **Holders** says all 3 are calibrated (see below; only needed once, and again if a holder moves).
4. Put the head at HOME and tick the box.
5. **Start printing.** The agent's live output appears under the orders, with a plain-English hint if something goes wrong.

Each keychain is engraved on its own shape's holder, and the head goes back to HOME after every keychain. Before each one the agent waits for a fresh blank: put one in the holder it names, then press **Fresh blank loaded** (the taskbar button flashes when it's waiting). A cart order engraves its keychains one after another and picks up where it left off if the agent is restarted.

**Stop printing** shuts the agent down the same way Ctrl+C does and returns the head to HOME. It asks first if a keychain is engraving. Start is blocked while another agent is already online, because two agents would print the same orders.

### Calibrate holders

Tells the agent where the rectangle, circle and heart holders sit on the bed. Only while the agent is stopped: **Calibrate** next to Holders opens the laser's port itself.

1. Push the head into the HOME corner by hand, then **Connect**. Where the head is now becomes HOME, exactly as when printing starts, so always use the same corner.
2. Jog with the arrows (or the arrow keys) in 10, 1 or 0.1 mm steps until the laser points at the middle of a holder, then **Save here**.
3. **Trace** runs the head along that keychain's border so you can check it sits inside the holder. Adjust and save again if it doesn't.
4. **Done** returns the head to HOME and frees the port.

The laser is never switched on while calibrating. The centres are saved to `holders.json` in the agent folder (one per machine, not in git); the agent reads it when it starts, and that's the only agent file Laser Queue writes.

## What it can't do

It can't cancel, clear or reprint orders. Order data comes from the same public reads the website uses, so the app itself contains no secret keys. It only reads the agent's `project_id` to check that the key is for the right project.

## Build (first time) and rebuild after editing the code

First time only, in this folder: `py -3.14 -m venv .venv` then `.venv\Scripts\python -m pip install PySide6 pyserial pyinstaller`.

```
.venv\Scripts\python build.py
```

That produces a new `dist\LaserQueue.exe`. The design values (colours, sizes, refresh timing) are all in `tokens.py`.

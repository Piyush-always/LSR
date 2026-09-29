# Laser Queue

A read-only desktop monitor for the laser keychain print queue (`laser-keychain-official`).

Source only is in git: the `.exe`, the build files and the Python environment are ignored (see `.gitignore`).

## Run it

Build it once (below), then double-click **`dist\LaserQueue.exe`**. It's a single file with no installer and no Python needed, so you can copy it to any Windows PC, including the printer laptop.

The first launch takes a few seconds while it unpacks. Windows SmartScreen may warn about an unrecognised app because the file isn't code-signed. Click **More info → Run anyway**.

## What it shows

- **Cards across the top:** waiting to print, in printing (and whether it's stuck), printed, unpaid, and all orders. Click a card to filter the table.
- **Printer:** online or offline, when the agent last reported, whether the laser is connected, the port, the last error, the limit switches, and recent events.
- **COM ports on this PC:** helps you find which port the laser is on. It only lists ports and never opens one, so it can't interfere with the printer agent.
- **Order details:** click a row to see the engraving (with a preview for image orders), the order's progress from created to printed, the phone number with a copy button, times, and payment IDs.

It refreshes every 15 seconds. `F5` refreshes immediately and `Ctrl+F` jumps to search.

## Run the printer (on the printer laptop)

The **Run on this PC** panel starts the printer agent for you, so Command Prompt isn't needed:

1. It checks the setup first: agent folder, agent version, a key for the live project, packages and Node.js. Anything wrong shows up with the exact fix.
2. Pick the laser's port (unplug the laser's USB if unsure: the port that disappears is the laser).
3. Put the head at HOME and tick the box.
4. **Start printing.** The agent's live output appears under the orders, with a plain-English hint if something goes wrong.

**Stop printing** shuts the agent down the same way Ctrl+C does. It asks first if a keychain is engraving. Start is blocked while another agent is already online, because two agents would print the same orders. The agent's own files aren't changed.

## What it can't do

It can't cancel, clear or reprint orders. Order data comes from the same public reads the website uses, so the app itself contains no secret keys. It only reads the agent's `project_id` to check that the key is for the right project.

## Build (first time) and rebuild after editing the code

First time only, in this folder: `py -3.14 -m venv .venv` then `.venv\Scripts\python -m pip install PySide6 pyserial pyinstaller`.

```
.venv\Scripts\python build.py
```

That produces a new `dist\LaserQueue.exe`. The design values (colours, sizes, refresh timing) are all in `tokens.py`.

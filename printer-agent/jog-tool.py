"""
Laser Jog Tool — keyboard-controlled position finder for GRBL lasers.

USE CASE
    Move the laser head with arrow keys to find the right HOME, START
    or PARK positions, then read the X/Y coordinates off the screen and
    plug them into printer-agent/text-to-gcode.js.

PREREQ
    1. Stop `node index.js` first — the COM port can only be open in
       one program at a time.
    2. Install dependencies once:
            pip install pyserial pynput

USAGE
    python jog-tool.py            # uses LASER_PORT env var or COM3
    python jog-tool.py COM5       # specify a port directly

KEYS
    Arrow keys      Jog the laser by current step
    + / -           Step size  (1, 5, 10, 25 mm)
    H               Set current position as HOME (G92 X0 Y0)
    L               Toggle laser ON/OFF at LOW power (sighting only)
    Z               Return to HOME (G0 X0 Y0)
    Q  /  Esc       Quit safely (laser off, port released)

SAFETY
    - Laser is OFF by default. The L key turns it on at LOW power
      (S20 / 1000) for sighting only. Never put your eye near the
      beam — even at low power it can damage your retina.
    - Keep an emergency-stop or kill switch within reach.
"""

import os
import sys
import time
import threading

try:
    import serial
    import serial.tools.list_ports
    from pynput import keyboard
except ImportError:
    print("Missing dependencies. Run:")
    print("    pip install pyserial pynput")
    sys.exit(1)


# ===== CONFIG =====
DEFAULT_PORT = os.environ.get("LASER_PORT", "COM8")
BAUD = 115200
JOG_FEED = 1500            # mm/min — speed of arrow-key moves
SIGHT_POWER = 20           # S value for sighting laser (low)
STEPS = [1, 5, 10, 25]     # mm — cycle through with +/-
DEFAULT_STEP_INDEX = 1     # start at 5 mm


# ===== STATE =====
ser = None
running = True
laser_on = False
step_index = DEFAULT_STEP_INDEX


# ===== SERIAL =====
def open_serial(port):
    global ser
    print(f"Opening {port} at {BAUD}...")
    # Open WITHOUT toggling DTR/RTS. The CV-01 Pro v2 uses ESP32 native
    # USB CDC, which throws WriteFile errors when the host tries to assert
    # control signals or send certain raw bytes (like \x18 soft reset).
    ser = serial.Serial()
    ser.port = port
    ser.baudrate = BAUD
    ser.timeout = 0.2
    ser.dtr = False
    ser.rts = False
    ser.open()
    time.sleep(2.0)              # let GRBL finish booting
    ser.reset_input_buffer()
    # NO soft reset (\x18) — it crashes on ESP32 native USB CDC.
    send_line("$X")              # unlock alarm
    send_line("G21")             # mm
    send_line("G90")             # absolute
    send_line("M5")              # laser off
    print("Connected.\n")


def send_raw(data):
    if ser and ser.is_open:
        ser.write(data.encode() if isinstance(data, str) else data)


def send_line(cmd):
    if ser and ser.is_open:
        ser.write((cmd + "\n").encode())


# ===== ACTIONS =====
def jog(dx, dy):
    """Send a relative jog. GRBL's $J= is non-blocking and queueable."""
    step = STEPS[step_index]
    cmd = f"$J=G91 G21 X{dx*step:.3f} Y{dy*step:.3f} F{JOG_FEED}"
    send_line(cmd)


def set_home():
    send_line("G92 X0 Y0")
    print("\n[HOME] Current position is now (0, 0).")


def go_home():
    send_line("G90")
    send_line(f"G0 X0 Y0 F{JOG_FEED}")


def toggle_laser():
    global laser_on
    laser_on = not laser_on
    if laser_on:
        send_line(f"M3 S{SIGHT_POWER}")
        print("\n[LASER] ON (sighting power).")
    else:
        send_line("M5")
        print("\n[LASER] OFF.")


def step_change(direction):
    """direction = +1 or -1"""
    global step_index
    step_index = max(0, min(len(STEPS) - 1, step_index + direction))
    print(f"\n[STEP] {STEPS[step_index]} mm")


# ===== STATUS POLL =====
def status_poll():
    """Ask GRBL for position 5x/sec and rewrite a single status line."""
    while running:
        if ser and ser.is_open:
            try:
                ser.write(b"?")
                time.sleep(0.05)
                data = ser.read_all().decode(errors="ignore")
                for line in data.splitlines():
                    if line.startswith("<") and "MPos:" in line:
                        try:
                            mpos = line.split("MPos:")[1].split("|")[0].split(",")
                            wpos_part = ""
                            if "WPos:" in line:
                                wpos = line.split("WPos:")[1].split("|")[0].split(",")
                                wpos_part = (
                                    f"  WPos X{float(wpos[0]):8.3f}"
                                    f"  Y{float(wpos[1]):8.3f}"
                                )
                            mpos_part = (
                                f"MPos X{float(mpos[0]):8.3f}"
                                f"  Y{float(mpos[1]):8.3f}"
                            )
                            laser = "ON " if laser_on else "off"
                            sys.stdout.write(
                                f"\r{mpos_part}{wpos_part}   "
                                f"step={STEPS[step_index]:>2}mm  "
                                f"laser={laser}   "
                            )
                            sys.stdout.flush()
                        except (ValueError, IndexError):
                            pass
            except serial.SerialException:
                pass
        time.sleep(0.2)


# ===== KEYBOARD =====
def on_press(key):
    global running
    try:
        if key == keyboard.Key.up:
            jog(0, +1)
        elif key == keyboard.Key.down:
            jog(0, -1)
        elif key == keyboard.Key.right:
            jog(+1, 0)
        elif key == keyboard.Key.left:
            jog(-1, 0)
        elif key == keyboard.Key.esc:
            running = False
            return False
        elif hasattr(key, "char") and key.char:
            c = key.char.lower()
            if c == "q":
                running = False
                return False
            elif c == "h":
                set_home()
            elif c == "l":
                toggle_laser()
            elif c == "z":
                go_home()
            elif c in ("+", "="):
                step_change(+1)
            elif c in ("-", "_"):
                step_change(-1)
    except AttributeError:
        pass


# ===== MAIN =====
def list_ports_help():
    print("Available serial ports:")
    for p in serial.tools.list_ports.comports():
        print(f"  {p.device:8}  {p.description}")
    print()


def main():
    global running
    port = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PORT
    list_ports_help()
    try:
        open_serial(port)
    except serial.SerialException as e:
        print(f"Could not open {port}: {e}")
        return

    print("=" * 60)
    print(" LASER JOG TOOL")
    print("=" * 60)
    print(" Arrow keys       Move the laser")
    print(" + / -            Step size  (1, 5, 10, 25 mm)")
    print(" H                Set current position as HOME (G92 X0 Y0)")
    print(" L                Toggle laser ON/OFF (sighting power)")
    print(" Z                Return to HOME")
    print(" Q  /  Esc        Quit")
    print("=" * 60)
    print(f" Step: {STEPS[step_index]} mm    |    Feed: {JOG_FEED} mm/min")
    print()
    print("This terminal must have focus for the keys to register.\n")

    threading.Thread(target=status_poll, daemon=True).start()

    listener = keyboard.Listener(on_press=on_press)
    listener.start()
    listener.join()

    print("\n\nShutting down...")
    if ser and ser.is_open:
        send_line("M5")          # laser off
        time.sleep(0.2)
        ser.close()
    print("Port released.")


if __name__ == "__main__":
    main()

"""Home the CV-01 Pro, then visit the saved shape centers with the laser off.

Run from the printer-agent folder:
    python auto-position-test.py
    python auto-position-test.py COM8

This script moves the machine. Keep the bed path clear and the emergency stop
within reach. It leaves the head at the circle center when it finishes.
"""

import sys
import time

try:
    import serial
except ImportError:
    print("Missing pyserial. Install it with: pip install pyserial")
    raise SystemExit(1)


PORT = sys.argv[1] if len(sys.argv) > 1 else "COM8"
BAUD = 115200
HOME_TIMEOUT_SECONDS = 90
MOVE_TIMEOUT_SECONDS = 90
START_DELAY_SECONDS = 5
POSITION_HOLD_SECONDS = 5
# Shape centers in machine coordinates (MPos), matching jog-tool.py.
SHAPE_CENTERS_MPOS = [
    ("Heart", 60.0, 28.0),
    ("Rectangle", 170.0, 28.0),
    ("Circle", 97.0, 135.0),
]


def read_line(port):
    return port.readline().decode("ascii", errors="ignore").strip()


def send_and_wait_ok(port, command, timeout=10):
    print(f"[SEND] {command}")
    port.write((command + "\n").encode("ascii"))
    deadline = time.monotonic() + timeout

    while time.monotonic() < deadline:
        line = read_line(port)
        if not line:
            continue
        print(f"[GRBL] {line}")
        if line.lower() == "ok":
            return
        if line.lower().startswith(("error", "alarm")):
            raise RuntimeError(f"GRBL rejected {command}: {line}")

    raise TimeoutError(f"Timed out waiting for GRBL response to: {command}")


def parse_status(line):
    if not line.startswith("<") or not line.endswith(">"):
        return None

    fields = line[1:-1].split("|")
    state = fields[0]
    mpos = next((field[5:] for field in fields if field.startswith("MPos:")), None)
    if mpos is None:
        return state, None

    try:
        xyz = [float(value) for value in mpos.split(",")]
    except ValueError:
        return state, None
    return state, xyz


def home_machine(port):
    print("[HOME] Sending physical homing command ($H)...")
    port.write(b"$H\n")
    deadline = time.monotonic() + HOME_TIMEOUT_SECONDS
    next_status_at = 0.0
    saw_home_state = False
    saw_home_ok = False

    while time.monotonic() < deadline:
        now = time.monotonic()
        if now >= next_status_at:
            port.write(b"?")
            next_status_at = now + 0.4

        line = read_line(port)
        if not line:
            continue
        print(f"[GRBL] {line}")

        lower = line.lower()
        if lower.startswith(("error", "alarm")):
            raise RuntimeError(f"Homing failed: {line}")
        if lower == "ok":
            saw_home_ok = True
            continue

        status = parse_status(line)
        if status:
            state, _ = status
            if state.lower() == "home":
                saw_home_state = True
            elif state.lower() == "idle" and (saw_home_state or saw_home_ok):
                print("[HOME] Physical homing complete.")
                return

    raise TimeoutError("Timed out waiting for physical homing to complete")


def wait_for_motion_complete(port, label):
    deadline = time.monotonic() + MOVE_TIMEOUT_SECONDS
    next_status_at = 0.0
    last_display_at = 0.0
    last_status_line = "No status received yet"
    saw_run = False

    while time.monotonic() < deadline:
        now = time.monotonic()
        if now >= next_status_at:
            port.write(b"?")
            next_status_at = now + 0.25

        line = read_line(port)
        if not line:
            continue
        status = parse_status(line)
        if not status:
            if line.lower().startswith(("error", "alarm")):
                raise RuntimeError(f"Move to {label} failed: {line}")
            continue

        state, mpos = status
        last_status_line = line
        if state.lower() == "alarm":
            raise RuntimeError(f"GRBL reported an alarm at {label}: {line}")
        if state.lower() == "run":
            saw_run = True
        elif state.lower() == "idle" and saw_run:
            coords = (
                f" MPos X{mpos[0]:.3f} Y{mpos[1]:.3f}"
                if mpos and len(mpos) >= 2 else ""
            )
            print(f"[POSITION] {label} move complete:{coords}")
            return

        now = time.monotonic()
        if now - last_display_at >= 1.0:
            print(f"[WAIT] {label}: {line}")
            last_display_at = now

    raise TimeoutError(
        f"Timed out waiting for the {label} move to finish. "
        f"Last status: {last_status_line}"
    )


def main():
    port = None
    try:
        print(f"[SERIAL] Opening {PORT} at {BAUD} baud...")
        port = serial.Serial(port=None, baudrate=BAUD, timeout=0.2, write_timeout=2)
        port.port = PORT
        port.dtr = False
        port.rts = False
        port.open()
        time.sleep(2)
        port.reset_input_buffer()

        # Make the laser-off state explicit before any machine movement.
        send_and_wait_ok(port, "M5")
        send_and_wait_ok(port, "G21")
        send_and_wait_ok(port, "G90")
        home_machine(port)

        print(f"[WAIT] Waiting {START_DELAY_SECONDS} seconds before visiting centers...")
        time.sleep(START_DELAY_SECONDS)

        for label, x, y in SHAPE_CENTERS_MPOS:
            send_and_wait_ok(port, "M5")
            send_and_wait_ok(port, "G90")
            send_and_wait_ok(port, f"G53 G0 X{x:.3f} Y{y:.3f}")
            wait_for_motion_complete(port, label)
            print(f"[WAIT] Holding at {label} center for {POSITION_HOLD_SECONDS} seconds.")
            time.sleep(POSITION_HOLD_SECONDS)

        print("[HOME] Returning to physical home after visiting all centers...")
        send_and_wait_ok(port, "M5")
        home_machine(port)
        print("[DONE] Visited all centers and returned to physical home; laser is off.")

    except KeyboardInterrupt:
        print("\n[STOP] Interrupted by operator.")
        raise SystemExit(130)
    except Exception as error:
        print(f"\n[ERROR] {error}")
        raise SystemExit(1)
    finally:
        if port is not None and port.is_open:
            try:
                port.write(b"M5\n")
                time.sleep(0.2)
            finally:
                port.close()
                print("[SERIAL] Port closed.")


if __name__ == "__main__":
    main()

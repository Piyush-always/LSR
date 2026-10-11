# ============================================================
# LASER JOG TOOL — CV-01 PRO / GRBL
# Diagnostic version
#
# R = Physical machine home
# H = Work home (G92)
# Z = Move to heart center (reference point)
# 1/2/3 = Move to heart/rectangle/circle centers
# D = Coordinate diagnostic — NO MOVEMENT
# C = DISABLED FOR NOW
# ============================================================

import os
import sys
import time
import threading

try:
    import serial
    import serial.tools.list_ports
    from pynput import keyboard
except ImportError:
    print("Missing dependencies.")
    print("Run:")
    print("    pip install pyserial pynput")
    sys.exit(1)


# ============================================================
# CONFIG
# ============================================================

DEFAULT_PORT = os.environ.get("LASER_PORT", "COM8")
BAUD = 115200

JOG_FEED = 1500
SIGHT_POWER = 20

# Shape centers in machine coordinates (MPos), measured from physical home.
SHAPE_MPOS = {
    "heart": {"x": 60.0, "y": 28.0},
    "rectangle": {"x": 170.0, "y": 28.0},
    "circle": {"x": 97.0, "y": 135.0},
}
REFERENCE_MPOS_X = SHAPE_MPOS["heart"]["x"]
REFERENCE_MPOS_Y = SHAPE_MPOS["heart"]["y"]

STEPS = [1, 5, 10, 25]
DEFAULT_STEP_INDEX = 0


# ============================================================
# STATE
# ============================================================

ser = None
running = True
laser_on = False
step_index = DEFAULT_STEP_INDEX
serial_lock = threading.Lock()
homing = False
machine_homed = False


# ============================================================
# SERIAL
# ============================================================

def send_line(cmd):
    if ser and ser.is_open:
        try:
            with serial_lock:
                ser.write((cmd + "\n").encode())
        except serial.SerialException:
            pass


def read_serial(seconds=1.0):
    """
    Read serial data for a fixed amount of time.
    """
    if not ser or not ser.is_open:
        return ""

    data = ""
    end_time = time.time() + seconds

    while time.time() < end_time:
        try:
            chunk = ser.read_all().decode(errors="ignore")
            if chunk:
                data += chunk
        except serial.SerialException:
            break

        time.sleep(0.05)

    return data


# ============================================================
# OPEN SERIAL
# ============================================================

def open_serial(port):

    global ser

    print(f"Opening {port} at {BAUD}...")

    ser = serial.Serial()

    ser.port = port
    ser.baudrate = BAUD
    ser.timeout = 0.2

    # Important
    ser.dtr = False
    ser.rts = False

    ser.open()

    # Allow controller to boot
    time.sleep(2)

    ser.reset_input_buffer()
    ser.reset_output_buffer()

    print("[INIT] Unlocking GRBL...")
    send_line("$X")
    time.sleep(0.5)

    print("[INIT] Millimeters...")
    send_line("G21")
    time.sleep(0.3)

    print("[INIT] Absolute mode...")
    send_line("G90")
    time.sleep(0.3)

    print("[INIT] Laser OFF...")
    send_line("M5")
    time.sleep(0.3)

    # IMPORTANT:
    # No G92
    # No G0
    # No movement

    print("[INIT] Reading current machine position...")

    with serial_lock:
        ser.write(b"?")

    time.sleep(0.3)

    data = ser.read_all().decode(errors="ignore")

    print()
    print("[GRBL INITIAL STATUS]")

    found = False

    for line in data.splitlines():
        line = line.strip()

        if line.startswith("<"):
            print(line)
            found = True

    if not found:
        print("No status received.")

    print()
    print("Connected.")
    print("Machine will NOT move automatically.")
    print()


# ============================================================
# PHYSICAL MACHINE HOME
# ============================================================

def physical_home():

    global homing, machine_homed

    if not ser or not ser.is_open:
        return

    if homing:
        print("\n[HOME] Already homing...")
        return

    homing = True
    machine_homed = False

    # Laser OFF
    send_line("M5")
    time.sleep(0.2)

    print()
    print("================================================")
    print("[HOME] PHYSICAL MACHINE HOMING")
    print("[HOME] Sending $H...")
    print("================================================")

    try:

        with serial_lock:
            ser.write(b"$H\n")

        start_time = time.time()

        while time.time() - start_time < 60:

            time.sleep(0.1)

            try:
                data = ser.read_all().decode(errors="ignore")
            except serial.SerialException:
                break

            if data:
                for line in data.splitlines():

                    line = line.strip()

                    if line:
                        print(f"[GRBL] {line}")

            # Ask status
            with serial_lock:
                ser.write(b"?")

            time.sleep(0.1)

            status_data = ser.read_all().decode(
                errors="ignore"
            )

            for line in status_data.splitlines():

                line = line.strip()

                if line.startswith("<"):

                    print(f"[STATUS] {line}")

                    if (
                        "<Idle|" in line
                        and "MPos:" in line
                    ):

                        print()
                        print("[HOME] Homing complete.")

                        machine_homed = True
                        homing = False
                        return

        print()
        print("[HOME] Homing timeout.")

    except serial.SerialException as e:

        print(f"[HOME] Serial error: {e}")

    homing = False


# ============================================================
# JOG
# ============================================================

def jog(dx, dy):

    if not ser or not ser.is_open:
        return

    if homing:
        print("\n[WARNING] Homing in progress.")
        return

    step = STEPS[step_index]

    x_move = dx * step
    y_move = dy * step

    cmd = (
        f"$J=G91 G21 "
        f"X{x_move:.3f} "
        f"Y{y_move:.3f} "
        f"F{JOG_FEED}"
    )

    send_line(cmd)


# ============================================================
# WORK HOME
# ============================================================

def set_home():

    if homing:
        return

    send_line("G92 X0 Y0")
    time.sleep(0.2)

    print()
    print("[HOME] WORK coordinate set to X0 Y0.")
    print("[HOME] Machine MPos is NOT changed.")


# ============================================================
# GO TO FIXED REFERENCE POINT
# ============================================================

def go_home():

    go_to_shape("heart")


def go_to_shape(shape):

    global laser_on

    if homing:
        return

    if not machine_homed:
        print("\n[WARNING] Press R to physically home the machine before moving to a saved position.")
        return

    target = SHAPE_MPOS[shape]

    # Keep the laser off during the travel move.
    send_line("M5")
    laser_on = False
    time.sleep(0.1)

    send_line("G90")
    time.sleep(0.1)

    send_line(
        f"G53 G0 X{target['x']:.3f} Y{target['y']:.3f}"
    )

    print(
        f"\n[POSITION] Moving to {shape} center at machine coordinates "
        f"X{target['x']:.3f} Y{target['y']:.3f}."
    )


# ============================================================
# LASER
# ============================================================

def toggle_laser():

    global laser_on

    if homing:
        print("\n[WARNING] Laser disabled during homing.")
        return

    laser_on = not laser_on

    if laser_on:

        send_line(
            f"M3 S{SIGHT_POWER}"
        )

        print()
        print(
            f"[LASER] ON (S{SIGHT_POWER})"
        )

    else:

        send_line("M5")

        print()
        print("[LASER] OFF")


# ============================================================
# STEP SIZE
# ============================================================

def step_change(direction):

    global step_index

    step_index = max(
        0,
        min(
            len(STEPS) - 1,
            step_index + direction
        )
    )

    print(
        f"\n[STEP] {STEPS[step_index]} mm"
    )


# ============================================================
# COORDINATE DIAGNOSTIC
# ============================================================

def coordinate_diagnostic():

    if not ser or not ser.is_open:
        return

    print()
    print("================================================")
    print("[DIAG] COORDINATE DIAGNOSTIC")
    print("[DIAG] NO MOVEMENT WILL BE PERFORMED")
    print("================================================")

    # Laser OFF
    send_line("M5")
    time.sleep(0.2)

    # --------------------------------------------------------
    # 1. Current status
    # --------------------------------------------------------

    print()
    print("[DIAG] CURRENT STATUS (?)")

    with serial_lock:
        ser.write(b"?")

    time.sleep(0.3)

    data = ser.read_all().decode(errors="ignore")

    if data:
        print(data.strip())
    else:
        print("No status response.")


    # --------------------------------------------------------
    # 2. Coordinate offsets
    # --------------------------------------------------------

    print()
    print("[DIAG] GRBL COORDINATE OFFSETS ($#)")

    with serial_lock:
        ser.write(b"$#\n")

    time.sleep(0.5)

    data = ser.read_all().decode(errors="ignore")

    if data:
        print(data.strip())
    else:
        print("No $# response.")


    # --------------------------------------------------------
    # 3. Parser state
    # --------------------------------------------------------

    print()
    print("[DIAG] GRBL PARSER STATE ($G)")

    with serial_lock:
        ser.write(b"$G\n")

    time.sleep(0.5)

    data = ser.read_all().decode(errors="ignore")

    if data:
        print(data.strip())
    else:
        print("No $G response.")


    # --------------------------------------------------------
    # 4. Current settings
    # --------------------------------------------------------

    print()
    print("[DIAG] IMPORTANT SETTINGS")

    with serial_lock:
        ser.write(b"$10\n")

    time.sleep(0.3)

    data = ser.read_all().decode(errors="ignore")

    if data:
        print(data.strip())

    with serial_lock:
        ser.write(b"$30\n")

    time.sleep(0.3)

    data = ser.read_all().decode(errors="ignore")

    if data:
        print(data.strip())

    with serial_lock:
        ser.write(b"$32\n")

    time.sleep(0.3)

    data = ser.read_all().decode(errors="ignore")

    if data:
        print(data.strip())


    # --------------------------------------------------------
    # 5. Final status
    # --------------------------------------------------------

    print()
    print("[DIAG] FINAL STATUS")

    with serial_lock:
        ser.write(b"?")

    time.sleep(0.3)

    data = ser.read_all().decode(errors="ignore")

    if data:
        print(data.strip())

    print()
    print("================================================")
    print("[DIAG] COMPLETE")
    print("[DIAG] MACHINE WAS NOT MOVED")
    print("================================================")
    print()


# ============================================================
# STATUS POLLING
# ============================================================

def status_poll():

    global running

    while running:

        if ser and ser.is_open:

            try:

                with serial_lock:
                    ser.write(b"?")

                time.sleep(0.05)

                data = ser.read_all().decode(
                    errors="ignore"
                )

                for line in data.splitlines():

                    line = line.strip()

                    if (
                        line.startswith("<")
                        and "MPos:" in line
                    ):

                        try:

                            mpos = (
                                line
                                .split("MPos:")[1]
                                .split("|")[0]
                                .split(",")
                            )

                            mx = float(mpos[0])
                            my = float(mpos[1])

                            # WPos if available
                            wpos_part = ""

                            if "WPos:" in line:

                                wpos = (
                                    line
                                    .split("WPos:")[1]
                                    .split("|")[0]
                                    .split(",")
                                )

                                wx = float(wpos[0])
                                wy = float(wpos[1])

                                wpos_part = (
                                    f"  WPos X{wx:8.3f}"
                                    f"  Y{wy:8.3f}"
                                )

                            laser = (
                                "ON "
                                if laser_on
                                else "off"
                            )

                            sys.stdout.write(
                                "\r"
                                f"MPos X{mx:8.3f}"
                                f"  Y{my:8.3f}"
                                f"{wpos_part}"
                                f"   "
                                f"step={STEPS[step_index]:>2}mm"
                                f"  laser={laser}   "
                            )

                            sys.stdout.flush()

                        except (
                            ValueError,
                            IndexError
                        ):
                            pass

            except serial.SerialException:
                pass

        time.sleep(0.2)


# ============================================================
# KEYBOARD
# ============================================================

def on_press(key):

    global running

    try:

        # ----------------------------------------------------
        # ARROWS
        # ----------------------------------------------------

        if key == keyboard.Key.up:

            jog(0, +1)

        elif key == keyboard.Key.down:

            jog(0, -1)

        elif key == keyboard.Key.right:

            jog(+1, 0)

        elif key == keyboard.Key.left:

            jog(-1, 0)


        # ----------------------------------------------------
        # ESC
        # ----------------------------------------------------

        elif key == keyboard.Key.esc:

            running = False
            return False


        # ----------------------------------------------------
        # CHARACTER KEYS
        # ----------------------------------------------------

        elif hasattr(key, "char") and key.char:

            c = key.char.lower()


            # R = PHYSICAL HOME
            # -----------------------------------------------

            if c == "r":

                physical_home()


            # H = WORK HOME
            # -----------------------------------------------

            elif c == "h":

                set_home()


            # D = DIAGNOSTIC
            # -----------------------------------------------

            elif c == "d":

                coordinate_diagnostic()


            # L = LASER
            # -----------------------------------------------

            elif c == "l":

                toggle_laser()


            # Z = FIXED REFERENCE RETURN
            # -----------------------------------------------

            elif c == "z":

                go_home()

            # Number keys move to the saved shape centers.
            elif c == "1":

                go_to_shape("heart")

            elif c == "2":

                go_to_shape("rectangle")

            elif c == "3":

                go_to_shape("circle")


            # + = BIGGER STEP
            # -----------------------------------------------

            elif c in ("+", "="):

                step_change(+1)


            # - = SMALLER STEP
            # -----------------------------------------------

            elif c in ("-", "_"):

                step_change(-1)


            # Q = QUIT
            # -----------------------------------------------

            elif c == "q":

                running = False
                return False

    except AttributeError:

        pass


# ============================================================
# PORT LIST
# ============================================================

def list_ports_help():

    print("Available serial ports:")

    for p in serial.tools.list_ports.comports():

        print(
            f"  {p.device:8} "
            f"{p.description}"
        )

    print()


# ============================================================
# MAIN
# ============================================================

def main():

    global running

    port = (
        sys.argv[1]
        if len(sys.argv) > 1
        else DEFAULT_PORT
    )

    list_ports_help()

    try:

        open_serial(port)

    except serial.SerialException as e:

        print(
            f"Could not open {port}: {e}"
        )

        return


    print("=" * 60)
    print(" LASER JOG TOOL — CV-01 PRO")
    print("=" * 60)

    print(
        " Arrow keys       Jog laser"
    )

    print(
        " + / -            Step "
        "(1, 5, 10, 25 mm)"
    )

    print(
        " R                PHYSICAL HOME ($H)"
    )

    print(
        " H                WORK HOME (G92)"
    )

    print(
        " D                COORDINATE DIAGNOSTIC"
    )

    print(
        f" Z                Go to heart center / reference MPos "
        f"X{REFERENCE_MPOS_X:g} Y{REFERENCE_MPOS_Y:g} (home first with R)"
    )

    print(
        " 1 / 2 / 3        Go to heart / rectangle / circle center"
    )

    print(
        " L                Laser ON/OFF (S20)"
    )

    print(
        " Q / Esc          Quit"
    )

    print("=" * 60)

    print(
        f" Step: {STEPS[step_index]} mm"
        f"    |    Feed: {JOG_FEED} mm/min"
    )

    print()

    print(
        "For Circle calibration:"
    )

    print(
        "  Use R for PHYSICAL HOME."
    )

    print(
        "  Do NOT press H."
    )

    print(
        "  Do NOT press C yet."
    )

    print()

    print(
        "Press D after homing to diagnose coordinates."
    )

    print()

    print(
        "This terminal must have focus "
        "for the keys to register."
    )

    print()


    # Start status thread

    threading.Thread(
        target=status_poll,
        daemon=True
    ).start()


    # Keyboard

    listener = keyboard.Listener(
        on_press=on_press
    )

    listener.start()

    listener.join()


    # --------------------------------------------------------
    # SAFE SHUTDOWN
    # --------------------------------------------------------

    print(
        "\n\nShutting down..."
    )

    running = False

    if ser and ser.is_open:

        try:

            send_line("M5")

            time.sleep(0.2)

            ser.close()

        except serial.SerialException:

            pass

    print("Port released.")


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    main()

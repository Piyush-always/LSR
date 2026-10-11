"""A small GRBL client for calibrating holders from Laser Queue.

Opens the laser's COM port (only while the printer agent is stopped), homes the
machine with $H and makes that spot HOME (exactly what the agent does when it
connects), jogs, reports the head's position, traces a keychain outline with the
laser OFF, and on disconnect returns the head to HOME before closing the port. It
never sends M3, so the laser never fires.

All serial I/O runs on one worker thread; results come back as Qt signals.
"""
from __future__ import annotations

import math
import queue
import re
import threading
import time

from PySide6.QtCore import QObject, Signal

BAUD = 115200
BANNER_WAIT_S = 5          # some boards reset when the port opens and print "Grbl ..."; others don't
REPLY_TIMEOUT_S = 10       # a normal command's 'ok'
MOVE_TIMEOUT_S = 90        # a move to be finished (head Idle again)
HOMING_TIMEOUT_S = 120     # $H replies only once the head has reached its switches
STATUS_POLL_S = 0.15
TRACE_FEED = 1500          # mm/min: slow enough to follow the outline by eye

# CV-01 firmware may glue the acknowledgement onto debug text ("stop st_go_idleok").
OK_RE = re.compile(r"(\bok|idleok)\s*$", re.IGNORECASE)
STATUS_RE = re.compile(r"<([A-Za-z]+)[^>]*?(WPos|MPos):(-?[\d.]+),(-?[\d.]+)")
WCO_RE = re.compile(r"WCO:(-?[\d.]+),(-?[\d.]+)")

# The border engraved on each real blank, in mm around the holder centre (Y-up).
# Same geometry as printer-agent/holders.js (Tejas's tested shapes).
BLANKS = {"rectangle": (29, 61), "circle": (90, 90), "heart": (45, 45)}


def outline(shape: str) -> list[tuple[float, float]]:
    w, h = BLANKS.get(shape, BLANKS["rectangle"])
    if shape == "circle":
        return [(w / 2 * math.cos(a), w / 2 * math.sin(a)) for a in (i * 2 * math.pi / 64 for i in range(65))]
    if shape == "heart":
        raw = []
        for i in range(129):
            t = i / 128 * 2 * math.pi
            raw.append((16 * math.sin(t) ** 3,
                        13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)))
        xs, ys = [p[0] for p in raw], [p[1] for p in raw]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        return [(((x - x0) / (x1 - x0) - 0.5) * w, ((y - y0) / (y1 - y0) - 0.5) * h) for x, y in raw]
    return [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2)]


class GrblError(Exception):
    pass


class NoReply(GrblError):
    pass


class GrblLink(QObject):
    position = Signal(float, float, str)      # x, y (mm from HOME), machine state
    connected_changed = Signal(bool)
    busy = Signal(bool)
    message = Signal(str, str)                # text, tone: secondary / warning / danger
    closed = Signal()                         # a disconnect finished: the port is free

    def __init__(self, serial_factory=None) -> None:
        super().__init__()
        self._factory = serial_factory or _open_serial
        self._ser = None
        self._rx = b""
        self._wco = (0.0, 0.0)
        self.connected = False
        self.x = self.y = 0.0
        self._jobs: queue.Queue = queue.Queue()
        threading.Thread(target=self._run, name="grbl-link", daemon=True).start()

    # -- requests from the UI (queued, run in order on the worker) ----------------------
    def connect_port(self, port: str) -> None:
        self._jobs.put((self._connect, (port,)))

    def jog(self, dx: float, dy: float) -> None:
        self._jobs.put((self._jog, (dx, dy)))

    def go_to(self, x: float, y: float) -> None:
        self._jobs.put((self._go_to, (x, y)))

    def trace(self, shape: str, x: float, y: float) -> None:
        self._jobs.put((self._trace, (shape, x, y)))

    def go_home(self) -> None:
        self._jobs.put((self._go_to, (0.0, 0.0)))

    def disconnect_port(self) -> None:
        self._jobs.put((self._disconnect, ()))

    def shutdown(self) -> None:
        """End the worker thread once the queued jobs (a disconnect, say) have run."""
        self._jobs.put((None, ()))

    # -- worker ---------------------------------------------------------------------------
    def _run(self) -> None:
        while True:
            fn, args = self._jobs.get()
            if fn is None:
                return
            # == not `is`: each self._connect access makes a new bound-method object
            if fn != self._connect and fn != self._disconnect and not self.connected:
                continue                                  # connection dropped: skip queued moves
            self.busy.emit(True)
            try:
                fn(*args)
            except Exception as e:                        # serial errors arrive as several types
                self.message.emit(str(e), "danger")
                if fn == self._connect or not self._port_alive():
                    self._close()
            finally:
                self.busy.emit(False)

    def _connect(self, port: str) -> None:
        if self.connected:
            return
        self.message.emit(f"Connecting on {port}…", "secondary")
        try:
            self._ser = self._factory(port)
        except Exception as e:                            # SerialException, OSError, ValueError
            raise GrblError(f"Couldn't open {port}. If the printer agent or another program "
                            f"is using it, stop that first. ({e})") from e
        self._rx = b""
        deadline = time.monotonic() + BANNER_WAIT_S
        while time.monotonic() < deadline:                # wait for the board to finish its reset
            line = self._readline(deadline)
            if line is not None and line.lower().startswith("grbl"):
                break
        time.sleep(0.3)
        try:
            self._send("M5", timeout=3)                   # laser off; also checks the board answers
        except NoReply:
            raise NoReply(f"No reply from the laser on {port}. Check the port and that the laser is on.")
        except GrblError:                                 # locked until homed: it answered, that's enough
            pass
        self.message.emit("Homing: the head drives to its HOME corner…", "secondary")
        try:
            self._send("$H", timeout=HOMING_TIMEOUT_S)    # also clears a start-up alarm lock
        except GrblError as e:                            # an alarm's text already says to check the switches
            raise GrblError(f"Homing failed: {e}")
        for cmd in ("G21", "G90", "M5", "G92.1", "G92 X0 Y0"):   # same as the agent: HOME = homed spot
            self._send(cmd)
        self.connected = True
        self.connected_changed.emit(True)
        self._report()
        self.message.emit("Connected and homed. Positions are mm from HOME.", "secondary")

    def _jog(self, dx: float, dy: float) -> None:
        self._send("G91")
        try:
            self._send(f"G0 X{dx:.3f} Y{dy:.3f}")
        finally:
            self._send("G90")
        self._wait_idle()

    def _go_to(self, x: float, y: float) -> None:
        self._send(f"G0 X{x:.3f} Y{y:.3f}")
        self._wait_idle()

    def _trace(self, shape: str, x: float, y: float) -> None:
        self._send("M5")                                  # belt and braces: laser off
        pts = outline(shape)
        self._send(f"G0 X{x + pts[0][0]:.3f} Y{y + pts[0][1]:.3f}")
        for dx, dy in pts[1:]:
            self._send(f"G1 X{x + dx:.3f} Y{y + dy:.3f} F{TRACE_FEED}")
        self._send(f"G0 X{x:.3f} Y{y:.3f}")
        self._wait_idle()
        self.message.emit(f"Traced the {shape} outline (laser off).", "secondary")

    def _disconnect(self) -> None:
        try:
            if self.connected:
                try:                                      # laser off, back to HOME, wait until there
                    self._send("M5")
                    self._send("G0 X0 Y0")
                    self._send("G4 P0.1", timeout=MOVE_TIMEOUT_S)
                    self._report()
                    self.message.emit("Disconnected. The head is at HOME.", "secondary")
                except Exception as e:                    # report it, but still release the port
                    self.message.emit(f"Couldn't confirm the head is back at HOME: {e}", "warning")
        finally:
            self._close()
            self.closed.emit()

    # -- serial helpers ---------------------------------------------------------------------
    def _port_alive(self) -> bool:
        return self._ser is not None and getattr(self._ser, "is_open", True)

    def _close(self) -> None:
        if self._ser is not None:
            try:
                self._ser.close()
            except Exception:                             # already gone; nothing else to release
                pass
        self._ser = None
        if self.connected:
            self.connected = False
            self.connected_changed.emit(False)

    def _readline(self, deadline: float) -> str | None:
        while time.monotonic() < deadline:
            if b"\n" in self._rx:
                line, self._rx = self._rx.split(b"\n", 1)
                return line.decode("ascii", "replace").strip()
            chunk = self._ser.read(self._ser.in_waiting or 1)
            if chunk:
                self._rx += chunk
        return None

    def _send(self, command: str, timeout: float = REPLY_TIMEOUT_S) -> None:
        self._ser.write((command + "\n").encode("ascii"))
        deadline = time.monotonic() + timeout
        while True:
            line = self._readline(deadline)
            if line is None:
                raise NoReply(f"No reply from the laser to {command}")
            if OK_RE.search(line):
                return
            if line.lower().startswith("error"):
                raise GrblError(f"The laser rejected {command} ({line})")
            if line.upper().startswith("ALARM"):
                raise GrblError(f"Laser alarm after {command} ({line}). Check the limit switches and the head.")
            self._note_status(line)                       # status reports, [MSG:…] etc.

    def _status(self) -> str | None:
        self._ser.write(b"?")                             # real-time: no newline, no 'ok'
        deadline = time.monotonic() + 1.0
        while True:
            line = self._readline(deadline)
            if line is None:
                return None
            state = self._note_status(line)
            if state:
                return state

    def _note_status(self, line: str) -> str | None:
        wco = WCO_RE.search(line)
        if wco:
            self._wco = (float(wco.group(1)), float(wco.group(2)))
        m = STATUS_RE.search(line)
        if not m:
            return None
        state, kind, x, y = m.group(1), m.group(2), float(m.group(3)), float(m.group(4))
        if kind == "MPos":                                # report in work coordinates (from HOME)
            x, y = x - self._wco[0], y - self._wco[1]
        self.x, self.y = x, y
        self.position.emit(x, y, state)
        return state

    def _report(self) -> None:
        self._status()

    def _wait_idle(self, timeout: float = MOVE_TIMEOUT_S) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._status() == "Idle":
                return
            time.sleep(STATUS_POLL_S)
        raise GrblError("The head didn't stop moving in time")


def _open_serial(port: str):
    import serial                                         # imported here so tests can run without a port
    return serial.Serial(port, BAUD, timeout=0.05)

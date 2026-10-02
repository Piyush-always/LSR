"""A small GRBL client for calibrating holders from Laser Queue.

Opens the laser's COM port (only while the printer agent is stopped), sets HOME
where the head is (exactly what the agent does when it connects), jogs, reports
the head's position, traces a keychain outline with the laser OFF, and on
disconnect returns the head to HOME before closing the port. It never sends M3,
so the laser never fires.

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
STATUS_POLL_S = 0.15
TRACE_FEED = 1500          # mm/min: slow enough to follow the outline by eye

STATUS_RE = re.compile(r"<([A-Za-z]+)[^>]*?(WPos|MPos):(-?[\d.]+),(-?[\d.]+)")
WCO_RE = re.compile(r"WCO:(-?[\d.]+),(-?[\d.]+)")

# The engraved border of each keychain, in mm around the holder centre (Y-up).
# Same geometry as printer-agent/text-to-gcode.js.
_HEART_PATH = [
    (27.5, 46, 14, 36, 2, 26, 2, 15), (2, 15, 2, 7, 8, 2, 16, 2), (16, 2, 21.5, 2, 25.5, 5.5, 27.5, 9.5),
    (27.5, 9.5, 29.5, 5.5, 33.5, 2, 39, 2), (39, 2, 47, 2, 53, 7, 53, 15), (53, 15, 53, 26, 41, 36, 27.5, 46),
]


def outline(shape: str) -> list[tuple[float, float]]:
    if shape == "circle":
        return [(23 * math.cos(a), 23 * math.sin(a)) for a in (i * 2 * math.pi / 36 for i in range(37))]
    if shape == "heart":
        pts = []
        for x0, y0, x1, y1, x2, y2, x3, y3 in _HEART_PATH:
            for i in range(0 if not pts else 1, 9):
                t, u = i / 8, 1 - i / 8
                x = u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3
                y = u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3
                pts.append((x - 27.5, (50 - y) - 25))      # Y-down web → Y-up, centred on the blank
        return pts
    return [(-34, -15.5), (34, -15.5), (34, 15.5), (-34, 15.5), (-34, -15.5)]   # rectangle border


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
            self._send("$X", timeout=3)                   # unlock if the board starts in alarm
        except NoReply:
            raise NoReply(f"No reply from the laser on {port}. Check the port and that the laser is on.")
        except GrblError:                                 # rejected: the board wasn't locked
            pass
        for cmd in ("G21", "G90", "M5", "G92.1", "G92 X0 Y0"):   # same as the agent: HOME = here
            self._send(cmd)
        self.connected = True
        self.connected_changed.emit(True)
        self._report()
        self.message.emit("Connected. HOME is where the head is now.", "secondary")

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
            if line == "ok":
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

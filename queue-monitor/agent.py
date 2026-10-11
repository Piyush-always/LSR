"""Runs the printer agent (node index.js) on this PC for the operator.

Checks the setup first, starts the agent with the chosen laser port, streams its
output, and stops it by running the agent's own Ctrl+C shutdown. The agent's
files are not touched. Everything here runs on the UI thread: QProcess
is event-driven, so nothing blocks.
"""
from __future__ import annotations

import json
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PySide6.QtCore import QObject, QProcess, QProcessEnvironment, QTimer, Signal

import firestore as fs
import tokens as T

FOLDER_GUESSES = (r"C:\laser-keychain\printer-agent", r"C:\laser-keychain-live\printer-agent")

# Preloaded into the agent with `node --require`. Windows can't deliver Ctrl+C to a
# process started from a windowed app, so the app writes "stop" to the agent's
# stdin instead, and this emits SIGINT: the agent's own Ctrl+C handler runs.
STOP_HOOK = """// Written by Laser Queue. Lets the app stop the agent the way Ctrl+C does.
process.stdin.on('data', (chunk) => {
    if (String(chunk).includes('stop')) process.emit('SIGINT');
});
"""

# (pattern in an agent output line, what the operator should do)
HINTS = (
    (re.compile(r"Cannot find module"), "Packages are missing. Run npm install in the agent folder."),
    (re.compile(r"Access denied", re.I),
     "Another program is using the laser's port. Close other laser software, the jog tool, "
     "or any Command Prompt window running the agent."),
    (re.compile(r"Opening COM\d+: File not found"),
     "That port isn't connected. Check the laser's USB cable and pick the port again."),
    (re.compile(r"publish failed|default credentials|invalid_grant", re.I),
     "The key isn't working. Replace service-account.json with a new key."),
)


@dataclass(frozen=True)
class Check:
    ok: bool
    label: str          # the good outcome, e.g. "Packages installed"
    fix: str = ""       # what to do when it isn't ok


def find_agent_folder(saved: str | None) -> str | None:
    here = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent
    candidates = [saved, *FOLDER_GUESSES, str(here / "printer-agent"), str(here.parent / "printer-agent")]
    for c in candidates:
        if c and (Path(c) / "index.js").is_file():
            return str(Path(c))
    return None


def preflight(folder: str | None) -> list[Check]:
    """Cheap file checks, safe to repeat on every refresh."""
    if not folder or not (Path(folder) / "index.js").is_file():
        return [Check(False, "Agent folder", "Choose the printer-agent folder (the one with index.js).")]
    root = Path(folder)
    source = (root / "index.js").read_text(encoding="utf-8", errors="replace")
    checks = [Check("system/printer" in source, "Current agent version",
                    "This is the old agent. In the repo folder run: git pull")]

    project = None
    try:                                           # only project_id is kept; the key stays on disk
        project = json.loads((root / "service-account.json").read_text(encoding="utf-8")).get("project_id")
    except (OSError, ValueError):
        pass
    if project == fs.PROJECT:
        checks.append(Check(True, f"Key for {fs.PROJECT}"))
    elif project:
        checks.append(Check(False, f"Key for {fs.PROJECT}",
                            f"This key is for {project}. Replace service-account.json with a key for {fs.PROJECT}."))
    else:
        checks.append(Check(False, f"Key for {fs.PROJECT}", "No readable service-account.json in the agent folder."))

    checks.append(Check((root / "node_modules" / "serialport").is_dir(), "Packages installed",
                        "Run npm install in the agent folder."))
    checks.append(Check(shutil.which("node") is not None, "Node.js installed", "Install Node.js LTS from nodejs.org."))
    return checks


class AgentRunner(QObject):
    """States: stopped, starting, connecting, retrying, connected, listening,
    engraving, waiting_blank, stopping, crashed."""

    output = Signal(list)                 # batches of (text, transient) lines
    state_changed = Signal(str, str)      # state, detail
    hint = Signal(str)                    # "" clears the hint

    def __init__(self) -> None:
        super().__init__()
        self._proc: QProcess | None = None
        self._buf = ""
        self._pending: list[tuple[str, bool]] = []
        self._stop_requested = False
        self.state = "stopped"
        self.detail = ""
        self.port = ""
        self._engraving = ""                  # what was engraving before a blank change

        self._flush = QTimer(self)
        self._flush.setSingleShot(True)
        self._flush.setInterval(T.LOG_FLUSH_MS)
        self._flush.timeout.connect(self._emit_pending)
        self._silence = QTimer(self)                          # laser never answered after the port opened
        self._silence.setSingleShot(True)
        self._silence.setInterval(T.LASER_SILENT_S * 1000)
        self._silence.timeout.connect(lambda: self.hint.emit(
            f"The laser isn't answering on {self.port}. It may be the wrong port, or the laser is off. "
            "Stop, then check the port (unplug the laser's USB: the port that disappears is the laser)."))
        self._force = QTimer(self)                            # Ctrl+C didn't stop it in time
        self._force.setSingleShot(True)
        self._force.setInterval(T.STOP_GRACE_MS)
        self._force.timeout.connect(lambda: self._proc and self._proc.kill())

    @property
    def running(self) -> bool:
        return self._proc is not None

    def start(self, folder: str, port: str) -> None:
        if self._proc is not None:
            return
        node = shutil.which("node")
        if not node:
            self._set("crashed", "Node.js isn't installed")
            return
        hook = Path(tempfile.gettempdir()) / "laserqueue-stop-hook.js"
        try:
            hook.write_text(STOP_HOOK, encoding="utf-8")
        except OSError as e:
            self._set("crashed", f"Couldn't write the stop helper: {e}")
            return
        proc = QProcess(self)
        proc.setProgram(node)
        proc.setArguments(["--require", str(hook), "index.js"])
        proc.setWorkingDirectory(folder)
        env = QProcessEnvironment.systemEnvironment()
        env.insert("LASER_PORT", port)
        proc.setProcessEnvironment(env)
        proc.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)
        proc.readyReadStandardOutput.connect(self._read)
        proc.finished.connect(self._finished)
        proc.errorOccurred.connect(self._error)
        self._proc, self.port, self._buf, self._stop_requested = proc, port, "", False
        self.hint.emit("")
        self._queue(f"── Starting the agent on {port} ──", False)
        self._set("starting")
        proc.start()

    def stop(self) -> None:
        if self._proc is None or self._stop_requested:
            return
        self._stop_requested = True
        self._set("stopping")
        self._queue("── Stopping (same as Ctrl+C) ──", False)
        if self._proc.write(b"stop\n") == -1:           # stdin gone: nothing left to ask nicely
            self._proc.kill()
        else:
            self._force.start()

    def fresh_blank_loaded(self) -> None:
        """The operator has put a fresh blank in the holder the agent is waiting for."""
        if self._proc is not None and self.state == "waiting_blank":
            self._queue("── Fresh blank loaded ──", False)
            self._proc.write(b"next\n")

    # -- output parsing ----------------------------------------------------------------------
    def _read(self) -> None:
        self._buf += bytes(self._proc.readAllStandardOutput()).decode("utf-8", errors="replace")
        parts = re.split(r"(\r\n|\n|\r)", self._buf)
        self._buf = parts.pop()                               # incomplete tail waits for more output
        for text, sep in zip(parts[0::2], parts[1::2]):
            if sep == "\r":                                   # progress lines rewrite themselves with \r
                if text:
                    self._line(text, transient=True)
            else:
                self._line(text, transient=False)

    def _line(self, text: str, transient: bool) -> None:
        self._queue(text, transient)
        if self._stop_requested:                          # output still arriving while it shuts down
            return
        if "Attempting to connect" in text:
            self._set("connecting", self.port)
        elif text.startswith("[WARN] Could not connect"):
            self._set("retrying", text.split(": ", 1)[-1])
        elif "Waiting for GRBL banner" in text:
            self._silence.start()
        elif text.startswith("[READY]"):
            self._silence.stop()
            self.hint.emit("")
            self._set("connected")
        elif "Listening for new orders" in text:
            self._set("listening")
        elif text.startswith("[PRINT] Printing:"):
            self._engraving = text.split(":", 1)[1].strip()
            self._set("engraving", self._engraving)
        elif text.startswith("[PRINT] ") and " holder" in text:      # one keychain of an order
            self._engraving = text[len("[PRINT] "):].split(":", 1)[0]
            self._set("engraving", self._engraving)
        elif text.startswith("[BLANK] Load a fresh"):
            m = re.search(r"fresh (\w+) blank", text)
            self._set("waiting_blank", m.group(1).lower() if m else "")
        elif text.startswith("[BLANK]") and "loaded" in text:
            self._set("engraving", self._engraving)
        elif text.startswith("[DONE]"):
            self._set("listening")
        elif "Laser connection lost" in text:
            self._set("connecting", self.port)
        if text.startswith("[GRBL]"):
            self._silence.stop()
        for pattern, message in HINTS:
            if pattern.search(text):
                self.hint.emit(message)

    def _queue(self, text: str, transient: bool) -> None:
        self._pending.append((text, transient))
        if not self._flush.isActive():
            self._flush.start()

    def _emit_pending(self) -> None:
        if self._pending:
            batch, self._pending = self._pending, []
            self.output.emit(batch)

    # -- lifecycle -------------------------------------------------------------------------------
    def _finished(self, code: int, _status) -> None:
        self._force.stop()
        self._silence.stop()
        if self._buf:
            self._line(self._buf, transient=False)
            self._buf = ""
        clean = self._stop_requested or code == 0
        self._queue(f"── Agent stopped (exit code {code}) ──", False)
        self._emit_pending()
        self._proc.deleteLater()
        self._proc = None
        self._set("stopped" if clean else "crashed", "" if clean else f"exit code {code}")

    def _error(self, error) -> None:
        if error == QProcess.ProcessError.FailedToStart:
            self._proc.deleteLater()
            self._proc = None
            self._set("crashed", "Node.js couldn't start")

    def _set(self, state: str, detail: str = "") -> None:
        self.state, self.detail = state, detail
        self.state_changed.emit(state, detail)

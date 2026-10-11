"""The operator console: run the printer agent on this PC and watch what it says."""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QIcon, QTextCharFormat, QTextCursor
from PySide6.QtWidgets import (QCheckBox, QComboBox, QFrame, QHBoxLayout, QLabel, QPlainTextEdit,
                               QPushButton, QVBoxLayout, QWidget)

import agent as A
import calibrate_ui as CAL
import tokens as T
from theme import font, theme
from widgets import StatusDot, Stepper, clear_layout, label, micro, set_prop

AGENT_STEPS = ("Started", "Laser", "Listening", "Engraving")

_STATE = {  # state -> (headline, dot tone, stepper: done, active, tone)
    "stopped": ("Not running", "text_3", (0, None, "accent")),
    "starting": ("Starting…", "text_2", (0, 0, "accent")),
    "connecting": ("Connecting to the laser…", "text_2", (1, 1, "accent")),
    "retrying": ("Can't reach the laser, retrying", "warning", (1, 1, "warning")),
    "connected": ("Laser connected", "success", (2, 2, "accent")),
    "listening": ("Ready, waiting for orders", "success", (3, None, "accent")),
    "engraving": ("Engraving", "accent", (3, 3, "accent")),
    "waiting_blank": ("Load a fresh blank", "warning", (3, 3, "warning")),
    "stopping": ("Stopping…", "text_2", (0, None, "accent")),
    "crashed": ("Stopped unexpectedly", "danger", (0, 0, "danger")),
}
_RUNNING = {"starting", "connecting", "retrying", "connected", "listening", "engraving", "waiting_blank",
            "stopping"}


class RunPanel(QWidget):
    """Sidebar section: setup checks, laser port, HOME confirmation, Start/Stop."""

    start_clicked = Signal(str, str)      # agent folder, laser port
    stop_clicked = Signal()
    blank_loaded = Signal()
    choose_folder = Signal()
    calibrate_clicked = Signal(str, str)  # agent folder, laser port

    def __init__(self) -> None:
        super().__init__()
        self._folder: str | None = None
        self._checks_key = None
        self._checks_ok = False
        self._blocked = ""
        self._saved_port: str | None = None
        self._ports_key = None
        self._state = "stopped"
        self._detail = ""

        v = QVBoxLayout(self)
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(T.SP_8)
        v.addWidget(micro("Run on this PC"))
        head = QHBoxLayout()
        head.setSpacing(T.SP_8)
        self.dot = StatusDot()
        self.headline = label("Not running")
        head.addWidget(self.dot, 0, Qt.AlignmentFlag.AlignVCenter)
        head.addWidget(self.headline, 1)
        v.addLayout(head)
        self.detail = label("", "secondary", wrap=True)
        self.detail.hide()
        v.addWidget(self.detail)

        # Shown on PCs that don't have the agent (monitor-only use).
        self.not_here = QWidget()
        nh = QVBoxLayout(self.not_here)
        nh.setContentsMargins(0, 0, 0, 0)
        nh.setSpacing(T.SP_8)
        nh.addWidget(label("Only needed on the printer laptop.", "secondary", wrap=True))
        pick = QPushButton("Choose agent folder")
        pick.setObjectName("Ghost")
        pick.clicked.connect(self.choose_folder)
        nh.addWidget(pick, 0, Qt.AlignmentFlag.AlignLeft)
        v.addWidget(self.not_here)

        # Setup, shown while the agent is stopped.
        self.setup = QWidget()
        sv = QVBoxLayout(self.setup)
        sv.setContentsMargins(0, T.SP_4, 0, 0)
        sv.setSpacing(T.SP_8)
        self.checks = QVBoxLayout()
        self.checks.setSpacing(T.SP_4)
        sv.addLayout(self.checks)

        folder_head = QHBoxLayout()
        folder_head.addWidget(label("Agent folder", "secondary"), 1)
        change = QPushButton("Change")
        change.setObjectName("Ghost")
        change.clicked.connect(self.choose_folder)
        folder_head.addWidget(change)
        sv.addSpacing(T.SP_4)
        sv.addLayout(folder_head)
        self.folder_label = label("", "primary", wrap=True, selectable=True)
        sv.addWidget(self.folder_label)

        sv.addSpacing(T.SP_4)
        sv.addWidget(label("Laser port", "secondary"))
        self.port = QComboBox()
        self.port.setPlaceholderText("Pick the laser's port")
        self.port.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
        self.port.setMinimumContentsLength(T.SP_12)
        self.port.view().setMinimumWidth(T.SIDEBAR_W + T.SP_48)
        self.port.currentIndexChanged.connect(self._update_start)
        sv.addWidget(self.port)
        sv.addWidget(label("Not sure? Unplug the laser's USB cable: the port that disappears is the laser.",
                           "tertiary", wrap=True))

        holders_head = QHBoxLayout()
        holders_head.addWidget(label("Holders", "secondary"), 1)
        self.calibrate_btn = QPushButton("Calibrate")
        self.calibrate_btn.setObjectName("Ghost")
        self.calibrate_btn.clicked.connect(self._calibrate)
        holders_head.addWidget(self.calibrate_btn)
        sv.addSpacing(T.SP_4)
        sv.addLayout(holders_head)
        self.holders_label = label("", "primary", wrap=True)
        sv.addWidget(self.holders_label)

        self.home = QCheckBox("The laser head is at HOME")
        self.home.toggled.connect(self._update_start)
        sv.addSpacing(T.SP_4)
        sv.addWidget(self.home)
        sv.addWidget(label("Wherever the head is when the agent connects becomes HOME, "
                           "and every keychain is placed from it.", "tertiary", wrap=True))

        self.start_btn = QPushButton("Start printing")
        self.start_btn.setObjectName("Primary")
        self.start_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.start_btn.clicked.connect(self._start)
        sv.addSpacing(T.SP_4)
        sv.addWidget(self.start_btn)
        self.reason = label("", "secondary", wrap=True)
        sv.addWidget(self.reason)
        v.addWidget(self.setup)

        # Shown while the agent waits for the operator to reload a holder.
        self.blank_btn = QPushButton("Fresh blank loaded")
        self.blank_btn.setObjectName("Primary")
        self.blank_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.blank_btn.clicked.connect(self.blank_loaded)
        v.addWidget(self.blank_btn)

        # Shown while the agent runs.
        self.stop_btn = QPushButton("Stop printing")
        self.stop_btn.setObjectName("Danger")
        self.stop_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.stop_btn.clicked.connect(self.stop_clicked)
        v.addWidget(self.stop_btn)
        self.retheme()
        self.set_state("stopped", "")

    # -- inputs from the window --------------------------------------------------------------
    def set_folder(self, folder: str | None) -> None:
        self._folder = folder
        self.folder_label.setText(folder or "Not found")
        self._checks_key = None
        self.refresh_checks()
        self.refresh_holders()
        self._apply_visibility()

    def refresh_holders(self) -> None:
        text, tone = CAL.summary(self._folder)
        self.holders_label.setText(text)
        set_prop(self.holders_label, "role", tone)

    def set_saved_port(self, port: str | None) -> None:
        self._saved_port = port or None

    def set_ports(self, ports: list) -> None:
        key = tuple(p["device"] + p["description"] for p in ports)
        if key == self._ports_key:
            return                                   # unchanged: don't disturb an open dropdown
        self._ports_key = key
        wanted = self.port.currentData() or self._saved_port
        self.port.blockSignals(True)
        self.port.clear()
        for p in ports:
            self.port.addItem(f"{p['device']}  ·  {p['description']}", p["device"])
        self.port.setCurrentIndex(self.port.findData(wanted))    # -1 shows the placeholder
        self.port.blockSignals(False)
        self._update_start()

    def refresh_checks(self) -> None:
        checks = A.preflight(self._folder)
        key = tuple((c.ok, c.label, c.fix) for c in checks)
        if key == self._checks_key:
            return
        self._checks_key = key
        self._checks_ok = all(c.ok for c in checks)
        clear_layout(self.checks)
        for c in checks:
            row = QHBoxLayout()
            row.setSpacing(T.SP_8)
            icon = QLabel()
            icon.setPixmap(theme.icon("check" if c.ok else "alert", "success" if c.ok else "warning"))
            row.addWidget(icon, 0, Qt.AlignmentFlag.AlignTop)
            text = QVBoxLayout()
            text.setSpacing(0)
            text.addWidget(label(c.label, "primary" if c.ok else "warning", wrap=True))
            if not c.ok and c.fix:
                text.addWidget(label(c.fix, "secondary", wrap=True, selectable=True))
            row.addLayout(text, 1)
            self.checks.addLayout(row)
        self._update_start()

    def set_blocked(self, reason: str) -> None:
        if reason != self._blocked:
            self._blocked = reason
            self._update_start()

    def set_state(self, state: str, detail: str) -> None:
        self._state, self._detail = state, detail
        text, tone, _ = _STATE.get(state, _STATE["stopped"])
        self.headline.setText(text)
        self.dot.set_state(tone, False)              # the printer panel owns the app's one pulse
        shown = {"engraving": detail, "connecting": detail and f"on {detail}", "retrying": detail,
                 "crashed": detail,
                 "waiting_blank": f"Put a new {detail} blank in the {detail} holder, then press the button."
                 }.get(state, "")
        self.detail.setText(shown or "")
        self.detail.setVisible(bool(shown))
        self._apply_visibility()

    def reset_home(self) -> None:
        self.home.setChecked(False)                  # confirm HOME again before every start

    def retheme(self) -> None:
        self.start_btn.setIcon(QIcon(theme.icon("play", "on_accent")))
        self.stop_btn.setIcon(QIcon(theme.icon("stop", "danger")))
        self.blank_btn.setIcon(QIcon(theme.icon("check", "on_accent")))
        self._checks_key = None
        self.refresh_checks()
        self.set_state(self._state, self._detail)

    # -- internals ---------------------------------------------------------------------------------
    def _apply_visibility(self) -> None:
        running = self._state in _RUNNING
        self.not_here.setVisible(not self._folder and not running)
        self.setup.setVisible(bool(self._folder) and not running)
        self.blank_btn.setVisible(self._state == "waiting_blank")
        self.stop_btn.setVisible(running)
        self.stop_btn.setEnabled(self._state != "stopping")

    def _update_start(self) -> None:
        reason = ""
        if not self._checks_ok:
            reason = "Fix the items marked above to start."
        elif self._blocked:
            reason = self._blocked
        elif not self.port.currentData():
            reason = "Pick the laser's port."
        elif not self.home.isChecked():
            reason = "Move the head to HOME, then tick the box."
        self.start_btn.setEnabled(not reason)
        self.reason.setText(reason)
        self.reason.setVisible(bool(reason))
        has_port = bool(self.port.currentData())
        self.calibrate_btn.setEnabled(has_port)
        self.calibrate_btn.setToolTip("" if has_port else "Pick the laser's port first.")

    def _start(self) -> None:
        if self._folder and self.port.currentData():
            self.start_clicked.emit(self._folder, self.port.currentData())

    def _calibrate(self) -> None:
        if self._folder and self.port.currentData():
            self.calibrate_clicked.emit(self._folder, self.port.currentData())


class HintBar(QFrame):
    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("Banner")
        h = QHBoxLayout(self)
        h.setContentsMargins(T.SP_12, T.SP_8, T.SP_12, T.SP_8)
        h.setSpacing(T.SP_8)
        self._icon = QLabel()
        self._text = label("", "primary", wrap=True)
        h.addWidget(self._icon, 0, Qt.AlignmentFlag.AlignTop)
        h.addWidget(self._text, 1)
        self.retheme()
        self.hide()

    def set_text(self, text: str) -> None:
        self._text.setText(text)
        self.setVisible(bool(text))

    def retheme(self) -> None:
        self._icon.setPixmap(theme.icon("alert", "warning"))


class LogPanel(QFrame):
    """Under the orders table: the agent's progress steps, a plain-English hint when
    something is wrong, and its live output."""

    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("LogPanel")
        v = QVBoxLayout(self)
        v.setContentsMargins(T.SP_16, T.SP_8, T.SP_16, T.SP_12)
        v.setSpacing(T.SP_8)
        head = QHBoxLayout()
        head.setSpacing(T.SP_24)
        head.addWidget(micro("Agent output"))
        self.stepper = Stepper(AGENT_STEPS)
        self.stepper.setFixedWidth(T.SP_48 * 8)
        head.addWidget(self.stepper)
        head.addStretch(1)
        clear = QPushButton("Clear")
        clear.setObjectName("Ghost")
        clear.clicked.connect(self._clear)
        head.addWidget(clear)
        v.addLayout(head)
        self.hint = HintBar()
        v.addWidget(self.hint)
        self.view = QPlainTextEdit()
        self.view.setObjectName("Log")
        self.view.setReadOnly(True)
        self.view.setMaximumBlockCount(T.LOG_MAX_LINES)
        self.view.setFont(font(mono=True))
        self.view.setPlaceholderText("The printer agent isn't running on this PC. Start it from the left.")
        v.addWidget(self.view, 1)
        self._transient_tag: str | None = None

    def set_state(self, state: str) -> None:
        self.stepper.set_state(*_STATE.get(state, _STATE["stopped"])[2])

    def set_hint(self, text: str) -> None:
        self.hint.set_text(text)

    def append(self, batch: list) -> None:
        bar = self.view.verticalScrollBar()
        follow = bar.value() >= bar.maximum() - T.SP_4
        doc = self.view.document()
        cur = QTextCursor(doc)
        cur.movePosition(QTextCursor.MoveOperation.End)
        for text, transient in batch:
            tag = text.split("]", 1)[0] if text.startswith("[") else None
            fmt = self._format(text)
            if self._transient_tag is not None and tag == self._transient_tag:
                # A progress line rewrites itself instead of scrolling a new line per percent.
                cur.movePosition(QTextCursor.MoveOperation.StartOfBlock, QTextCursor.MoveMode.KeepAnchor)
                cur.removeSelectedText()
            elif not doc.isEmpty():
                cur.insertBlock()
            cur.insertText(text, fmt)
            self._transient_tag = tag if transient else None
        if follow:
            bar.setValue(bar.maximum())

    def retheme(self) -> None:
        self.hint.retheme()
        self.stepper.update()

    def _clear(self) -> None:
        self.view.clear()
        self._transient_tag = None

    @staticmethod
    def _format(text: str) -> QTextCharFormat:
        low = text.lower()
        if text.startswith("──"):
            tone = "text_3"
        elif text.startswith("[FAIL]") or "[ERROR]" in text or "error:" in low:
            tone = "danger"
        elif text.startswith(("[WARN]", "[BLANK] Load")) or "failed" in low:
            tone = "warning"
        elif text.startswith(("[READY]", "[DONE]")):
            tone = "success"
        elif text.startswith(("[GRBL]", "[PRINT]")):
            tone = "text_1"
        else:
            tone = "text_2"
        fmt = QTextCharFormat()
        fmt.setForeground(theme.c(tone))
        return fmt

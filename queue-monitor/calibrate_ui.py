"""Calibrate holders: teach the printer agent where each keychain holder sits on the bed.

Talks to the laser directly (through grbl_link) while the agent is stopped. The
operator jogs the head over the middle of each holder and saves that spot to
holders.json in the agent folder, which the agent reads when it starts. The
laser is never switched on: tracing an outline moves the head with the laser off.
"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

from PySide6.QtCore import QPointF, Qt
from PySide6.QtGui import QFont, QIcon, QKeySequence, QPainter, QPainterPath, QPen, QShortcut
from PySide6.QtWidgets import (QButtonGroup, QDialog, QFrame, QGridLayout, QHBoxLayout, QPushButton,
                               QVBoxLayout, QWidget)

import grbl_link as G
import tokens as T
from theme import font, theme
from widgets import StatusDot, label, micro, set_prop

SHAPES = (("rectangle", "Rectangle"), ("circle", "Circle"), ("heart", "Heart"))
STEPS_MM = (10.0, 1.0, 0.1)
HOLDERS_FILE = "holders.json"


# -- holders.json --------------------------------------------------------------------------------
def load_holders(folder: str) -> tuple[dict, str]:
    """The saved holders, and an error text if the file exists but can't be read."""
    try:
        data = json.loads((Path(folder) / HOLDERS_FILE).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}, ""
    except (OSError, ValueError) as e:
        return {}, f"{HOLDERS_FILE} couldn't be read ({e}). Saving a holder will replace it."
    return (data, "") if isinstance(data, dict) else ({}, f"{HOLDERS_FILE} isn't a list of holders.")


def centre(holders: dict, shape: str) -> tuple[float, float] | None:
    """A holder's saved centre, checked the same way the agent checks it."""
    c = holders.get(shape)
    if not isinstance(c, dict):
        return None
    x, y = c.get("x"), c.get("y")
    ok = all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (x, y))
    return (float(x), float(y)) if ok else None


def save_holder(folder: str, shape: str, x: float, y: float) -> dict:
    """Merge one holder's centre into holders.json; the other holders are kept."""
    path = Path(folder) / HOLDERS_FILE
    holders, _ = load_holders(folder)
    holders[shape] = {"x": round(x, 2), "y": round(y, 2),
                      "savedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    tmp = path.with_name(HOLDERS_FILE + ".tmp")
    tmp.write_text(json.dumps(holders, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)                  # all or nothing: never leaves half a file behind
    return holders


def summary(folder: str | None) -> tuple[str, str]:
    """One line for the Run panel: how many holders are set, and its tone."""
    if not folder:
        return "", "secondary"
    holders, error = load_holders(folder)
    if error:
        return error, "warning"
    missing = [name.lower() for key, name in SHAPES if centre(holders, key) is None]
    if not missing:
        return "All 3 calibrated", "primary"
    if len(missing) == len(SHAPES):
        return "Not calibrated: every keychain would print at HOME", "warning"
    return f"{len(SHAPES) - len(missing)} of 3 calibrated ({', '.join(missing)} not set)", "warning"


def mm(v: float) -> str:
    return f"{v:.2f}"


# -- widgets -------------------------------------------------------------------------------------
class ShapeGlyph(QWidget):
    """The keychain's engraved border, drawn small, so each holder row is recognisable."""

    def __init__(self, shape: str) -> None:
        super().__init__()
        self._pts = G.outline(shape)
        self.setFixedSize(T.SP_32, T.SP_32)

    def paintEvent(self, _e) -> None:
        xs, ys = [p[0] for p in self._pts], [p[1] for p in self._pts]
        scale = (self.width() - T.SP_4) / max(max(xs) - min(xs), max(ys) - min(ys))
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        path = QPainterPath()
        for i, (x, y) in enumerate(self._pts):
            pt = QPointF(self.width() / 2 + (x - cx) * scale, self.height() / 2 - (y - cy) * scale)
            path.moveTo(pt) if i == 0 else path.lineTo(pt)
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setPen(QPen(theme.c("text_2"), 1.5))
        p.drawPath(path)


def card() -> tuple[QFrame, QVBoxLayout]:
    frame = QFrame()
    frame.setObjectName("Card")
    v = QVBoxLayout(frame)
    v.setContentsMargins(T.SP_16, T.SP_16, T.SP_16, T.SP_16)
    v.setSpacing(T.SP_12)
    return frame, v


def button(text: str, name: str = "") -> QPushButton:
    b = QPushButton(text)
    if name:
        b.setObjectName(name)
    b.setCursor(Qt.CursorShape.PointingHandCursor)
    return b


# -- the window ----------------------------------------------------------------------------------
class CalibrateDialog(QDialog):
    def __init__(self, folder: str, port: str, parent: QWidget | None = None,
                 link: G.GrblLink | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Calibrate holders")
        self.setModal(True)
        self.setMinimumWidth(T.SIDEBAR_W + T.PRIMARY_MIN_W)     # height follows the content
        self._folder, self._port = folder, port
        self._state = "idle"               # idle, connecting, connected, closing
        self._busy = False
        self._done = False
        self._step = STEPS_MM[0]
        self.holders, load_error = load_holders(folder)

        self.link = link or G.GrblLink()
        queued = Qt.ConnectionType.QueuedConnection     # the link reports from its own thread
        self.link.position.connect(self._on_position, queued)
        self.link.connected_changed.connect(self._on_connected, queued)
        self.link.busy.connect(self._on_busy, queued)
        self.link.message.connect(self._show_message, queued)
        self.link.closed.connect(self._on_closed, queued)

        v = QVBoxLayout(self)
        v.setContentsMargins(T.SP_24, T.SP_24, T.SP_24, T.SP_24)
        v.setSpacing(T.SP_16)
        v.addWidget(self._build_connect())
        body = QHBoxLayout()
        body.setSpacing(T.SP_16)
        body.addWidget(self._build_head(), 0)
        body.addWidget(self._build_holders(), 1)
        v.addLayout(body, 1)
        v.addLayout(self._build_footer())

        for key, dx, dy in ((Qt.Key.Key_Up, 0, 1), (Qt.Key.Key_Down, 0, -1),
                            (Qt.Key.Key_Left, -1, 0), (Qt.Key.Key_Right, 1, 0)):
            sc = QShortcut(QKeySequence(key), self)
            sc.setAutoRepeat(False)        # holding a key must not queue a run of moves
            sc.activated.connect(lambda dx=dx, dy=dy: self._jog(dx, dy))

        self._retheme()
        theme.changed.connect(self._retheme)
        self._refresh_rows()
        self._apply_state()
        if load_error:
            self._show_message(load_error, "warning")

    # -- layout ------------------------------------------------------------------------------
    def _build_connect(self) -> QFrame:
        frame, v = card()
        head = QHBoxLayout()
        head.setSpacing(T.SP_8)
        self.dot = StatusDot()
        self.headline = label("Not connected", weight=QFont.Weight.DemiBold)
        head.addWidget(self.dot, 0, Qt.AlignmentFlag.AlignVCenter)
        head.addWidget(self.headline, 1)
        self.connect_btn = button(f"Connect on {self._port}", "Primary")
        self.connect_btn.clicked.connect(self._connect)
        head.addWidget(self.connect_btn)
        v.addLayout(head)
        self.intro = label("Push the laser head into the HOME corner by hand, then connect. Where the head is "
                           "when you connect becomes HOME, the same as when printing starts. "
                           "The laser stays off the whole time.", "secondary", wrap=True)
        v.addWidget(self.intro)
        return frame

    def _build_head(self) -> QFrame:
        frame, v = card()
        frame.setFixedWidth(T.SIDEBAR_W)
        v.addWidget(micro("Head position"))
        readout = QGridLayout()
        readout.setHorizontalSpacing(T.SP_8)
        readout.setVerticalSpacing(0)
        self.pos_x = label("—", size=T.SIZE_DISPLAY, weight=QFont.Weight.DemiBold)
        self.pos_y = label("—", size=T.SIZE_DISPLAY, weight=QFont.Weight.DemiBold)
        for row, (axis, value) in enumerate((("X", self.pos_x), ("Y", self.pos_y))):
            value.setFont(font(T.SIZE_DISPLAY, QFont.Weight.DemiBold, tabular=True))
            readout.addWidget(label(axis, "tertiary", weight=QFont.Weight.DemiBold), row, 0,
                              Qt.AlignmentFlag.AlignVCenter)
            readout.addWidget(value, row, 1)
            readout.addWidget(label("mm", "tertiary"), row, 2, Qt.AlignmentFlag.AlignVCenter)
        readout.setColumnStretch(3, 1)
        v.addLayout(readout)
        self.motion = label("", "secondary")
        v.addWidget(self.motion)

        v.addWidget(micro("Step"))
        steps = QHBoxLayout()
        steps.setSpacing(T.SP_4)
        self.step_group = QButtonGroup(self)
        for i, step in enumerate(STEPS_MM):
            b = button(f"{step:g} mm", "Segment")
            b.setCheckable(True)
            b.setChecked(i == 0)
            b.clicked.connect(lambda _c=False, s=step: setattr(self, "_step", s))
            self.step_group.addButton(b)
            steps.addWidget(b, 1)
        v.addLayout(steps)

        pad = QGridLayout()
        pad.setSpacing(T.SP_4)
        self.move_btns: list[QPushButton] = []
        self._arrows: list[tuple[QPushButton, str]] = []
        for icon, tip, r, c, dx, dy in (("arrow-up", "Y +", 0, 1, 0, 1), ("arrow-left", "X −", 1, 0, -1, 0),
                                        ("arrow-right", "X +", 1, 2, 1, 0), ("arrow-down", "Y −", 2, 1, 0, -1)):
            b = button("")
            b.setFixedHeight(T.CONTROL_H + T.SP_8)
            b.setToolTip(f"Move {tip}")
            b.clicked.connect(lambda _c=False, dx=dx, dy=dy: self._jog(dx, dy))
            pad.addWidget(b, r, c)
            self.move_btns.append(b)
            self._arrows.append((b, icon))
        self.home_btn = button("HOME")
        self.home_btn.setFixedHeight(T.CONTROL_H + T.SP_8)
        self.home_btn.setToolTip("Move the head back to HOME")
        self.home_btn.clicked.connect(self._go_home)
        pad.addWidget(self.home_btn, 1, 1)
        self.move_btns.append(self.home_btn)
        v.addLayout(pad)
        v.addWidget(label("The arrow keys move one step too. Up adds to Y and right adds to X: watch "
                          "the numbers to see which way that is on your laser.", "tertiary", wrap=True))
        v.addStretch(1)
        return frame

    def _build_holders(self) -> QFrame:
        frame, v = card()
        v.addWidget(micro("Holders"))
        v.addWidget(label("Move the head until the laser points at the middle of a holder, then press "
                          "Save here. Trace runs the head along that keychain's border, laser off, so you "
                          "can check it sits inside the holder.", "secondary", wrap=True))
        self.rows: dict[str, dict] = {}
        for key, name in SHAPES:
            line = QFrame()
            line.setObjectName("HolderRow")
            h = QHBoxLayout(line)
            h.setContentsMargins(0, T.SP_8, 0, T.SP_8)
            h.setSpacing(T.SP_12)
            h.addWidget(ShapeGlyph(key), 0, Qt.AlignmentFlag.AlignVCenter)
            text = QVBoxLayout()
            text.setSpacing(0)
            text.addWidget(label(name, weight=QFont.Weight.DemiBold))
            saved = label("", "secondary")
            saved.setFont(font(T.SIZE_BODY, tabular=True))
            text.addWidget(saved)
            h.addLayout(text, 1)
            save = button("Save here", "Primary")
            save.clicked.connect(lambda _c=False, k=key: self._save(k))
            goto = button("Go to", "Ghost")
            goto.clicked.connect(lambda _c=False, k=key: self._go_to(k))
            trace = button("Trace", "Ghost")
            trace.clicked.connect(lambda _c=False, k=key: self._trace(k))
            for b in (goto, trace, save):
                h.addWidget(b, 0, Qt.AlignmentFlag.AlignVCenter)
            v.addWidget(line)
            self.rows[key] = {"saved": saved, "save": save, "goto": goto, "trace": trace}
        v.addStretch(1)
        v.addWidget(label("The printer agent reads the holders when it starts, so the next "
                          "Start printing uses what you save here.", "tertiary", wrap=True))
        return frame

    def _build_footer(self) -> QHBoxLayout:
        h = QHBoxLayout()
        h.setSpacing(T.SP_12)
        self.message = label("", "secondary", wrap=True)
        h.addWidget(self.message, 1)
        self.done_btn = button("Done", "Primary")
        self.done_btn.setDefault(False)
        self.done_btn.setAutoDefault(False)
        self.done_btn.clicked.connect(self._finish)
        h.addWidget(self.done_btn, 0, Qt.AlignmentFlag.AlignBottom)
        return h

    # -- actions ---------------------------------------------------------------------------------
    def _ready(self) -> bool:
        return self._state == "connected" and not self._busy

    def _connect(self) -> None:
        if self._state == "idle":
            self._state = "connecting"
            self.link.connect_port(self._port)
            self._apply_state()

    def _jog(self, dx: int, dy: int) -> None:
        if self._ready():
            self.link.jog(dx * self._step, dy * self._step)

    def _go_home(self) -> None:
        if self._ready():
            self.link.go_home()

    def _go_to(self, shape: str) -> None:
        c = centre(self.holders, shape)
        if self._ready() and c:
            self.link.go_to(*c)

    def _trace(self, shape: str) -> None:
        c = centre(self.holders, shape)
        if self._ready() and c:
            self.link.trace(shape, *c)

    def _save(self, shape: str) -> None:
        if not self._ready():
            return
        x, y = self.link.x, self.link.y
        try:
            self.holders = save_holder(self._folder, shape, x, y)
        except OSError as e:
            self._show_message(f"Couldn't save {HOLDERS_FILE}: {e}", "danger")
            return
        self._refresh_rows()
        self._show_message(f"{shape.capitalize()} holder saved at X {mm(x)}, Y {mm(y)} mm.", "success")

    def _finish(self) -> None:
        """Done, Esc or the close box: return the head to HOME and free the port, then close."""
        if self._state in ("connecting", "connected"):
            self._state = "closing"
            self.link.disconnect_port()     # runs after any move already under way
            self._show_message("Returning the head to HOME…", "secondary")
            self._apply_state()
        elif self._state == "idle":
            self._close_now()

    def _close_now(self) -> None:
        self._done = True
        self.link.shutdown()
        self.accept()

    def reject(self) -> None:               # Esc
        self._finish()

    def closeEvent(self, e) -> None:
        if self._done:
            super().closeEvent(e)
            return
        e.ignore()
        self._finish()

    # -- from the link ---------------------------------------------------------------------------
    def _on_position(self, x: float, y: float, state: str) -> None:
        self.pos_x.setText(mm(x))
        self.pos_y.setText(mm(y))

    def _on_connected(self, connected: bool) -> None:
        if connected and self._state == "connecting":
            self._state = "connected"
        elif not connected and self._state != "closing":
            self._state = "idle"           # the link dropped (cable pulled, alarm)
        self._apply_state()

    def _on_busy(self, busy: bool) -> None:
        self._busy = busy
        if not busy and self._state == "connecting" and not self.link.connected:
            self._state = "idle"           # the connect failed; its message says why
        self._apply_state()

    def _on_closed(self) -> None:
        if self._state == "closing":
            self._close_now()

    def _show_message(self, text: str, tone: str) -> None:
        self.message.setText(text)
        set_prop(self.message, "role", tone)
        self._fit()

    # -- state -----------------------------------------------------------------------------------
    def _apply_state(self) -> None:
        s = self._state
        headline, tone = {
            "idle": ("Not connected", "text_3"),
            "connecting": ("Connecting…", "text_2"),
            "connected": (f"Connected on {self._port}", "success"),
            "closing": ("Returning to HOME…", "text_2"),
        }[s]
        self.headline.setText(headline)
        self.dot.set_state(tone, False)    # the printer panel owns the app's one pulse
        self.connect_btn.setVisible(s in ("idle", "connecting"))
        self.connect_btn.setEnabled(s == "idle")
        self.connect_btn.setText("Connecting…" if s == "connecting" else f"Connect on {self._port}")
        self.intro.setVisible(s in ("idle", "connecting"))

        live = s == "connected"
        self.motion.setText("Moving…" if live and self._busy else "")
        if not live:
            self.pos_x.setText("—")
            self.pos_y.setText("—")
        for b in self.move_btns + self.step_group.buttons():
            b.setEnabled(live)
        for key, row in self.rows.items():
            has = centre(self.holders, key) is not None
            row["save"].setEnabled(live)
            row["goto"].setEnabled(live and has)
            row["trace"].setEnabled(live and has)
        self.done_btn.setEnabled(s != "closing")
        self._fit()

    def _fit(self) -> None:
        """Keep the window tall enough for its content at its width, wrapped text included
        (Qt's own minimum size measures wrapped text as one long line and would squeeze the jog pad)."""
        layout = self.layout()
        if layout is None:
            return
        layout.activate()
        need = layout.totalHeightForWidth(max(self.width(), self.minimumWidth()))
        self.setMinimumHeight(need)
        if self.height() < need:
            self.resize(self.width(), need)

    def _refresh_rows(self) -> None:
        for key, row in self.rows.items():
            c = centre(self.holders, key)
            row["saved"].setText(f"X {mm(c[0])}  ·  Y {mm(c[1])} mm" if c else "Not set")
            set_prop(row["saved"], "role", "secondary" if c else "warning")
        self._apply_state()

    def _retheme(self) -> None:
        for b, icon in self._arrows:
            b.setIcon(QIcon(theme.icon(icon, "text_1")))    # Qt dims it when the button is disabled

    def showEvent(self, e) -> None:
        super().showEvent(e)
        self._fit()
        theme.style_titlebar(self)

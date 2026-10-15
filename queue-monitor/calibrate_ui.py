"""Test holders: see, test and correct where the three holders are.

While the printer agent is stopped, this window talks to the laser itself
(grbl_link). Connect homes the machine. The bed view shows the three holders
from the agent's machine.json and the head's live position. For each holder
the head can go to its centre, trace its border with the laser off, or draw
the border at low power. Jog onto a holder's real centre and Save here to
correct machine.json; the printer agent uses it the next time it starts.
"""
from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QFont, QIcon, QKeySequence, QPainter, QPainterPath, QPen, QShortcut
from PySide6.QtWidgets import (QButtonGroup, QDialog, QFrame, QGridLayout, QHBoxLayout, QMessageBox,
                               QPushButton, QVBoxLayout, QWidget)

import grbl_link as G
import machine as M
import tokens as T
from theme import font, theme
from widgets import StatusDot, label, micro, set_prop

NAMES = {"heart": "Heart", "rectangle": "Rectangle", "circle": "Circle"}
STEPS_MM = (10.0, 1.0, 0.1)
POWERS = ((20, "2%"), (50, "5%"), (100, "10%"))      # S out of 1000; Tejas's shape tests drew at S20


def mm(v: float) -> str:
    return f"{v:.2f}"


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


class ShapeGlyph(QWidget):
    """A holder's border, drawn small, so each row is recognisable."""

    def __init__(self, shape: str, holder: dict) -> None:
        super().__init__()
        self._pts = M.border(shape, holder)
        self.setFixedSize(T.SP_32, T.SP_32)

    def paintEvent(self, _e) -> None:
        xs, ys = [p[0] for p in self._pts], [p[1] for p in self._pts]
        scale = (self.width() - T.SP_4) / max(max(xs) - min(xs), max(ys) - min(ys))
        path = QPainterPath()
        for i, (x, y) in enumerate(self._pts):
            pt = QPointF(self.width() / 2 + x * scale, self.height() / 2 - y * scale)
            path.moveTo(pt) if i == 0 else path.lineTo(pt)
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setPen(QPen(theme.c("text_2"), 1.5))
        p.drawPath(path)


class BedView(QWidget):
    """The bed from above in machine mm (X right, Y up): HOME, the three holders, the head."""

    def __init__(self) -> None:
        super().__init__()
        self._holders: dict = {}
        self._head: tuple[float, float] | None = None
        self._active: str | None = None
        self.setMinimumSize(360, 300)

    def set_holders(self, holders: dict) -> None:
        self._holders = holders
        self.update()

    def set_head(self, xy: tuple[float, float] | None) -> None:
        self._head = xy
        self.update()

    def set_active(self, shape: str | None) -> None:
        self._active = shape
        self.update()

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        hs = self._holders
        x1 = max([h["x"] + h["width"] / 2 for h in hs.values()] + [100]) + 15
        y1 = max([h["y"] + h["height"] / 2 for h in hs.values()] + [100]) + 15
        x0, y0, pad = -10.0, -10.0, T.SP_16
        s = min((self.width() - 2 * pad) / (x1 - x0), (self.height() - 2 * pad - T.SP_16) / (y1 - y0))
        left = (self.width() - (x1 - x0) * s) / 2
        top = (self.height() - T.SP_16 - (y1 - y0) * s) / 2     # centred, room for the axis note

        def to(x: float, y: float) -> QPointF:
            return QPointF(left + (x - x0) * s, top + (y1 - y) * s)

        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(theme.c("surface_0"))
        p.drawRoundedRect(QRectF(to(x0, y1), to(x1, y0)), T.R_CONTROL, T.R_CONTROL)
        for g in range(0, int(max(x1, y1)) + 1, 10):                       # 10 mm grid
            p.setPen(QPen(theme.c("hairline_st" if g % 50 == 0 else "hairline"), 1))
            if g <= x1:
                p.drawLine(to(g, y0), to(g, y1))
            if g <= y1:
                p.drawLine(to(x0, g), to(x1, g))

        p.setFont(font(T.SIZE_MICRO, QFont.Weight.DemiBold, track_em=T.TRACK_MICRO))
        p.setPen(QPen(theme.c("text_2"), 1.5))
        home = to(0, 0)
        p.drawLine(home + QPointF(-6, 0), home + QPointF(6, 0))
        p.drawLine(home + QPointF(0, -6), home + QPointF(0, 6))
        p.drawText(home + QPointF(8, -6), "HOME")
        p.setPen(theme.c("text_3"))
        p.drawText(QRectF(to(x0, y0), to(x1, y0 - 12 / s)).adjusted(0, 2, -4, 0),
                   int(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignTop), "X RIGHT  ·  Y UP  ·  MM")

        for shape, h in hs.items():
            active = shape == self._active
            path = QPainterPath()
            for i, (bx, by) in enumerate(M.border(shape, h)):
                pt = to(h["x"] + bx, h["y"] + by)
                path.moveTo(pt) if i == 0 else path.lineTo(pt)
            p.setBrush(theme.c("accent", 0.10) if active else Qt.BrushStyle.NoBrush)
            p.setPen(QPen(theme.c("accent" if active else "text_2"), 2 if active else 1.5))
            p.drawPath(path)
            c = to(h["x"], h["y"])
            p.drawLine(c + QPointF(-4, 0), c + QPointF(4, 0))
            p.drawLine(c + QPointF(0, -4), c + QPointF(0, 4))
            p.setPen(theme.c("text_1" if active else "text_2"))
            under = to(h["x"], h["y"] - h["height"] / 2)
            p.drawText(QRectF(under.x() - 60, under.y() + 4, 120, 14), int(Qt.AlignmentFlag.AlignHCenter),
                       NAMES[shape].upper())

        if self._head is not None:
            c = to(*self._head)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(theme.c("accent", 0.25))
            p.drawEllipse(c, 9, 9)
            p.setBrush(theme.c("accent"))
            p.drawEllipse(c, 4, 4)


class TestHoldersDialog(QDialog):
    def __init__(self, folder: str, port: str, parent: QWidget | None = None,
                 link: G.GrblLink | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Test holders")
        self.setModal(True)
        self.setMinimumWidth(T.SIDEBAR_W + T.PRIMARY_MIN_W + T.SP_48 * 4)
        self._folder, self._port = folder, port
        self._state = "idle"               # idle, connecting, connected, closing
        self._busy = False
        self._done = False
        self._draw_ok = False              # the operator confirmed drawing with the laser once
        self._step = STEPS_MM[0]
        self._power = POWERS[0][0]
        self.holders, load_error = M.load(folder)

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
        body.addWidget(self._build_bed(), 1)
        side = QVBoxLayout()
        side.setSpacing(T.SP_16)
        side.addWidget(self._build_head())
        side.addWidget(self._build_holders(), 1)
        body.addLayout(side, 0)
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
            self._show_message(load_error, "danger")

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
        self.intro = label("Put a blank in each holder and clear the bed, then connect. The laser homes itself "
                           "first. Trace moves the head around a holder's border with the laser off; Draw "
                           "burns that border at low power so you can see exactly where a keychain will go.",
                           "secondary", wrap=True)
        v.addWidget(self.intro)
        return frame

    def _build_bed(self) -> QFrame:
        frame, v = card()
        v.addWidget(micro("The bed"))
        self.bed = BedView()
        self.bed.set_holders(self.holders)
        v.addWidget(self.bed, 1)
        return frame

    def _build_head(self) -> QFrame:
        frame, v = card()
        v.addWidget(micro("Head position · machine mm"))
        readout = QHBoxLayout()
        readout.setSpacing(T.SP_8)
        self.pos_x = label("—", size=T.SIZE_DISPLAY, weight=QFont.Weight.DemiBold)
        self.pos_y = label("—", size=T.SIZE_DISPLAY, weight=QFont.Weight.DemiBold)
        for axis, value in (("X", self.pos_x), ("Y", self.pos_y)):
            value.setFont(font(T.SIZE_DISPLAY, QFont.Weight.DemiBold, tabular=True))
            readout.addWidget(label(axis, "tertiary", weight=QFont.Weight.DemiBold), 0, Qt.AlignmentFlag.AlignVCenter)
            readout.addWidget(value)
            readout.addSpacing(T.SP_8)
        readout.addStretch(1)
        v.addLayout(readout)
        self.motion = label("", "secondary")
        v.addWidget(self.motion)

        row = QHBoxLayout()
        row.setSpacing(T.SP_16)
        steps_box = QVBoxLayout()
        steps_box.setSpacing(T.SP_4)
        steps_box.addWidget(micro("Step"))
        self.step_group = QButtonGroup(self)
        for i, step in enumerate(STEPS_MM):
            b = button(f"{step:g} mm", "Segment")
            b.setCheckable(True)
            b.setChecked(i == 0)
            b.clicked.connect(lambda _c=False, s=step: setattr(self, "_step", s))
            self.step_group.addButton(b)
            steps_box.addWidget(b)
        steps_box.addStretch(1)
        row.addLayout(steps_box)

        pad = QGridLayout()
        pad.setSpacing(T.SP_4)
        self.move_btns: list[QPushButton] = []
        self._arrows: list[tuple[QPushButton, str]] = []
        for icon, tip, r, c, dx, dy in (("arrow-up", "Y +", 0, 1, 0, 1), ("arrow-left", "X −", 1, 0, -1, 0),
                                        ("arrow-right", "X +", 1, 2, 1, 0), ("arrow-down", "Y −", 2, 1, 0, -1)):
            b = button("")
            b.setFixedSize(T.SP_48 + T.SP_16, T.CONTROL_H + T.SP_8)
            b.setToolTip(f"Move {tip} (or the arrow keys)")
            b.clicked.connect(lambda _c=False, dx=dx, dy=dy: self._jog(dx, dy))
            pad.addWidget(b, r, c)
            self.move_btns.append(b)
            self._arrows.append((b, icon))
        self.home_btn = button("HOME")
        self.home_btn.setFixedSize(T.SP_48 + T.SP_16, T.CONTROL_H + T.SP_8)
        self.home_btn.clicked.connect(self._go_home)
        pad.addWidget(self.home_btn, 1, 1)
        self.move_btns.append(self.home_btn)
        row.addLayout(pad)
        row.addStretch(1)
        v.addLayout(row)
        return frame

    def _build_holders(self) -> QFrame:
        frame, v = card()
        v.setSpacing(T.SP_8)
        v.addWidget(micro("Holders · machine.json"))
        self.rows: dict[str, dict] = {}
        for shape in M.SHAPES:
            holder = self.holders.get(shape)
            line = QFrame()
            line.setObjectName("HolderRow")
            h = QHBoxLayout(line)
            h.setContentsMargins(0, T.SP_8, 0, T.SP_4)
            h.setSpacing(T.SP_8)
            if holder:
                h.addWidget(ShapeGlyph(shape, holder), 0, Qt.AlignmentFlag.AlignVCenter)
            text = QVBoxLayout()
            text.setSpacing(0)
            text.addWidget(label(NAMES[shape], weight=QFont.Weight.DemiBold))
            where = label("", "secondary")
            where.setFont(font(T.SIZE_BODY, tabular=True))
            text.addWidget(where)
            h.addLayout(text, 1)
            buttons = {}
            for key, caption, name, tip in (("goto", "Go to", "Ghost", "Move to the centre, laser off"),
                                            ("trace", "Trace", "Ghost", "Follow the border, laser off"),
                                            ("draw", "Draw", "Ghost", "Burn the border at the chosen low power"),
                                            ("save", "Save here", "Primary", "Make the head's position this holder's centre")):
                b = button(caption, name)
                b.setToolTip(tip)
                b.clicked.connect(lambda _c=False, k=key, s=shape: self._row_action(k, s))
                h.addWidget(b, 0, Qt.AlignmentFlag.AlignVCenter)
                buttons[key] = b
            v.addWidget(line)
            self.rows[shape] = {"where": where, **buttons}

        power = QHBoxLayout()
        power.setSpacing(T.SP_4)
        power.addWidget(label("Draw power", "secondary"), 1)
        self.power_group = QButtonGroup(self)
        for i, (s_value, caption) in enumerate(POWERS):
            b = button(caption, "Segment")
            b.setCheckable(True)
            b.setChecked(i == 0)
            b.clicked.connect(lambda _c=False, sv=s_value: setattr(self, "_power", sv))
            self.power_group.addButton(b)
            power.addWidget(b)
        v.addSpacing(T.SP_8)
        v.addLayout(power)
        self.test_all_btn = button("Trace all 3 (laser off)", "Ghost")
        self.test_all_btn.clicked.connect(self._trace_all)
        v.addWidget(self.test_all_btn)
        v.addStretch(1)
        v.addWidget(label("Saved positions go into machine.json. The printer uses them the next time "
                          "it starts.", "tertiary", wrap=True))
        return frame

    def _build_footer(self) -> QHBoxLayout:
        h = QHBoxLayout()
        h.setSpacing(T.SP_12)
        self.message = label("", "secondary", wrap=True)
        h.addWidget(self.message, 1)
        self.done_btn = button("Done", "Primary")
        self.done_btn.setAutoDefault(False)
        self.done_btn.clicked.connect(self._finish)
        h.addWidget(self.done_btn, 0, Qt.AlignmentFlag.AlignBottom)
        return h

    # -- coordinates -----------------------------------------------------------------------
    def _to_home(self, shape: str) -> tuple[float, float]:
        """A holder's machine.json centre in mm from HOME (where homing stopped)."""
        h = self.holders[shape]
        return h["x"] - self.link.home_mpos[0], h["y"] - self.link.home_mpos[1]

    def _head_machine(self) -> tuple[float, float]:
        return self.link.x + self.link.home_mpos[0], self.link.y + self.link.home_mpos[1]

    # -- actions ---------------------------------------------------------------------------
    def _ready(self) -> bool:
        return self._state == "connected" and not self._busy and bool(self.holders)

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
            self.bed.set_active(None)
            self.link.go_home()

    def _row_action(self, key: str, shape: str) -> None:
        if not self._ready():
            return
        x, y = self._to_home(shape)
        self.bed.set_active(shape)
        if key == "goto":
            self.link.go_to(x, y)
        elif key == "trace":
            self.link.trace(shape, self.holders[shape], x, y, 0)
        elif key == "draw" and self._confirm_draw(shape):
            self.link.trace(shape, self.holders[shape], x, y, self._power)
        elif key == "save":
            self._save(shape)

    def _trace_all(self) -> None:
        if self._ready():
            for shape in M.SHAPES:
                x, y = self._to_home(shape)
                self.link.trace(shape, self.holders[shape], x, y, 0)
            self._show_message("Tracing heart, rectangle and circle in turn (laser off)…", "secondary")

    def _confirm_draw(self, shape: str) -> bool:
        if self._draw_ok:
            return True
        pct = dict(POWERS)[self._power]
        box = QMessageBox(self)
        box.setWindowTitle("Draw with the laser?")
        box.setText("Draw with the laser?")
        box.setInformativeText(f"The laser burns the {NAMES[shape].lower()} border at {pct} power on whatever "
                               "is in the holder. Use a scrap blank, keep the lid closed and protect your eyes.")
        box.setIconPixmap(theme.icon("alert", "warning", T.SP_32, stroke=1.5))
        go = box.addButton("Draw", QMessageBox.ButtonRole.AcceptRole)
        box.addButton("Cancel", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        self._draw_ok = box.clickedButton() is go
        return self._draw_ok

    def _save(self, shape: str) -> None:
        old = self.holders[shape]
        mx, my = self._head_machine()
        box = QMessageBox(self)
        box.setWindowTitle(f"Save the {NAMES[shape].lower()} position?")
        box.setText(f"Save the {NAMES[shape].lower()} position?")
        box.setInformativeText(f"Its centre moves from X {mm(old['x'])}, Y {mm(old['y'])} to the head's "
                               f"position, X {mm(mx)}, Y {mm(my)} (machine mm).")
        save = box.addButton("Save", QMessageBox.ButtonRole.AcceptRole)
        box.addButton("Cancel", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        if box.clickedButton() is not save:
            return
        try:
            self.holders = M.save_centre(self._folder, shape, mx, my)
        except (OSError, ValueError, KeyError) as e:
            self._show_message(f"Couldn't save {M.FILE}: {e}", "danger")
            return
        self.bed.set_holders(self.holders)
        self._refresh_rows()
        self._show_message(f"{NAMES[shape]} centre saved at X {mm(mx)}, Y {mm(my)}. The printer uses it the "
                           "next time it starts.", "success")

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

    # -- from the link -----------------------------------------------------------------------
    def _on_position(self, x: float, y: float, _state: str) -> None:
        if self._state != "connected":
            return
        mx, my = x + self.link.home_mpos[0], y + self.link.home_mpos[1]
        self.pos_x.setText(mm(mx))
        self.pos_y.setText(mm(my))
        self.bed.set_head((mx, my))

    def _on_connected(self, connected: bool) -> None:
        if connected and self._state == "connecting":
            self._state = "connected"
            self._on_position(self.link.x, self.link.y, "")
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
            "connecting": ("Connecting and homing…", "text_2"),
            "connected": (f"Connected on {self._port} · homed", "success"),
            "closing": ("Returning to HOME…", "text_2"),
        }[s]
        self.headline.setText(headline)
        self.dot.set_state(tone, False)    # the printer panel owns the app's one pulse
        self.connect_btn.setVisible(s in ("idle", "connecting"))
        self.connect_btn.setEnabled(s == "idle" and bool(self.holders))
        self.connect_btn.setText("Connecting…" if s == "connecting" else f"Connect on {self._port}")

        live = s == "connected"
        self.motion.setText("Moving…" if live and self._busy else "")
        if not live:
            self.pos_x.setText("—")
            self.pos_y.setText("—")
            self.bed.set_head(None)
        for b in self.move_btns + self.step_group.buttons() + self.power_group.buttons() + [self.test_all_btn]:
            b.setEnabled(live)
        for row in self.rows.values():
            for key in ("goto", "trace", "draw", "save"):
                row[key].setEnabled(live)
        self.done_btn.setEnabled(s != "closing")
        self._fit()

    def _refresh_rows(self) -> None:
        for shape, row in self.rows.items():
            h = self.holders.get(shape)
            row["where"].setText(f"X {mm(h['x'])}  ·  Y {mm(h['y'])}  ·  {h['width']:g} × {h['height']:g} mm"
                                 if h else "Not in machine.json")
        self._apply_state()

    def _fit(self) -> None:
        """Keep the window tall enough for its content at its width, wrapped text included."""
        layout = self.layout()
        if layout is None:
            return
        layout.activate()
        need = layout.totalHeightForWidth(max(self.width(), self.minimumWidth()))
        self.setMinimumHeight(need)
        if self.height() < need:
            self.resize(self.width(), need)

    def _retheme(self) -> None:
        for b, icon in self._arrows:
            b.setIcon(QIcon(theme.icon(icon, "text_1")))    # Qt dims it when the button is disabled
        self.bed.update()

    def showEvent(self, e) -> None:
        super().showEvent(e)
        self._fit()
        theme.style_titlebar(self)

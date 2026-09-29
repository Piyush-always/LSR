"""Reusable widgets. Every colour, size and duration comes from tokens via theme."""
from __future__ import annotations

import base64
from datetime import datetime

from PySide6.QtCore import (QAbstractAnimation, QAbstractTableModel, QEasingCurve, QModelIndex,
                            QPointF, QPropertyAnimation, QRectF, QSortFilterProxyModel, Qt,
                            QTimer, QVariantAnimation, Signal)
from PySide6.QtGui import QFont, QFontMetrics, QGuiApplication, QPainter, QPen, QPixmap
from PySide6.QtWidgets import (QApplication, QFrame, QGraphicsOpacityEffect, QGridLayout,
                               QHBoxLayout, QLabel, QPushButton, QScrollArea, QSizePolicy,
                               QStackedWidget, QStyle, QStyledItemDelegate, QStyleOptionViewItem,
                               QVBoxLayout, QWidget)

import shiboken6

import data as D
import tokens as T
from theme import font, theme

SORT_ROLE = Qt.ItemDataRole.UserRole + 1
ORDER_ROLE = Qt.ItemDataRole.UserRole + 2
COLUMNS = ("#", "Status", "Engraving", "Customer", "Placed")
COL_WIDTHS = {0: 56, 1: 104, 3: 152, 4: 96}
PLACED_COL = 4


# -- small helpers ----------------------------------------------------------------------
def set_prop(w: QWidget, name: str, value) -> None:
    """Change a stylesheet-driving property and re-polish so the new rule applies."""
    if w.property(name) == value:
        return
    w.setProperty(name, value)
    w.style().unpolish(w)
    w.style().polish(w)


def label(text: str = "", role: str = "primary", size: int = T.SIZE_BODY,
          weight: QFont.Weight = QFont.Weight.Normal, mono: bool = False,
          wrap: bool = False, track_em: float = 0.0, selectable: bool = False) -> QLabel:
    lab = QLabel(text)
    lab.setFont(font(size, weight, mono, track_em))
    lab.setProperty("role", role)
    lab.setWordWrap(wrap)
    if selectable:
        lab.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
    return lab


def micro(text: str, role: str = "secondary") -> QLabel:
    return label(text.upper(), role, T.SIZE_MICRO, QFont.Weight.DemiBold, track_em=T.TRACK_MICRO)


def display(text: str = "") -> QLabel:
    return label(text, "primary", T.SIZE_DISPLAY, QFont.Weight.DemiBold, track_em=T.TRACK_DISPLAY)


def chip(text: str) -> QLabel:
    lab = micro(text)
    lab.setObjectName("Chip")
    return lab


def clear_layout(layout) -> None:
    while layout.count():
        item = layout.takeAt(0)
        if item.widget():
            item.widget().hide()                  # deletion is deferred; hide now so nothing overlaps
            item.widget().deleteLater()
        elif item.layout():
            clear_layout(item.layout())


def scroll_area(content: QWidget) -> QScrollArea:
    area = QScrollArea()
    area.setWidgetResizable(True)
    area.setFrameShape(QFrame.Shape.NoFrame)
    area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
    content.setObjectName("ScrollContent")
    area.setWidget(content)
    return area


def _animate(anim: QVariantAnimation) -> None:
    if T.MOTION_ENABLED:
        anim.start()


# -- stat card (doubles as a filter tab) ---------------------------------------------------
class StatCard(QFrame):
    clicked = Signal()

    def __init__(self, title: str) -> None:
        super().__init__()
        self.setObjectName("StatCard")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(T.SP_16, T.SP_12, T.SP_16, T.SP_12)
        lay.setSpacing(T.SP_4)
        self.value = display("—")
        self.sub = label("", "secondary")
        lay.addWidget(micro(title))
        lay.addWidget(self.value)
        lay.addWidget(self.sub)

    def set_data(self, value: int | str, sub: str, tone: str) -> None:
        self.value.setText(str(value))
        self.sub.setText(sub)
        set_prop(self.sub, "role", tone)

    def set_selected(self, on: bool) -> None:
        set_prop(self, "selected", "true" if on else "false")

    def mousePressEvent(self, e) -> None:
        if e.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mousePressEvent(e)


# -- status dot with the app's single ambient pulse --------------------------------------
class StatusDot(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.setFixedSize(T.SP_16, T.SP_16)
        self._tone = "text_3"
        self._t = 0.0
        self._anim = QVariantAnimation(self)
        self._anim.setStartValue(0.0)
        self._anim.setEndValue(1.0)
        self._anim.setDuration(T.DUR_AMBIENT)
        self._anim.setLoopCount(-1)
        self._anim.setEasingCurve(QEasingCurve.Type.InOutSine)
        self._anim.valueChanged.connect(self._tick)

    def _tick(self, v) -> None:
        self._t = float(v)
        self.update()

    def set_state(self, tone: str, pulsing: bool) -> None:
        self._tone = tone
        if pulsing and T.MOTION_ENABLED:
            if self._anim.state() != QAbstractAnimation.State.Running:
                self._anim.start()
        else:
            self._anim.stop()
            self._t = 0.0
        self.update()

    def paintEvent(self, _) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setPen(Qt.PenStyle.NoPen)
        c = theme.c(self._tone)
        centre = QPointF(self.width() / 2, self.height() / 2)
        r = T.DOT / 2
        if self._anim.state() == QAbstractAnimation.State.Running:
            halo = theme.c(self._tone, alpha=0.4 * (1.0 - self._t))
            p.setBrush(halo)
            p.drawEllipse(centre, r + r * self._t, r + r * self._t)
        p.setBrush(c)
        p.drawEllipse(centre, r, r)


# -- order lifecycle stepper --------------------------------------------------------------
class Stepper(QWidget):
    LABELS = ("Created", "Paid", "Printing", "Printed")

    def __init__(self, labels: tuple[str, ...] = LABELS) -> None:
        super().__init__()
        self.setFixedHeight(T.SP_48)
        self._labels = labels
        self._done, self._active, self._tone = 0, None, "accent"

    def set_state(self, done: int, active: int | None, tone: str) -> None:
        self._done, self._active, self._tone = done, active, tone
        self.update()

    def paintEvent(self, _) -> None:
        p = QPainter(self)
        p.setRenderHints(QPainter.RenderHint.Antialiasing | QPainter.RenderHint.TextAntialiasing)
        n = len(self._labels)
        pad = T.SP_32
        step = (self.width() - 2 * pad) / (n - 1)
        y = T.SP_12
        r = T.SP_12 / 2
        tone = theme.c(self._tone)
        rail = theme.c("hairline_st")

        for i in range(n - 1):
            filled = i + 1 < self._done or (self._active is not None and i + 1 == self._active)
            p.setPen(QPen(tone if filled else rail, 2))
            p.drawLine(QPointF(pad + i * step + r, y), QPointF(pad + (i + 1) * step - r, y))

        p.setFont(font())
        for i, text in enumerate(self._labels):
            x = pad + i * step
            if i < self._done:
                p.setPen(Qt.PenStyle.NoPen)
                p.setBrush(tone)
                p.drawEllipse(QPointF(x, y), r, r)
                text_tone = "text_1"
            elif i == self._active:
                p.setPen(QPen(tone, 2))
                p.setBrush(theme.c("surface_1"))
                p.drawEllipse(QPointF(x, y), r - 1, r - 1)
                text_tone = "text_1"
            else:
                p.setPen(QPen(rail, 2))
                p.setBrush(Qt.BrushStyle.NoBrush)
                p.drawEllipse(QPointF(x, y), r - 1, r - 1)
                text_tone = "text_3"
            p.setPen(theme.c(text_tone))
            p.drawText(QRectF(x - pad, y + r + T.SP_4, 2 * pad, T.SP_24), Qt.AlignmentFlag.AlignCenter, text)


# -- loading skeleton -----------------------------------------------------------------------
class Skeleton(QWidget):
    COLS = ((56, 0.5), (104, 0.7), (0, 0.55), (152, 0.7), (96, 0.5))

    def __init__(self) -> None:
        super().__init__()
        self._o = 1.0
        self._anim = QVariantAnimation(self)
        self._anim.setStartValue(0.45)
        self._anim.setKeyValueAt(0.5, 1.0)
        self._anim.setEndValue(0.45)
        self._anim.setDuration(T.DUR_AMBIENT)
        self._anim.setLoopCount(-1)
        self._anim.setEasingCurve(QEasingCurve.Type.InOutSine)
        self._anim.valueChanged.connect(self._tick)

    def _tick(self, v) -> None:
        self._o = float(v)
        self.update()

    def showEvent(self, e) -> None:
        _animate(self._anim)
        super().showEvent(e)

    def hideEvent(self, e) -> None:
        self._anim.stop()
        super().hideEvent(e)

    def paintEvent(self, _) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(theme.c("surface_3", alpha=self._o))
        fixed = sum(w for w, _ in self.COLS)
        flex = max(T.SP_48, self.width() - fixed)
        y = T.CONTROL_H
        row = 0
        bar = T.SP_12
        while y + T.ROW_H <= self.height() and row < 14:
            x = 0
            for c, (w, frac) in enumerate(self.COLS):
                width = w or flex
                vary = 0.6 + 0.4 * (((row * 7 + c * 3) % 5) / 4)
                p.drawRoundedRect(QRectF(x + T.SP_12, y + (T.ROW_H - bar) / 2,
                                         max(T.SP_16, (width - 2 * T.SP_12) * frac * vary), bar),
                                  bar / 2, bar / 2)
                x += width
            y += T.ROW_H
            row += 1


# -- empty / error / terminal state -------------------------------------------------------
class StateView(QWidget):
    action = Signal()

    def __init__(self) -> None:
        super().__init__()
        outer = QHBoxLayout(self)
        outer.setContentsMargins(T.SP_24, T.SP_24, T.SP_24, T.SP_24)
        column = QWidget()
        column.setMaximumWidth(T.STATE_TEXT_W)
        column.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        outer.addStretch(1)
        outer.addWidget(column, 100)
        outer.addStretch(1)
        lay = QVBoxLayout(column)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(T.SP_8)
        self._icon = QLabel()
        self._title = label("", "primary", weight=QFont.Weight.DemiBold, wrap=True)
        self._body = label("", "secondary", wrap=True)
        self._button = QPushButton()
        self._button.setObjectName("Ghost")
        self._button.clicked.connect(self.action)
        for w in (self._icon, self._title, self._body):
            w.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        lay.addStretch(1)
        lay.addWidget(self._icon)
        lay.addSpacing(T.SP_4)
        lay.addWidget(self._title)
        lay.addWidget(self._body)
        lay.addSpacing(T.SP_8)
        lay.addWidget(self._button, 0, Qt.AlignmentFlag.AlignHCenter)
        lay.addStretch(1)
        self._spec = ("inbox", "text_3")

    def show_state(self, icon: str, tone: str, title: str, body: str = "", button: str | None = None) -> None:
        self._spec = (icon, tone)
        self._icon.setPixmap(theme.icon(icon, tone, T.SP_32, stroke=1.5))
        self._title.setText(title)
        self._title.setVisible(bool(title))
        self._body.setText(body)
        self._body.setVisible(bool(body))
        self._button.setText(button or "")
        self._button.setVisible(bool(button))

    def retheme(self) -> None:
        self._icon.setPixmap(theme.icon(*self._spec, T.SP_32, stroke=1.5))


# -- recoverable error banner ---------------------------------------------------------------
class Banner(QFrame):
    retry = Signal()

    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("Banner")
        lay = QHBoxLayout(self)
        lay.setContentsMargins(T.SP_12, T.SP_8, T.SP_8, T.SP_8)
        lay.setSpacing(T.SP_8)
        self._icon = QLabel()
        self._text = label("", "primary", wrap=True)
        button = QPushButton("Retry")
        button.setObjectName("Ghost")
        button.clicked.connect(self.retry)
        lay.addWidget(self._icon, 0, Qt.AlignmentFlag.AlignTop)
        lay.addWidget(self._text, 1)
        lay.addWidget(button, 0, Qt.AlignmentFlag.AlignVCenter)
        self.retheme()

    def set_text(self, text: str) -> None:
        self._text.setText(text)

    def retheme(self) -> None:
        self._icon.setPixmap(theme.icon("alert", "warning"))


# -- key / value list -----------------------------------------------------------------------
class KeyValueList(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self._grid = QGridLayout(self)
        self._grid.setContentsMargins(0, 0, 0, 0)
        self._grid.setHorizontalSpacing(T.SP_12)
        self._grid.setVerticalSpacing(T.SP_8)
        self._grid.setColumnMinimumWidth(0, T.KEY_W)
        self._grid.setColumnStretch(1, 1)

    def set_rows(self, rows, extras: dict | None = None) -> None:
        """rows: (label, value, tone, monospace). extras: {label: widget} shown after that value."""
        clear_layout(self._grid)
        extras = extras or {}
        for i, (key, value, tone, mono) in enumerate(rows):
            k = label(key, "secondary", wrap=True)
            k.setFixedWidth(T.KEY_W)
            v = label(value, tone, mono=mono, wrap=True, selectable=True)
            v.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
            self._grid.addWidget(k, i, 0, Qt.AlignmentFlag.AlignTop)
            if key in extras:
                cell = QWidget()
                h = QHBoxLayout(cell)
                h.setContentsMargins(0, 0, 0, 0)
                h.setSpacing(T.SP_8)
                h.addWidget(v, 1)
                h.addWidget(extras[key], 0, Qt.AlignmentFlag.AlignVCenter)
                self._grid.addWidget(cell, i, 1, Qt.AlignmentFlag.AlignTop)
            else:
                self._grid.addWidget(v, i, 1, Qt.AlignmentFlag.AlignTop)


# -- orders table: model, filter/sort proxy, delegate ---------------------------------------
class OrdersModel(QAbstractTableModel):
    def __init__(self) -> None:
        super().__init__()
        self._rows: list[dict] = []
        self._ctx: D.Context | None = None

    def set_orders(self, orders: dict, ctx: D.Context) -> None:
        self.beginResetModel()
        self._rows = list(orders.values())
        self._ctx = ctx
        self.endResetModel()

    def rowCount(self, parent=QModelIndex()) -> int:
        return 0 if parent.isValid() else len(self._rows)

    def columnCount(self, parent=QModelIndex()) -> int:
        return 0 if parent.isValid() else len(COLUMNS)

    def headerData(self, section, orientation, role=Qt.ItemDataRole.DisplayRole):
        if orientation == Qt.Orientation.Horizontal and role == Qt.ItemDataRole.DisplayRole:
            return COLUMNS[section].upper()
        return None

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid():
            return None
        o, col, ctx = self._rows[index.row()], index.column(), self._ctx
        if role == ORDER_ROLE:
            return o
        if role == SORT_ROLE:
            return D.sort_key(o, col, ctx)
        if role == Qt.ItemDataRole.DisplayRole:
            if col == 0:
                qp = o.get("queue_position")
                return str(qp) if qp is not None else "—"
            if col == 1:
                return D.status(o, ctx)[0]
            if col == 2:
                return D.engraving(o)
            if col == 3:
                return D.phone(o)
            return D.rel_time(D.placed_at(o), ctx.now)
        if role == Qt.ItemDataRole.ForegroundRole:
            text = self.data(index)
            if text == "—":
                return theme.c("text_3")
            return theme.c("text_1" if col in (0, 2) else "text_2")
        if role == Qt.ItemDataRole.FontRole and col in (0, 3, PLACED_COL):
            return font(tabular=True)
        if role == Qt.ItemDataRole.TextAlignmentRole:
            return Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter
        return None


class OrdersProxy(QSortFilterProxyModel):
    def __init__(self) -> None:
        super().__init__()
        self._statuses: set | None = None
        self._needle = ""
        self.setSortRole(SORT_ROLE)
        self.setDynamicSortFilter(True)

    def set_statuses(self, statuses: set | None) -> None:
        self._statuses = statuses
        self.invalidateRowsFilter()

    def set_search(self, text: str) -> None:
        self._needle = text.strip().lower()
        self.invalidateRowsFilter()

    @property
    def needle(self) -> str:
        return self._needle

    def filterAcceptsRow(self, row, parent) -> bool:
        o = self.sourceModel().index(row, 0, parent).data(ORDER_ROLE)
        if self._statuses is not None and o.get("status") not in self._statuses:
            return False
        return not self._needle or self._needle in D.haystack(o)


_TONES = {  # tone -> (text token, background token, background alpha or None for token alpha)
    "neutral": ("text_1", "hairline_st", None),
    "muted": ("text_3", "hairline", None),
    "accent": ("accent", "accent", 0.16),
    "success": ("success", "success", 0.16),
    "warning": ("warning", "warning", 0.16),
    "danger": ("danger", "danger", 0.16),
}


def paint_pill(p: QPainter, x: float, cy: float, text: str, tone: str) -> float:
    fg, bg, alpha = _TONES.get(tone, _TONES["muted"])
    f = font(T.SIZE_MICRO, QFont.Weight.DemiBold, track_em=T.TRACK_MICRO)
    text = text.upper()
    w = QFontMetrics(f).horizontalAdvance(text) + 2 * T.SP_8
    rect = QRectF(x, cy - T.PILL_H / 2, w, T.PILL_H)
    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(theme.c(bg, alpha))
    p.drawRoundedRect(rect, T.PILL_H / 2, T.PILL_H / 2)
    p.setFont(f)
    p.setPen(theme.c(fg))
    p.drawText(rect, Qt.AlignmentFlag.AlignCenter, text)
    return w


class OrdersDelegate(QStyledItemDelegate):
    """Paints the status pill and the engraving column (with an IMAGE chip);
    every other column uses the default painter."""

    def paint(self, p, option, index) -> None:
        col = index.column()
        if col not in (1, 2):
            return super().paint(p, option, index)
        opt = QStyleOptionViewItem(option)
        self.initStyleOption(opt, index)
        text = opt.text
        opt.text = ""
        style = opt.widget.style() if opt.widget else QApplication.style()
        style.drawControl(QStyle.ControlElement.CE_ItemViewItem, opt, p, opt.widget)   # background + selection
        o = index.data(ORDER_ROLE)
        p.save()
        p.setRenderHints(QPainter.RenderHint.Antialiasing | QPainter.RenderHint.TextAntialiasing)
        rect = QRectF(option.rect).adjusted(T.SP_12, 0, -T.SP_12, 0)
        cy = rect.center().y()
        if col == 1:
            ctx = index.model().sourceModel()._ctx
            paint_pill(p, rect.left(), cy, text, D.status(o, ctx)[1])
        else:
            x = rect.left()
            if o.get("mode") == "image":
                x += paint_pill(p, x, cy, "Image", "neutral") + T.SP_8
            p.setFont(font())
            p.setPen(theme.c("text_2" if o.get("mode") == "image" else "text_1"))
            fm = QFontMetrics(p.font())
            area = QRectF(x, rect.top(), rect.right() - x, rect.height())
            p.drawText(area, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                       fm.elidedText(text, Qt.TextElideMode.ElideRight, int(area.width())))
        p.restore()


# -- sidebar: printer + COM ports -----------------------------------------------------------
class PrinterPanel(QWidget):
    _STATE = {  # state -> (headline, dot tone, pulse)
        "online": ("Online", "success", True),
        "stalled": ("Stalled", "warning", False),
        "offline": ("Offline", "danger", False),
        "never": ("Never seen", "text_3", False),
        "unknown": ("Unknown", "text_3", False),
        "loading": ("Checking", "text_3", False),
    }

    def __init__(self) -> None:
        super().__init__()
        v = QVBoxLayout(self)
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(T.SP_8)
        v.addWidget(micro("Printer"))
        head = QHBoxLayout()
        head.setSpacing(T.SP_8)
        self.dot = StatusDot()
        self.headline = display()
        head.addWidget(self.dot, 0, Qt.AlignmentFlag.AlignVCenter)
        head.addWidget(self.headline, 1)
        v.addLayout(head)
        self.seen = label("", "secondary", wrap=True)
        v.addWidget(self.seen)
        v.addSpacing(T.SP_8)
        self.details = KeyValueList()
        v.addWidget(self.details)
        v.addSpacing(T.SP_16)
        self.events_title = micro("Recent events")
        v.addWidget(self.events_title)
        self.events = QVBoxLayout()
        self.events.setSpacing(T.SP_4)
        v.addLayout(self.events)
        self._printer: dict | None = None
        self._loaded = False
        self._state = "loading"
        self._show_state("loading", None)
        self.seen.setText("Waiting for the first update…")
        self.events_title.hide()

    def set_snapshot(self, snap: D.Snapshot, now: datetime) -> None:
        if snap.fetched_at is None:
            self._show_state("unknown", None)
            self.seen.setText("Couldn't reach the order database.")
            return
        self._printer = snap.printer
        self._loaded = True
        self.tick(now)
        if not snap.printer:
            self.details.set_rows([])
            clear_layout(self.events)
            self.events_title.hide()
            return
        self.details.set_rows(D.printer_rows(snap.printer, now))
        clear_layout(self.events)
        events = [e for e in (snap.printer.get("events") or []) if isinstance(e, dict)][: T.EVENTS_SHOWN]
        self.events_title.setVisible(bool(events))
        for e in events:
            row = QHBoxLayout()
            row.setSpacing(T.SP_8)
            when = label(D.short_time(D.ms_time(e.get("t"))), "tertiary")
            when.setFixedWidth(T.KEY_W)
            row.addWidget(when, 0, Qt.AlignmentFlag.AlignTop)
            row.addWidget(label(str(e.get("msg", "")), "secondary", wrap=True), 1)
            self.events.addLayout(row)

    def tick(self, now: datetime) -> None:
        """Called every second so 'last seen' and online/offline stay current between refreshes."""
        if not self._loaded:
            return
        state, age = D.printer_state(self._printer, now)
        self._show_state(state, age)
        if state == "never":
            self.seen.setText("No printer has reported to this project yet.")
        else:
            t = self._printer.get("updatedAt")
            self.seen.setText(f"Last seen {D.rel_time(t, now)} · {D.abs_time(t)}")

    def _show_state(self, state: str, _age) -> None:
        self._state = state
        text, tone, pulse = self._STATE[state]
        self.headline.setText(text)
        self.dot.set_state(tone, pulse)


class Sidebar(QFrame):
    def __init__(self, run_panel: QWidget) -> None:
        super().__init__()
        self.setObjectName("Sidebar")
        self.setFixedWidth(T.SIDEBAR_W)
        content = QWidget()
        v = QVBoxLayout(content)
        v.setContentsMargins(T.SP_16, T.SP_16, T.SP_16, T.SP_16)
        v.setSpacing(T.SP_32)
        self.printer = PrinterPanel()
        v.addWidget(run_panel)
        v.addWidget(self.printer)
        v.addStretch(1)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(scroll_area(content))

    def set_snapshot(self, snap: D.Snapshot, now: datetime) -> None:
        self.printer.set_snapshot(snap, now)


# -- inspector ------------------------------------------------------------------------------
class Inspector(QFrame):
    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("Inspector")
        self.setFixedWidth(T.INSPECTOR_W)
        self._order: dict | None = None
        self._ctx: D.Context | None = None
        self._fade = None

        self.empty = StateView()
        self.empty.show_state("pointer", "text_3", "", "Select an order to see its details.")

        self.detail = QWidget()
        dv = QVBoxLayout(self.detail)
        dv.setContentsMargins(T.SP_24, T.SP_24, T.SP_24, T.SP_24)
        dv.setSpacing(T.SP_12)
        self.kicker = micro("")
        self.title = display()
        self.title.setWordWrap(True)
        self.title.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.preview = QFrame()
        self.preview.setObjectName("Preview")
        pv = QVBoxLayout(self.preview)
        pv.setContentsMargins(T.SP_12, T.SP_12, T.SP_12, T.SP_12)
        self.preview_img = QLabel()
        self.preview_img.setAlignment(Qt.AlignmentFlag.AlignCenter)
        pv.addWidget(self.preview_img)
        self.stepper = Stepper()
        self.details = KeyValueList()
        dv.addWidget(self.kicker)
        dv.addWidget(self.title)
        dv.addWidget(self.preview)
        dv.addSpacing(T.SP_8)
        dv.addWidget(self.stepper)
        dv.addSpacing(T.SP_8)
        dv.addWidget(self.details)
        dv.addStretch(1)

        self.stack = QStackedWidget()
        self.stack.addWidget(self.empty)
        self.stack.addWidget(scroll_area(self.detail))
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(self.stack)

    def clear(self) -> None:
        self._order = None
        self.stack.setCurrentIndex(0)

    def show_order(self, o: dict, ctx: D.Context, animate: bool) -> None:
        self._order, self._ctx = o, ctx
        label_text, _ = D.status(o, ctx)
        qp = o.get("queue_position")
        self.kicker.setText((f"Order #{qp} · {label_text}" if qp is not None else f"{label_text} order").upper())
        self.title.setText(D.engraving(o))
        self._set_preview(o.get("printImageBase64"))
        self.stepper.set_state(*D.lifecycle(o, ctx))

        extras = {}
        if D.phone(o) != "—":
            button = QPushButton()
            button.setObjectName("Ghost")
            button.setFixedSize(T.SP_32, T.SP_32 - T.SP_4)
            button.setIcon(theme.icon("copy"))
            button.setToolTip("Copy phone number")
            button.setCursor(Qt.CursorShape.PointingHandCursor)
            button.clicked.connect(lambda _=False, b=button, n=D.phone_e164(o): self._copy(b, n))
            extras["Phone"] = button
        self.details.set_rows(D.order_rows(o), extras)
        self.stack.setCurrentIndex(1)
        if animate and T.MOTION_ENABLED:
            self._fade_in()

    def retheme(self) -> None:
        self.empty.retheme()
        if self._order is not None:
            self.show_order(self._order, self._ctx, animate=False)

    def _set_preview(self, data_url) -> None:
        pm = QPixmap()
        if isinstance(data_url, str) and "," in data_url:
            try:
                pm.loadFromData(base64.b64decode(data_url.split(",", 1)[1]))
            except ValueError:
                pm = QPixmap()
        self.preview.setVisible(not pm.isNull())
        if pm.isNull():
            return
        screen = QGuiApplication.primaryScreen()
        dpr = screen.devicePixelRatio() if screen else 1.0
        width = T.INSPECTOR_W - 2 * T.SP_24 - 2 * T.SP_12
        scaled = pm.scaledToWidth(round(width * dpr), Qt.TransformationMode.SmoothTransformation)
        scaled.setDevicePixelRatio(dpr)
        self.preview_img.setPixmap(scaled)

    def _copy(self, button: QPushButton, number: str) -> None:
        QGuiApplication.clipboard().setText(number)
        button.setIcon(theme.icon("check", "success"))
        # A refresh may rebuild the inspector (deleting this button) before the timer fires.
        QTimer.singleShot(T.FEEDBACK_MS,
                          lambda: shiboken6.isValid(button) and button.setIcon(theme.icon("copy")))

    def _fade_in(self) -> None:
        effect = QGraphicsOpacityEffect(self.detail)
        self.detail.setGraphicsEffect(effect)
        self._fade = QPropertyAnimation(effect, b"opacity", self)
        self._fade.setStartValue(0.0)
        self._fade.setEndValue(1.0)
        self._fade.setDuration(T.DUR_STANDARD)
        self._fade.setEasingCurve(QEasingCurve.Type.OutCubic)
        # The effect costs an offscreen pass per frame; drop it as soon as the fade ends.
        self._fade.finished.connect(lambda: self.detail.setGraphicsEffect(None))
        self._fade.start()

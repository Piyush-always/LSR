"""Laser Queue: a read-only desktop monitor for the laser keychain print queue.

Shows every order, the printer agent's live status, and the COM ports on this
PC. Needs no laser, no COM port and no admin key: it reads the same public data
the website reads, so it is safe to run on any computer.
"""
from __future__ import annotations

import ctypes
import os
import sys
from datetime import datetime, timedelta, timezone
from functools import partial
from pathlib import Path

from PySide6.QtCore import QSettings, Qt, QTimer
from PySide6.QtGui import QFont, QIcon, QKeySequence, QShortcut
from PySide6.QtWidgets import (QAbstractItemView, QApplication, QFileDialog, QFrame, QHBoxLayout,
                               QHeaderView, QLineEdit, QMainWindow, QMessageBox, QPushButton,
                               QSplitter, QStackedWidget, QTableView, QVBoxLayout, QWidget)

import agent as AG
import console_ui as C
import data as D
import firestore as fs
import tokens as T
import widgets as W
from theme import app_icon_pixmap, font, theme

FILTERS = (  # key, card title, statuses shown (None = everything)
    ("waiting", "Waiting to print", {"queued"}),
    ("printing", "In printing", {"printing"}),
    ("printed", "Printed", {"done"}),
    ("unpaid", "Unpaid", {"created"}),
    ("all", "All orders", None),
)
EMPTY_COPY = {
    "waiting": "Nothing is waiting to print.",
    "printing": "Nothing is printing right now.",
    "printed": "No orders have been printed yet.",
    "unpaid": "No unpaid checkouts.",
    "all": "No orders yet.",
}
ASC, DESC = Qt.SortOrder.AscendingOrder, Qt.SortOrder.DescendingOrder
DEFAULT_SORT = {"waiting": (0, ASC), "printing": (0, ASC), "printed": (W.PLACED_COL, DESC),
                "unpaid": (W.PLACED_COL, DESC), "all": (W.PLACED_COL, DESC)}


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Laser Queue")
        self.setWindowIcon(QIcon(app_icon_pixmap()))
        self.resize(1360, 840)
        self.setMinimumSize(T.SIDEBAR_W + T.PRIMARY_MIN_W + T.INSPECTOR_W, 640)

        self._snap: D.Snapshot | None = None
        self._ctx: D.Context | None = None
        self._busy = False
        self._filter = "waiting"
        self._selected_id: str | None = None
        self._agent_folder: str | None = None
        self._stopped_at: datetime | None = None     # when this window's agent last stopped
        self._closing = False
        self.settings = QSettings("Invengic", "LaserQueue")
        self.runner = AG.AgentRunner()
        self.run_panel = C.RunPanel()

        self.model = W.OrdersModel()
        self.proxy = W.OrdersProxy()
        self.proxy.setSourceModel(self.model)

        root = QWidget()
        v = QVBoxLayout(root)
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(0)
        v.addWidget(self._build_toolbar())
        v.addWidget(self._build_stat_row())
        body = QHBoxLayout()
        body.setSpacing(0)
        self.sidebar = W.Sidebar(self.run_panel)
        self.inspector = W.Inspector()
        body.addWidget(self.sidebar)
        body.addWidget(self._build_primary(), 1)
        body.addWidget(self.inspector)
        v.addLayout(body, 1)
        v.addWidget(self._build_status_strip())
        self.setCentralWidget(root)

        self.poller = D.Poller()
        self.poller.ready.connect(self._on_snapshot)
        self.poller.busy.connect(self._on_busy)

        self._refresh_timer = QTimer(self)
        self._refresh_timer.setInterval(T.REFRESH_MS)
        self._refresh_timer.timeout.connect(lambda: self._request(full=False))
        self._refresh_timer.start()
        self._clock = QTimer(self)
        self._clock.setInterval(1000)
        self._clock.timeout.connect(self._tick)
        self._clock.start()

        QShortcut(QKeySequence.StandardKey.Refresh, self, activated=lambda: self._request(full=True))
        QShortcut(QKeySequence.StandardKey.Find, self, activated=self.search.setFocus)
        theme.changed.connect(self._retheme)

        self.run_panel.set_saved_port(self.settings.value("laser_port"))
        self._set_agent_folder(AG.find_agent_folder(self.settings.value("agent_folder")))
        self.run_panel.start_clicked.connect(self._start_agent)
        self.run_panel.stop_clicked.connect(self._stop_agent)
        self.run_panel.choose_folder.connect(self._choose_folder)
        self.runner.state_changed.connect(self._on_agent_state)
        self.runner.output.connect(self.log_panel.append)
        self.runner.hint.connect(self.log_panel.set_hint)

        self._set_filter("waiting")
        self._request(full=True)

    # -- layout ------------------------------------------------------------------------------
    def _build_toolbar(self) -> QFrame:
        bar = QFrame()
        bar.setObjectName("Toolbar")
        bar.setFixedHeight(T.TOOLBAR_H)
        h = QHBoxLayout(bar)
        h.setContentsMargins(T.SP_16, 0, T.SP_16, 0)
        h.setSpacing(T.SP_12)
        h.addWidget(W.label("Laser Queue", weight=QFont.Weight.DemiBold))
        h.addWidget(W.chip(fs.PROJECT))
        h.addStretch(1)
        self.search = QLineEdit()
        self.search.setObjectName("Search")
        self.search.setPlaceholderText("Search name, phone or order ID")
        self.search.setFixedWidth(T.SEARCH_W)
        self._search_icon = self.search.addAction(QIcon(), QLineEdit.ActionPosition.LeadingPosition)
        self.search.textChanged.connect(self._on_search)
        self.refresh_btn = QPushButton("Refresh")
        self.refresh_btn.setObjectName("Primary")
        self.refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.refresh_btn.clicked.connect(lambda: self._request(full=True))
        h.addWidget(self.search)
        h.addWidget(self.refresh_btn)
        return bar

    def _build_stat_row(self) -> QFrame:
        row = QFrame()
        row.setObjectName("StatRow")
        h = QHBoxLayout(row)
        h.setContentsMargins(T.SP_16, T.SP_16, T.SP_16, T.SP_16)
        h.setSpacing(T.SP_12)
        self.cards: dict[str, W.StatCard] = {}
        for key, title, _ in FILTERS:
            card = W.StatCard(title)
            card.clicked.connect(partial(self._set_filter, key))
            h.addWidget(card)
            self.cards[key] = card
        return row

    def _build_primary(self) -> QFrame:
        primary = QFrame()
        primary.setObjectName("Primary")
        primary.setMinimumWidth(T.PRIMARY_MIN_W)
        v = QVBoxLayout(primary)
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(0)
        self.banner_box = QWidget()
        bb = QVBoxLayout(self.banner_box)
        bb.setContentsMargins(T.SP_16, T.SP_16, T.SP_16, T.SP_8)
        self.banner = W.Banner()
        self.banner.retry.connect(lambda: self._request(full=True))
        bb.addWidget(self.banner)
        self.banner_box.hide()

        self.table = QTableView()
        self.table.setModel(self.proxy)
        self.table.setItemDelegate(W.OrdersDelegate(self.table))
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setShowGrid(False)
        self.table.setWordWrap(False)
        self.table.setSortingEnabled(True)
        self.table.setFrameShape(QFrame.Shape.NoFrame)
        self.table.setVerticalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        self.table.setHorizontalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        vh = self.table.verticalHeader()
        vh.setVisible(False)
        vh.setSectionResizeMode(QHeaderView.ResizeMode.Fixed)
        vh.setDefaultSectionSize(T.ROW_H)
        hh = self.table.horizontalHeader()
        hh.setFont(font(T.SIZE_MICRO, QFont.Weight.DemiBold, track_em=T.TRACK_MICRO))
        hh.setFixedHeight(T.CONTROL_H)
        hh.setHighlightSections(False)
        hh.setDefaultAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        hh.setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        hh.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        for col, width in W.COL_WIDTHS.items():
            self.table.setColumnWidth(col, width)
        self.table.selectionModel().currentRowChanged.connect(self._on_current_changed)

        self.skeleton = W.Skeleton()
        self.state = W.StateView()
        self.state.action.connect(lambda: self._request(full=True))
        self.stack = QStackedWidget()
        for w in (self.skeleton, self.table, self.state):
            self.stack.addWidget(w)
        orders = QWidget()
        ov = QVBoxLayout(orders)
        ov.setContentsMargins(0, 0, 0, 0)
        ov.setSpacing(0)
        ov.addWidget(self.banner_box)
        ov.addWidget(self.stack, 1)
        self.log_panel = C.LogPanel()
        self.log_panel.setMinimumHeight(T.LOG_MIN_H)
        self.splitter = QSplitter(Qt.Orientation.Vertical)
        self.splitter.setChildrenCollapsible(False)
        self.splitter.addWidget(orders)
        self.splitter.addWidget(self.log_panel)
        self.splitter.setStretchFactor(0, 3)
        self.splitter.setStretchFactor(1, 2)
        v.addWidget(self.splitter, 1)
        return primary

    def _build_status_strip(self) -> QFrame:
        strip = QFrame()
        strip.setObjectName("StatusStrip")
        strip.setFixedHeight(T.STATUS_H)
        h = QHBoxLayout(strip)
        h.setContentsMargins(T.SP_16, 0, T.SP_16, 0)
        self.status_left = W.label("Connecting…", "secondary")
        self.status_right = W.label(f"Read-only · auto-refresh every {T.REFRESH_MS // 1000} s", "secondary")
        h.addWidget(self.status_left)
        h.addStretch(1)
        h.addWidget(self.status_right)
        return strip

    # -- data flow -----------------------------------------------------------------------------
    def _request(self, full: bool) -> None:
        if not self._busy:
            self.poller.request(full)

    def _on_busy(self, busy: bool) -> None:
        self._busy = busy
        self.refresh_btn.setEnabled(not busy)
        self.refresh_btn.setText("Refreshing…" if busy else "Refresh")
        self._tick()

    def _on_snapshot(self, snap: D.Snapshot) -> None:
        self._snap = snap
        now = datetime.now(timezone.utc)
        self._ctx = D.context(snap, now)

        scroll = self.table.verticalScrollBar().value()
        self.model.set_orders(snap.orders, self._ctx)
        self._reselect()
        self.table.verticalScrollBar().setValue(scroll)

        if snap.fetched_at is None:
            # Never show zeros we haven't read: "0 waiting" would look like an empty queue.
            for card in self.cards.values():
                card.set_data("—", "No data yet", "tertiary")
        else:
            for key, (count, sub, tone) in D.stats(snap.orders, self._ctx, snap.counter).items():
                self.cards[key].set_data(count, sub, tone)
        self.sidebar.set_snapshot(snap, now)
        self.run_panel.set_ports(snap.ports)
        self.run_panel.refresh_checks()
        self.run_panel.set_blocked(self._other_agent_reason(snap, now))

        stale = snap.error is not None and snap.fetched_at is not None
        self.banner_box.setVisible(stale)
        if stale:
            self.banner.set_text(f"Couldn't refresh ({self._reason(snap.error)}). "
                                 f"Showing data from {D.clock(snap.fetched_at)}.")
        self._update_center()
        self._tick()

    # -- filtering, selection, centre panel ------------------------------------------------------
    def _set_filter(self, key: str) -> None:
        self._filter = key
        statuses = next(s for k, _, s in FILTERS if k == key)
        self.proxy.set_statuses(statuses)
        col, order = DEFAULT_SORT[key]
        self.table.sortByColumn(col, order)
        for k, card in self.cards.items():
            card.set_selected(k == key)
        self._reselect()
        self._update_center()

    def _on_search(self, text: str) -> None:
        self.proxy.set_search(text)
        self._reselect()
        self._update_center()

    def _on_current_changed(self, current, _previous) -> None:
        if not current.isValid() or self._ctx is None:
            return
        order = current.data(W.ORDER_ROLE)
        animate = order["id"] != self._selected_id
        self._selected_id = order["id"]
        self.inspector.show_order(order, self._ctx, animate)

    def _reselect(self) -> None:
        """Keep the same order selected across refreshes and filter changes."""
        if self._selected_id:
            for row in range(self.proxy.rowCount()):
                index = self.proxy.index(row, 0)
                if index.data(W.ORDER_ROLE)["id"] == self._selected_id:
                    self.table.setCurrentIndex(index)
                    return
        self._selected_id = None
        self.table.clearSelection()
        self.inspector.clear()

    def _update_center(self) -> None:
        snap = self._snap
        if snap is None:
            self.stack.setCurrentWidget(self.skeleton)
            return
        if snap.fetched_at is None and snap.error is not None:
            if snap.error.kind == "permission":
                self.state.show_state(
                    "alert", "danger", "The database refused to share the orders",
                    "Its security rules no longer let the public read orders, which this monitor "
                    "relies on. The website's order screens will be affected too. Ask the developer "
                    "to restore read access.", "Try again")
            else:
                self.state.show_state(
                    "alert", "warning", "Can't reach the order database",
                    f"{self._reason(snap.error).capitalize()}. Check this computer's internet "
                    f"connection. The monitor retries every {T.REFRESH_MS // 1000} seconds.", "Try again")
            self.stack.setCurrentWidget(self.state)
            return
        if self.proxy.rowCount() == 0:
            needle = self.proxy.needle
            text = f"No orders match “{needle}”." if needle else EMPTY_COPY[self._filter]
            self.state.show_state("inbox", "text_3", "", text)
            self.stack.setCurrentWidget(self.state)
            return
        self.stack.setCurrentWidget(self.table)

    # -- ticking + theming -------------------------------------------------------------------------
    def _tick(self) -> None:
        now = datetime.now(timezone.utc)
        snap = self._snap
        if self._busy:
            text = "Updating…"
        elif snap is None:
            text = "Connecting…"
        elif snap.fetched_at is None:
            text = "Not connected"
        else:
            secs = int((now - snap.fetched_at).total_seconds())
            text = f"Updated {secs} s ago" if secs < 60 else f"Updated at {D.clock(snap.fetched_at)}"
        self.status_left.setText(text)
        self.sidebar.printer.tick(now)

    # -- operator console ---------------------------------------------------------------------------
    def _set_agent_folder(self, folder: str | None) -> None:
        self._agent_folder = folder
        self.run_panel.set_folder(folder)
        self.log_panel.setVisible(bool(folder) or self.runner.running)

    def _choose_folder(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Choose the printer-agent folder",
                                                self._agent_folder or "C:\\")
        if not path:
            return
        if (Path(path) / "index.js").is_file():
            self.settings.setValue("agent_folder", path)
        self._set_agent_folder(path)           # a wrong folder shows up as a failed check

    def _start_agent(self, folder: str, port: str) -> None:
        self.settings.setValue("laser_port", port)
        self.log_panel.show()
        self.runner.start(folder, port)

    def _stop_agent(self) -> None:
        if self.runner.state == "engraving" and not self._confirm(
                "Stop while engraving?",
                "A keychain is being engraved right now. Stopping ruins it, and its order stays stuck in printing.",
                "Stop anyway"):
            return
        self.runner.stop()

    def _on_agent_state(self, state: str, detail: str) -> None:
        self.run_panel.set_state(state, detail)
        self.log_panel.set_state(state)
        if state in ("stopped", "crashed"):
            self._stopped_at = datetime.now(timezone.utc)
            self.run_panel.reset_home()
            if self._closing:
                QTimer.singleShot(0, self.close)

    def _other_agent_reason(self, snap: D.Snapshot, now: datetime) -> str:
        """Two agents would pull the same orders, so don't start while another is online."""
        if self.runner.running or snap.fetched_at is None:
            return ""
        state, _ = D.printer_state(snap.printer, now)
        if state != "online":
            return ""
        beat = snap.printer.get("updatedAt")
        if self._stopped_at and beat <= self._stopped_at + timedelta(seconds=10):
            return ""                          # the last heartbeats of the agent this window just stopped
        return "Another agent is already online. Stop it first (Ctrl+C in its window), then start here."

    def _confirm(self, title: str, body: str, action: str) -> bool:
        box = QMessageBox(self)
        box.setWindowTitle(title)
        box.setText(title)
        box.setInformativeText(body)
        box.setIconPixmap(theme.icon("alert", "warning", T.SP_32, stroke=1.5))
        go = box.addButton(action, QMessageBox.ButtonRole.DestructiveRole)
        keep = box.addButton("Keep running", QMessageBox.ButtonRole.RejectRole)
        box.setDefaultButton(keep)
        box.exec()
        return box.clickedButton() is go

    def closeEvent(self, e) -> None:
        if self.runner.running:
            if not self._closing:
                engraving = self.runner.state == "engraving"
                body = ("A keychain is being engraved right now. Closing stops the agent and ruins it."
                        if engraving else
                        "The printer agent is running from this window. Closing stops it, and new orders "
                        "won't print until it's started again.")
                if not self._confirm("Stop printing and close?", body, "Stop and close"):
                    e.ignore()
                    return
                self._closing = True
                self.runner.stop()
            e.ignore()                             # closes for real once the agent has stopped
            return
        super().closeEvent(e)

    def _retheme(self) -> None:
        self._search_icon.setIcon(QIcon(theme.icon("search", "text_3")))
        self.refresh_btn.setIcon(QIcon(theme.icon("refresh", "on_accent")))
        self.state.retheme()
        self.banner.retheme()
        self.inspector.retheme()
        self.run_panel.retheme()
        self.log_panel.retheme()
        if self._snap is not None:
            self.sidebar.set_snapshot(self._snap, datetime.now(timezone.utc))
        self.table.viewport().update()
        theme.style_titlebar(self)

    @staticmethod
    def _reason(error: fs.FirestoreError) -> str:
        return {"network": "no internet connection", "permission": "access refused"}.get(
            error.kind, str(error) or "server error")

    def showEvent(self, e) -> None:
        super().showEvent(e)
        theme.style_titlebar(self)


def main() -> int:
    if sys.platform == "win32":
        # Own taskbar identity, so Windows shows this app's icon rather than Python's.
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Invengic.LaserQueue")
    app = QApplication(sys.argv)
    app.setApplicationName("Laser Queue")
    app.setStyle("Fusion")
    theme.attach(app)
    window = MainWindow()
    window._retheme()

    # Diagnostic: LASERQUEUE_SCREENSHOT=path renders off-screen, saves the window after the
    # first data load, then exits. Used to verify a build without opening a window.
    shot = os.environ.get("LASERQUEUE_SCREENSHOT")
    if shot:
        window.setAttribute(Qt.WidgetAttribute.WA_DontShowOnScreen)
        window.poller.ready.connect(
            lambda _snap: QTimer.singleShot(1500, lambda: (window.grab().save(shot), app.quit())))
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())

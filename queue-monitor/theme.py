"""Turns the tokens into Qt: colours, fonts, icons, the stylesheet, and live
light/dark switching when Windows changes theme."""
from __future__ import annotations

import ctypes
import os
import re
import sys
import tempfile
from pathlib import Path
from string import Template

from PySide6.QtCore import QByteArray, QObject, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QGuiApplication, QPainter, QPalette, QPixmap
from PySide6.QtSvg import QSvgRenderer

import tokens as T

_RGBA = re.compile(r"rgba\((\d+),(\d+),(\d+),([\d.]+)\)")

# Lucide icons (ISC licence), 24x24 stroke paths.
_LUCIDE = {
    "refresh": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'
               '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    "search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    "copy": '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>'
            '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    "inbox": '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>'
             '<path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89'
             'A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    "alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>'
             '<path d="M12 9v4"/><path d="M12 17h.01"/>',
    "plug": '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/>'
            '<path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    "check": '<path d="M20 6 9 17l-5-5"/>',
    "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    "arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    "play": '<polygon points="6 3 20 12 6 21 6 3"/>',
    "stop": '<rect width="14" height="14" x="5" y="5" rx="2"/>',
    "pointer": '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58'
               'a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
}

QSS = """
QMainWindow, QFrame#Primary { background: $surface_0; border: none; }
QFrame#StatRow { background: $surface_0; border: none; border-bottom: 1px solid $hairline; }
QFrame#Toolbar { background: $surface_1; border: none; border-bottom: 1px solid $hairline; }
QFrame#Sidebar { background: $surface_1; border: none; border-right: 1px solid $hairline; }
QFrame#Inspector { background: $surface_1; border: none; border-left: 1px solid $hairline; }
QFrame#StatusStrip { background: $surface_1; border: none; border-top: 1px solid $hairline; }
QScrollArea, QScrollArea > QWidget, QWidget#ScrollContent { background: transparent; border: none; }
QStackedWidget { background: transparent; }

QLabel { background: transparent; color: $text_1; }
QLabel[role="secondary"] { color: $text_2; }
QLabel[role="tertiary"] { color: $text_3; }
QLabel[role="success"] { color: $success; }
QLabel[role="warning"] { color: $warning; }
QLabel[role="danger"] { color: $danger; }
QLabel#Chip { background: $surface_2; border: 1px solid $hairline; border-radius: 10px;
              color: $text_2; padding: 0px 8px; min-height: 18px; max-height: 18px; }

QFrame#StatCard { background: $surface_2; border: 1px solid $hairline; border-radius: 10px; }
QFrame#StatCard:hover { background: $surface_3; }
QFrame#StatCard[selected="true"] { border: 1px solid $accent; }
QFrame#Banner { background: $surface_2; border: 1px solid $warning; border-radius: 10px; }
QFrame#Preview { background: $preview_bg; border: 1px solid $hairline; border-radius: 10px; }

QLineEdit#Search { background: $surface_2; border: 1px solid $hairline; border-radius: 6px;
                   padding: 0px 8px; min-height: 30px; color: $text_1;
                   selection-background-color: $accent; selection-color: $on_accent; }
QLineEdit#Search:focus { border: 1px solid $accent; }

QPushButton#Primary { background: $accent; color: $on_accent; border: none; border-radius: 6px;
                      padding: 0px 12px; min-height: 32px; }
QPushButton#Primary:hover { background: $accent_hover; }
QPushButton#Primary:disabled { background: $surface_3; color: $text_3; }
QPushButton#Ghost { background: transparent; color: $text_1; border: 1px solid $hairline_st;
                    border-radius: 6px; padding: 0px 8px; min-height: 26px; }
QPushButton#Ghost:hover { background: $surface_3; }
QPushButton#Ghost:disabled, QPushButton:disabled { color: $text_3; border: 1px solid $hairline; }
QPushButton#Segment { padding: 0px 8px; }
QPushButton#Segment:checked { background: $accent; color: $on_accent; border: 1px solid $accent; }
QPushButton#Segment:checked:disabled { background: $surface_3; color: $text_3; border: 1px solid $hairline; }

QTableView { background: $surface_0; border: none; gridline-color: transparent; outline: 0;
             selection-background-color: $surface_3; selection-color: $text_1; }
QTableView::item { border: none; border-bottom: 1px solid $hairline; padding: 0px 12px; }
QTableView::item:selected { background: $surface_3; color: $text_1; }
QHeaderView { background: $surface_0; border: none; }
QHeaderView::section { background: $surface_0; color: $text_2; border: none;
                       border-bottom: 1px solid $hairline; padding: 0px 12px; }
QTableCornerButton::section { background: $surface_0; border: none; }

QScrollBar:vertical { background: transparent; width: 12px; margin: 0px; }
QScrollBar::handle:vertical { background: $hairline_st; border-radius: 4px; min-height: 32px; margin: 2px; }
QScrollBar:horizontal { background: transparent; height: 12px; margin: 0px; }
QScrollBar::handle:horizontal { background: $hairline_st; border-radius: 4px; min-width: 32px; margin: 2px; }
QScrollBar::add-line, QScrollBar::sub-line { width: 0px; height: 0px; }
QScrollBar::add-page, QScrollBar::sub-page { background: transparent; }

QToolTip { background: $surface_2; color: $text_1; border: 1px solid $hairline_st; padding: 4px 8px; }

QPushButton { background: $surface_2; color: $text_1; border: 1px solid $hairline_st; border-radius: 6px;
              padding: 0px 12px; min-height: 28px; }
QPushButton:hover { background: $surface_3; }
QPushButton:default { border: 1px solid $accent; }
QPushButton#Danger { background: transparent; color: $danger; border: 1px solid $danger; border-radius: 6px;
                     padding: 0px 12px; min-height: 32px; }
QPushButton#Danger:hover { background: $surface_3; }
QDialog { background: $surface_0; }
QMessageBox { background: $surface_1; }   /* after QDialog: Qt ranks the two equally, so the later wins */
QFrame#Card { background: $surface_1; border: 1px solid $hairline; border-radius: 10px; }
QFrame#HolderRow { background: transparent; border: none; border-top: 1px solid $hairline; }

QComboBox { background: $surface_2; color: $text_1; border: 1px solid $hairline; border-radius: 6px;
            padding: 0px 8px; min-height: 30px; }
QComboBox:focus, QComboBox:on { border: 1px solid $accent; }
QComboBox::drop-down { border: none; width: 24px; }
QComboBox QAbstractItemView { background: $surface_2; color: $text_1; border: 1px solid $hairline_st;
                              selection-background-color: $surface_3; selection-color: $text_1; outline: 0; }

QCheckBox { color: $text_1; spacing: 8px; }
QCheckBox::indicator { width: 16px; height: 16px; border: 1px solid $hairline_st; border-radius: 4px;
                       background: $surface_2; }
QCheckBox::indicator:checked { background: $accent; border: 1px solid $accent; image: url("$check_png"); }
QCheckBox:disabled { color: $text_3; }

QFrame#LogPanel { background: $surface_1; border: none; }
QPlainTextEdit#Log { background: $surface_1; color: $text_2; border: none;
                     selection-background-color: $accent; selection-color: $on_accent; }
QSplitter::handle:vertical { height: 5px; background: $hairline; }
"""


def font(size: int = T.SIZE_BODY, weight: QFont.Weight = QFont.Weight.Normal,
         mono: bool = False, track_em: float = 0.0, tabular: bool = False) -> QFont:
    f = QFont()
    f.setFamilies(list(T.FONT_MONO if mono else T.FONT_UI))
    f.setPixelSize(size)
    f.setWeight(weight)
    if track_em:
        f.setLetterSpacing(QFont.SpacingType.AbsoluteSpacing, track_em * size)
    if tabular:                                   # equal-width digits, so numbers line up in columns
        f.setFeature(QFont.Tag("tnum"), 1)
    return f


class Theme(QObject):
    changed = Signal()

    def __init__(self) -> None:
        super().__init__()
        self.dark = True
        self.p = T.DARK
        self._app = None

    # -- colours ---------------------------------------------------------------
    def c(self, name: str, alpha: float | None = None) -> QColor:
        value = self.p[name].replace(" ", "")
        m = _RGBA.fullmatch(value)
        col = QColor(int(m[1]), int(m[2]), int(m[3])) if m else QColor(value)
        if m:
            col.setAlphaF(float(m[4]))
        if alpha is not None:
            col.setAlphaF(alpha)
        return col

    # -- application-wide --------------------------------------------------------
    def attach(self, app) -> None:
        self._app = app
        QGuiApplication.styleHints().colorSchemeChanged.connect(lambda *_: self._apply())
        self._apply()

    def _apply(self) -> None:
        forced = os.environ.get("LASERQUEUE_THEME", "").lower()     # "light" / "dark" override
        if forced in ("light", "dark"):
            self.dark = forced == "dark"
        else:
            self.dark = QGuiApplication.styleHints().colorScheme() != Qt.ColorScheme.Light
        self.p = T.DARK if self.dark else T.LIGHT

        pal = QPalette()
        for role, tok in (
            (QPalette.ColorRole.Window, "surface_0"), (QPalette.ColorRole.WindowText, "text_1"),
            (QPalette.ColorRole.Base, "surface_0"), (QPalette.ColorRole.AlternateBase, "surface_1"),
            (QPalette.ColorRole.Text, "text_1"), (QPalette.ColorRole.Button, "surface_2"),
            (QPalette.ColorRole.ButtonText, "text_1"), (QPalette.ColorRole.Highlight, "accent"),
            (QPalette.ColorRole.HighlightedText, "on_accent"), (QPalette.ColorRole.ToolTipBase, "surface_2"),
            (QPalette.ColorRole.ToolTipText, "text_1"), (QPalette.ColorRole.PlaceholderText, "text_3"),
        ):
            pal.setColor(role, self.c(tok))
        self._app.setPalette(pal)
        self._app.setFont(font())
        self._app.setStyleSheet(Template(QSS).substitute(self.p, check_png=self._check_image()))
        self.changed.emit()

    def _check_image(self) -> str:
        """Stylesheets can only draw images from files, so the tick for checked boxes
        is rendered to a PNG (plus an @2x copy for high-DPI screens) in the temp folder."""
        folder = Path(tempfile.gettempdir()) / "laserqueue"
        folder.mkdir(exist_ok=True)
        name = "check-dark" if self.dark else "check-light"
        for suffix, px in (("", T.SP_12), ("@2x", T.SP_24)):
            pm = self.icon("check", "on_accent", px, stroke=3.0)
            pm.setDevicePixelRatio(1.0)
            pm.scaled(px, px).save(str(folder / f"{name}{suffix}.png"), "PNG")
        return (folder / f"{name}.png").as_posix()

    def style_titlebar(self, window) -> None:
        """Match the native Windows title bar to the theme. Windows 11 honours all three
        attributes; older builds reject them and keep their default title bar, which is fine."""
        if sys.platform != "win32":
            return
        hwnd = int(window.winId())
        for attr, value in ((20, 1 if self.dark else 0),            # DWMWA_USE_IMMERSIVE_DARK_MODE
                            (35, self._colorref("surface_1")),       # DWMWA_CAPTION_COLOR
                            (36, self._colorref("text_1"))):         # DWMWA_TEXT_COLOR
            v = ctypes.c_int(value)
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(v), ctypes.sizeof(v))

    def _colorref(self, name: str) -> int:
        c = self.c(name)
        return c.red() | (c.green() << 8) | (c.blue() << 16)

    # -- icons -------------------------------------------------------------------
    def icon(self, name: str, tone: str = "text_2", px: int = T.SP_16, stroke: float = 2.0) -> QPixmap:
        c = self.c(tone)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
               f'stroke="{c.name()}" stroke-opacity="{c.alphaF():.3f}" stroke-width="{stroke}" '
               f'stroke-linecap="round" stroke-linejoin="round">{_LUCIDE[name]}</svg>')
        screen = QGuiApplication.primaryScreen()
        dpr = screen.devicePixelRatio() if screen else 1.0
        pm = QPixmap(round(px * dpr), round(px * dpr))
        pm.fill(Qt.GlobalColor.transparent)
        p = QPainter(pm)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(0, 0, pm.width(), pm.height()))
        p.end()
        pm.setDevicePixelRatio(dpr)
        return pm


def app_icon_pixmap(px: int = 256) -> QPixmap:
    """The app mark: a queue of three bars, the first (now printing) in accent."""
    pm = QPixmap(px, px)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(QColor(T.DARK["surface_2"]))
    p.drawRoundedRect(QRectF(0, 0, px, px), px * 0.22, px * 0.22)
    bar_h = px * 0.10
    for i, y in enumerate((0.30, 0.45, 0.60)):
        col = QColor(T.DARK["accent"]) if i == 0 else QColor(T.DARK["text_1"])
        if i:
            col.setAlphaF(0.62 if i == 1 else 0.38)
        p.setBrush(col)
        p.drawRoundedRect(QRectF(px * 0.22, px * y, px * 0.56, bar_h), bar_h / 2, bar_h / 2)
    p.end()
    return pm


theme = Theme()

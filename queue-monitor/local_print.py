"""Local print: engrave any text, in any of the website's fonts, or a photo on the
heart, rectangle or circle holder, straight from this PC, without a website order.

The engraving is made by the printer agent's own code (printer-agent/local-print.js),
so it comes out exactly like a website order, and the preview draws the very G-code the
laser will run. Printing needs the laser's port, so it runs only while the printer
agent is stopped. Stop turns the laser off and returns the head HOME, like Ctrl+C.
"""
from __future__ import annotations

import json
import re
import shutil
import tempfile
from pathlib import Path

from PySide6.QtCore import QObject, QPointF, QProcess, QProcessEnvironment, QRectF, Qt, QTimer, Signal
from PySide6.QtGui import QFont, QFontDatabase, QIcon, QImageReader, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import (QButtonGroup, QCheckBox, QFileDialog, QFrame, QGridLayout, QHBoxLayout,
                               QLineEdit, QMessageBox, QProgressBar, QSlider, QVBoxLayout, QWidget)

import agent as A
import machine as M
import tokens as T
from calibrate_ui import NAMES, ShapeGlyph, button, card
from theme import font, theme
from widgets import label, micro, set_prop

# The website's fonts (js/keychain-layout.js KEYCHAIN_FONTS): id, name, file in printer-agent/fonts.
FONTS = (("pixel", "Pixel", "PressStart2P-Regular.ttf"), ("bebas", "Bebas", "BebasNeue-Regular.ttf"),
         ("montserrat", "Modern", "Montserrat-Bold.ttf"), ("marker", "Marker", "PermanentMarker-Regular.ttf"),
         ("pacifico", "Script", "Pacifico-Regular.ttf"))
MAX_CHARS = 20               # the website's name field
PHOTO_MAX_PX = 2000          # larger photos are scaled down first; the engraving is about 600 px
PREVIEW_DELAY_MS = 250       # wait for typing to pause before making a new preview
STOP_GRACE_MS = 50_000       # laser off + back HOME can take ~45 s; after that the process is ended
TMP = Path(tempfile.gettempdir())
_WORD = re.compile(r"([A-Z])(-?\d+(?:\.\d+)?)")


def size_text(shape: str, holder: dict) -> str:
    if shape == "circle":
        return f"Ø {holder['width']:g} mm"
    return f"{holder['width']:g} × {holder['height']:g} mm"


def burn_segments(gcode: str) -> list[tuple[float, float, float, float]]:
    """The moves that burn (G1 with the laser on above zero power), in the G-code's mm."""
    segs: list[tuple[float, float, float, float]] = []
    x = y = power = 0.0
    on = False
    for raw in gcode.splitlines():
        words = dict(_WORD.findall(raw.split(";", 1)[0].upper()))
        if not words:
            continue
        if "M" in words:
            m = int(float(words["M"]))
            on = True if m in (3, 4) else False if m == 5 else on
        if "S" in words:
            power = float(words["S"])
        if "G" in words and ("X" in words or "Y" in words):
            g = int(float(words["G"]))
            nx, ny = float(words.get("X", x)), float(words.get("Y", y))
            if g == 1 and on and power > 0:
                segs.append((x, y, nx, ny))
            if g in (0, 1):
                x, y = nx, ny
    return segs


class EngravingPreview(QWidget):
    """The blank in its holder, seen from above, with every line the laser will burn."""

    def __init__(self) -> None:
        super().__init__()
        self._outline: list[tuple[float, float]] = []
        self._burn = QPainterPath()
        self._message, self._tone = "", "text_3"
        self.setMinimumSize(360, 360)

    def set_outline(self, pts: list[tuple[float, float]]) -> None:
        self._outline = pts
        self.update()

    def set_burns(self, segs: list[tuple[float, float, float, float]]) -> None:
        path = QPainterPath()
        for x0, y0, x1, y1 in segs:
            path.moveTo(x0, y0)
            path.lineTo(x1, y1)
        self._burn = path
        self.update()

    def set_message(self, text: str, tone: str = "text_3") -> None:
        self._message, self._tone = text, tone
        self.update()

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        if self._outline:
            xs, ys = [q[0] for q in self._outline], [q[1] for q in self._outline]
            half = max(max(abs(v) for v in xs), max(abs(v) for v in ys)) + 4      # mm around the centre
            s = (min(self.width(), self.height() - T.SP_32) - 2 * T.SP_16) / (2 * half)
            p.save()
            p.translate(self.width() / 2, (self.height() - T.SP_32) / 2)
            p.scale(s, -s)                                                      # mm, Y up like the bed
            blank = QPainterPath()
            for i, (x, y) in enumerate(self._outline):
                blank.moveTo(x, y) if i == 0 else blank.lineTo(x, y)
            blank.closeSubpath()
            edge = QPen(theme.c("hairline_st"), 1.5, Qt.PenStyle.DashLine)
            edge.setCosmetic(True)
            p.setPen(edge)
            p.setBrush(theme.c("surface_2"))
            p.drawPath(blank)
            burn = QPen(theme.c("text_1"), max(1.0, 0.18 * s))                  # 0.15 mm lines merge into areas
            burn.setCosmetic(True)
            burn.setCapStyle(Qt.PenCapStyle.FlatCap)
            p.setPen(burn)
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawPath(self._burn)
            p.restore()
        if self._message:
            p.setPen(theme.c(self._tone))
            p.setFont(font())
            p.drawText(QRectF(0, self.height() - T.SP_32, self.width(), T.SP_32),
                       int(Qt.AlignmentFlag.AlignCenter | Qt.TextFlag.TextWordWrap), self._message)


class LocalRunner(QObject):
    """Runs printer-agent/local-print.js: previews (no laser) and prints (the laser's port).
    Print states: idle, homing, engraving, stopping, done, stopped, failed."""

    preview_done = Signal(str, str)       # the G-code ("" if it failed), the error
    state_changed = Signal(str, str)      # state, detail
    progress = Signal(int)                # percent of the G-code sent

    def __init__(self) -> None:
        super().__init__()
        self._preview: QProcess | None = None
        self._queued: tuple[str, dict] | None = None
        self._print: QProcess | None = None
        self._buf = ""
        self._done = self._stop_requested = False
        self._error = ""
        self.state = "idle"
        self._force = QTimer(self)
        self._force.setSingleShot(True)
        self._force.setInterval(STOP_GRACE_MS)
        self._force.timeout.connect(self._kill)

    @property
    def busy(self) -> bool:
        return self._print is not None

    @property
    def previewing(self) -> bool:
        return self._preview is not None

    # -- preview ---------------------------------------------------------------------------------
    def preview(self, folder: str, job: dict) -> None:
        if self._preview is not None:
            self._queued = (folder, job)          # the newest wins; made when this one finishes
            return
        node = shutil.which("node")
        if not node:
            self.preview_done.emit("", "Node.js isn't installed.")
            return
        job_file = TMP / "laserqueue-local-preview.json"
        job_file.write_text(json.dumps(job), encoding="utf-8")
        proc = QProcess(self)
        proc.setProgram(node)
        proc.setArguments(["local-print.js", "preview", str(job_file)])
        proc.setWorkingDirectory(folder)
        proc.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)
        proc.finished.connect(lambda *_: self._preview_finished(proc))
        proc.errorOccurred.connect(lambda e: e == QProcess.ProcessError.FailedToStart and self._preview_finished(proc))
        self._preview = proc
        proc.start()

    def _preview_finished(self, proc: QProcess) -> None:
        if self._preview is not proc:
            return
        out = bytes(proc.readAllStandardOutput()).decode("utf-8", errors="replace")
        self._preview = None
        proc.deleteLater()
        gcode, error = "", ""
        m = re.search(r"^\[LOCAL\] GCODE (.+)$", out, re.M)
        if m:
            try:
                gcode = Path(m.group(1).strip()).read_text(encoding="utf-8")
            except OSError as e:
                error = f"Couldn't read the preview ({e})."
        else:
            f = re.search(r"^\[LOCAL\] Failed: (.+)$", out, re.M)
            error = f.group(1).strip() if f else (out.strip().splitlines() or ["The preview couldn't be made."])[-1]
        if self._queued:
            folder, job = self._queued
            self._queued = None
            self.preview(folder, job)             # something changed meanwhile: show that instead
            return
        self.preview_done.emit(gcode, error)

    # -- print -----------------------------------------------------------------------------------
    def start_print(self, folder: str, port: str, job: dict) -> None:
        if self._print is not None:
            return
        node = shutil.which("node")
        if not node:
            self._set("failed", "Node.js isn't installed.")
            return
        hook = TMP / "laserqueue-stop-hook.js"
        job_file = TMP / "laserqueue-local-print.json"
        try:
            hook.write_text(A.STOP_HOOK, encoding="utf-8")
            job_file.write_text(json.dumps(job), encoding="utf-8")
        except OSError as e:
            self._set("failed", f"Couldn't write the print job: {e}")
            return
        proc = QProcess(self)
        proc.setProgram(node)
        proc.setArguments(["--require", str(hook), "local-print.js", "print", str(job_file)])
        proc.setWorkingDirectory(folder)
        env = QProcessEnvironment.systemEnvironment()
        env.insert("LASER_PORT", port)
        proc.setProcessEnvironment(env)
        proc.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)
        proc.readyReadStandardOutput.connect(self._read)
        proc.finished.connect(self._print_finished)
        proc.errorOccurred.connect(self._print_error)
        self._print, self._buf, self._error = proc, "", ""
        self._done = self._stop_requested = False
        self._set("homing", f"on {port}")
        proc.start()

    def stop(self) -> None:
        if self._print is None or self._stop_requested:
            return
        self._stop_requested = True
        self._set("stopping")
        if self._print.write(b"stop\n") == -1:
            self._kill()
        else:
            self._force.start()

    def _kill(self) -> None:
        if self._print is not None:
            self._error = ("It didn't confirm the laser is off and the head is back. "
                           "Check the laser; switch it off and on if it doesn't respond.")
            self._print.kill()

    def _read(self) -> None:
        self._buf += bytes(self._print.readAllStandardOutput()).decode("utf-8", errors="replace")
        *lines, self._buf = re.split(r"\r\n|\n|\r", self._buf)
        for text in lines:
            self._line(text)

    def _line(self, text: str) -> None:
        if text.startswith("[HOME] Homing:") and not self._stop_requested:
            self._set("homing", "The head drives to its HOME corner.")
        elif text.startswith("[LOCAL] Engraving") and not self._stop_requested:
            self._set("engraving")
        elif m := re.match(r"\[LOCAL\] Progress (\d+)%", text):
            self.progress.emit(int(m.group(1)))
        elif text.startswith("[LOCAL] Failed:") and not self._stop_requested:     # not "Stopped by the operator"
            self._error = self._error or text.split(":", 1)[1].strip()
        elif text.startswith("[LOCAL] Done"):
            self._done = True
        elif text.startswith("[SERIAL] Could not confirm"):
            self._error = ("It didn't confirm the laser is off and the head is back. "
                           "Check the laser; switch it off and on if it doesn't respond.")
        for pattern, message in A.HINTS:
            if pattern.search(text):
                self._error = message

    def _print_finished(self, code: int, _status) -> None:
        self._force.stop()
        self._read()                                  # output that arrived with the exit
        if self._buf:
            self._line(self._buf)
            self._buf = ""
        proc, self._print = self._print, None
        proc.deleteLater()
        if self._done and code == 0:
            self._set("done")
        elif self._stop_requested:
            self._set("stopped", self._error)
        else:
            self._set("failed", self._error or f"The print stopped (exit code {code}).")

    def _print_error(self, error) -> None:
        if error == QProcess.ProcessError.FailedToStart and self._print is not None:
            self._print.deleteLater()
            self._print = None
            self._set("failed", "Node.js couldn't start.")

    def _set(self, state: str, detail: str = "") -> None:
        self.state = state
        self.state_changed.emit(state, detail)


class ShapeTile(QFrame):
    clicked = Signal()

    def __init__(self, shape: str, holder: dict) -> None:
        super().__init__()
        self.setObjectName("Tile")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        v = QVBoxLayout(self)
        v.setContentsMargins(T.SP_12, T.SP_12, T.SP_12, T.SP_12)
        v.setSpacing(T.SP_4)
        v.addWidget(ShapeGlyph(shape, holder), 0, Qt.AlignmentFlag.AlignHCenter)
        v.addWidget(label(NAMES[shape], weight=QFont.Weight.DemiBold), 0, Qt.AlignmentFlag.AlignHCenter)
        v.addWidget(label(size_text(shape, holder), "secondary"), 0, Qt.AlignmentFlag.AlignHCenter)

    def set_selected(self, on: bool) -> None:
        set_prop(self, "selected", on)

    def mousePressEvent(self, e) -> None:
        if e.button() == Qt.MouseButton.LeftButton and self.isEnabled():
            self.clicked.emit()


class LocalPrintPage(QWidget):
    """The Local print tab."""

    busy_changed = Signal(bool)

    def __init__(self) -> None:
        super().__init__()
        self._folder: str | None = None
        self._port: str | None = None
        self._agent_running = False
        self._holders: dict = {}
        self._fonts_loaded: str | None = None
        self._shape = "heart"
        self._mode = "text"
        self._font = "bebas"
        self._photo: str | None = None              # upright PNG copy of the chosen photo
        self._photo_name = ""
        self._gcode_ok = False                      # the preview matches the current choices
        self._error = ""                            # machine.json couldn't be read
        self._status_override: tuple[str, str] | None = None    # the last print's outcome
        self.runner = LocalRunner()
        self.runner.preview_done.connect(self._on_preview)
        self.runner.state_changed.connect(self._on_print_state)
        self.runner.progress.connect(self._on_progress)
        self._debounce = QTimer(self)
        self._debounce.setSingleShot(True)
        self._debounce.setInterval(PREVIEW_DELAY_MS)
        self._debounce.timeout.connect(self._make_preview)

        h = QHBoxLayout(self)
        h.setContentsMargins(T.SP_24, T.SP_24, T.SP_24, T.SP_24)
        h.setSpacing(T.SP_16)
        left = QVBoxLayout()
        left.setSpacing(T.SP_16)
        left.addWidget(self._build_shapes())
        left.addWidget(self._build_content())
        left.addWidget(self._build_print())
        left.addStretch(1)
        side = QWidget()
        side.setLayout(left)
        side.setFixedWidth(T.SIDEBAR_W + T.INSPECTOR_W - T.SP_48)
        h.addWidget(side)
        h.addWidget(self._build_preview(), 1)
        self.retheme()
        self._apply()

    # -- inputs from the window ------------------------------------------------------------------
    @property
    def busy(self) -> bool:
        return self.runner.busy

    def set_folder(self, folder: str | None) -> None:
        self._folder = folder
        self._holders, self._error = M.load(folder) if folder else ({}, "")
        self._load_fonts()
        self._rebuild_tiles()

    def set_port(self, port: str | None) -> None:
        self._port = port or None
        self._apply()

    def set_agent_running(self, running: bool) -> None:
        self._agent_running = running
        self._apply()

    def stop(self) -> None:
        self.runner.stop()

    def retheme(self) -> None:
        self.choose_btn.setIcon(QIcon(theme.icon("image", "text_1")))
        self.print_btn.setIcon(QIcon(theme.icon("play", "on_accent")))
        self.stop_btn.setIcon(QIcon(theme.icon("stop", "danger")))
        self.preview.update()

    # -- layout ------------------------------------------------------------------------------------
    def _build_shapes(self) -> QFrame:
        frame, v = card()
        v.addWidget(micro("1 · Shape"))
        self.tiles_row = QHBoxLayout()
        self.tiles_row.setSpacing(T.SP_8)
        v.addLayout(self.tiles_row)
        self.tiles: dict[str, ShapeTile] = {}
        return frame

    def _build_content(self) -> QFrame:
        frame, v = card()
        v.addWidget(micro("2 · What to engrave"))
        modes = QHBoxLayout()
        modes.setSpacing(T.SP_4)
        self.mode_group = QButtonGroup(self)
        for key, caption in (("text", "Text"), ("image", "Photo")):
            b = button(caption, "Segment")
            b.setCheckable(True)
            b.setChecked(key == self._mode)
            b.clicked.connect(lambda _c=False, k=key: self._set_mode(k))
            self.mode_group.addButton(b)
            modes.addWidget(b, 1)
        v.addLayout(modes)

        self.text_box = QWidget()
        tv = QVBoxLayout(self.text_box)
        tv.setContentsMargins(0, T.SP_4, 0, 0)
        tv.setSpacing(T.SP_8)
        self.text = QLineEdit()
        self.text.setObjectName("Field")
        self.text.setMaxLength(MAX_CHARS)
        self.text.setPlaceholderText("Name or text, up to 20 characters")
        self.text.textChanged.connect(self._schedule)
        tv.addWidget(self.text)
        tv.addWidget(label("Font", "secondary"))
        self.font_grid = QGridLayout()
        self.font_grid.setSpacing(T.SP_8)
        self.font_group = QButtonGroup(self)
        self.font_btns: dict[str, object] = {}
        for i, (fid, name, _file) in enumerate(FONTS):
            b = button(name, "FontChip")
            b.setCheckable(True)
            b.setChecked(fid == self._font)
            b.setMinimumHeight(T.CONTROL_H + T.SP_12)
            b.clicked.connect(lambda _c=False, f=fid: self._set_font(f))
            self.font_group.addButton(b)
            self.font_grid.addWidget(b, i // 3, i % 3)
            self.font_btns[fid] = b
        tv.addLayout(self.font_grid)
        v.addWidget(self.text_box)

        self.photo_box = QWidget()
        pv = QVBoxLayout(self.photo_box)
        pv.setContentsMargins(0, T.SP_4, 0, 0)
        pv.setSpacing(T.SP_8)
        pick = QHBoxLayout()
        self.choose_btn = button("Choose photo…")
        self.choose_btn.clicked.connect(self._choose_photo)
        pick.addWidget(self.choose_btn)
        self.photo_label = label("No photo yet", "secondary")
        pick.addWidget(self.photo_label, 1)
        pv.addLayout(pick)
        self.threshold, self.threshold_value = self._slider(pv, "Darkness", 0, 255, 128)
        self.zoom, self.zoom_value = self._slider(pv, "Size", 50, 300, 100)
        self.invert = QCheckBox("Invert (burn the light parts)")
        self.invert.toggled.connect(self._schedule)
        pv.addWidget(self.invert)
        pv.addWidget(label("Like the website: dark parts of the photo burn. Logos and line drawings work "
                           "best.", "tertiary", wrap=True))
        v.addWidget(self.photo_box)
        return frame

    def _slider(self, layout: QVBoxLayout, caption: str, lo: int, hi: int, value: int):
        row = QHBoxLayout()
        row.setSpacing(T.SP_8)
        name = label(caption, "secondary")
        name.setFixedWidth(T.KEY_W - T.SP_24)
        row.addWidget(name)
        s = QSlider(Qt.Orientation.Horizontal)
        s.setRange(lo, hi)
        s.setValue(value)
        shown = label("", "secondary")
        shown.setFont(font(tabular=True))
        shown.setFixedWidth(T.SP_48)
        shown.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        s.valueChanged.connect(self._schedule)
        s.valueChanged.connect(self._show_slider_values)
        row.addWidget(s, 1)
        row.addWidget(shown)
        layout.addLayout(row)
        return s, shown

    def _build_print(self) -> QFrame:
        frame, v = card()
        v.addWidget(micro("3 · Print"))
        self.status = label("", "secondary", wrap=True)
        v.addWidget(self.status)
        self.bar = QProgressBar()
        self.bar.setRange(0, 100)
        self.bar.setTextVisible(False)
        self.bar.setFixedHeight(T.SP_8)
        self.bar.hide()
        v.addWidget(self.bar)
        self.print_btn = button("Print", "Primary")
        self.print_btn.clicked.connect(self._print)
        v.addWidget(self.print_btn)
        self.stop_btn = button("Stop", "Danger")
        self.stop_btn.clicked.connect(self.runner.stop)
        self.stop_btn.hide()
        v.addWidget(self.stop_btn)
        return frame

    def _build_preview(self) -> QFrame:
        frame, v = card()
        head = QHBoxLayout()
        head.addWidget(micro("Preview · exactly what the laser burns"), 1)
        self.preview_caption = label("", "secondary")
        head.addWidget(self.preview_caption)
        v.addLayout(head)
        self.preview = EngravingPreview()
        v.addWidget(self.preview, 1)
        return frame

    def _rebuild_tiles(self) -> None:
        while self.tiles_row.count():
            w = self.tiles_row.takeAt(0).widget()
            if w:
                w.setParent(None)                     # off the screen now, not when Qt gets round to it
                w.deleteLater()
        self.tiles = {}
        for shape in M.SHAPES:
            holder = self._holders.get(shape)
            if not holder:
                continue
            tile = ShapeTile(shape, holder)
            tile.clicked.connect(lambda s=shape: self._set_shape(s))
            self.tiles_row.addWidget(tile, 1)
            self.tiles[shape] = tile
        self._set_shape(self._shape)

    def _load_fonts(self) -> None:
        """Each font button shows its name in that font, from the agent's own font files."""
        if not self._folder or self._fonts_loaded == self._folder:
            return
        self._fonts_loaded = self._folder
        for fid, _name, file in FONTS:
            font_id = QFontDatabase.addApplicationFont(str(Path(self._folder) / "fonts" / file))
            families = QFontDatabase.applicationFontFamilies(font_id) if font_id >= 0 else []
            if families:
                f = QFont(families[0])
                f.setPixelSize(T.SIZE_BODY if fid == "pixel" else T.SIZE_BODY + 6)   # Pixel is very wide
                self.font_btns[fid].setFont(f)

    # -- choices -------------------------------------------------------------------------------------
    def _set_shape(self, shape: str) -> None:
        self._shape = shape
        for s, tile in self.tiles.items():
            tile.set_selected(s == shape)
        holder = self._holders.get(shape)
        self.preview.set_outline(M.border(shape, holder) if holder else [])
        self.preview_caption.setText(f"{NAMES[shape]} · {size_text(shape, holder)}" if holder else "")
        self._schedule()
        self._apply()

    def _set_mode(self, mode: str) -> None:
        self._mode = mode
        self._schedule()
        self._apply()

    def _set_font(self, fid: str) -> None:
        self._font = fid
        self._schedule()

    def _show_slider_values(self) -> None:
        self.threshold_value.setText(str(self.threshold.value()))
        self.zoom_value.setText(f"{self.zoom.value()}%")

    def _choose_photo(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Choose a photo", "",
                                              "Images (*.png *.jpg *.jpeg *.webp *.bmp)")
        if not path:
            return
        reader = QImageReader(path)
        reader.setAutoTransform(True)                 # phone photos: turn them upright
        img = reader.read()
        if img.isNull():
            QMessageBox.warning(self, "Couldn't open the photo", f"{reader.errorString()}. Try a PNG or JPG.")
            return
        if max(img.width(), img.height()) > PHOTO_MAX_PX:
            img = img.scaled(PHOTO_MAX_PX, PHOTO_MAX_PX, Qt.AspectRatioMode.KeepAspectRatio,
                             Qt.TransformationMode.SmoothTransformation)
        copy = TMP / "laserqueue-local-photo.png"
        if not img.save(str(copy), "PNG"):
            QMessageBox.warning(self, "Couldn't open the photo", "It couldn't be prepared for engraving.")
            return
        self._photo, self._photo_name = str(copy), Path(path).name
        self.photo_label.setText(self._photo_name)
        self._schedule()
        self._apply()

    def _job(self) -> dict | None:
        """The current choices as a job for local-print.js, or None if something is missing."""
        if self._mode == "text":
            name = self.text.text().strip()
            return {"shape": self._shape, "mode": "text", "name": name, "fontId": self._font} if name else None
        if not self._photo:
            return None
        return {"shape": self._shape, "mode": "image", "photo": self._photo, "threshold": self.threshold.value(),
                "invert": self.invert.isChecked(), "zoom": self.zoom.value() / 100}

    # -- preview ---------------------------------------------------------------------------------------
    def _schedule(self, *_args) -> None:
        self._gcode_ok = False
        self._debounce.start()
        self._apply()

    def _make_preview(self) -> None:
        job = self._job()
        if not self._folder or job is None:
            self.preview.set_burns([])
            self.preview.set_message("Type a name to see it on the keychain." if self._mode == "text"
                                     else "Choose a photo to see it on the keychain.")
            return
        self.preview.set_message("Making the preview…")
        self.runner.preview(self._folder, job)

    def _on_preview(self, gcode: str, error: str) -> None:
        if self._debounce.isActive():
            return                                    # outdated: a newer preview is on its way
        if error:
            self.preview.set_burns([])
            self.preview.set_message(error, "danger")
            return
        segs = burn_segments(gcode)
        self.preview.set_burns(segs)
        self.preview.set_message("" if segs else "Nothing would burn: try another darkness or invert.",
                                 "text_3" if segs else "warning")
        self._gcode_ok = bool(segs)
        self._apply()

    # -- print ---------------------------------------------------------------------------------------------
    def _print(self) -> None:
        job = self._job()
        if job is None or not self._can_print():
            return
        what = f"“{job['name']}”" if job["mode"] == "text" else "the photo"
        holder = NAMES[self._shape].lower()
        box = QMessageBox(self)
        box.setWindowTitle(f"Print on the {holder} holder?")
        box.setText(f"Print {what} on the {holder} holder?")
        box.setInformativeText(f"Put a blank in the {holder} holder and keep the bed clear. The laser homes "
                               "first, then engraves at full power. Keep the lid closed.")
        box.setIconPixmap(theme.icon("alert", "warning", T.SP_32, stroke=1.5))
        go = box.addButton("Print", QMessageBox.ButtonRole.AcceptRole)
        box.addButton("Cancel", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        if box.clickedButton() is not go:
            return
        self.bar.setValue(0)
        self.runner.start_print(self._folder, self._port, job)
        self.busy_changed.emit(True)

    def _on_print_state(self, state: str, detail: str) -> None:
        holder = NAMES[self._shape].lower()
        text, tone = {
            "homing": ("Homing: the head drives to its HOME corner…", "secondary"),
            "engraving": (f"Engraving on the {holder} holder…", "secondary"),
            "stopping": ("Stopping: laser off, back to HOME…", "secondary"),
            "done": ("Done. The head is back at HOME; take the keychain out.", "success"),
            "stopped": (detail or "Stopped. The laser is off and the head is back at HOME.",
                        "warning" if detail else "secondary"),
            "failed": (f"Didn't print: {detail}", "danger"),
        }.get(state, ("", "secondary"))
        self._status_override = (text, tone)
        if state in ("done", "stopped", "failed"):
            self.busy_changed.emit(False)
        self._apply()

    def _on_progress(self, pct: int) -> None:
        self.bar.setValue(pct)

    def _can_print(self) -> bool:
        return not self._why_not()

    def _why_not(self) -> str:
        if not self._folder:
            return "Choose the printer-agent folder on the Orders tab."
        if self._error:
            return self._error
        if self._agent_running:
            return "The printer agent is using the laser. Stop it on the Orders tab to print here."
        if not self._port:
            return "Pick the laser's port on the Orders tab."
        if self._job() is None:
            return "Type the text to engrave." if self._mode == "text" else "Choose a photo."
        if not self._gcode_ok:
            return "Making the preview…" if self._debounce.isActive() or self.runner.previewing else \
                "The preview shows a problem; fix it to print."
        return ""

    # -- state ---------------------------------------------------------------------------------------------
    def _apply(self) -> None:
        busy = self.runner.busy
        self.text_box.setVisible(self._mode == "text")
        self.photo_box.setVisible(self._mode == "image")
        for w in (*self.tiles.values(), *self.mode_group.buttons(), self.text, *self.font_group.buttons(),
                  self.choose_btn, self.threshold, self.zoom, self.invert):
            w.setEnabled(not busy)
        self._show_slider_values()
        self.print_btn.setText(f"Print on the {NAMES[self._shape].lower()} holder")
        self.print_btn.setVisible(not busy)
        self.stop_btn.setVisible(busy)
        self.stop_btn.setEnabled(self.runner.state != "stopping")
        self.bar.setVisible(busy and self.runner.state == "engraving")
        reason = self._why_not()
        self.print_btn.setEnabled(not busy and not reason)
        if busy or (self._status_override and not reason):
            text, tone = self._status_override or ("", "secondary")
        else:
            self._status_override = None
            text, tone = reason, "secondary"
        self.status.setText(text)
        set_prop(self.status, "role", tone)
        self.status.setVisible(bool(text))

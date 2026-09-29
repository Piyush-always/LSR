"""Builds dist/LaserQueue.exe: a single file, no console window.

    .venv\\Scripts\\python build.py
"""
import pathlib
import sys

import PyInstaller.__main__
from PySide6.QtWidgets import QApplication

from theme import app_icon_pixmap

HERE = pathlib.Path(__file__).resolve().parent
BUILD = HERE / "build"

app = QApplication(sys.argv)                      # needed to render the icon
BUILD.mkdir(exist_ok=True)
icon = BUILD / "icon.ico"
if not app_icon_pixmap().save(str(icon), "ICO"):
    sys.exit("Couldn't write build/icon.ico (Qt's ICO image plugin is missing).")

PyInstaller.__main__.run([
    str(HERE / "app.py"),
    "--name", "LaserQueue",
    "--onefile",
    "--windowed",
    "--noconfirm",
    "--clean",
    "--icon", str(icon),
    "--distpath", str(HERE / "dist"),
    "--workpath", str(BUILD / "work"),
    "--specpath", str(BUILD),
    "--exclude-module", "tkinter",
])

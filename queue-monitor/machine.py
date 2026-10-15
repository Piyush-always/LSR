"""The three holders on the bed: machine.json in the printer-agent folder.

The printer agent reads the same file. x, y = a holder's centre in MACHINE
coordinates (mm from physical home); width, height, inset = the blank and how
far inside its edge the border is engraved. The border shapes match
printer-agent/holders.js exactly, so a trace here follows what a job engraves.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

SHAPES = ("heart", "rectangle", "circle")
FILE = "machine.json"
_KEYS = ("x", "y", "width", "height", "inset")


def load(folder: str | None) -> tuple[dict, str]:
    """The holders, and an error text if machine.json is missing or damaged."""
    if not folder:
        return {}, "Choose the printer-agent folder first."
    try:
        holders = json.loads((Path(folder) / FILE).read_text(encoding="utf-8"))["holders"]
    except FileNotFoundError:
        return {}, f"{FILE} is missing from the agent folder. In the repo folder run: git pull"
    except (OSError, ValueError, KeyError, TypeError) as e:
        return {}, f"{FILE} couldn't be read ({e})."
    for shape in SHAPES:
        h = holders.get(shape)
        if not isinstance(h, dict) or not all(isinstance(h.get(k), (int, float)) and math.isfinite(h[k]) for k in _KEYS):
            return {}, f"{FILE}: the {shape} holder needs numbers {', '.join(_KEYS)}."
    return holders, ""


def save_centre(folder: str, shape: str, x: float, y: float) -> dict:
    """Set one holder's centre (machine mm); everything else in the file is kept."""
    path = Path(folder) / FILE
    data = json.loads(path.read_text(encoding="utf-8"))
    data["holders"][shape]["x"] = round(x, 2)
    data["holders"][shape]["y"] = round(y, 2)
    tmp = path.with_name(FILE + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)                      # all or nothing: never half a file
    return data["holders"]


def border(shape: str, holder: dict) -> list[tuple[float, float]]:
    """The engraved border around (0, 0), mm, Y-up (same as holders.js borderPolyline)."""
    w = holder["width"] - 2 * holder["inset"]
    h = holder["height"] - 2 * holder["inset"]
    if shape == "circle":
        r = min(w, h) / 2
        return [(r * math.cos(a), r * math.sin(a)) for a in (2 * math.pi * i / 64 for i in range(65))]
    if shape == "heart":
        raw = []
        for i in range(129):
            t = i / 128 * 2 * math.pi
            raw.append((16 * math.sin(t) ** 3,
                        13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)))
        xs, ys = [p[0] for p in raw], [p[1] for p in raw]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        return [(((x - x0) / (x1 - x0) - 0.5) * w, ((y - y0) / (y1 - y0) - 0.5) * h) for x, y in raw]
    # rectangle with rounded corners
    r, hx, hy, pts = min(1.5, holder["height"] / 4), w / 2, h / 2, []
    for cx, cy, a0 in ((hx - r, -hy + r, -math.pi / 2), (hx - r, hy - r, 0.0),
                       (-hx + r, hy - r, math.pi / 2), (-hx + r, -hy + r, math.pi)):
        pts += [(cx + r * math.cos(a0 + math.pi / 2 * i / 8), cy + r * math.sin(a0 + math.pi / 2 * i / 8))
                for i in range(9)]
    return pts + [pts[0]]

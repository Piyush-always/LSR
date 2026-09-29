"""Design tokens: the only place colours, type sizes, spacing, radii and
durations are defined. Every other module reads from here.

Dark is the base theme; light is derived from it.
"""

MOTION_ENABLED = True

DARK = {
    "surface_0": "#131316",   # window / table background
    "surface_1": "#1A1A1F",   # toolbar, sidebar, inspector, status strip
    "surface_2": "#212127",   # cards, inputs, previews
    "surface_3": "#2A2A32",   # hover / selected
    "hairline": "rgba(255,255,255,0.08)",
    "hairline_st": "rgba(255,255,255,0.14)",
    "text_1": "#F5F5F7",
    "text_2": "rgba(245,245,247,0.62)",
    "text_3": "rgba(245,245,247,0.38)",
    "accent": "#0A84FF",
    "accent_hover": "#3D9CFF",
    "on_accent": "#FFFFFF",
    "success": "#30D158",
    "warning": "#FF9F0A",
    "danger": "#FF453A",
    # Engraving previews are white-on-dark (white = burn), so they sit on dark in both themes.
    "preview_bg": "#131316",
}

LIGHT = {
    "surface_0": "#FBFBFD",
    "surface_1": "#F2F2F5",
    "surface_2": "#FFFFFF",
    "surface_3": "#E6E6EB",
    "hairline": "rgba(0,0,0,0.10)",
    "hairline_st": "rgba(0,0,0,0.16)",
    "text_1": "#1D1D1F",
    "text_2": "rgba(29,29,31,0.60)",
    "text_3": "rgba(29,29,31,0.38)",
    "accent": "#007AFF",
    "accent_hover": "#1A88FF",
    "on_accent": "#FFFFFF",
    "success": "#34C759",
    "warning": "#FF9500",
    "danger": "#FF3B30",
    # Engraving previews are white-on-dark (white = burn), so they sit on dark in both themes.
    "preview_bg": "#131316",
}

# Type: three sizes, hierarchy comes from weight and colour.
FONT_UI = ("Segoe UI Variable Text", "Segoe UI")
FONT_MONO = ("Cascadia Mono", "Consolas")
SIZE_DISPLAY = 28
SIZE_BODY = 13
SIZE_MICRO = 10
TRACK_DISPLAY = -0.02     # em
TRACK_MICRO = 0.06        # em, micro labels are uppercase

# 4pt grid
SP_4, SP_8, SP_12, SP_16, SP_24, SP_32, SP_48 = 4, 8, 12, 16, 24, 32, 48

R_CONTROL = 6
R_CARD = 10
PILL_H = 20
DOT = 8

TOOLBAR_H = 52
STATUS_H = 24
CONTROL_H = 32
ROW_H = 36
SIDEBAR_W = 260
INSPECTOR_W = 320
PRIMARY_MIN_W = 560        # every table column visible without scrolling
SEARCH_W = 280
KEY_W = 96                # label column in key/value lists
STATE_TEXT_W = 384        # max line length of empty/error state copy

DUR_MICRO = 120
DUR_STANDARD = 220
DUR_AMBIENT = 1400        # skeleton shimmer, live printer pulse

# Behaviour
REFRESH_MS = 15_000
FULL_RELOAD_EVERY_S = 300
ONLINE_WITHIN_S = 60      # the agent heartbeats every 15 s
OFFLINE_AFTER_S = 300
EVENTS_SHOWN = 6
FEEDBACK_MS = 1200         # how long 'Copied' stays on the button

# Operator console (running the agent on this PC)
LOG_MAX_LINES = 3000
LOG_FLUSH_MS = 60          # coalesce agent output into one repaint
LASER_SILENT_S = 20        # port open but no reply from the laser this long -> show a hint
STOP_GRACE_MS = 6000       # after Ctrl+C, wait this long before force-stopping
LOG_MIN_H = 160

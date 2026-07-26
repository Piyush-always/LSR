// =====================================================================
//  KEYCHAIN LAYOUT — single source of truth (web side)
//  ⚠️  KEEP IN SYNC with printer-agent/text-to-gcode.js  SETTINGS / FONTS
// =====================================================================

window.KEYCHAIN_LAYOUT = {
    width: 72,            // mm — physical keychain width
    height: 35,           // mm — physical keychain height
    borderInset: 2,       // mm — engraved border distance from edge
    cornerRadius: 4,      // mm — keychain corner radius
    holeX: 7,             // mm — hole center X
    holeY: 17.5,          // mm — hole center Y (vertically centered)
    holeRadius: 2.5,      // mm — engraved hole radius
    textLeft: 14,         // mm — text area starts after the hole
    textRight: 70,        // mm — text area ends before right border
    maxChars: 20,         // max characters in name input
};

// ---------------------------------------------------------------------
// Font registry — id, label, web font-family stack, fixed cap height,
// printer-side .ttf filename. Each fixedCapHeight is in millimeters and
// is the value used by the SVG preview AND passed to the laser engraver.
// ---------------------------------------------------------------------
window.KEYCHAIN_FONTS = {
    pixel: {
        id: 'pixel',
        label: 'Pixel',
        family: "'Press Start 2P', 'Noto Emoji', monospace",
        fixedCapHeight: 4,        // mm — small because each glyph is wide
        file: 'PressStart2P-Regular.ttf',
    },
    bebas: {
        id: 'bebas',
        label: 'Bebas',
        family: "'Bebas Neue', 'Noto Emoji', sans-serif",
        fixedCapHeight: 7,
        file: 'BebasNeue-Regular.ttf',
    },
    montserrat: {
        id: 'montserrat',
        label: 'Modern',
        family: "'Montserrat', 'Noto Emoji', sans-serif",
        fixedCapHeight: 5,
        file: 'Montserrat-Bold.ttf',
    },
    marker: {
        id: 'marker',
        label: 'Marker',
        family: "'Permanent Marker', 'Noto Emoji', cursive",
        fixedCapHeight: 5,
        file: 'PermanentMarker-Regular.ttf',
    },
    pacifico: {
        id: 'pacifico',
        label: 'Script',
        family: "'Pacifico', 'Noto Emoji', cursive",
        fixedCapHeight: 5,
        file: 'Pacifico-Regular.ttf',
    },
};

window.DEFAULT_FONT_ID = 'pixel';

// ---------------------------------------------------------------------
// IMAGE keychain — engrave area + resolution.
// ⚠️  KEEP IN SYNC with printer-agent/image-to-gcode.js  IMAGE_AREA / SETTINGS
//
// Rectangle (mm) inside the keychain border, to the RIGHT of the hole, where
// an uploaded image is engraved. Same coordinate system as the SVG preview:
// origin at the keychain's top-left corner, +x right, +y down. The client
// fitter and the laser rasteriser BOTH use these numbers so the on-screen
// black/white preview matches what actually burns (WYSIWYG).
// ---------------------------------------------------------------------
window.KEYCHAIN_IMAGE_AREA = {
    x: 13,       // mm — left edge (clears the hole at x≈7 + border)
    y: 4,        // mm — top edge (inside the border)
    width: 56,   // mm — engrave area width
    height: 27,  // mm — engrave area height
};

// Engrave resolution — mm per pixel. Client renders the processed bitmap at
// this scale and the agent rasterises at the same scale. Must match
// printer-agent/image-to-gcode.js SETTINGS.pixelSize.
window.ENGRAVE_PIXEL_SIZE_MM = 0.15;

// Upload limits (mirrored in storage.rules + functions/index.js validation).
window.IMAGE_UPLOAD = {
    maxBytes: 5 * 1024 * 1024,  // 5 MB
    accept: 'image/png,image/jpeg,image/webp',
};

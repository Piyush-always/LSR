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
// Unified Shapes Registry — Single Source of Truth for all shapes
// ---------------------------------------------------------------------
window.KEYCHAIN_SHAPES = {
    rectangle: {
        id: 'rectangle',
        name: 'Rectangle',
        desc: '72 × 35 mm',
        width: 72,
        height: 35,
        viewBox: '-7 -7 86 49',
        viewBoxW: 86,
        viewBoxH: 49,
        originX: 7,
        originY: 7,
        dimLabelX: '72 mm',
        dimLabelY: '35 mm',
        hole: { cx: 7, cy: 17.5, r: 2.5 },
        outlineSvg: '<rect x="2" y="2" width="68" height="31" rx="4" ry="4" fill="none" stroke="#0a0a0a" stroke-width="0.4"/>',
        borderPathD: 'M 2 6 Q 2 2 6 2 H 66 Q 70 2 70 6 V 29 Q 70 33 66 33 H 6 Q 2 33 2 29 Z',
        clipPathD: 'M 2 6 Q 2 2 6 2 H 66 Q 70 2 70 6 V 29 Q 70 33 66 33 H 6 Q 2 33 2 29 Z',
        holeSvg: '<circle cx="7" cy="17.5" r="2.5" fill="none" stroke="#0a0a0a" stroke-width="0.4"/>',
        textArea: {
            x: 42,
            y: 17.5,
            anchor: 'middle',
            baseline: 'central',
            fontScale: 1.0,
            maxTextWidth: 52,
        },
        imageArea: {
            x: 13,
            y: 4,
            width: 56,
            height: 27,
        },
        dimensionLines: `
            <line x1="0" y1="-3" x2="72" y2="-3" stroke="#bbb" stroke-width="0.18"/>
            <line x1="0" y1="-2" x2="0" y2="-4" stroke="#bbb" stroke-width="0.18"/>
            <line x1="72" y1="-2" x2="72" y2="-4" stroke="#bbb" stroke-width="0.18"/>
            <text x="36" y="-4.5" font-size="2.6" text-anchor="middle" fill="#888" font-family="Inter, sans-serif" font-weight="600">72 mm</text>
            <line x1="-3" y1="0" x2="-3" y2="35" stroke="#bbb" stroke-width="0.18"/>
            <line x1="-2" y1="0" x2="-4" y2="0" stroke="#bbb" stroke-width="0.18"/>
            <line x1="-2" y1="35" x2="-4" y2="35" stroke="#bbb" stroke-width="0.18"/>
            <text x="-4.5" y="17.5" font-size="2.6" text-anchor="middle" fill="#888" font-family="Inter, sans-serif" font-weight="600" transform="rotate(-90, -4.5, 17.5)">35 mm</text>
        `,
        iconSvg: `
            <svg viewBox="0 0 72 35" width="44" height="22">
                <rect x="2" y="2" width="68" height="31" rx="4" fill="none" stroke="currentColor" stroke-width="2.2"/>
                <circle cx="8" cy="17.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
            </svg>
        `
    },
    circle: {
        id: 'circle',
        name: 'Circle',
        desc: 'Ø 50 mm',
        width: 50,
        height: 50,
        viewBox: '-7 -7 64 64',
        viewBoxW: 64,
        viewBoxH: 64,
        originX: 7,
        originY: 7,
        dimLabelX: 'Ø 50 mm',
        dimLabelY: 'Ø 50 mm',
        hole: { cx: 25, cy: 7, r: 2.5 },
        outlineSvg: '<circle cx="25" cy="25" r="23" fill="none" stroke="#0a0a0a" stroke-width="0.4"/>',
        borderPathD: 'M 25 2 A 23 23 0 1 1 24.99 2 Z',
        clipPathD: 'M 25 2 A 23 23 0 1 1 24.99 2 Z',
        holeSvg: '<circle cx="25" cy="7" r="2.5" fill="none" stroke="#0a0a0a" stroke-width="0.4"/>',
        textArea: {
            x: 25,
            y: 28,
            anchor: 'middle',
            baseline: 'central',
            fontScale: 0.85,
            maxTextWidth: 36,
        },
        imageArea: {
            x: 2,
            y: 2,
            width: 46,
            height: 46,
        },
        dimensionLines: `
            <line x1="0" y1="-3" x2="50" y2="-3" stroke="#bbb" stroke-width="0.18"/>
            <line x1="0" y1="-2" x2="0" y2="-4" stroke="#bbb" stroke-width="0.18"/>
            <line x1="50" y1="-2" x2="50" y2="-4" stroke="#bbb" stroke-width="0.18"/>
            <text x="25" y="-4.5" font-size="2.6" text-anchor="middle" fill="#888" font-family="Inter, sans-serif" font-weight="600">Ø 50 mm</text>
            <line x1="-3" y1="0" x2="-3" y2="50" stroke="#bbb" stroke-width="0.18"/>
            <line x1="-2" y1="0" x2="-4" y2="0" stroke="#bbb" stroke-width="0.18"/>
            <line x1="-2" y1="50" x2="-4" y2="50" stroke="#bbb" stroke-width="0.18"/>
            <text x="-4.5" y="25" font-size="2.6" text-anchor="middle" fill="#888" font-family="Inter, sans-serif" font-weight="600" transform="rotate(-90, -4.5, 25)">Ø 50 mm</text>
        `,
        iconSvg: `
            <svg viewBox="0 0 50 50" width="30" height="30">
                <circle cx="25" cy="25" r="22" fill="none" stroke="currentColor" stroke-width="2.2"/>
                <circle cx="25" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
            </svg>
        `
    },
    heart: {
        id: 'heart',
        name: 'Heart',
        desc: '55 × 50 mm',
        width: 55,
        height: 50,
        viewBox: '-7 -7 69 64',
        viewBoxW: 69,
        viewBoxH: 64,
        originX: 7,
        originY: 7,
        dimLabelX: '55 mm',
        dimLabelY: '50 mm',
        hole: { cx: 27.5, cy: 7, r: 2.5 },
        outlineSvg: '<path d="M 27.5 46 C 14 36 2 26 2 15 C 2 7 8 2 16 2 C 21.5 2 25.5 5.5 27.5 9.5 C 29.5 5.5 33.5 2 39 2 C 47 2 53 7 53 15 C 53 26 41 36 27.5 46 Z" fill="none" stroke="#0a0a0a" stroke-width="0.4"/>',
        borderPathD: 'M 27.5 46 C 14 36 2 26 2 15 C 2 7 8 2 16 2 C 21.5 2 25.5 5.5 27.5 9.5 C 29.5 5.5 33.5 2 39 2 C 47 2 53 7 53 15 C 53 26 41 36 27.5 46 Z',
        clipPathD: 'M 27.5 46 C 14 36 2 26 2 15 C 2 7 8 2 16 2 C 21.5 2 25.5 5.5 27.5 9.5 C 29.5 5.5 33.5 2 39 2 C 47 2 53 7 53 15 C 53 26 41 36 27.5 46 Z',
        holeSvg: '<circle cx="27.5" cy="7" r="2.5" fill="none" stroke="#0a0a0a" stroke-width="0.4"/>',
        textArea: {
            x: 27.5,
            y: 25,
            anchor: 'middle',
            baseline: 'central',
            fontScale: 0.85,
            maxTextWidth: 32,
        },
        imageArea: {
            x: 2,
            y: 2,
            width: 51,
            height: 44,
        },
        dimensionLines: `
            <line x1="0" y1="-3" x2="55" y2="-3" stroke="#bbb" stroke-width="0.18"/>
            <line x1="0" y1="-2" x2="0" y2="-4" stroke="#bbb" stroke-width="0.18"/>
            <line x1="55" y1="-2" x2="55" y2="-4" stroke="#bbb" stroke-width="0.18"/>
            <text x="27.5" y="-4.5" font-size="2.6" text-anchor="middle" fill="#888" font-family="Inter, sans-serif" font-weight="600">55 mm</text>
            <line x1="-3" y1="0" x2="-3" y2="50" stroke="#bbb" stroke-width="0.18"/>
            <line x1="-2" y1="0" x2="-4" y2="0" stroke="#bbb" stroke-width="0.18"/>
            <line x1="-2" y1="50" x2="-4" y2="50" stroke="#bbb" stroke-width="0.18"/>
            <text x="-4.5" y="25" font-size="2.6" text-anchor="middle" fill="#888" font-family="Inter, sans-serif" font-weight="600" transform="rotate(-90, -4.5, 25)">50 mm</text>
        `,
        iconSvg: `
            <svg viewBox="0 0 55 50" width="32" height="30">
                <path d="M 27.5 46 C 14 36 2 26 2 15 C 2 7 8 2 16 2 C 21.5 2 25.5 5.5 27.5 9.5 C 29.5 5.5 33.5 2 39 2 C 47 2 53 7 53 15 C 53 26 41 36 27.5 46 Z" fill="none" stroke="currentColor" stroke-width="2.2"/>
                <circle cx="27.5" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
            </svg>
        `
    }
};

window.DEFAULT_SHAPE_ID = 'rectangle';

window.getShape = function(shapeId) {
    return window.KEYCHAIN_SHAPES[shapeId] || window.KEYCHAIN_SHAPES[window.DEFAULT_SHAPE_ID];
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


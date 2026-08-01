// =====================================================================
//  TEXT → G-CODE — vector outline engraving for the laser
//  ⚠️  KEEP IN SYNC with js/keychain-layout.js
// =====================================================================

const opentype = require('opentype.js');
const fs = require('fs');
const path = require('path');

// #####################################################################
// ##                                                                 ##
// ##   🔧  EASY-EDIT SETTINGS — change these if you need to move    ##
// ##       where the keychain engraves or where the laser parks.    ##
// ##                                                                 ##
// ##       You ONLY need to change the numbers. Do not touch         ##
// ##       anything else in this file.                               ##
// ##                                                                 ##
// Precise shape holder offsets mapped from physical bed measurements (in mm relative to Home)
const SHAPE_POSITIONS = {
    circle:    { startOffsetX: 0, startOffsetY: 0 },
    rectangle: { startOffsetX: 0, startOffsetY: 0 },
    heart:     { startOffsetX: 0, startOffsetY: 0 },
};

function getPositionForShape(shape) {
    const key = String(shape || 'rectangle').toLowerCase().trim();
    return SHAPE_POSITIONS[key] || SHAPE_POSITIONS.rectangle;
}

const POSITION = {
    get startOffsetX() { return SHAPE_POSITIONS.rectangle.startOffsetX; },
    get startOffsetY() { return SHAPE_POSITIONS.rectangle.startOffsetY; },
};
// #####################################################################
// ##  End of easy-edit settings. Do not edit below this line unless  ##
// ##  you know what you are doing.                                   ##
// #####################################################################


// ===== KEYCHAIN LAYOUT (mirror of js/keychain-layout.js KEYCHAIN_LAYOUT) =====
const SETTINGS = {
    // Speeds
    feedRate: 800,           // mm/min — engraving speed (slower = darker)
    travelRate: 3000,        // mm/min — laser-off travel speed

    // Power
    maxPower: 1000,          // S value at full power (Creality CV-01 Pro: 0–1000)

    // Layout (must match js/keychain-layout.js)
    keychainWidth: 72,       // mm
    keychainHeight: 35,      // mm
    cornerRadius: 4,
    borderInset: 2,
    holeX: 7,                // hole center X
    holeY: 17.5,             // hole center Y
    holeRadius: 2.5,
    textLeft: 14,            // text area left edge
    textRight: 70,           // text area right edge

    // Curve flattening
    curveSegments: 10,       // segments per Bezier curve in glyph paths
    circleSegments: 64,      // segments for the hole circle
};

// ===== FONT REGISTRY (mirror of js/keychain-layout.js KEYCHAIN_FONTS) =====
const FONTS = {
    pixel:      { file: 'PressStart2P-Regular.ttf',     fixedCapHeight: 4 },
    bebas:      { file: 'BebasNeue-Regular.ttf',        fixedCapHeight: 7 },
    montserrat: { file: 'Montserrat-Bold.ttf',          fixedCapHeight: 5 },
    marker:     { file: 'PermanentMarker-Regular.ttf',  fixedCapHeight: 5 },
    pacifico:   { file: 'Pacifico-Regular.ttf',         fixedCapHeight: 5 },
};
const DEFAULT_FONT_ID = 'pixel';
const EMOJI_FONT_FILE = 'NotoEmoji-Regular.ttf';
const EMOJI_FALLBACK_GLYPH = '?';

// ===== FONT CACHE =====
const fontCache = {};

function loadFontById(fontId) {
    const id = FONTS[fontId] ? fontId : DEFAULT_FONT_ID;
    if (fontCache[id]) return fontCache[id];
    const fontPath = path.join(__dirname, 'fonts', FONTS[id].file);
    fontCache[id] = opentype.loadSync(fontPath);
    return fontCache[id];
}

let cachedEmojiFont = null;
function loadEmojiFont() {
    if (cachedEmojiFont) return cachedEmojiFont;
    const fontPath = path.join(__dirname, 'fonts', EMOJI_FONT_FILE);
    cachedEmojiFont = opentype.loadSync(fontPath);
    return cachedEmojiFont;
}

// ===== EMOJI DETECTION =====
function isEmoji(char) {
    const cp = char.codePointAt(0);
    return (
        (cp >= 0x1F300 && cp <= 0x1FAFF) ||  // misc symbols & pictographs, emoticons, supplemental
        (cp >= 0x2600  && cp <= 0x27BF)  ||  // misc symbols, dingbats
        (cp >= 0x1F000 && cp <= 0x1F2FF)     // mahjong, playing cards, enclosed alphanumerics
    );
}

// =================================================================
// MAIN ENTRY
// =================================================================
async function textToGcode(name, orderId, fontId = 'pixel', shape = 'rectangle') {
    const cleanFontId = FONTS[fontId] ? fontId : DEFAULT_FONT_ID;
    const fontMetric = FONTS[cleanFontId];
    const fontSize = fontMetric.fixedCapHeight;

    // Selective uppercase: Latin letters only, preserve emoji + symbols
    const cleanName = name.replace(/[a-z]/g, c => c.toUpperCase());

    // Build all paths in machine coordinates (Y-up, mm)
    const paths = [];

    if (shape === 'circle') {
        // Circle 50x50 mm
        paths.push(circlePolyline(25, 25, 23, SETTINGS.circleSegments));
        // Hole at (25, 43) in Y-up (7 mm from top)
        paths.push(circlePolyline(25, 43, SETTINGS.holeRadius, SETTINGS.circleSegments));
        const textPolylines = buildTextPolylinesCustom(cleanName, cleanFontId, fontSize * 0.85, 25, 22, 36);
        paths.push(...textPolylines);
    } else if (shape === 'heart') {
        // Heart 55x50 mm
        paths.push(heartPolyline(27.5, 24, 50, 44));
        // Hole at (27.5, 43) in Y-up (7 mm from top)
        paths.push(circlePolyline(27.5, 43, SETTINGS.holeRadius, SETTINGS.circleSegments));
        const textPolylines = buildTextPolylinesCustom(cleanName, cleanFontId, fontSize * 0.85, 27.5, 25, 32);
        paths.push(...textPolylines);
    } else {
        // Rectangle 72x35 mm (Default)
        paths.push(roundedRectPolyline(
            SETTINGS.borderInset,
            SETTINGS.borderInset,
            SETTINGS.keychainWidth - 2 * SETTINGS.borderInset,
            SETTINGS.keychainHeight - 2 * SETTINGS.borderInset,
            SETTINGS.cornerRadius
        ));
        paths.push(circlePolyline(SETTINGS.holeX, SETTINGS.keychainHeight - SETTINGS.holeY, SETTINGS.holeRadius, SETTINGS.circleSegments));
        const textPolylines = buildTextPolylines(cleanName, cleanFontId, fontSize * 1.0, 42, 17.5, 52);
        paths.push(...textPolylines);
    }

    // Generate G-code
    const gcodeText = pathsToGcode(paths, orderId, cleanName, cleanFontId, shape);

    // Save to file
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const gcodePath = path.join(outputDir, `keychain_${orderId}.gcode`);
    fs.writeFileSync(gcodePath, gcodeText);

    console.log(`[GCODE] Generated: ${gcodePath} (${gcodeText.split('\n').length} lines, font=${cleanFontId}, shape=${shape})`);
    return gcodePath;
}

// =================================================================
// BUILD TEXT POLYLINES — char-by-char, mixed fonts
// =================================================================
function buildTextPolylines(text, fontId, baseFontSize, centerX = (SETTINGS.textLeft + SETTINGS.textRight) / 2, centerY = SETTINGS.keychainHeight / 2, maxTextWidth = 52) {
    const textFont = loadFontById(fontId);
    const emojiFont = loadEmojiFont();

    // First pass: lay out all glyphs at x=0, y=0 to measure total width
    const chars = Array.from(text);
    const glyphPlacements = []; // { font, glyph, x }
    let cursorX = 0;

    for (const char of chars) {
        const useEmoji = isEmoji(char);
        let font = useEmoji ? emojiFont : textFont;
        let glyph = font.charToGlyph(char);

        // Fallback if the glyph is .notdef (codepoint not in font)
        if (glyph.unicode === undefined && useEmoji) {
            console.log(`[GCODE] Unsupported emoji: ${char} → fallback to '${EMOJI_FALLBACK_GLYPH}'`);
            font = textFont;
            glyph = font.charToGlyph(EMOJI_FALLBACK_GLYPH);
        }

        glyphPlacements.push({ font, glyph, x: cursorX });
        cursorX += (glyph.advanceWidth / font.unitsPerEm) * baseFontSize;
    }

    const unscaledTotalWidth = cursorX;

    // Scale font down if text exceeds maximum width for shape
    let effectiveFontSize = baseFontSize;
    if (unscaledTotalWidth > maxTextWidth && unscaledTotalWidth > 0) {
        const scale = maxTextWidth / unscaledTotalWidth;
        effectiveFontSize = baseFontSize * scale;
    }

    // Re-calculate placement X coordinates with effectiveFontSize
    let scaledCursorX = 0;
    for (const item of glyphPlacements) {
        item.x = scaledCursorX;
        scaledCursorX += (item.glyph.advanceWidth / item.font.unitsPerEm) * effectiveFontSize;
    }
    const totalWidth = scaledCursorX;

    // Center horizontally in the text area
    const offsetX = centerX - totalWidth / 2;

    // Center vertically — opentype draws glyphs with baseline at y=0,
    // ascenders going DOWN (Y-down convention). We need Y-up for the laser.
    // Place baseline at centerY - capHeight*0.35 so the cap-height-tall
    // text appears centered.
    const baselineY = centerY - effectiveFontSize * 0.35;

    const polylines = [];
    for (const { glyph, x } of glyphPlacements) {
        // opentype uses (x, y) with y being the baseline; we pass y=0 and flip later
        const glyphPath = glyph.getPath(x, 0, effectiveFontSize);
        const glyphPolylines = flattenOpentypePath(glyphPath);
        for (const poly of glyphPolylines) {
            const transformed = poly.map(([px, py]) => [
                px + offsetX,
                baselineY - py,  // flip Y (opentype Y-down → machine Y-up)
            ]);
            polylines.push(transformed);
        }
    }
    return polylines;
}

const buildTextPolylinesCustom = buildTextPolylines;

// =================================================================
// FLATTEN OPENTYPE PATH → POLYLINES
// =================================================================
function flattenOpentypePath(opentypePath) {
    const polylines = [];
    let current = null;
    let cx = 0, cy = 0;

    for (const cmd of opentypePath.commands) {
        if (cmd.type === 'M') {
            if (current && current.length > 0) polylines.push(current);
            current = [];
            cx = cmd.x; cy = cmd.y;
            current.push([cx, cy]);
        } else if (cmd.type === 'L') {
            cx = cmd.x; cy = cmd.y;
            current.push([cx, cy]);
        } else if (cmd.type === 'Q') {
            const x0 = cx, y0 = cy;
            for (let i = 1; i <= SETTINGS.curveSegments; i++) {
                const t = i / SETTINGS.curveSegments;
                const mt = 1 - t;
                const x = mt * mt * x0 + 2 * mt * t * cmd.x1 + t * t * cmd.x;
                const y = mt * mt * y0 + 2 * mt * t * cmd.y1 + t * t * cmd.y;
                current.push([x, y]);
            }
            cx = cmd.x; cy = cmd.y;
        } else if (cmd.type === 'C') {
            const x0 = cx, y0 = cy;
            for (let i = 1; i <= SETTINGS.curveSegments; i++) {
                const t = i / SETTINGS.curveSegments;
                const mt = 1 - t;
                const x = mt*mt*mt*x0 + 3*mt*mt*t*cmd.x1 + 3*mt*t*t*cmd.x2 + t*t*t*cmd.x;
                const y = mt*mt*mt*y0 + 3*mt*mt*t*cmd.y1 + 3*mt*t*t*cmd.y2 + t*t*t*cmd.y;
                current.push([x, y]);
            }
            cx = cmd.x; cy = cmd.y;
        } else if (cmd.type === 'Z') {
            if (current && current.length > 0) {
                const [fx, fy] = current[0];
                const [lx, ly] = current[current.length - 1];
                if (fx !== lx || fy !== ly) current.push([fx, fy]);
            }
        }
    }
    if (current && current.length > 0) polylines.push(current);
    return polylines;
}

// =================================================================
// SHAPE GENERATORS
// =================================================================
function circlePolyline(cx, cy, r, segments) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return points;
}

function roundedRectPolyline(x, y, w, h, r) {
    const segs = 8;
    const pts = [];
    function arc(cx, cy, startA, endA) {
        for (let i = 0; i <= segs; i++) {
            const a = startA + (endA - startA) * (i / segs);
            pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
    }
    pts.push([x + r, y + h]);
    pts.push([x + w - r, y + h]);
    arc(x + w - r, y + h - r, Math.PI / 2, 0);
    pts.push([x + w, y + r]);
    arc(x + w - r, y + r, 0, -Math.PI / 2);
    pts.push([x + r, y]);
    arc(x + r, y + r, -Math.PI / 2, -Math.PI);
    pts.push([x, y + h - r]);
    arc(x + r, y + h - r, Math.PI, Math.PI / 2);
    return pts;
}

function heartPolyline(cx, cy, w, h) {
    const pts = [];
    const segs = 32;
    for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * Math.PI * 2;
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push([cx + (x / 16) * (w / 2), cy + (y / 16) * (h / 2)]);
    }
    return pts;
}

// =================================================================
// PATHS → G-CODE
// =================================================================
function pathsToGcode(polylines, orderId, name, fontId, shape = 'rectangle') {
    const lines = [];

    lines.push('; Vector keychain G-code');
    lines.push(`; Order: ${orderId}`);
    lines.push(`; Name: ${name}`);
    lines.push(`; Font: ${fontId}`);
    lines.push(`; Shape: ${shape}`);
    lines.push(`; Mode: outline only`);
    lines.push(`; Total paths: ${polylines.length}`);
    lines.push('');
    // NOTE: HOME (G92 X0 Y0) is set ONCE when the printer agent connects
    // to the laser — see sendInitSequence() in laser-sender.js. Every job
    // runs in that shared coordinate system, so the laser reliably returns
    // to the exact same HOME after each job. That's what prevents drift
    // between prints.
    lines.push('G21');          // mm mode
    lines.push('G90');          // absolute positioning
    lines.push('M5');           // laser off
    lines.push(`F${SETTINGS.feedRate}`); // set default feedrate
    lines.push('');

    const pos = getPositionForShape(shape);
    const dx = pos.startOffsetX;
    const dy = pos.startOffsetY;

    for (const polyline of polylines) {
        if (!polyline || polyline.length < 2) continue;

        const [sx, sy] = polyline[0];
        lines.push('M5');
        lines.push(`G0 X${(sx + dx).toFixed(3)} Y${(sy + dy).toFixed(3)}`);
        lines.push(`M3 S${SETTINGS.maxPower}`);

        for (let i = 1; i < polyline.length; i++) {
            const [x, y] = polyline[i];
            lines.push(`G1 X${(x + dx).toFixed(3)} Y${(y + dy).toFixed(3)}`);
        }
    }

    lines.push('');
    lines.push('M5           ; laser off');
    lines.push('G0 X0 Y0     ; return to HOME');
    lines.push('G4 P1        ; wait 1 second before next job');

    return lines.join('\n');
}

module.exports = { textToGcode, SETTINGS, FONTS, POSITION, SHAPE_POSITIONS, getPositionForShape };

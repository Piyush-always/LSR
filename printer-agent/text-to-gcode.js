// =====================================================================
//  TEXT → G-CODE — vector outline engraving for the laser
//  ⚠️  KEEP IN SYNC with js/keychain-layout.js
// =====================================================================

const opentype = require('opentype.js');
const fs = require('fs');
const path = require('path');
const { placement, fitInside } = require('./holders');

// Where a keychain lands (its holder and its outline, from machine.json) is in holders.js.


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
    textLeft: 15,            // text area left edge
    textRight: 70,           // text area right edge

    // Curve flattening
    curveSegments: 10,       // segments per Bezier curve in glyph paths
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
const TEXT_MARGIN_MM = 1;      // the name stays at least this far inside the keychain outline
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

    // The keychain's outline as all-shapes-test.js draws it (no hole), and the name
    // centred inside it: cap height at most 48% of the keychain across, scaled down to
    // fit 78% of its length. On the upright rectangle the name runs along its length
    // (turned 90 degrees, reading upwards), as the website shows it along the long side.
    // (A dragged position from the website isn't used: the website's sizes differ.)
    const key = (shape === 'circle' || shape === 'heart') ? shape : 'rectangle';
    const place = placement(key);
    const { width, height } = place.blank;
    const along = place.turned ? height : width, across = place.turned ? width : height;
    const laidOut = buildTextPolylines(cleanName, cleanFontId, Math.min(fontSize, across * 0.48), 0, 0, along * 0.78);
    const placed = laidOut.map(poly => poly.map(([x, y]) => (place.turned
        ? [place.centre.x - y, place.centre.y + x]
        : [place.centre.x + x, place.centre.y + y])));
    // Keep the whole name at least TEXT_MARGIN_MM inside the outline (a long name on the
    // heart would otherwise reach its narrowing sides): shrink it around the centre.
    const textPolylines = fitInside(place.border, placed, place.centre, TEXT_MARGIN_MM);

    // All paths in machine coordinates (mm from HOME, Y-up)
    const paths = [place.border, ...textPolylines];

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
    // Feed rate set the way Tejas's hardware-tested code sets it (G1 F...). A bare
    // "F800" line is the likely cause of the error:20 failures seen on Oct 14.
    lines.push(`G1 F${SETTINGS.feedRate}`);
    lines.push('');

    for (const polyline of polylines) {
        if (!polyline || polyline.length < 2) continue;

        const [sx, sy] = polyline[0];
        lines.push('M5');
        lines.push(`G0 X${sx.toFixed(3)} Y${sy.toFixed(3)}`);
        lines.push(`M3 S${SETTINGS.maxPower}`);

        for (let i = 1; i < polyline.length; i++) {
            const [x, y] = polyline[i];
            lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)}`);
        }
    }

    lines.push('');
    lines.push('M5           ; laser off');
    // The caller performs a physical $H after the job, matching the shape test.
    lines.push('G4 P1        ; wait 1 second before physical homing');

    return lines.join('\n');
}

module.exports = { textToGcode, SETTINGS, FONTS };

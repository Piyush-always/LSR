const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const { placement } = require('./holders');

// =====================================================================
//  IMAGE → G-CODE — raster engraving for uploaded logo/line-art images.
//  ⚠️  KEEP IN SYNC with js/keychain-layout.js (KEYCHAIN_IMAGE_AREA +
//      ENGRAVE_PIXEL_SIZE_MM). The web client pre-processes the upload into a
//      black/white bitmap sized to exactly this area; it's resampled only for
//      its size on the real blank. Convention: WHITE pixel = burn, BLACK = skip.
//
//  Coordinate model matches text-to-gcode.js: the photo area is in the website
//  design's frame (mm, Y-UP) and holders.js places it on the real blank (centred
//  on the holder, turned and scaled like the name). HOME is set ONCE at connect
//  (see laser-sender.js) — we do NOT reset origin here.
// =====================================================================

// Per shape: keychain height (mm, to flip Y) and the engrave area in SVG/web
// coordinates (Y-down, origin at the keychain's top-left). Mirror of height and
// imageArea in js/keychain-layout.js: the photo the customer placed fills
// exactly this area.
const SHAPE_LAYOUT = {
    rectangle: { height: 35, area: { x: 13, y: 4, width: 56, height: 27 } },
    circle: { height: 50, area: { x: 2, y: 2, width: 46, height: 46 } },
    heart: { height: 50, area: { x: 2, y: 2, width: 51, height: 44 } },
};
const IMAGE_AREA = SHAPE_LAYOUT.rectangle.area;

const SETTINGS = {
    feedRate: 1500,         // mm/min — engraving speed (lower = deeper/darker)
    travelRate: 3000,       // mm/min — movement speed when laser is off
    maxPower: 1000,         // S value for full laser power (CV-01 Pro: S0-S1000)
    minPower: 0,            // S value for laser off
    pixelSize: 0.15,        // mm per pixel — MUST equal web ENGRAVE_PIXEL_SIZE_MM
};

/**
 * Converts a pre-processed black/white keychain PNG to G-code.
 * The image is expected to already be sized/letterboxed to IMAGE_AREA by the
 * web client; we scale defensively to the engrave-resolution grid anyway.
 * Assumes $32=1 (laser mode) has been set during connect().
 *
 * @param {string} imagePath - Path to the PNG image (white = burn)
 * @param {string} orderId - Used for filename
 * @param {string} shape - Keychain shape identifier ('rectangle', 'circle', 'heart')
 * @returns {string} Path to the generated .gcode file
 */
async function imageToGcode(imagePath, orderId, shape = 'rectangle') {
    const img = await loadImage(imagePath);
    const key = SHAPE_LAYOUT[shape] ? shape : 'rectangle';
    const layout = SHAPE_LAYOUT[key];
    const area = layout.area;
    const place = placement(key);

    // Engrave-resolution grid, resampled for the size on the real blank so the burn
    // lines stay SETTINGS.pixelSize apart there.
    const cols = Math.max(1, Math.round(area.width * place.scale / SETTINGS.pixelSize));
    const rows = Math.max(1, Math.round(area.height * place.scale / SETTINGS.pixelSize));

    const canvas = createCanvas(cols, rows);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, cols, rows);
    const pixels = ctx.getImageData(0, 0, cols, rows).data;

    // Design Y (Y-up) of the image area's TOP edge. row 0 sits here; deeper rows
    // step downward. A pixel's design position goes through toMachine().
    const areaTopY = layout.height - area.y;   // rectangle: 35 - 4 = 31
    const stepX = area.width / cols, stepY = area.height / rows;   // design mm per pixel
    const at = (row, col) => {
        const [x, y] = place.toMachine(area.x + col * stepX, areaTopY - row * stepY);
        return `X${x.toFixed(3)} Y${y.toFixed(3)}`;
    };

    const gcode = [];
    gcode.push('; Raster keychain G-code (uploaded image)');
    gcode.push(`; Order: ${orderId}`);
    gcode.push(`; Grid: ${cols} x ${rows} px @ ${SETTINGS.pixelSize} mm/px on the blank`);
    gcode.push(`; Engrave area (${key}): ${area.width} x ${area.height} mm design at (${area.x}, ${area.y}), x${place.scale.toFixed(3)}`);
    gcode.push('; Convention: white pixel = burn. HOME set at connect (no G92 here).');
    gcode.push('');
    gcode.push('G21          ; mm mode');
    gcode.push('G90          ; absolute positioning');
    gcode.push('M5           ; laser off');
    gcode.push(`G0 F${SETTINGS.travelRate}  ; travel speed`);
    gcode.push('M3 S0        ; arm laser (constant power mode, zero power)');
    gcode.push(`G1 F${SETTINGS.feedRate}    ; engrave speed`);
    gcode.push('');

    const brightnessAt = (row, col) => {
        const idx = (row * cols + col) * 4;
        return (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
    };

    for (let row = 0; row < rows; row++) {
        // Skip rows with no burn pixels.
        let hasContent = false;
        for (let c = 0; c < cols; c++) {
            if (brightnessAt(row, c) > 128) { hasContent = true; break; }
        }
        if (!hasContent) continue;

        // Bidirectional scan — alternate direction each row to save travel.
        const reverse = row % 2 === 1;
        const startCol = reverse ? cols - 1 : 0;
        const endCol = reverse ? -1 : cols;
        const stepCol = reverse ? -1 : 1;

        // Move to the row's start with the laser off.
        gcode.push(`G0 ${at(row, startCol)} S0`);

        // Walk the row, emitting a segment each time the power changes.
        let currentPower = -1;
        let col = startCol;
        for (col = startCol; col !== endCol; col += stepCol) {
            const power = brightnessAt(row, col) > 128 ? SETTINGS.maxPower : SETTINGS.minPower;
            if (power !== currentPower) {
                if (currentPower >= 0) {
                    gcode.push(`G1 ${at(row, col)} S${currentPower}`);
                }
                currentPower = power;
            }
        }
        // Flush the final segment of the row.
        if (currentPower >= 0) {
            gcode.push(`G1 ${at(row, col - stepCol)} S${currentPower}`);
        }
    }

    // Footer — laser off, return to HOME. No M2 (some GRBL builds reset the
    // controller / close the serial port on M2, breaking the next job).
    gcode.push('');
    gcode.push('M5           ; laser off');
    gcode.push('G0 X0 Y0     ; return to HOME');
    gcode.push('G4 P0.5      ; brief dwell so GRBL finishes moving before next job');

    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const gcodePath = path.join(outputDir, `keychain_${orderId}.gcode`);
    fs.writeFileSync(gcodePath, gcode.join('\n'));

    console.log(`[GCODE] Generated: ${gcodePath} (${gcode.length} lines, raster ${cols}x${rows})`);
    return gcodePath;
}

module.exports = { imageToGcode, SETTINGS, IMAGE_AREA, SHAPE_LAYOUT };

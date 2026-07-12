const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const { POSITION } = require('./text-to-gcode');

// =====================================================================
//  IMAGE → G-CODE — raster engraving for uploaded logo/line-art images.
//  ⚠️  KEEP IN SYNC with js/keychain-layout.js (KEYCHAIN_IMAGE_AREA +
//      ENGRAVE_PIXEL_SIZE_MM). The web client pre-processes the upload into a
//      black/white bitmap sized to exactly this area, so we map it 1:1 — no
//      re-fitting here. Convention: WHITE pixel = burn, BLACK = skip.
//
//  Coordinate model matches text-to-gcode.js: keychain frame is mm, Y-UP,
//  keychain occupying (0,0)–(72,35). HOME (G92 X0 Y0) is set ONCE at connect
//  (see laser-sender.js) — we do NOT reset origin here. START offset comes from
//  the shared POSITION block in text-to-gcode.js so text + image align.
// =====================================================================

const KEYCHAIN_HEIGHT = 35;   // mm — mirror of js/keychain-layout.js

// Engrave rectangle in SVG/web coordinates (Y-down, origin at keychain top-left).
// Mirror of window.KEYCHAIN_IMAGE_AREA.
const IMAGE_AREA = { x: 13, y: 4, width: 56, height: 27 };

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
 * @returns {string} Path to the generated .gcode file
 */
async function imageToGcode(imagePath, orderId) {
    const img = await loadImage(imagePath);

    // Engrave-resolution grid — same math as the web client.
    const cols = Math.round(IMAGE_AREA.width / SETTINGS.pixelSize);
    const rows = Math.round(IMAGE_AREA.height / SETTINGS.pixelSize);

    const canvas = createCanvas(cols, rows);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, cols, rows);
    const pixels = ctx.getImageData(0, 0, cols, rows).data;

    const dx = POSITION.startOffsetX;
    const dy = POSITION.startOffsetY;
    // Machine Y (Y-up) of the image area's TOP edge. row 0 sits here; deeper
    // rows step downward (decreasing machine Y).
    const areaTopY = KEYCHAIN_HEIGHT - IMAGE_AREA.y;   // 35 - 4 = 31

    const machineX = (col) => (IMAGE_AREA.x + col * SETTINGS.pixelSize + dx);
    const machineY = (row) => (areaTopY - row * SETTINGS.pixelSize + dy);

    const gcode = [];
    gcode.push('; Raster keychain G-code (uploaded image)');
    gcode.push(`; Order: ${orderId}`);
    gcode.push(`; Grid: ${cols} x ${rows} px @ ${SETTINGS.pixelSize} mm/px`);
    gcode.push(`; Engrave area: ${IMAGE_AREA.width} x ${IMAGE_AREA.height} mm at (${IMAGE_AREA.x}, ${IMAGE_AREA.y})`);
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

        const y = machineY(row).toFixed(3);

        // Bidirectional scan — alternate direction each row to save travel.
        const reverse = row % 2 === 1;
        const startCol = reverse ? cols - 1 : 0;
        const endCol = reverse ? -1 : cols;
        const stepCol = reverse ? -1 : 1;

        // Move to the row's starting X with the laser off.
        gcode.push(`G0 X${machineX(startCol).toFixed(3)} Y${y} S0`);

        // Walk the row, emitting a segment each time the power changes.
        let currentPower = -1;
        let col = startCol;
        for (col = startCol; col !== endCol; col += stepCol) {
            const power = brightnessAt(row, col) > 128 ? SETTINGS.maxPower : SETTINGS.minPower;
            if (power !== currentPower) {
                if (currentPower >= 0) {
                    gcode.push(`G1 X${machineX(col).toFixed(3)} S${currentPower}`);
                }
                currentPower = power;
            }
        }
        // Flush the final segment of the row.
        if (currentPower >= 0) {
            gcode.push(`G1 X${machineX(col - stepCol).toFixed(3)} S${currentPower}`);
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

module.exports = { imageToGcode, SETTINGS, IMAGE_AREA };

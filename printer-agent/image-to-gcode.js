const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

// ===== ENGRAVING SETTINGS =====
// Tuned for Creality CV-01 Pro
const SETTINGS = {
    feedRate: 1500,         // mm/min — engraving speed (lower = deeper/darker)
    travelRate: 3000,       // mm/min — movement speed when laser is off
    maxPower: 1000,         // S value for full laser power (CV-01 Pro: S0-S1000)
    minPower: 0,            // S value for laser off
    pixelSize: 0.15,        // mm per pixel — resolution
    engravingWidth: 35,     // mm — physical width of keychain engraving area
    lineByLine: true,       // bidirectional scanning (faster)
};

/**
 * Converts a keychain PNG image to G-code for laser engraving.
 * Assumes $32=1 (laser mode) has already been set during connect().
 *
 * @param {string} imagePath - Path to the PNG image
 * @param {string} orderId - Used for filename
 * @returns {string} Path to the generated .gcode file
 */
async function imageToGcode(imagePath, orderId) {
    const img = await loadImage(imagePath);

    // Scale image to match physical size
    const scaledWidth = Math.round(SETTINGS.engravingWidth / SETTINGS.pixelSize);
    const scaledHeight = Math.round((img.height / img.width) * scaledWidth);

    const canvas = createCanvas(scaledWidth, scaledHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);

    const imageData = ctx.getImageData(0, 0, scaledWidth, scaledHeight);
    const pixels = imageData.data;

    const gcode = [];

    // Header
    gcode.push('; Laser Keychain G-code');
    gcode.push('; Generated for Creality CV-01 Pro');
    gcode.push(`; Order: ${orderId}`);
    gcode.push(`; Image: ${scaledWidth} x ${scaledHeight} pixels`);
    gcode.push(`; Physical size: ${SETTINGS.engravingWidth}mm x ${(scaledHeight * SETTINGS.pixelSize).toFixed(1)}mm`);
    gcode.push(`; Resolution: ${SETTINGS.pixelSize}mm/pixel`);
    gcode.push('; Note: $32=1 is set by the printer agent during connect(), not here.');
    gcode.push('');
    gcode.push('G21          ; mm mode');
    gcode.push('G90          ; absolute positioning');
    gcode.push('M5           ; laser off');
    gcode.push('G92 X0 Y0    ; set current position as origin');
    gcode.push(`G0 F${SETTINGS.travelRate}  ; travel speed`);
    gcode.push('M3 S0        ; arm laser (constant power mode, zero power)');
    gcode.push(`G1 F${SETTINGS.feedRate}    ; engrave speed`);
    gcode.push('');

    // Scan each row
    for (let y = 0; y < scaledHeight; y++) {
        const yPos = (y * SETTINGS.pixelSize).toFixed(3);

        // Bidirectional scanning
        const reverse = SETTINGS.lineByLine && (y % 2 === 1);
        const startX = reverse ? scaledWidth - 1 : 0;
        const endX = reverse ? -1 : scaledWidth;
        const stepX = reverse ? -1 : 1;

        // Check if this row has any white pixels — skip empty rows
        let hasContent = false;
        for (let checkX = 0; checkX < scaledWidth; checkX++) {
            const idx = (y * scaledWidth + checkX) * 4;
            const brightness = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
            if (brightness > 128) {
                hasContent = true;
                break;
            }
        }
        if (!hasContent) continue;

        // Move to row start with laser off
        const rowStartX = reverse
            ? ((scaledWidth - 1) * SETTINGS.pixelSize).toFixed(3)
            : '0.000';
        gcode.push(`G0 X${rowStartX} Y${yPos} S0`);

        // Scan pixels in this row
        let currentPower = -1;
        let x = startX;

        for (x = startX; x !== endX; x += stepX) {
            const idx = (y * scaledWidth + x) * 4;
            const brightness = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;

            // White = engrave, Black = skip
            const power = brightness > 128 ? SETTINGS.maxPower : SETTINGS.minPower;

            if (power !== currentPower) {
                if (currentPower >= 0) {
                    const xPos = (x * SETTINGS.pixelSize).toFixed(3);
                    gcode.push(`G1 X${xPos} S${currentPower}`);
                }
                currentPower = power;
            }
        }

        // Output last segment of the row
        if (currentPower >= 0) {
            const xPos = ((x - stepX) * SETTINGS.pixelSize).toFixed(3);
            gcode.push(`G1 X${xPos} S${currentPower}`);
        }
    }

    // Footer — guarantee laser off before homing.
    // NOTE: no M2 (program end) — on some GRBL builds M2 resets the controller
    // and closes the USB serial port, which breaks the next job.
    gcode.push('');
    gcode.push('M5           ; laser off');
    gcode.push('G0 X0 Y0     ; return to origin');
    gcode.push('G4 P0.5      ; brief dwell so GRBL finishes moving before next job');

    // Save G-code file
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const gcodeFileName = `keychain_${orderId}.gcode`;
    const gcodePath = path.join(outputDir, gcodeFileName);
    fs.writeFileSync(gcodePath, gcode.join('\n'));

    console.log(`[GCODE] Generated: ${gcodePath} (${gcode.length} lines)`);
    return gcodePath;
}

module.exports = { imageToGcode, SETTINGS };

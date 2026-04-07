const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

// Keychain dimensions (in pixels — adjust based on your laser printer DPI)
const WIDTH = 1200;   // ~100mm at 300 DPI
const HEIGHT = 500;   // ~42mm at 300 DPI
const HOLE_RADIUS = 40;
const CORNER_RADIUS = 40;
const BORDER_WIDTH = 4;

/**
 * Generates a keychain engraving image (white on black)
 * Black = no engrave, White = engrave
 *
 * @param {string} name - The name to engrave
 * @param {string} orderId - Used for the filename
 * @returns {string} Path to the generated image file
 */
function generateKeychainImage(name, orderId) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');

    // Background — black (no engrave)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Keychain outline — white (engrave)
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = BORDER_WIDTH;
    roundedRect(ctx, BORDER_WIDTH, BORDER_WIDTH, WIDTH - BORDER_WIDTH * 2, HEIGHT - BORDER_WIDTH * 2, CORNER_RADIUS);
    ctx.stroke();

    // Keychain hole (left side)
    const holeX = 80;
    const holeY = HEIGHT / 2;
    ctx.beginPath();
    ctx.arc(holeX, holeY, HOLE_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = BORDER_WIDTH;
    ctx.stroke();

    // Inner hole
    ctx.beginPath();
    ctx.arc(holeX, holeY, HOLE_RADIUS - 12, 0, Math.PI * 2);
    ctx.stroke();

    // Name text — centered in the right portion
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Auto-size font based on name length
    const textAreaX = (WIDTH + 160) / 2; // offset past the hole area
    let fontSize = 120;
    if (name.length > 10) fontSize = 70;
    else if (name.length > 7) fontSize = 90;
    else if (name.length > 5) fontSize = 100;

    ctx.font = `bold ${fontSize}px "Arial", sans-serif`;
    ctx.fillText(name.toUpperCase(), textAreaX, HEIGHT / 2);

    // Save to file
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const fileName = `keychain_${orderId}_${name.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    const filePath = path.join(outputDir, fileName);

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(filePath, buffer);

    console.log(`[IMAGE] Generated: ${filePath}`);
    return filePath;
}

function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

module.exports = { generateKeychainImage };

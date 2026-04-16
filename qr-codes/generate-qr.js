/**
 * QR Code Generator
 *
 * Generates high-resolution QR code PNGs for any URL listed in TARGETS below.
 * Output files land in this same folder.
 *
 * Usage:   node generate-qr.js
 * Add a new QR by adding a new entry to the TARGETS array.
 */

const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

// =====================================================================
// 🔧  EDIT THIS LIST to add / remove QR codes to generate.
// =====================================================================
// Each entry makes one PNG file in this folder.
//   name: used as the file name  → <name>.png
//   url:  URL the QR encodes
// =====================================================================
const TARGETS = [
    {
        name: 'laser-inv',
        url:  'https://laser-inv.web.app',
    },
    {
        name: 'create-mytag',
        url:  'https://create-mytag.invengic.in',
    },
];

// =====================================================================
// Options applied to every QR code.
// =====================================================================
const OPTIONS = {
    width: 1024,      // pixel size of the output image
    margin: 2,        // white border thickness (in QR modules)
    color: {
        dark:  '#000000',    // QR dots
        light: '#ffffff',    // background
    },
    errorCorrectionLevel: 'M',  // L | M | Q | H (higher = denser QR, more resilient)
};

// =====================================================================
// Run
// =====================================================================
async function run() {
    console.log(`Generating ${TARGETS.length} QR code(s)...\n`);

    for (const target of TARGETS) {
        const outputPath = path.join(__dirname, `${target.name}.png`);
        await QRCode.toFile(outputPath, target.url, OPTIONS);
        const size = (fs.statSync(outputPath).size / 1024).toFixed(1);
        console.log(`✓ ${target.name}.png   →   ${target.url}   (${size} KB)`);
    }

    console.log('\nAll done.');
}

run().catch(err => {
    console.error('Error generating QR codes:', err);
    process.exit(1);
});

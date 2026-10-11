// Where each shape's holder sits on the bed, and the offset that puts a keychain
// drawing on it.
//
// holders.json (next to this file, not in git: it belongs to one machine) holds
// the CENTRE of each holder in mm from HOME, saved by Laser Queue's
// "Calibrate holders" screen:
//   { "rectangle": { "x": 120.5, "y": 40.2 }, "circle": { ... }, "heart": { ... } }
// It is read once when the agent starts, so restart the agent after calibrating.
const fs = require('fs');
const path = require('path');

const HOLDERS_PATH = path.join(__dirname, 'holders.json');

// Middle of each keychain in its own drawing (mm, Y-up, from its bottom-left corner).
const DESIGN_CENTRE = { rectangle: [36, 17.5], circle: [25, 25], heart: [27.5, 25] };

function loadHolders() {
    try {
        return JSON.parse(fs.readFileSync(HOLDERS_PATH, 'utf-8')) || {};
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`[HOLDERS] Could not read holders.json: ${err.message}`);
        return {};
    }
}

const HOLDERS = loadHolders();

// Offset to add to a shape's drawing so it lands on its holder; null if that
// holder hasn't been calibrated.
function holderOffset(shape) {
    const centre = HOLDERS[shape];
    const design = DESIGN_CENTRE[shape];
    if (!centre || !design || !Number.isFinite(centre.x) || !Number.isFinite(centre.y)) return null;
    return { startOffsetX: centre.x - design[0], startOffsetY: centre.y - design[1] };
}

function holderCentre(shape) {
    const c = HOLDERS[shape];
    return c && Number.isFinite(c.x) && Number.isFinite(c.y) ? { x: c.x, y: c.y } : null;
}

module.exports = { HOLDERS_PATH, DESIGN_CENTRE, holderOffset, holderCentre };

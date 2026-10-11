// Where each shape's holder sits on the bed, the real blank in it, and how a
// website design is placed onto that blank.
//
// holders.json (next to this file, not in git: it belongs to one machine) holds
// the CENTRE of each holder in mm from HOME (where homing leaves the head), saved
// by Laser Queue's "Calibrate holders" screen:
//   { "rectangle": { "x": 170, "y": 28 }, "circle": { ... }, "heart": { ... } }
// It is read once when the agent starts, so restart the agent after calibrating.
const fs = require('fs');
const path = require('path');

const HOLDERS_PATH = path.join(__dirname, 'holders.json');
const SHAPES = ['rectangle', 'circle', 'heart'];

// The real blanks: the border engraved on each, from Tejas's shape tests
// (rectangle_test.js, circle_test.js, heart_test.js), traced on the machine.
// mm, centred on the holder. `rotate` (degrees) turns the website design to lie
// like the blank: 90 puts the rectangle's long side along machine Y, with the end
// that has the hole on the website at the low-Y end. `fit` shrinks the design further
// where the shapes differ: the website heart is fuller at the bottom than Tejas's,
// and 0.83 keeps it (and a photo filling it) at least 0.5 mm inside the border.
const BLANKS = {
    rectangle: { width: 29, height: 61, rotate: 90 },   // stands upright on the bed
    circle:    { width: 90, height: 90, rotate: 0 },    // radius 45
    heart:     { width: 45, height: 45, rotate: 0, fit: 0.83 },
};

// The border box of each website design (mm, Y-up, from the design's bottom-left;
// js/keychain-layout.js): the rectangle's rounded border, the circle's ring, the heart.
const DESIGN_BORDER = {
    rectangle: { x0: 2, y0: 2, x1: 70, y1: 33 },
    circle:    { x0: 2, y0: 2, x1: 48, y1: 48 },
    heart:     { x0: 2, y0: 4, x1: 53, y1: 48 },
};

function loadHolders() {
    try {
        return JSON.parse(fs.readFileSync(HOLDERS_PATH, 'utf-8')) || {};
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`[HOLDERS] Could not read holders.json: ${err.message}`);
        return {};
    }
}

const HOLDERS = loadHolders();

function holderCentre(shape) {
    const c = HOLDERS[shape];
    return c && Number.isFinite(c.x) && Number.isFinite(c.y) ? { x: c.x, y: c.y } : null;
}

function missingHolders() {
    return SHAPES.filter(shape => !holderCentre(shape));
}

// The blank's border around (0, 0), drawn exactly as Tejas's tests draw it.
function borderPolyline(shape) {
    const { width, height } = BLANKS[shape];
    if (shape === 'circle') {
        const r = width / 2, segments = 64;
        const pts = [];
        for (let i = 0; i <= segments; i++) {
            const a = (2 * Math.PI * i) / segments;
            pts.push([r * Math.cos(a), r * Math.sin(a)]);
        }
        return pts;
    }
    if (shape === 'heart') {
        const raw = [];
        for (let i = 0; i <= 128; i++) {
            const t = (i / 128) * Math.PI * 2;
            raw.push([16 * Math.sin(t) ** 3,
                13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
        }
        const xs = raw.map(p => p[0]), ys = raw.map(p => p[1]);
        const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        return raw.map(([x, y]) => [((x - minX) / (maxX - minX) - 0.5) * width,
                                    ((y - minY) / (maxY - minY) - 0.5) * height]);
    }
    const hx = width / 2, hy = height / 2;
    return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy], [-hx, -hy]];
}

// Where everything for one shape lands on the machine (mm from HOME): the blank's
// border, and toMachine() for points of the website design. The design is centred
// on the holder, turned like the blank and scaled so its border fits the real one,
// so the name and photo keep the layout the customer saw.
function placement(shape) {
    const centre = holderCentre(shape);
    if (!centre || !BLANKS[shape]) throw new Error(`The ${shape} holder isn't calibrated (holders.json)`);
    const blank = BLANKS[shape];
    const box = DESIGN_BORDER[shape];
    const a = (blank.rotate * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    const turnedW = Math.abs(w * cos) + Math.abs(h * sin);
    const turnedH = Math.abs(w * sin) + Math.abs(h * cos);
    const scale = Math.min(blank.width / turnedW, blank.height / turnedH) * (blank.fit || 1);
    const mx = (box.x0 + box.x1) / 2, my = (box.y0 + box.y1) / 2;
    return {
        centre,
        scale,
        border: borderPolyline(shape).map(([x, y]) => [centre.x + x, centre.y + y]),
        toMachine(x, y) {
            const dx = (x - mx) * scale, dy = (y - my) * scale;
            return [centre.x + dx * cos - dy * sin, centre.y + dx * sin + dy * cos];
        },
    };
}

module.exports = { HOLDERS_PATH, SHAPES, BLANKS, holderCentre, missingHolders, borderPolyline, placement };

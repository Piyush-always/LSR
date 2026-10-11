// The three holders on the bed and the blank in each: machine.json (Tejas's
// hardware-tested values). Nothing is calibrated per PC.
//
// Holder centres are MACHINE coordinates (MPos) from physical home ($H). After
// homing, laser-sender reports where the head actually stopped, and every position
// here is converted to mm from that spot (= HOME, G92 X0 Y0). So even if homing
// stops a fraction of a millimetre away from MPos 0,0, the holders are still hit
// exactly.
const fs = require('fs');
const path = require('path');

const MACHINE_PATH = path.join(__dirname, 'machine.json');
const SHAPES = ['heart', 'rectangle', 'circle'];

function loadMachine() {
    const machine = JSON.parse(fs.readFileSync(MACHINE_PATH, 'utf-8'));
    for (const shape of SHAPES) {
        const h = (machine.holders || {})[shape];
        const ok = h && ['x', 'y', 'width', 'height', 'inset'].every(k => Number.isFinite(h[k]))
            && h.width > 0 && h.height > 0 && h.inset >= 0 && h.inset * 2 < Math.min(h.width, h.height);
        if (!ok) throw new Error(`machine.json: the ${shape} holder needs numbers x, y, width, height and inset`);
    }
    return machine.holders;
}

const HOLDERS = loadMachine();
let homeMpos = { x: 0, y: 0 };   // machine position of HOME; set after every homing

function setHomeMachinePosition(pos) {
    homeMpos = { x: pos.x, y: pos.y };
}

function holder(shape) {
    const h = HOLDERS[shape];
    if (!h) throw new Error(`No holder for the shape "${shape}"`);
    return h;
}

// A holder's centre in mm from HOME.
function holderCentre(shape) {
    const h = holder(shape);
    return { x: h.x - homeMpos.x, y: h.y - homeMpos.y };
}

// The engraved border around (0, 0), drawn as Tejas's code draws it: inset from
// the blank's edge; a circle, his parametric heart, or a rounded rectangle.
function borderPolyline(shape) {
    const { width, height, inset } = holder(shape);
    const w = width - 2 * inset, h = height - 2 * inset;
    if (shape === 'circle') {
        const r = Math.min(w, h) / 2, segments = 64;
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
        return raw.map(([x, y]) => [((x - minX) / (maxX - minX) - 0.5) * w, ((y - minY) / (maxY - minY) - 0.5) * h]);
    }
    // rectangle: rounded corners, radius as in Tejas's code
    const r = Math.min(1.5, height / 4), hx = w / 2, hy = h / 2, segs = 8, pts = [];
    const arc = (cx, cy, a0, a1) => {
        for (let i = 0; i <= segs; i++) {
            const a = a0 + ((a1 - a0) * i) / segs;
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
    };
    arc(hx - r, -hy + r, -Math.PI / 2, 0);
    arc(hx - r, hy - r, 0, Math.PI / 2);
    arc(-hx + r, hy - r, Math.PI / 2, Math.PI);
    arc(-hx + r, -hy + r, Math.PI, 1.5 * Math.PI);
    pts.push(pts[0]);
    return pts;
}

// Everything the engravers need for one shape, in mm from HOME.
function placement(shape) {
    const h = holder(shape);
    const centre = holderCentre(shape);
    return {
        centre,
        blank: { width: h.width, height: h.height, inset: h.inset },
        border: borderPolyline(shape).map(([x, y]) => [centre.x + x, centre.y + y]),
    };
}

module.exports = { MACHINE_PATH, SHAPES, HOLDERS, setHomeMachinePosition, holderCentre, borderPolyline, placement };

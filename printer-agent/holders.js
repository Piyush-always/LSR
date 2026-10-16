// The three holders on the bed: machine.json, matching all-shapes-test.js, which
// draws each outline at the right place, size and shape on the machine
// (hardware-verified). Nothing is calibrated per PC.
//
// Holder centres are MACHINE coordinates (MPos), the numbers Tejas's tools move to with
// G53 (auto-position-test.py, all-shapes-test.js). After homing, laser-sender reads
// where the head actually stopped (the CV-01 reports about -30,-30), and every position
// here is converted to mm from that spot (= HOME, G92 X0 Y0). So the agent lands
// exactly where a G53 move to the same numbers lands.
const fs = require('fs');
const path = require('path');

const MACHINE_PATH = path.join(__dirname, 'machine.json');
const SHAPES = ['heart', 'rectangle', 'circle'];

function loadMachine() {
    const machine = JSON.parse(fs.readFileSync(MACHINE_PATH, 'utf-8'));
    for (const shape of SHAPES) {
        const h = (machine.holders || {})[shape];
        const ok = h && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(h[k])) && h.width > 0 && h.height > 0;
        if (!ok) throw new Error(`machine.json: the ${shape} holder needs numbers x, y, width and height`);
    }
    return machine.holders;
}

const HOLDERS = loadMachine();
let homeMpos = null;   // machine position of HOME; set after every homing

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
    if (!homeMpos) throw new Error('HOME is not known yet: home the laser first');
    return { x: h.x - homeMpos.x, y: h.y - homeMpos.y };
}

// The keychain outline around (0, 0), exactly as all-shapes-test.js draws it:
// his parametric heart scaled to width x height, a circle, or a rectangle.
function borderPolyline(shape) {
    const { width, height } = holder(shape);
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
        return raw.map(([x, y]) => [((x - minX) / (maxX - minX) - 0.5) * width, ((y - minY) / (maxY - minY) - 0.5) * height]);
    }
    const hx = width / 2, hy = height / 2;
    return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy], [-hx, -hy]];
}

// Everything the engravers need for one shape, in mm from HOME. `turned` is true for
// a holder taller than it is wide (the rectangle stands upright on the bed): the
// name and photo are turned 90 degrees to run along its length.
function placement(shape) {
    const h = holder(shape);
    const centre = holderCentre(shape);
    return {
        centre,
        blank: { width: h.width, height: h.height },
        turned: h.height > h.width,
        border: borderPolyline(shape).map(([x, y]) => [centre.x + x, centre.y + y]),
    };
}

// Smallest distance (mm) from the polylines' points to the outline; negative if any is outside.
function clearance(outline, polylines) {
    let worst = Infinity;
    for (const poly of polylines) {
        for (const [px, py] of poly) {
            let inside = false, d = Infinity;
            for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
                const [xi, yi] = outline[i], [xj, yj] = outline[j];
                if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
                const dx = xi - xj, dy = yi - yj, len = dx * dx + dy * dy;
                const t = len ? Math.max(0, Math.min(1, ((px - xj) * dx + (py - yj) * dy) / len)) : 0;
                d = Math.min(d, Math.hypot(px - xj - t * dx, py - yj - t * dy));
            }
            worst = Math.min(worst, inside ? d : -d);
        }
    }
    return worst;
}

// Shrink polylines around `centre` until every point is at least `margin` mm inside the
// outline (the heart narrows towards its tip). Unchanged if they already fit.
function fitInside(outline, polylines, centre, margin) {
    const scaled = (s) => polylines.map(poly => poly.map(([x, y]) => [centre.x + (x - centre.x) * s, centre.y + (y - centre.y) * s]));
    if (clearance(outline, polylines) >= margin) return polylines;
    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (clearance(outline, scaled(mid)) >= margin) lo = mid; else hi = mid;
    }
    return scaled(lo);
}

module.exports = { MACHINE_PATH, SHAPES, HOLDERS, setHomeMachinePosition, holderCentre, borderPolyline, placement, clearance, fitInside };

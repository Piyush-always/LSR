// =====================================================================
//  PHOTO → PRINT IMAGE — the website's photo processing (js/image-processor.js),
//  for photos engraved from Laser Queue's Local print tab without a website order.
//  Same steps and numbers as the website: fit the photo into the shape's photo
//  area at the engrave resolution, drop the plain background around it, clip it
//  to the website's keychain shape, then threshold to black/white.
//  Output convention, as the website uploads it: WHITE = burn, transparent = skip.
//  The shapes, photo areas and pixel size are read from js/keychain-layout.js.
// =====================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, loadImage, Path2D } = require('@napi-rs/canvas');

const LAYOUT_FILE = path.join(__dirname, '..', 'js', 'keychain-layout.js');
const BG_TOLERANCE = 60;   // the website's default background keying tolerance

function websiteLayout() {
    if (!fs.existsSync(LAYOUT_FILE)) {
        throw new Error(`The website's keychain-layout.js is missing (${LAYOUT_FILE}); in the repo folder run: git pull`);
    }
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(LAYOUT_FILE, 'utf-8'), sandbox);
    return sandbox.window;
}

// The website's _applyBackgroundRemoval: flood-fill from the photo's edge, making
// pixels close to the edge's average colour transparent.
function removeBackground(ctx, w, h, dx, dy, dw, dh) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const startX = Math.max(0, Math.floor(dx)), endX = Math.min(w - 1, Math.ceil(dx + dw));
    const startY = Math.max(0, Math.floor(dy)), endY = Math.min(h - 1, Math.ceil(dy + dh));
    if (endX <= startX || endY <= startY) return;

    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    const sample = (x, y) => {
        const i = (y * w + x) * 4;
        if (data[i + 3] > 10) { sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; count++; }
    };
    for (let x = startX; x <= endX; x++) { sample(x, startY); sample(x, endY); }
    for (let y = startY + 1; y < endY; y++) { sample(startX, y); sample(endX, y); }
    if (count === 0) return;
    const bgR = sumR / count, bgG = sumG / count, bgB = sumB / count;

    const visited = new Uint8Array(w * h);
    const queue = [];
    for (let x = startX; x <= endX; x++) queue.push(startY * w + x, endY * w + x);
    for (let y = startY + 1; y < endY; y++) queue.push(y * w + startX, y * w + endX);
    for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        if (visited[idx]) continue;
        visited[idx] = 1;
        if (data[idx * 4 + 3] < 10) continue;
        const dist = Math.hypot(data[idx * 4] - bgR, data[idx * 4 + 1] - bgG, data[idx * 4 + 2] - bgB);
        if (dist < BG_TOLERANCE) {
            data[idx * 4 + 3] = 0;
            const px = idx % w, py = Math.floor(idx / w);
            if (px > startX && !visited[idx - 1]) queue.push(idx - 1);
            if (px < endX && !visited[idx + 1]) queue.push(idx + 1);
            if (py > startY && !visited[idx - w]) queue.push(idx - w);
            if (py < endY && !visited[idx + w]) queue.push(idx + w);
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * Turn a photo into the black/white print image the website would upload for it.
 * @param {string} photoPath - PNG/JPEG/WebP, already upright
 * @param {string} shapeId - 'rectangle' | 'circle' | 'heart'
 * @param {{threshold?: number, invert?: boolean, zoom?: number}} options - as on the website
 * @param {string} id - used for the file name
 * @returns {Promise<string>} path of the print image (PNG, white = burn)
 */
async function photoToPrintImage(photoPath, shapeId, { threshold = 128, invert = false, zoom = 1 } = {}, id) {
    const W = websiteLayout();
    const shape = W.KEYCHAIN_SHAPES[shapeId];
    if (!shape) throw new Error(`Unknown shape "${shapeId}"`);
    const area = shape.imageArea;
    const targetW = Math.round(area.width / W.ENGRAVE_PIXEL_SIZE_MM);
    const targetH = Math.round(area.height / W.ENGRAVE_PIXEL_SIZE_MM);
    const t = Math.max(0, Math.min(255, threshold | 0));
    const userScale = Math.max(0.5, Math.min(3.0, Number(zoom) || 1));

    // _fit(): aspect-preserving, centred, on a transparent background
    const source = await loadImage(fs.readFileSync(photoPath));
    const fit = createCanvas(targetW, targetH);
    const fctx = fit.getContext('2d');
    const scale = Math.min(targetW / source.width, targetH / source.height) * userScale;
    const dw = source.width * scale, dh = source.height * scale;
    const dx = Math.max(-dw + 10, Math.min(targetW - 10, (targetW - dw) / 2));
    const dy = Math.max(-dh + 10, Math.min(targetH - 10, (targetH - dh) / 2));
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(source, dx, dy, dw, dh);
    removeBackground(fctx, targetW, targetH, dx, dy, dw, dh);

    // Clip to the website's keychain shape (and its hole), like the website's mask.
    const mask = createCanvas(targetW, targetH);
    const mctx = mask.getContext('2d');
    mctx.save();
    mctx.scale(targetW / area.width, targetH / area.height);
    mctx.translate(-area.x, -area.y);
    mctx.fillStyle = '#ffffff';
    mctx.fill(new Path2D(shape.borderPathD));
    if (shape.hole) {
        mctx.globalCompositeOperation = 'destination-out';
        mctx.beginPath();
        mctx.arc(shape.hole.cx, shape.hole.cy, shape.hole.r + 0.3, 0, Math.PI * 2);
        mctx.fill();
    }
    mctx.restore();
    fctx.globalCompositeOperation = 'destination-in';
    fctx.drawImage(mask, 0, 0);

    // _process(): darker than the threshold burns (invert flips it); transparent never burns.
    const src = fctx.getImageData(0, 0, targetW, targetH).data;
    const outCanvas = createCanvas(targetW, targetH);
    const octx = outCanvas.getContext('2d');
    const out = octx.createImageData(targetW, targetH);
    const o = out.data;
    for (let i = 0; i < targetW * targetH; i++) {
        let burn = false;
        if (src[i * 4 + 3] >= 128) {
            const gray = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) | 0;
            const dark = gray < t;
            burn = invert ? !dark : dark;
        }
        const v = burn ? 255 : 0;
        o[i * 4] = v; o[i * 4 + 1] = v; o[i * 4 + 2] = v; o[i * 4 + 3] = burn ? 255 : 0;
    }
    octx.putImageData(out, 0, 0);

    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const outPath = path.join(outputDir, `print_${id}.png`);
    fs.writeFileSync(outPath, outCanvas.toBuffer('image/png'));
    return outPath;
}

module.exports = { photoToPrintImage };

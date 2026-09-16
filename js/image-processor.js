// =====================================================================
//  CLIENT IMAGE PROCESSOR — upload → fit → threshold black/white
//  ⚠️  Output convention: WHITE = burn, BLACK = no-burn.
//      This MUST match printer-agent/image-to-gcode.js (brightness > 128 → engrave).
//
//  All processing happens in-browser so the on-screen preview is exactly
//  what the laser engraves (WYSIWYG). The processed canvas is rendered at
//  engrave resolution (IMAGE_AREA / ENGRAVE_PIXEL_SIZE_MM) — 1 canvas pixel
//  == 1 engraved pixel — and uploaded as the print source.
// =====================================================================

(function () {
    const AREA = window.KEYCHAIN_IMAGE_AREA;
    const PIXEL_MM = window.ENGRAVE_PIXEL_SIZE_MM;
    const LIMITS = window.IMAGE_UPLOAD;
    const ACCEPTED = LIMITS.accept.split(',').map(s => s.trim());

    class KeychainImageProcessor {
        constructor() {
            this.threshold = 128;       // 0..255
            this.invert = false;
            this.offsetX = 0;           // px offset from default center in canvas space
            this.offsetY = 0;           // px offset from default center in canvas space
            this.userScale = 1.0;       // scale multiplier relative to auto-fit (0.5..3.0)
            this.mode = 'auto';         // 'auto' | 'logo' | 'photo'
            this.removeBg = false;      // active when mode is logo
            this.bgTolerance = 60;      // background color keying tolerance (10..150)

            // Processed output — TARGET_W × TARGET_H, white = burn.
            this.canvas = document.createElement('canvas');
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            this._ctx = this.canvas.getContext('2d');

            this._gray = null;   // Uint8ClampedArray
            this._alpha = null;  // Uint8ClampedArray
        }

        get currentArea() {
            const shape = (window.getShape && window.selectedShapeId)
                ? window.getShape(window.selectedShapeId)
                : null;
            return shape ? shape.imageArea : window.KEYCHAIN_IMAGE_AREA;
        }

        get width() {
            return Math.round(this.currentArea.width / window.ENGRAVE_PIXEL_SIZE_MM);
        }

        get height() {
            return Math.round(this.currentArea.height / window.ENGRAVE_PIXEL_SIZE_MM);
        }

        get hasImage() { return this.source !== null; }

        get effectiveType() {
            if (this.mode === 'logo' || this.mode === 'photo') return this.mode;
            return this._detectType();
        }

        _detectType() {
            if (!this.source) return 'photo';
            const temp = document.createElement('canvas');
            const tw = Math.min(100, this.source.width);
            const th = Math.min(100, this.source.height);
            temp.width = tw;
            temp.height = th;
            const tctx = temp.getContext('2d');
            tctx.drawImage(this.source, 0, 0, tw, th);
            const data = tctx.getImageData(0, 0, tw, th).data;

            const borderR = [], borderG = [], borderB = [];
            for (let x = 0; x < tw; x += 2) {
                [0, th - 1].forEach(y => {
                    const idx = (y * tw + x) * 4;
                    if (data[idx + 3] > 10) {
                        borderR.push(data[idx]); borderG.push(data[idx + 1]); borderB.push(data[idx + 2]);
                    }
                });
            }
            for (let y = 1; y < th - 1; y += 2) {
                [0, tw - 1].forEach(x => {
                    const idx = (y * tw + x) * 4;
                    if (data[idx + 3] > 10) {
                        borderR.push(data[idx]); borderG.push(data[idx + 1]); borderB.push(data[idx + 2]);
                    }
                });
            }

            if (borderR.length === 0) return 'logo'; // transparent PNG logo

            const meanR = borderR.reduce((a, b) => a + b, 0) / borderR.length;
            const meanG = borderG.reduce((a, b) => a + b, 0) / borderG.length;
            const meanB = borderB.reduce((a, b) => a + b, 0) / borderB.length;

            let variance = 0;
            for (let i = 0; i < borderR.length; i++) {
                const dR = borderR[i] - meanR, dG = borderG[i] - meanG, dB = borderB[i] - meanB;
                variance += (dR * dR + dG * dG + dB * dB);
            }
            variance = Math.sqrt(variance / borderR.length);

            return variance < 35 ? 'logo' : 'photo';
        }

        setImageMode(mode) {
            if (['auto', 'logo', 'photo'].includes(mode)) {
                this.mode = mode;
                if (this.source) {
                    this._fit();
                    this._process();
                }
            }
        }

        resetAdjustments() {
            this.offsetX = 0;
            this.offsetY = 0;
            this.userScale = 1.0;
            if (this.source) {
                this._fit();
                this._process();
            }
        }

        setOffset(dx, dy) {
            this.offsetX = dx;
            this.offsetY = dy;
            if (this.source) {
                this._fit();
                this._process();
            }
        }

        setZoom(scale) {
            this.userScale = Math.max(0.5, Math.min(3.0, parseFloat(scale) || 1.0));
            if (this.source) {
                this._fit();
                this._process();
            }
        }

        setRemoveBg(value) {
            this.removeBg = !!value;
            if (this.source) {
                this._fit();
                this._process();
            }
        }

        setBgTolerance(value) {
            this.bgTolerance = Math.max(10, Math.min(150, value | 0));
            if (this.source) {
                this._fit();
                this._process();
            }
        }

        // Validate + decode an uploaded File. Throws Error(message) on bad input.
        async loadFile(file) {
            if (!file) throw new Error('No file selected.');
            if (!ACCEPTED.includes(file.type)) {
                throw new Error('Please upload a PNG, JPG, or WEBP image.');
            }
            if (file.size > LIMITS.maxBytes) {
                const mb = (LIMITS.maxBytes / (1024 * 1024)).toFixed(0);
                throw new Error(`Image is too large. Max ${mb} MB.`);
            }
            let bitmap;
            try {
                bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
            } catch (e) {
                throw new Error('Could not read that image. Try a different file.');
            }
            this.originalFile = file;
            this.source = bitmap;
            this.offsetX = 0;
            this.offsetY = 0;
            this.userScale = 1.0;
            this._fit();       // compute cached grayscale/alpha
            this._process();   // render B&W with current threshold/invert
        }

        reprocess() {
            if (this.source) {
                this._fit();
                this._process();
            }
        }

        setThreshold(value) {
            this.threshold = Math.max(0, Math.min(255, value | 0));
            if (this.source) this._process();
        }

        setInvert(value) {
            this.invert = !!value;
            if (this.source) this._process();
        }

        _applyBackgroundRemoval(ctx, w, h, dx, dy, dw, dh) {
            const imgData = ctx.getImageData(0, 0, w, h);
            const data = imgData.data;

            const startX = Math.max(0, Math.floor(dx));
            const endX = Math.min(w - 1, Math.ceil(dx + dw));
            const startY = Math.max(0, Math.floor(dy));
            const endY = Math.min(h - 1, Math.ceil(dy + dh));

            if (endX <= startX || endY <= startY) return;

            let sumR = 0, sumG = 0, sumB = 0, count = 0;
            const samplePixel = (x, y) => {
                const idx = (y * w + x) * 4;
                if (data[idx + 3] > 10) {
                    sumR += data[idx];
                    sumG += data[idx + 1];
                    sumB += data[idx + 2];
                    count++;
                }
            };

            for (let x = startX; x <= endX; x++) {
                samplePixel(x, startY);
                samplePixel(x, endY);
            }
            for (let y = startY + 1; y < endY; y++) {
                samplePixel(startX, y);
                samplePixel(endX, y);
            }

            if (count === 0) return;
            const bgR = sumR / count;
            const bgG = sumG / count;
            const bgB = sumB / count;

            const visited = new Uint8Array(w * h);
            const queue = [];

            for (let x = startX; x <= endX; x++) {
                queue.push(startY * w + x, endY * w + x);
            }
            for (let y = startY + 1; y < endY; y++) {
                queue.push(y * w + startX, y * w + endX);
            }

            let head = 0;
            const tol = this.bgTolerance || 60;

            while (head < queue.length) {
                const idx = queue[head++];
                if (visited[idx]) continue;
                visited[idx] = 1;

                const a = data[idx * 4 + 3];
                if (a < 10) continue;

                const r = data[idx * 4];
                const g = data[idx * 4 + 1];
                const b = data[idx * 4 + 2];

                const dist = Math.hypot(r - bgR, g - bgG, b - bgB);
                if (dist < tol) {
                    data[idx * 4 + 3] = 0;

                    const px = idx % w;
                    const py = Math.floor(idx / w);

                    if (px > startX && !visited[idx - 1]) queue.push(idx - 1);
                    if (px < endX && !visited[idx + 1]) queue.push(idx + 1);
                    if (py > startY && !visited[idx - w]) queue.push(idx - w);
                    if (py < endY && !visited[idx + w]) queue.push(idx + w);
                }
            }

            ctx.putImageData(imgData, 0, 0);
        }

        // Fit the source into TARGET (aspect-preserving, letterboxed) on a
        // TRANSPARENT background, then cache grayscale + alpha. Letterbox pixels
        // keep alpha 0 so they never burn regardless of threshold.
        _fit() {
            const targetW = this.width;
            const targetH = this.height;
            const area = this.currentArea;

            this.canvas.width = targetW;
            this.canvas.height = targetH;

            const fit = document.createElement('canvas');
            fit.width = targetW;
            fit.height = targetH;
            const fctx = fit.getContext('2d');
            fctx.clearRect(0, 0, targetW, targetH);

            const sw = this.source.width;
            const sh = this.source.height;
            const autoFitScale = Math.min(targetW / sw, targetH / sh);
            const totalScale = autoFitScale * (this.userScale || 1.0);
       
            const dw = sw * totalScale;
            const dh = sh * totalScale;

            let dx = (targetW - dw) / 2 + (this.offsetX || 0);
            let dy = (targetH - dh) / 2 + (this.offsetY || 0);

            // Clamp so image remains partially inside target canvas
            dx = Math.max(-dw + 10, Math.min(targetW - 10, dx));
            dy = Math.max(-dh + 10, Math.min(targetH - 10, dy));
            this.offsetX = dx - (targetW - dw) / 2;
            this.offsetY = dy - (targetH - dh) / 2;

            fctx.imageSmoothingEnabled = true;
            fctx.imageSmoothingQuality = 'high';
            fctx.drawImage(this.source, dx, dy, dw, dh);

            // Automatically strip outer square background box around image
            this._applyBackgroundRemoval(fctx, targetW, targetH, dx, dy, dw, dh);

            // Shape mask compositing using Path2D
            const shape = (window.getShape && window.selectedShapeId)
                ? window.getShape(window.selectedShapeId)
                : null;

            if (shape && shape.borderPathD) {
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = targetW;
                maskCanvas.height = targetH;
                const mctx = maskCanvas.getContext('2d');

                const scaleX = targetW / area.width;
                const scaleY = targetH / area.height;

                mctx.save();
                mctx.scale(scaleX, scaleY);
                mctx.translate(-area.x, -area.y);

                const shapePath = new Path2D(shape.borderPathD);
                mctx.fillStyle = '#ffffff';
                mctx.fill(shapePath);

                if (shape.hole) {
                    mctx.globalCompositeOperation = 'destination-out';
                    mctx.beginPath();
                    mctx.arc(shape.hole.cx, shape.hole.cy, shape.hole.r + 0.3, 0, Math.PI * 2);
                    mctx.fill();
                }
                mctx.restore();

                fctx.globalCompositeOperation = 'destination-in';
                fctx.drawImage(maskCanvas, 0, 0);
            }

            const data = fctx.getImageData(0, 0, targetW, targetH).data;
            const n = targetW * targetH;
            this._gray = new Uint8ClampedArray(n);
            this._alpha = new Uint8ClampedArray(n);
            for (let i = 0; i < n; i++) {
                const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
                // Rec. 601 luma; matches the (r+g+b)/3-ish brightness idea but weighted.
                this._gray[i] = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
                this._alpha[i] = data[i * 4 + 3];
            }
        }

        _filterBackgroundNoise(burnMap, w, h) {
            const labels = new Int32Array(w * h);
            let currentLabel = 1;
            const compSizes = {};
            const compBounds = {};

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = y * w + x;
                    if (burnMap[idx] && !labels[idx]) {
                        let size = 0;
                        const queue = [idx];
                        labels[idx] = currentLabel;
                        let minX = x, maxX = x, minY = y, maxY = y;
                        let head = 0;

                        while (head < queue.length) {
                            const qIdx = queue[head++];
                            size++;
                            const qx = qIdx % w, qy = Math.floor(qIdx / w);
                            minX = Math.min(minX, qx);
                            maxX = Math.max(maxX, qx);
                            minY = Math.min(minY, qy);
                            maxY = Math.max(maxY, qy);

                            for (let dy = -1; dy <= 1; dy++) {
                                for (let dx = -1; dx <= 1; dx++) {
                                    const nx = qx + dx, ny = qy + dy;
                                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                                        const nIdx = ny * w + nx;
                                        if (burnMap[nIdx] && !labels[nIdx]) {
                                            labels[nIdx] = currentLabel;
                                            queue.push(nIdx);
                                        }
                                    }
                                }
                            }
                        }

                        compSizes[currentLabel] = size;
                        compBounds[currentLabel] = { minX, maxX, minY, maxY };
                        currentLabel++;
                    }
                }
            }

            for (let i = 0; i < w * h; i++) {
                const l = labels[i];
                if (!l) continue;
                const b = compBounds[l];
                const compW = b.maxX - b.minX + 1;
                const compH = b.maxY - b.minY + 1;
                const size = compSizes[l];

                // Filter thin isolated vertical/horizontal border lines (door frames, background wall clutter on periphery)
                const isBorderLine = (compW <= 4 && compH > 12 && (b.minX > w * 0.70 || b.maxX < w * 0.30)) ||
                                     (compH <= 4 && compW > 12 && (b.minY < h * 0.25 || b.maxY > h * 0.85));
                const isNoiseSpeck = size < 25;

                if (isBorderLine || isNoiseSpeck) {
                    burnMap[i] = 0;
                }
            }
        }

        // Threshold the cached grayscale into pure black/white. white = burn.
        // Default (no invert): pixels DARKER than the threshold burn — i.e. the
        // dark strokes of a logo on a light background. Invert flips that.
        _process() {
            const w = this.width;
            const h = this.height;
            const n = w * h;
            const out = this._ctx.createImageData(w, h);
            const o = out.data;
            const t = this.threshold;
            const inv = this.invert;

            const burnMap = new Uint8Array(n);
            for (let i = 0; i < n; i++) {
                if (this._alpha[i] < 128) {
                    burnMap[i] = 0; // letterbox / transparent → never burns
                } else {
                    const dark = this._gray[i] < t;
                    burnMap[i] = (inv ? !dark : dark) ? 1 : 0;
                }
            }

            if (this.removeBg) {
                this._filterBackgroundNoise(burnMap, w, h);
            }

            for (let i = 0; i < n; i++) {
                const burn = burnMap[i] === 1;
                const v = burn ? 255 : 0;
                o[i * 4] = v; o[i * 4 + 1] = v; o[i * 4 + 2] = v; o[i * 4 + 3] = burn ? 255 : 0;
            }
            this._ctx.putImageData(out, 0, 0);
        }

        // Export the processed B&W bitmap (the exact engrave source) as a PNG Blob.
        toPrintBlob() {
            return new Promise((resolve, reject) => {
                this.canvas.toBlob(
                    (blob) => blob ? resolve(blob) : reject(new Error('Failed to export image.')),
                    'image/png'
                );
            });
        }

        // Fraction of the engrave area that will burn (0..1) — used to warn on
        // very dense images (long engrave time / a solid black slab).
        coverage() {
            if (!this._gray) return 0;
            const w = this.width;
            const h = this.height;
            const n = w * h;
            let burn = 0;
            const t = this.threshold, inv = this.invert;
            for (let i = 0; i < n; i++) {
                if (this._alpha[i] < 128) continue;
                const dark = this._gray[i] < t;
                if (inv ? !dark : dark) burn++;
            }
            return burn / n;
        }
    }

    window.KeychainImageProcessor = KeychainImageProcessor;
})();

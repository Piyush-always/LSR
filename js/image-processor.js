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
            this.originalFile = null;   // the raw uploaded File (for moderation/record)
            this.source = null;         // decoded ImageBitmap
            this.threshold = 128;       // 0..255
            this.invert = false;

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
            const scale = Math.min(targetW / sw, targetH / sh);
       
            const dw = sw * scale;
            const dh = sh * scale;
            const dx = (targetW - dw) / 2;
            const dy = (targetH - dh) / 2;

            fctx.imageSmoothingEnabled = true;
            fctx.imageSmoothingQuality = 'high';
            fctx.drawImage(this.source, dx, dy, dw, dh);

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
            for (let i = 0; i < n; i++) {
                let burn;
                if (this._alpha[i] < 128) {
                    burn = false; // letterbox / transparent → never burns
                } else {
                    const dark = this._gray[i] < t;
                    burn = inv ? !dark : dark;
                }
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

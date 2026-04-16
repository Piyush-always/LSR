# QR Codes

This folder holds all QR codes for the laser keychain project and the script that generates them.

## What's in here

| File | Purpose |
|------|---------|
| `generate-qr.js` | Script that generates all QR codes |
| `laser-inv.png` | QR → `https://laser-inv.web.app` |
| `create-mytag.png` | QR → `https://create-mytag.invengic.in` |
| `README.md` | This file |

## How to generate / regenerate QR codes

From the project root:

```bash
cd qr-codes
node generate-qr.js
```

This regenerates **every** QR code listed inside `generate-qr.js`. It's safe to run any time — it simply overwrites the existing PNGs.

## How to add a new QR code

Open [generate-qr.js](generate-qr.js) and find the `TARGETS` array near the top:

```js
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
```

Add a new entry:

```js
{
    name: 'new-site',                       // this becomes the file name (new-site.png)
    url:  'https://new-site.invengic.in',  // the URL you want the QR to encode
},
```

Save the file, then run `node generate-qr.js`. A new `new-site.png` appears in this folder.

## Output settings

All QR codes use the same options (defined in `OPTIONS` inside `generate-qr.js`):

| Option | Value | Meaning |
|--------|-------|---------|
| `width` | `1024` | Pixel size of the output image — high resolution, print-ready |
| `margin` | `2` | White border around the QR |
| `errorCorrectionLevel` | `'M'` | Medium redundancy — about 15% of the QR can be damaged/obscured and still scan |
| Colors | black on white | Standard high-contrast |

Change these if you need smaller/larger output or different colors.

### Error correction levels

- `'L'` — Low (~7% recovery) — smallest QR, less resilient
- `'M'` — Medium (~15%) — **recommended default**
- `'Q'` — Quartile (~25%) — good if QR will be scratched/dirty
- `'H'` — High (~30%) — best resilience, densest QR pattern

## Dependencies

The script uses the `qrcode` npm package. It's installed in the project root `node_modules/` so you don't need a separate install here. If you ever see `Cannot find module 'qrcode'`, run this from the project root once:

```bash
npm install qrcode
```

## Printing / using the QR codes

These PNGs are 1024×1024 — plenty of resolution for:
- Printing on paper flyers or posters (up to ~10cm × 10cm at 300 DPI)
- Displaying on a screen / tablet at the counter
- Embedding in social media posts

For very large prints (A3+), either increase `width` in the script or use a vector format — drop me a note if you need SVG output and I can add that.

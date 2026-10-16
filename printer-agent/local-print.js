// One keychain from Laser Queue's Local print tab, without a website order: any text
// in any of the website's fonts, or a photo, on the heart, rectangle or circle holder.
// The engraving is made by the same code as a website order (text-to-gcode.js,
// image-to-gcode.js; photos through photo-to-print.js, the website's own steps).
//
//   node local-print.js preview <job.json>   write the G-code only (nothing moves)
//   node local-print.js print <job.json>     home, engrave on the holder, return HOME
//
// job.json: { "shape": "heart", "mode": "text", "name": "ANNA", "fontId": "bebas" }
//       or: { "shape": "heart", "mode": "image", "photo": "C:/.../photo.png",
//             "threshold": 128, "invert": false, "zoom": 1 }
// Only one program can use the laser's port: stop the printer agent first.
// Laser Queue reads the [LOCAL] lines; Ctrl+C (or "stop" from Laser Queue) stops safely.
const fs = require('fs');
const { SHAPES, HOLDERS, setHomeMachinePosition } = require('./holders');
const { textToGcode, FONTS } = require('./text-to-gcode');
const { imageToGcode } = require('./image-to-gcode');
const { photoToPrintImage } = require('./photo-to-print');

const [action, jobPath] = process.argv.slice(2);

function readJob() {
    const job = JSON.parse(fs.readFileSync(jobPath, 'utf-8'));
    if (!SHAPES.includes(job.shape)) throw new Error(`Unknown shape "${job.shape}"`);
    if (job.mode === 'image') {
        if (!job.photo || !fs.existsSync(job.photo)) throw new Error('The photo file is missing');
    } else if (job.mode === 'text') {
        if (!String(job.name || '').trim()) throw new Error('Type the text to engrave');
        if (!FONTS[job.fontId]) throw new Error(`Unknown font "${job.fontId}"`);
    } else {
        throw new Error(`Unknown mode "${job.mode}"`);
    }
    return job;
}

async function makeGcode(job, id) {
    if (job.mode === 'image') {
        const printImage = await photoToPrintImage(job.photo, job.shape, job, id);
        console.log(`[LOCAL] IMAGE ${printImage}`);
        return imageToGcode(printImage, id, job.shape);
    }
    return textToGcode(String(job.name).trim(), id, job.fontId, job.shape);
}

async function preview() {
    const job = readJob();
    setHomeMachinePosition(HOLDERS[job.shape]);      // the holder's centre is (0, 0) in the preview
    console.log(`[LOCAL] GCODE ${await makeGcode(job, 'local_preview')}`);
}

async function print() {
    const job = readJob();
    const { connect, sendGcodeFile, disconnect, SERIAL_CONFIG } = require('./laser-sender');
    let connected = false;
    let closing = null;                      // one shutdown, whether a stop or the end of the job asks first
    const close = () => closing || (closing = disconnect());
    process.on('SIGINT', async () => {
        console.log('\n[LOCAL] Stopping: laser off, back to HOME...');
        if (connected) await close();
        process.exit(130);
    });
    try {
        console.log(`[LOCAL] ${job.mode === 'image' ? 'Photo' : `"${job.name}" in ${job.fontId}`} on the ${job.shape} holder (port ${SERIAL_CONFIG.port})`);
        await connect();                                   // homes ($H)
        connected = true;
        const gcode = await makeGcode(job, `local_${Date.now()}`);
        console.log(`[LOCAL] Engraving on the ${job.shape} holder`);
        let last = -1;
        await sendGcodeFile(gcode, (line, total) => {
            const pct = Math.floor((line / total) * 100);
            if (pct !== last) { last = pct; console.log(`[LOCAL] Progress ${pct}%`); }
        });
        console.log('[LOCAL] Done');
    } catch (error) {
        console.error(`[LOCAL] Failed: ${error.message}`);
        process.exitCode = 1;
    } finally {
        if (connected) await close();                  // laser off, back to HOME, then close
    }
    // Laser Queue's stop hook keeps listening on stdin, which would keep Node running:
    // exit once the output above has been written.
    process.stdout.write('', () => process.exit());
}

if (action === 'preview' && jobPath) {
    preview().catch(error => { console.error(`[LOCAL] Failed: ${error.message}`); process.exitCode = 1; });
} else if (action === 'print' && jobPath) {
    print();
} else {
    console.error('Usage: node local-print.js preview|print <job.json>');
    process.exitCode = 2;
}

// Draw a heart outline that fits inside a 48 mm x 48 mm square.
// Run from printer-agent: node heart_test.js
// Default laser power is low (S20); set LASER_POWER in the environment to adjust.
const { connect, sendCommand, disconnect } = require('./laser-sender');

const CENTER_MPOS = { x: 60, y: 28 }; // Same center as jog-tool.py
const BOUNDING_WIDTH_MM = 45;
const BOUNDING_HEIGHT_MM = 45;
const SEGMENTS = 128;
const FEED_MM_MIN = 800;
const LASER_POWER = Number(process.env.LASER_POWER || 20);

async function send(command) {
    console.log(`[SEND] ${command}`);
    await sendCommand(command);
}

function heartPoints() {
    const raw = [];
    for (let i = 0; i <= SEGMENTS; i++) {
        const t = (i / SEGMENTS) * Math.PI * 2;
        raw.push([
            16 * Math.sin(t) ** 3,
            13 * Math.cos(t) - 5 * Math.cos(2 * t) -
                2 * Math.cos(3 * t) - Math.cos(4 * t),
        ]);
    }

    const xs = raw.map(([x]) => x);
    const ys = raw.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return raw.map(([x, y]) => [
        ((x - minX) / (maxX - minX) - 0.5) * BOUNDING_WIDTH_MM,
        ((y - minY) / (maxY - minY) - 0.5) * BOUNDING_HEIGHT_MM,
    ]);
}

async function main() {
    let connected = false;
    try {
        if (!Number.isFinite(LASER_POWER) || LASER_POWER < 0 || LASER_POWER > 1000) {
            throw new Error('LASER_POWER must be between 0 and 1000');
        }
        console.log(`[HEART] ${BOUNDING_WIDTH_MM} x ${BOUNDING_HEIGHT_MM} mm maximum outline`);
        console.log(`[HEART] Center MPos X${CENTER_MPOS.x} Y${CENTER_MPOS.y}; power S${LASER_POWER}`);
        console.log('[HEART] Laser stays off during homing and travel.');

        await connect();
        connected = true;
        await send('M5');
        await send('G21');
        await send('G90');
        // GRBL acknowledges $H when the physical homing cycle has completed.
        await send('$H');

        await send(`G53 G0 X${CENTER_MPOS.x} Y${CENTER_MPOS.y}`);
        // Set this physical center as the work origin; outline points are centered at (0, 0).
        await send('G92 X0 Y0');

        const points = heartPoints();
        const [startX, startY] = points[0];
        await send(`G0 F${FEED_MM_MIN} X${startX.toFixed(3)} Y${startY.toFixed(3)}`);
        await send(`M3 S${LASER_POWER}`);
        for (let i = 1; i < points.length; i++) {
            const [x, y] = points[i];
            await send(`G1 F${FEED_MM_MIN} X${x.toFixed(3)} Y${y.toFixed(3)}`);
        }
        await send('M5');
        console.log('[HEART] Outline complete; laser off.');
    } catch (error) {
        console.error(`[HEART] Failed: ${error.message}`);
        process.exitCode = 1;
    } finally {
        if (connected) await disconnect({ returnToOrigin: false });
    }
}

main();

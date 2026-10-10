// Draw an 80 mm diameter circle at the saved circle center.
// Run from printer-agent: node circle_test.js
// Start with the work area clear and the head ready for physical homing.
// Default laser power is low (S20); set LASER_POWER in the environment to adjust.
const { connect, sendCommand, disconnect } = require('./laser-sender');

const CENTER_MPOS = { x: 97, y: 135 }; // Same center as jog-tool.py
const RADIUS_MM = 45;
const SEGMENTS = 64;
const FEED_MM_MIN = 800;
const LASER_POWER = Number(process.env.LASER_POWER || 20);

async function send(command) {
    console.log(`[SEND] ${command}`);
    await sendCommand(command);
}

async function main() {
    let connected = false;
    try {
        if (!Number.isFinite(LASER_POWER) || LASER_POWER < 0 || LASER_POWER > 1000) {
            throw new Error('LASER_POWER must be between 0 and 1000');
        }
        console.log('[CIRCLE] 80 mm diameter, 40 mm radius');
        console.log(`[CIRCLE] Center MPos X${CENTER_MPOS.x} Y${CENTER_MPOS.y}; power S${LASER_POWER}`);
        console.log('[CIRCLE] Keep the bed path clear; laser remains off during homing and travel.');

        await connect();
        connected = true;
        await send('M5');
        await send('G21');
        await send('G90');
        // GRBL acknowledges $H when the physical homing cycle has completed.
        await send('$H');

        await send(`G53 G0 X${CENTER_MPOS.x} Y${CENTER_MPOS.y}`);
        // Establish the exact circle center as the local work origin. The
        // outline coordinates below are therefore offsets around that center.
        await send('G92 X0 Y0');
        await send(`G0 F${FEED_MM_MIN} X${RADIUS_MM} Y0`);
        await send(`M3 S${LASER_POWER}`);

        for (let i = 1; i <= SEGMENTS; i++) {
            const angle = (2 * Math.PI * i) / SEGMENTS;
            const x = RADIUS_MM * Math.cos(angle);
            const y = RADIUS_MM * Math.sin(angle);
            await send(`G1 F${FEED_MM_MIN} X${x.toFixed(3)} Y${y.toFixed(3)}`);
        }

        await send('M5');
        console.log('[CIRCLE] Circle complete; laser off.');
    } catch (error) {
        console.error(`[CIRCLE] Failed: ${error.message}`);
        process.exitCode = 1;
    } finally {
        if (connected) await disconnect({ returnToOrigin: false });
    }
}

main();

// Draw a 35 mm (X) by 65 mm (Y) rectangle at the saved rectangle center.
// Run from printer-agent: node rectangle_test.js
// Default laser power is low (S20); set LASER_POWER in the environment to adjust.
const { connect, sendCommand, disconnect } = require('./laser-sender');

const CENTER_MPOS = { x: 170, y: 28 }; // Same center as jog-tool.py
const HALF_WIDTH_X_MM = 14.5;
const HALF_HEIGHT_Y_MM = 30.5;
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
        console.log('[RECTANGLE] 35 mm (X) x 65 mm (Y)');
        console.log(`[RECTANGLE] Center MPos X${CENTER_MPOS.x} Y${CENTER_MPOS.y}; power S${LASER_POWER}`);
        console.log('[RECTANGLE] Laser stays off during homing and travel.');

        await connect();
        connected = true;
        await send('M5');
        await send('G21');
        await send('G90');
        // GRBL acknowledges $H when the physical homing cycle has completed.
        await send('$H');

        await send(`G53 G0 X${CENTER_MPOS.x} Y${CENTER_MPOS.y}`);
        // Use the actual saved center as the local origin for this outline.
        await send('G92 X0 Y0');
        await send(`G0 F${FEED_MM_MIN} X-${HALF_WIDTH_X_MM} Y-${HALF_HEIGHT_Y_MM}`);
        await send(`M3 S${LASER_POWER}`);
        await send(`G1 F${FEED_MM_MIN} X${HALF_WIDTH_X_MM} Y-${HALF_HEIGHT_Y_MM}`);
        await send(`G1 F${FEED_MM_MIN} X${HALF_WIDTH_X_MM} Y${HALF_HEIGHT_Y_MM}`);
        await send(`G1 F${FEED_MM_MIN} X-${HALF_WIDTH_X_MM} Y${HALF_HEIGHT_Y_MM}`);
        await send(`G1 F${FEED_MM_MIN} X-${HALF_WIDTH_X_MM} Y-${HALF_HEIGHT_Y_MM}`);
        await send('M5');
        console.log('[RECTANGLE] Outline complete; laser off.');
    } catch (error) {
        console.error(`[RECTANGLE] Failed: ${error.message}`);
        process.exitCode = 1;
    } finally {
        if (connected) await disconnect({ returnToOrigin: false });
    }
}

main();

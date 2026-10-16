// Draw the heart, rectangle, and circle test outlines, or select one shape.
// Run from printer-agent: node all-shapes-test.js [all|heart|rectangle|circle]
// The machine physically homes first. Keep the bed clear and use a blank on
// each selected holder. Default laser power is low (S20); override with LASER_POWER.
//
// Positions and sizes come from machine.json, in machine coordinates (MPos):
// heart 45x45 at (60,28), rectangle 29x61 at (170,28), circle 90 mm at (97,135),
// moved to with G53 and drawn with the same outlines as Tejas's original.
const { connect, sendCommand, homeMachine, disconnect } = require('./laser-sender');
const { SHAPES, HOLDERS, borderPolyline } = require('./holders');

const FEED_MM_MIN = 800;
const LASER_POWER = Number(process.env.LASER_POWER || 20);

async function send(command) {
    console.log(`[SEND] ${command}`);
    await sendCommand(command);
}

async function drawShape(shape) {
    const center = HOLDERS[shape];
    console.log(`\n[${shape.toUpperCase()}] Center MPos X${center.x} Y${center.y}; laser S${LASER_POWER}`);
    await send('M5');
    await send('G21');
    await send('G90');
    await send(`G53 G0 X${center.x} Y${center.y}`);
    // Set the selected holder center as the local origin for its outline.
    await send('G92 X0 Y0');

    const points = borderPolyline(shape);
    const [startX, startY] = points[0];
    await send(`G0 F${FEED_MM_MIN} X${startX.toFixed(3)} Y${startY.toFixed(3)}`);
    await send(`M3 S${LASER_POWER}`);
    for (let i = 1; i < points.length; i++) {
        const [x, y] = points[i];
        await send(`G1 F${FEED_MM_MIN} X${x.toFixed(3)} Y${y.toFixed(3)}`);
    }
    await send('M5');
    console.log(`[${shape.toUpperCase()}] Complete; laser off.`);
}

async function main() {
    const requested = (process.argv[2] || 'all').toLowerCase();
    const shapes = requested === 'all' ? SHAPES : [requested];
    let connected = false;
    try {
        if (!shapes.every(shape => SHAPES.includes(shape))) {
            throw new Error('Usage: node all-shapes-test.js [all|heart|rectangle|circle]');
        }
        if (!Number.isFinite(LASER_POWER) || LASER_POWER < 0 || LASER_POWER > 1000) {
            throw new Error('LASER_POWER must be between 0 and 1000');
        }
        console.log(`[SHAPE TEST] Running ${shapes.join(', ')}; power S${LASER_POWER}. Keep the bed path clear.`);
        await connect(); // Homes the machine before any movement.
        connected = true;
        for (const shape of shapes) await drawShape(shape);
        console.log('\n[SHAPE TEST] Returning to physical HOME...');
        await send('M5');
        await homeMachine();
        console.log('\n[SHAPE TEST] All selected outlines complete.');
    } catch (error) {
        console.error(`\n[SHAPE TEST] Failed: ${error.message}`);
        process.exitCode = 1;
    } finally {
        if (connected) await disconnect({ returnToOrigin: false });
    }
}

main();

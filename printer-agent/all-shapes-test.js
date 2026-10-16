// Draw the heart, rectangle, and circle test outlines, or select one shape.
// Run from printer-agent: node all-shapes-test.js [all|heart|rectangle|circle]
// The machine physically homes first. Keep the bed clear and use a blank on
// each selected holder. Default laser power is low (S20); override with LASER_POWER.
const { connect, sendCommand, homeMachine, disconnect } = require('./laser-sender');

const CENTERS_MPOS = {
    heart: { x: 60, y: 28 },
    rectangle: { x: 170, y: 28 },
    circle: { x: 97, y: 135 },
};
const FEED_MM_MIN = 800;
const LASER_POWER = Number(process.env.LASER_POWER || 20);
const SEGMENTS = { heart: 128, circle: 64 };
const RECTANGLE_HALF_WIDTH_MM = 14.5;
const RECTANGLE_HALF_HEIGHT_MM = 30.5;
const HEART_WIDTH_MM = 45;
const HEART_HEIGHT_MM = 45;
const CIRCLE_RADIUS_MM = 45;

function heartPoints() {
    const raw = [];
    for (let i = 0; i <= SEGMENTS.heart; i++) {
        const t = (i / SEGMENTS.heart) * Math.PI * 2;
        raw.push([
            16 * Math.sin(t) ** 3,
            13 * Math.cos(t) - 5 * Math.cos(2 * t) -
                2 * Math.cos(3 * t) - Math.cos(4 * t),
        ]);
    }
    const xs = raw.map(([x]) => x);
    const ys = raw.map(([, y]) => y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return raw.map(([x, y]) => [
        ((x - minX) / (maxX - minX) - 0.5) * HEART_WIDTH_MM,
        ((y - minY) / (maxY - minY) - 0.5) * HEART_HEIGHT_MM,
    ]);
}

async function send(command) {
    console.log(`[SEND] ${command}`);
    await sendCommand(command);
}

async function drawShape(shape) {
    const center = CENTERS_MPOS[shape];
    console.log(`\n[${shape.toUpperCase()}] Center MPos X${center.x} Y${center.y}; laser S${LASER_POWER}`);
    await send('M5');
    await send('G21');
    await send('G90');
    await send(`G53 G0 X${center.x} Y${center.y}`);
    // Set the selected holder center as the local origin for its outline.
    await send('G92 X0 Y0');

    let points;
    if (shape === 'heart') {
        points = heartPoints();
    } else if (shape === 'circle') {
        points = Array.from({ length: SEGMENTS.circle + 1 }, (_, i) => {
            const angle = (2 * Math.PI * i) / SEGMENTS.circle;
            return [CIRCLE_RADIUS_MM * Math.cos(angle), CIRCLE_RADIUS_MM * Math.sin(angle)];
        });
    } else {
        points = [
            [-RECTANGLE_HALF_WIDTH_MM, -RECTANGLE_HALF_HEIGHT_MM],
            [ RECTANGLE_HALF_WIDTH_MM, -RECTANGLE_HALF_HEIGHT_MM],
            [ RECTANGLE_HALF_WIDTH_MM,  RECTANGLE_HALF_HEIGHT_MM],
            [-RECTANGLE_HALF_WIDTH_MM,  RECTANGLE_HALF_HEIGHT_MM],
            [-RECTANGLE_HALF_WIDTH_MM, -RECTANGLE_HALF_HEIGHT_MM],
        ];
    }

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
    const shapes = requested === 'all' ? ['heart', 'rectangle', 'circle'] : [requested];
    let connected = false;
    try {
        if (!shapes.every(shape => Object.hasOwn(CENTERS_MPOS, shape))) {
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

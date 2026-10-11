// Move to a configured keychain center with the laser off.
// Run from printer-agent: node test-shape.js heart|rectangle|circle
const { connect, sendCommand, disconnect, SERIAL_CONFIG } = require('./laser-sender');
const SHAPE_POSITIONS = require('./shape-positions');

const shapeId = (process.argv[2] || '').toLowerCase();
const center = SHAPE_POSITIONS[shapeId];

if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    console.error('Usage: node test-shape.js <heart|rectangle|circle>');
    console.error('That shape must have a calibrated center in shape-positions.js.');
    process.exit(2);
}

async function main() {
    let connected = false;
    try {
        console.log(`[CENTER CHECK] Shape: ${shapeId}`);
        console.log(`[CENTER CHECK] Port: ${SERIAL_CONFIG.port}`);
        console.log('[CENTER CHECK] Laser stays off. Head will move to the saved center and stop there.');
        console.log('[CENTER CHECK] Start with the head at your reference point and clear the travel path.');

        await connect();
        connected = true;
        await sendCommand('M5');
        await sendCommand('G90');
        await sendCommand(`G0 X${center.x.toFixed(3)} Y${center.y.toFixed(3)}`);
        console.log(`[CENTER CHECK] Reached ${shapeId} center (X${center.x}, Y${center.y}). Head will remain there.`);
    } catch (error) {
        console.error(`\n[CENTER CHECK] Failed: ${error.message}`);
        process.exitCode = 1;
    } finally {
        if (connected) {
            // Keep the head at the selected center; don't return it to origin.
            await disconnect({ returnToOrigin: false });
        }
    }
}

main();

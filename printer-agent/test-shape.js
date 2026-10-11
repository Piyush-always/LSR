// Move to a holder's centre with the laser off, and leave the head there.
// Run from printer-agent: node test-shape.js heart|rectangle|circle
// The machine homes first ($H); the centres come from machine.json.
const { connect, sendCommand, disconnect, homeMachinePosition, SERIAL_CONFIG } = require('./laser-sender');
const { SHAPES, setHomeMachinePosition, holderCentre } = require('./holders');

const shapeId = (process.argv[2] || '').toLowerCase();

if (!SHAPES.includes(shapeId)) {
    console.error(`Usage: node test-shape.js <${SHAPES.join('|')}>`);
    process.exit(2);
}

async function main() {
    let connected = false;
    try {
        console.log(`[CENTER CHECK] Shape: ${shapeId}`);
        console.log(`[CENTER CHECK] Port: ${SERIAL_CONFIG.port}`);
        console.log('[CENTER CHECK] Laser stays off. The machine homes, then the head moves to the centre and stops there.');
        console.log('[CENTER CHECK] Clear the travel path.');

        await connect();                                   // homes ($H)
        connected = true;
        setHomeMachinePosition(homeMachinePosition());
        const centre = holderCentre(shapeId);
        await sendCommand('M5');
        await sendCommand('G90');
        await sendCommand(`G0 X${centre.x.toFixed(3)} Y${centre.y.toFixed(3)}`);
        console.log(`[CENTER CHECK] Reached the ${shapeId} centre (${centre.x.toFixed(1)}, ${centre.y.toFixed(1)} mm from HOME). Head will remain there.`);
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

// Test-print a name on one holder, or on all three in turn, without a website order.
// Run from printer-agent (stop the printer agent first; only one program can use the port):
//     node print-test.js heart|rectangle|circle|all [NAME] [font]
//     e.g.  node print-test.js all INVENGIC bebas
// The machine homes first ($H). Each keychain is engraved on its holder (machine.json)
// exactly as an order would be, and the head returns HOME. Ctrl+C stops safely.
const { connect, sendGcodeFile, disconnect, homeAndResetOrigin, SERIAL_CONFIG } = require('./laser-sender');
const { SHAPES, holderCentre } = require('./holders');
const { textToGcode, FONTS } = require('./text-to-gcode');

const [which = '', name = 'INVENGIC', fontId = 'pixel'] = process.argv.slice(2);
const shapes = which.toLowerCase() === 'all' ? SHAPES : [which.toLowerCase()];

if (!shapes.every(s => SHAPES.includes(s)) || !FONTS[fontId]) {
    console.error(`Usage: node print-test.js <${SHAPES.join('|')}|all> [NAME] [${Object.keys(FONTS).join('|')}]`);
    process.exit(2);
}

let connected = false;
let atPhysicalHome = false;
let homingFailed = false;
process.on('SIGINT', async () => {
    console.log('\n[TEST PRINT] Stopping: laser off, back to HOME...');
    if (connected) await disconnect();
    process.exit(130);
});

async function main() {
    try {
        console.log(`[TEST PRINT] "${name}" in ${fontId} on: ${shapes.join(', ')} (port ${SERIAL_CONFIG.port})`);
        console.log('[TEST PRINT] Put a blank in each of those holders and keep the bed clear.');
        await connect();                                   // homes ($H)
        connected = true;
        atPhysicalHome = true;
        for (const shape of shapes) {
            const c = holderCentre(shape);
            console.log(`\n[TEST PRINT] ${shape.toUpperCase()}: holder centre (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) mm from HOME`);
            const gcode = await textToGcode(name, `test_${shape}_${Date.now()}`, fontId, shape);
            let last = -1;
            await sendGcodeFile(gcode, (line, total) => {
                const pct = Math.floor((line / total) * 10) * 10;
                if (pct !== last) { last = pct; process.stdout.write(`  ${pct}%`); }
            });
            console.log(`\n[TEST PRINT] ${shape} engraved; returning to physical HOME...`);
            atPhysicalHome = false;
            await homeAndResetOrigin();
            atPhysicalHome = true;
            console.log(`[TEST PRINT] ${shape} done; physically homed.`);
        }
    } catch (error) {
        homingFailed = Boolean(error.homing);
        console.error(`\n[TEST PRINT] Failed: ${error.message}`);
        process.exitCode = 1;
    } finally {
        if (connected) await disconnect({ returnToOrigin: !atPhysicalHome && !homingFailed });
    }
}

main();

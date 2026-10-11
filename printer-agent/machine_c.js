const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const PORT = process.env.LASER_PORT || 'COM8';
const BAUD = 115200;

let port;
let parser;


// ============================================================
// WAIT
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// ============================================================
// SEND COMMAND
// ============================================================

function send(command) {

    return new Promise((resolve, reject) => {

        console.log(`[SEND] ${command}`);

        let finished = false;

        const onData = (data) => {

            const line = data.toString().trim();

            if (!line) return;

            console.log(`[GRBL] ${line}`);

            if (line === 'ok') {

                finished = true;

                parser.removeListener(
                    'data',
                    onData
                );

                resolve();
            }

            if (/^error/i.test(line)) {

                finished = true;

                parser.removeListener(
                    'data',
                    onData
                );

                reject(new Error(line));
            }

            if (/^ALARM/i.test(line)) {

                finished = true;

                parser.removeListener(
                    'data',
                    onData
                );

                reject(new Error(line));
            }
        };

        parser.on('data', onData);

        const timer = setTimeout(() => {

            if (!finished) {

                parser.removeListener(
                    'data',
                    onData
                );

                reject(
                    new Error(
                        `Timeout waiting for ${command}`
                    )
                );
            }

        }, 10000);

        port.write(command + '\n');
    });
}


// ============================================================
// WAIT FOR GRBL
// ============================================================

function waitForGrbl() {

    return new Promise(resolve => {

        let done = false;

        const onData = (data) => {

            const line =
                data.toString().trim();

            console.log(`[GRBL] ${line}`);

            if (/^Grbl/i.test(line)) {

                done = true;

                parser.removeListener(
                    'data',
                    onData
                );

                resolve();
            }
        };

        parser.on('data', onData);

        setTimeout(() => {

            if (!done) {

                parser.removeListener(
                    'data',
                    onData
                );

                resolve();
            }

        }, 5000);
    });
}


// ============================================================
// PHYSICAL HOMING
// ============================================================

function physicalHome() {

    return new Promise((resolve, reject) => {

        console.log('');
        console.log('============================================');
        console.log('       PHYSICAL HOMING');
        console.log('============================================');

        let finished = false;

        const onData = (data) => {

            const raw = data.toString();

            console.log(
                `[HOME] ${raw.trim()}`
            );

            const line =
                raw.toLowerCase();

            if (line.includes('st_go_idle')) {

                finished = true;

                parser.removeListener(
                    'data',
                    onData
                );

                console.log(
                    '[HOME] Physical homing complete.'
                );

                resolve();
            }

            if (line.includes('alarm')) {

                finished = true;

                parser.removeListener(
                    'data',
                    onData
                );

                reject(
                    new Error(
                        `GRBL alarm: ${raw.trim()}`
                    )
                );
            }
        };

        parser.on(
            'data',
            onData
        );

        const timer = setTimeout(() => {

            if (!finished) {

                parser.removeListener(
                    'data',
                    onData
                );

                reject(
                    new Error(
                        'Physical homing timeout'
                    )
                );
            }

        }, 30000);

        console.log('[HOME] Sending $H...');

        port.write('$H\n');
    });
}


// ============================================================
// POSITION
// ============================================================

function getPosition() {

    return new Promise((resolve, reject) => {

        let finished = false;

        const onData = (data) => {

            const line =
                data.toString().trim();

            console.log(
                `[STATUS] ${line}`
            );

            const match =
                line.match(
                    /MPos:([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?)/
                );

            if (match) {

                finished = true;

                parser.removeListener(
                    'data',
                    onData
                );

                resolve({
                    x: parseFloat(match[1]),
                    y: parseFloat(match[2]),
                    z: parseFloat(match[3])
                });
            }
        };

        parser.on(
            'data',
            onData
        );

        setTimeout(() => {

            if (!finished) {

                parser.removeListener(
                    'data',
                    onData
                );

                reject(
                    new Error(
                        'Position query timeout'
                    )
                );
            }

        }, 5000);

        // GRBL real-time status
        port.write('?');
    });
}


// ============================================================
// MAIN
// ============================================================

async function main() {

    try {

        console.log('');
        console.log('============================================');
        console.log('       20 MM X MOVEMENT TEST');
        console.log('============================================');


        // ----------------------------------------------------
        // CONNECT
        // ----------------------------------------------------

        console.log(
            `[SERIAL] Opening ${PORT}...`
        );

        port = new SerialPort({
            path: PORT,
            baudRate: BAUD
        });

        parser = port.pipe(
            new ReadlineParser({
                delimiter: '\n'
            })
        );

        await new Promise((resolve, reject) => {

            port.once('open', resolve);

            port.once('error', reject);
        });

        console.log(
            '[SERIAL] Port opened.'
        );


        // ----------------------------------------------------
        // GRBL
        // ----------------------------------------------------

        await waitForGrbl();

        await sleep(1000);


        // ----------------------------------------------------
        // INITIAL SETUP
        // ----------------------------------------------------

        try {

            await send('$X');

        } catch (error) {

            console.log(
                `[WARNING] $X: ${error.message}`
            );
        }

        await send('$32=1');
        await send('G21');
        await send('G90');
        await send('M5');


        // ----------------------------------------------------
        // PHYSICAL HOME
        // ----------------------------------------------------

        await physicalHome();

        await sleep(1000);


        // ----------------------------------------------------
        // READ HOME POSITION
        // ----------------------------------------------------

        console.log('');
        console.log(
            '[STATUS] Position after homing...'
        );

        const home =
            await getPosition();

        console.log('');
        console.log('============================================');
        console.log('       HOME POSITION');
        console.log('============================================');

        console.log(
            `X = ${home.x.toFixed(3)} mm`
        );

        console.log(
            `Y = ${home.y.toFixed(3)} mm`
        );


        // ----------------------------------------------------
        // MOVE +20 X
        // ----------------------------------------------------

        console.log('');
        console.log('============================================');
        console.log('       MOVING +20 MM IN X');
        console.log('============================================');

        console.log(
            '[MOVE] Relative movement: X +20 mm'
        );

        console.log(
            '[MOVE] Speed: 500 mm/min'
        );

        await send(
            '$J=G91 G21 X20 F500'
        );

        await sleep(2000);


        // ----------------------------------------------------
        // READ POSITION
        // ----------------------------------------------------

        console.log('');
        console.log(
            '[STATUS] Position after +20 mm X...'
        );

        const afterMove =
            await getPosition();

        console.log('');
        console.log('============================================');
        console.log('       RESULT');
        console.log('============================================');

        console.log(
            `Before X = ${home.x.toFixed(3)} mm`
        );

        console.log(
            `After  X = ${afterMove.x.toFixed(3)} mm`
        );

        console.log(
            `Change   = ${(afterMove.x - home.x).toFixed(3)} mm`
        );

        console.log('');
        console.log(
            '[SAFETY] Laser OFF.'
        );

        console.log(
            '[SAFETY] Machine will remain here.'
        );


        // Do NOT automatically return.
        // We want to physically inspect the movement.

        await new Promise(() => {});


    } catch (error) {

        console.error('');
        console.error(
            '[ERROR]',
            error.message
        );

        try {

            if (port && port.isOpen) {

                port.write('M5\n');

                await sleep(300);

                port.close();
            }

        } catch (_) {}

        process.exitCode = 1;
    }
}

main();
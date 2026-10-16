const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');

// ===== SERIAL PORT SETTINGS =====
// Adjust COM port for your Creality CV-01 Pro
// Check Device Manager → Ports (COM & LPT) on the printer laptop
function getEffectivePort() {
    if (process.env.LASER_PORT) return process.env.LASER_PORT;
    try {
        if (fs.existsSync('/dev')) {
            const files = fs.readdirSync('/dev');
            const found = files.find(f => f.startsWith('cu.usbmodem') || f.startsWith('cu.usbserial') || f.startsWith('cu.wchusbserial'));
            if (found) return '/dev/' + found;
        }
    } catch (e) {}
    return '/dev/cu.usbmodem1234561';
}

const SERIAL_CONFIG = {
    get port() { return getEffectivePort(); },
    baudRate: 115200,
};

const BANNER_TIMEOUT_MS = 5000;    // Wait up to 5s for GRBL startup banner
const COMMAND_TIMEOUT_MS = 120000; // 2 min — GRBL holds 'ok' while planner buffer drains at end of job

let serialPort = null;
let parser = null;
let isConnected = false;
let stopRequested = false;            // set on shutdown: sendGcodeFile stops before its next line
let inFlight = Promise.resolve();     // the command currently waiting for 'ok'

const SHUTDOWN_STEP_TIMEOUT_MS = 5000;   // laser off / queue the move home
const SHUTDOWN_HOME_TIMEOUT_MS = 30000;  // wait for the head to finish moving home

/**
 * Connect to the laser printer via serial port.
 * Waits for GRBL banner, then sends init sequence.
 */
async function connect(retryCount = 0) {
    await forceClose();

    const targetPort = SERIAL_CONFIG.port;

    return new Promise((resolve, reject) => {
        console.log(`[SERIAL] Connecting to ${targetPort} at ${SERIAL_CONFIG.baudRate} baud...`);

        // Each attempt ends once: connected, failed, or handed to ONE retry. Without this the
        // close handler and the error path could both retry, and every attempt homes the machine.
        let settled = false;

        serialPort = new SerialPort({
            path: targetPort,
            baudRate: SERIAL_CONFIG.baudRate,
        }, (err) => {
            if (err && !settled) {
                settled = true;
                isConnected = false;
                reject(err);
            }
        });

        parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

        // Global log listener — logs everything that isn't 'ok'
        parser.on('data', (data) => {
            const line = data.toString().trim();
            if (line && line !== 'ok') {
                console.log(`[GRBL] ${line}`);
            }
        });

        serialPort.on('error', (err) => {
            console.error(`[SERIAL] Error: ${err.message}`);
            isConnected = false;
        });

        serialPort.on('close', () => {
            console.log('[SERIAL] Port closed');
            isConnected = false;
            if (!settled && retryCount < 3) {
                settled = true;
                console.log('[SERIAL] Creality USB reset detected on connect, retrying in 1s...');
                setTimeout(() => {
                    connect(retryCount + 1).then(resolve).catch(reject);
                }, 1000);
            }
        });

        serialPort.on('open', async () => {
            console.log(`[SERIAL] Port opened. Waiting for GRBL banner...`);

            try {
                await waitForBanner();
                if (settled) return;           // handed to a retry (USB reset): that attempt owns the new port
                console.log('[SERIAL] GRBL banner received');

                if (!serialPort || !serialPort.isOpen) {
                    throw new Error('Port closed during startup banner');
                }

                await sendInitSequence();
                console.log('[SERIAL] Init sequence sent');

                isConnected = true;
                settled = true;
                resolve();
            } catch (err) {
                isConnected = false;
                if (settled) return;           // the close handler already took over (USB reset)
                settled = true;
                if (retryCount < 3 && !err.homing) {
                    console.log(`[SERIAL] Connect attempt ${retryCount + 1} failed (${err.message}), retrying...`);
                    setTimeout(() => {
                        connect(retryCount + 1).then(resolve).catch(reject);
                    }, 1000);
                } else {
                    reject(err);
                }
            }
        });
    });
}

/**
 * Wait for the GRBL startup banner (e.g. "Grbl 1.1h ['$' for help]").
 * Resolves on first line starting with "Grbl" or after timeout (some clones skip it).
 */
function waitForBanner() {
    return new Promise((resolve) => {
        let done = false;

        const finish = () => {
            if (done) return;
            done = true;
            parser.removeListener('data', onData);
            clearTimeout(timer);
            resolve();
        };

        const onData = (data) => {
            const line = data.toString().trim();
            if (/^Grbl/i.test(line) || /homtary/i.test(line) || /^ep=/i.test(line)) {
                finish();
            }
        };

        parser.on('data', onData);
        // If no banner shows up in time, proceed anyway — some GRBL clones skip it
        const timer = setTimeout(finish, BANNER_TIMEOUT_MS);
    });
}

/**
 * Send the one-time init sequence right after GRBL is ready.
 * This is the right time to set $32=1 because GRBL is in IDLE state.
 */
async function sendInitSequence() {
    // NOTE: do NOT send \x18 here — on CH340 Creality boards, opening the
    // port already triggers a DTR-pulse reset (which is why we got the
    // banner). Sending another reset causes the driver to close the port.

    // Settle delay after the banner for Creality ESP32 motor driver init
    await sleep(1500);

    // Physical homing: the head drives to its limit switches, so HOME is the same spot
    // every session and after every reconnect. $H also clears a start-up alarm lock.
    // The laser stays off (M5 is the power-on state; it's sent again below).
    await homeMachine();

    // Enable laser mode — THIS IS THE CRITICAL FIX
    await sendCommand('$32=1');

    // Set up modal state
    await sendCommand('G21'); // mm
    await sendCommand('G90'); // absolute
    await sendCommand('M5');  // laser off

    // === DEFINE HOME (session origin) ===
    // Clear any stale work-coordinate offset, then make the homed position (0, 0) =
    // HOME. machine.json's holder centres are mm from here, and every job returns
    // here. Going back to exactly where homing left the head never touches a switch.
    await sendCommand('G92.1');      // clear any prior G92 offset
    await sendCommand('G92 X0 Y0');  // the homed position is now HOME
    try {   // for the log only: positions are measured from here, whatever the laser reports
        const m = await getCurrentPosition();
        console.log(`[HOME] HOME set at the homed position (the laser reports X${m.x.toFixed(3)} Y${m.y.toFixed(3)})`);
    } catch (err) {
        console.log('[HOME] HOME set at the homed position');
    }
}

// $H: GRBL replies only once the homing cycle has finished (CV-01 firmware may glue
// the 'ok' onto debug text: "stop st_go_idleok"). A failure is not retried: running
// into a faulty switch again and again would only grind the axis.
async function homeMachine() {
    console.log('[HOME] Homing: the head moves to its HOME corner. Keep the bed clear.');
    try {
        await sendCommand('$H');
    } catch (err) {
        const homing = new Error(`Homing failed (${err.message}). Check the limit switches and that nothing blocks the head.`);
        homing.homing = true;
        throw homing;
    }
    console.log('[HOME] Homing complete');
}

/**
 * Send a single G-code command and wait for 'ok'.
 * Handles errors, alarms, and timeouts properly.
 */
function sendCommand(command) {
    const sent = new Promise((resolve, reject) => {
        if (!serialPort || !serialPort.isOpen) {
            return reject(new Error('Serial port not open'));
        }

        let done = false;

        const finish = (fn, arg) => {
            if (done) return;
            done = true;
            parser.removeListener('data', onData);
            clearTimeout(timer);
            fn(arg);
        };

        const onData = (data) => {
            const line = data.toString().trim();

            // Some CV-01 firmware builds append the acknowledgement directly
            // to debug text (for example, "stop st_go_idleok") instead of
            // sending a clean standalone "ok" line.
            if (/\bok\s*$/i.test(line) || /idleok\s*$/i.test(line)) {
                finish(resolve);
            } else if (/^error/i.test(line)) {
                finish(reject, new Error(`GRBL error: ${line} (on "${command}")`));
            } else if (/^ALARM/i.test(line)) {
                finish(reject, new Error(`GRBL alarm: ${line} (on "${command}")`));
            }
            // Ignore everything else (status reports, [MSG:...], banners, etc.)
        };

        const timer = setTimeout(() => {
            finish(reject, new Error(`Command timeout (${COMMAND_TIMEOUT_MS}ms): ${command}`));
        }, COMMAND_TIMEOUT_MS);

        parser.on('data', onData);
        serialPort.write(command + '\n');
    });
    inFlight = sent.catch(() => {});
    return sent;
}

/**
 * Send a complete G-code file to the laser printer line by line.
 * Waits for 'ok' after each command before sending the next.
 *
 * @param {string} gcodePath - Path to the .gcode file
 * @param {function} onProgress - Callback with (currentLine, totalLines)
 */
async function sendGcodeFile(gcodePath, onProgress) {
    if (!isConnected) {
        throw new Error('Not connected to printer. Call connect() first.');
    }

    const fileContent = fs.readFileSync(gcodePath, 'utf-8');
    const lines = fileContent
        .split('\n')
        .map(line => line.split(';')[0].trim())
        .filter(Boolean);

    const totalLines = lines.length;
    console.log(`[SERIAL] Sending ${totalLines} G-code commands...`);

    for (let i = 0; i < totalLines; i++) {
        if (stopRequested) {
            throw new Error('Stopped by the operator');
        }
        const line = lines[i];
        await sendCommand(line);

        if (onProgress && (i % 100 === 0 || i === totalLines - 1)) {
            onProgress(i + 1, totalLines);
        }
    }

    console.log('[SERIAL] G-code sending complete!');
}

/**
 * List available serial ports (to find your laser printer)
 */
async function listPorts() {
    const ports = await SerialPort.list();
    console.log('\n[SERIAL] Available ports:');
    ports.forEach(p => {
        console.log(`  ${p.path} — ${p.manufacturer || 'Unknown manufacturer'} ${p.pnpId || ''}`);
    });
    console.log('');
    return ports;
}

/**
 * Force-close any existing serial port handle. Safe to call even if
 * nothing is open. Waits for the underlying 'close' event to fire so
 * that the OS releases the COM port before we attempt to re-open.
 */
function forceClose() {
    return new Promise((resolve) => {
        isConnected = false;

        if (!serialPort) {
            return resolve();
        }

        const port = serialPort;
        serialPort = null;
        parser = null;

        if (!port.isOpen) {
            return resolve();
        }

        // Give it up to 2s to close, then resolve anyway
        const timer = setTimeout(resolve, 2000);
        port.close(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}

/**
 * Disconnect from the laser printer (graceful shutdown)
 */
async function disconnect({ returnToOrigin = true } = {}) {
    stopRequested = true;
    if (serialPort && serialPort.isOpen && isConnected) {
        // Let the line in progress finish, then laser off and back to HOME. G4 (dwell)
        // is acknowledged only after every queued move has run, so its 'ok' means the
        // head is at HOME. Only then close: closing the port can reset the board,
        // which would leave the head wherever it stopped.
        // returnToOrigin: false (the shape tests) leaves the head where it is.
        try {
            await withTimeout(inFlight, SHUTDOWN_STEP_TIMEOUT_MS);
            await withTimeout(sendCommand('M5'), SHUTDOWN_STEP_TIMEOUT_MS);
            if (returnToOrigin) {
                await withTimeout(sendCommand('G0 X0 Y0'), SHUTDOWN_STEP_TIMEOUT_MS);
                await withTimeout(sendCommand('G4 P0.1'), SHUTDOWN_HOME_TIMEOUT_MS);
                console.log('[SERIAL] Laser off, head back at HOME');
            } else {
                console.log('[SERIAL] Laser off');
            }
        } catch (err) {
            console.log(`[SERIAL] Could not confirm the laser is off and the head is back: ${err.message}`);
        }
    } else if (serialPort && serialPort.isOpen) {
        try {
            serialPort.write('M5\n');
        } catch (err) {
            console.log(`[SERIAL] Laser-off on shutdown failed: ${err.message}`);
        }
        await sleep(300);
    }
    await forceClose();
}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no reply within ${ms / 1000}s`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Query GRBL for the current machine position. Sends `?` and parses the
 * `<state|MPos:x,y,z|...>` status report. Returns { x, y } in millimeters.
 *
 * Uses a temporary parser listener so it doesn't conflict with the global
 * one. Resolves on the first matching status line; rejects after timeout.
 */
function getCurrentPosition({ timeoutMs = 1000 } = {}) {
    return new Promise((resolve, reject) => {
        if (!serialPort || !serialPort.isOpen || !parser) {
            return reject(new Error('Serial port not open'));
        }

        let done = false;
        const onData = (data) => {
            const line = data.toString().trim();
            // GRBL status report:  <Idle|MPos:0.000,0.000,0.000|FS:0,0>
            const m = line.match(/<[^|]+\|MPos:(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (m) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                parser.removeListener('data', onData);
                resolve({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
            }
        };

        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            parser.removeListener('data', onData);
            reject(new Error('Position query timeout'));
        }, timeoutMs);

        parser.on('data', onData);
        // `?` is GRBL's real-time status query — no newline, single byte
        serialPort.write('?');
    });
}

module.exports = { connect, sendCommand, sendGcodeFile, listPorts, disconnect, getCurrentPosition, homeMachine, SERIAL_CONFIG };

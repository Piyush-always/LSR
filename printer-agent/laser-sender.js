const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');

// ===== SERIAL PORT SETTINGS =====
// Adjust COM port for your Creality CV-01 Pro
// Check Device Manager → Ports (COM & LPT) on the printer laptop
const SERIAL_CONFIG = {
    port: process.env.LASER_PORT || 'COM8',
    baudRate: 115200,
};

const BANNER_TIMEOUT_MS = 5000;    // Wait up to 5s for GRBL startup banner
const COMMAND_TIMEOUT_MS = 120000; // 2 min — GRBL holds 'ok' while planner buffer drains at end of job

let serialPort = null;
let parser = null;
let isConnected = false;

/**
 * Connect to the laser printer via serial port.
 * Waits for GRBL banner, then sends init sequence.
 */
async function connect() {
    // If there's a stale port handle from a previous failed session, close it
    // cleanly first. Windows gives "Access denied" if we try to open a COM port
    // that another handle (even in this same process) still holds.
    await forceClose();

    return new Promise((resolve, reject) => {
        console.log(`[SERIAL] Connecting to ${SERIAL_CONFIG.port} at ${SERIAL_CONFIG.baudRate} baud...`);

        serialPort = new SerialPort({
            path: SERIAL_CONFIG.port,
            baudRate: SERIAL_CONFIG.baudRate,
        }, (err) => {
            if (err) {
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
        });

        serialPort.on('open', async () => {
            console.log(`[SERIAL] Port opened. Waiting for GRBL banner...`);

            try {
                await waitForBanner();
                console.log('[SERIAL] GRBL banner received');

                isConnected = true;

                // Send machine init sequence while GRBL is IDLE
                await sendInitSequence();
                console.log('[SERIAL] Init sequence sent');

                resolve();
            } catch (err) {
                isConnected = false;
                reject(err);
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
            if (/^Grbl/i.test(line)) {
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

    // Small settle delay after the banner
    await sleep(300);

    // Unlock from alarm state (ignore errors — not always needed)
    try {
        await sendCommand('$X');
    } catch (err) {
        console.log(`[SERIAL] $X unlock warning: ${err.message}`);
    }

    // Enable laser mode — THIS IS THE CRITICAL FIX
    await sendCommand('$32=1');

    // Set up modal state
    await sendCommand('G21'); // mm
    await sendCommand('G90'); // absolute
    await sendCommand('M5');  // laser off
}

/**
 * Send a single G-code command and wait for 'ok'.
 * Handles errors, alarms, and timeouts properly.
 */
function sendCommand(command) {
    return new Promise((resolve, reject) => {
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

            if (line === 'ok') {
                finish(resolve);
            } else if (/^error/i.test(line)) {
                finish(reject, new Error(`GRBL error: ${line}`));
            } else if (/^ALARM/i.test(line)) {
                finish(reject, new Error(`GRBL alarm: ${line}`));
            }
            // Ignore everything else (status reports, [MSG:...], banners, etc.)
        };

        const timer = setTimeout(() => {
            finish(reject, new Error(`Command timeout (${COMMAND_TIMEOUT_MS}ms): ${command}`));
        }, COMMAND_TIMEOUT_MS);

        parser.on('data', onData);
        serialPort.write(command + '\n');
    });
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
    const lines = fileContent.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith(';');
    });

    const totalLines = lines.length;
    console.log(`[SERIAL] Sending ${totalLines} G-code commands...`);

    for (let i = 0; i < totalLines; i++) {
        const line = lines[i].trim();
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
async function disconnect() {
    if (serialPort && serialPort.isOpen) {
        try {
            serialPort.write('M5\n');
            serialPort.write('G0 X0 Y0\n');
        } catch (err) {
            // Ignore write errors on shutdown
        }
        await sleep(300);
    }
    await forceClose();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { connect, sendCommand, sendGcodeFile, listPorts, disconnect, SERIAL_CONFIG };

// Serial handshake with the Arduino material feeder. The feeder has its own
// USB serial port, separate from the laser's GRBL port.
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const BAUD_RATE = 115200;
const STARTUP_TIMEOUT_MS = 15000;
const LOAD_TIMEOUT_MS = 120000;

const COMMANDS = {
    heart: 'LOAD HEART',
    rectangle: 'LOAD RECTANGLE',
    circle: 'LOAD CIRCLE',
};

class FeederLink {
    constructor(portPath) {
        this.portPath = portPath;
        this.port = null;
        this.parser = null;
        this.pendingLoad = null;
        this.ready = false;
    }

    async connect() {
        if (this.ready) return;
        this.port = new SerialPort({ path: this.portPath, baudRate: BAUD_RATE, autoOpen: false });
        this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
        this.parser.on('data', line => this.onLine(String(line).trim()));
        this.port.on('error', err => {
            if (this.pendingLoad) {
                clearTimeout(this.pendingLoad.timer);
                this.pendingLoad.reject(new Error(`Feeder serial error: ${err.message}`));
                this.pendingLoad = null;
            }
        });

        // Install the startup listener before opening the port: opening an Uno's
        // COM port resets it, and its banner can arrive before open() calls back.
        try {
            let finishStartup;
            const startup = new Promise((resolve, reject) => {
                let settled = false;
                finishStartup = err => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    this.parser.removeListener('data', onStartup);
                    err ? reject(err) : resolve();
                };
                const onStartup = line => {
                    if (String(line).trim() === 'FEEDER READY') finishStartup();
                };
                const timer = setTimeout(() => finishStartup(new Error(`No FEEDER READY from Arduino on ${this.portPath}`)), STARTUP_TIMEOUT_MS);
                this.parser.on('data', onStartup);
            });
            await new Promise((resolve, reject) => this.port.open(err => err ? reject(err) : resolve()));
            await startup;
        } catch (err) {
            if (finishStartup) finishStartup(err);
            await this.close();
            throw err;
        }

        this.ready = true;
        console.log(`[FEEDER] Arduino ready on ${this.portPath}`);
    }

    onLine(line) {
        if (!line) return;
        console.log(`[FEEDER] ${line}`);
        const pending = this.pendingLoad;
        if (!pending) return;
        if (line === pending.readyLine) {
            clearTimeout(pending.timer);
            this.pendingLoad = null;
            pending.resolve();
        } else if (line.startsWith(`ERROR ${pending.shape.toUpperCase()} `)) {
            clearTimeout(pending.timer);
            this.pendingLoad = null;
            pending.reject(new Error(`Feeder failed to load ${pending.shape}: ${line}`));
        }
    }

    async load(shape) {
        const command = COMMANDS[shape];
        if (!command) throw new Error(`No feeder command configured for shape: ${shape}`);
        if (!this.ready || !this.port?.isOpen) throw new Error('Feeder is not connected');
        if (this.pendingLoad) throw new Error('Feeder already has a load command in progress');

        console.log(`[FEEDER] Loading ${shape.toUpperCase()}; waiting for confirmation...`);
        await this.command(shape, command, `READY ${shape.toUpperCase()}`);
    }

    async feedUp(shape) {
        const command = `FEED UP ${String(shape).toUpperCase()}`;
        if (!COMMANDS[shape]) throw new Error(`No feeder command configured for shape: ${shape}`);
        if (!this.ready || !this.port?.isOpen) throw new Error('Feeder is not connected');
        if (this.pendingLoad) throw new Error('Feeder already has a command in progress');

        console.log(`[FEEDER] Moving ${shape.toUpperCase()} upward for the next job...`);
        await this.command(shape, command, `READY UP ${shape.toUpperCase()}`);
    }

    async removeRectangle() {
        if (!this.ready || !this.port?.isOpen) throw new Error('Feeder is not connected');
        if (this.pendingLoad) throw new Error('Feeder already has a command in progress');

        console.log('[FEEDER] Removing finished rectangle; waiting for A-axis limit cycle...');
        await this.command('REMOVE RECTANGLE', 'REMOVE RECTANGLE', 'READY REMOVE RECTANGLE');
    }

    async command(shape, command, readyLine) {
        await new Promise((resolve, reject) => {
            const pending = {
                shape,
                readyLine,
                resolve,
                reject,
                timer: setTimeout(() => {
                    if (this.pendingLoad !== pending) return;
                    this.pendingLoad = null;
                    reject(new Error(`Feeder timed out waiting for ${readyLine} (${command})`));
                }, LOAD_TIMEOUT_MS),
            };
            this.pendingLoad = pending;
            this.port.write(`${command}\n`, err => {
                if (!err) return;
                clearTimeout(pending.timer);
                this.pendingLoad = null;
                reject(new Error(`Could not send feeder command: ${err.message}`));
            });
        });
    }

    async close() {
        this.ready = false;
        if (this.pendingLoad) {
            clearTimeout(this.pendingLoad.timer);
            this.pendingLoad.reject(new Error('Feeder connection closed'));
            this.pendingLoad = null;
        }
        if (this.port?.isOpen) await new Promise(resolve => this.port.close(() => resolve()));
        this.port = null;
        this.parser = null;
    }
}

module.exports = { FeederLink };

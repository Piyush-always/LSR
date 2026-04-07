const QRCode = require('qrcode');
const path = require('path');

const URL = 'https://laser-inv.web.app';
const outputPath = path.join(__dirname, 'assets', 'qr-code.png');

QRCode.toFile(outputPath, URL, {
    width: 1024,
    margin: 2,
    color: {
        dark: '#000000',
        light: '#ffffff',
    },
}, (err) => {
    if (err) {
        console.error('Error generating QR code:', err);
    } else {
        console.log('QR code saved to:', outputPath);
    }
});

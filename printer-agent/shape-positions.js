// Offsets from the heart center/reference at machine MPos X60 Y28 mm.
// Start the printer agent with the head at the heart center. Values are mm.
// Keep each piece centered at these coordinates with a bed jig.
// Leave a shape as null until its center has been measured; jobs for an
// uncalibrated shape are rejected instead of moving to a guessed location.
module.exports = {
    heart: { x: 0, y: 0 },       // Heart center is the session origin
    rectangle: { x: 110, y: 0 }, // MPos center (170, 28) minus heart reference (60, 28)
    circle: { x: 37, y: 107 },   // MPos center (97, 135) minus heart reference (60, 28)
};

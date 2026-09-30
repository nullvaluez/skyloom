// NIGHT (edit 78.0-82.0). Down the Hudson toward Lower Manhattan and the harbor
// at night: lit towers both banks, moonlight on the water, plumes glowing.
module.exports = {
  id: 'nyc-night',
  frames: 135, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 28, 0, 20), // el ~ -16 (night)
  weather: 'few',
  start: { lat: 40.7650, lon: -74.0020, altM: 520, headingDeg: 200 },
  settle: { maxSec: 600, minSec: 30, streamSec: 180 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const path = TR.path([
      { t: -3, lat: 40.7640, lon: -74.0028, alt: 520 },
      { t: 0, lat: 40.7585, lon: -74.0062, alt: 500 },
      { t: 5, lat: 40.7490, lon: -74.0112, alt: 470 },
    ]);
    const fly = TR.flyPath(path);
    const cam = TR.cam.orbit({ az: (t) => 150 - 12 * t / 4.5, el: 7, dist: 34, lookFwd: -4, lookUp: 0, fov: 52 });
    TR.ambientFleet({ lat: 40.72, lon: -73.95, n: 12, radiusKm: 22, altMin: 2000, altMax: 9000, seed: 41 });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

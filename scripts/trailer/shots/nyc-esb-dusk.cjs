// LANDMARKS (edit 76.0-78.0). Empire State Building at blue hour; the Vector
// streaks past the mast, city lights coming on below.
module.exports = {
  id: 'nyc-esb-dusk',
  frames: 90, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 23, 2), // el ~ -3 (blue hour)
  weather: 'few',
  start: { lat: 40.7455, lon: -73.9950, altM: 520, headingDeg: 62 },
  settle: { maxSec: 600, minSec: 30, streamSec: 180 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    // pass 130 m north-west of the mast (40.7484,-73.9857), heading ~62 deg
    const path = TR.path([
      { t: -3, lat: 40.7441, lon: -73.9985, alt: 540 },
      { t: 0, lat: 40.7471, lon: -73.9903, alt: 520 },
      { t: 3, lat: 40.7502, lon: -73.9822, alt: 505 },
    ]);
    const fly = TR.flyPath(path);
    const cam = TR.cam.tripod({ lat: 40.7466, lon: -73.9819, alt: 470, target: null, lookUp: 0, lookFwd: 0, fov: 42,
      lead: 0.45, leadTarget: { lat: 40.7484, lon: -73.9857, alt: 480 } });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

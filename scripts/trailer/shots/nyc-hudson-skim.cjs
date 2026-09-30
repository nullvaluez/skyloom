// WATERFRONT (edit ~26.0-28.0). Low, fast skim up the Hudson at golden hour;
// Midtown and Hudson Yards on the right, coastal reflections below 2.2 km.
module.exports = {
  id: 'nyc-hudson-skim',
  frames: 105, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 22, 10),
  weather: 'baseline',
  start: { lat: 40.7400, lon: -74.0160, altM: 90, headingDeg: 27 },
  settle: { maxSec: 600, minSec: 30, streamSec: 150 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const path = TR.path([
      { t: -3, lat: 40.7395, lon: -74.0162, alt: 70 },
      { t: 0, lat: 40.7458, lon: -74.0121, alt: 62 },
      { t: 4, lat: 40.7552, lon: -74.0068, alt: 58 },
    ]);
    const fly = TR.flyPath(path);
    const cam = TR.cam.orbit({ az: (t) => -28 + 6 * t, el: 1.5, dist: 20, lookFwd: 70, lookUp: 2, fov: 50 });
    TR.ambientFleet({ lat: 40.74, lon: -73.95, n: 10, radiusKm: 25, altMin: 9500, altMax: 11800, seed: 21 });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

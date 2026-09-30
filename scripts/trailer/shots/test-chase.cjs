// Rig smoke test: straight flight north over Manhattan, native chase camera.
module.exports = {
  id: 'test-chase',
  fps: 30,
  frames: 60,
  runIn: 30,
  sunUtc: Date.UTC(2026, 6, 18, 21, 30, 0), // ~5:30pm EDT, warm afternoon
  start: { lat: 40.70, lon: -74.015, altM: 450, headingDeg: 20 },
  settle: { maxSec: 300, minSec: 20 },
  page: function () {
    const TR = window.TR;
    const p = TR.path([
      { t: -2, lat: 40.700, lon: -74.018, alt: 450 },
      { t: 6, lat: 40.7135, lon: -74.010, alt: 430 },
    ]);
    const fl = TR.flyPath(p);
    window.__shot = { flight: (t) => fl(t) };
  },
};

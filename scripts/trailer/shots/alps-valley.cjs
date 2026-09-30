// WORLD (edit 16.0-19.0) + CLIMAX (88-89). Down the Lauterbrunnen valley,
// 500 m above the floor between 1 km cliffs, toward the Jungfrau massif.
module.exports = {
  id: 'alps-valley',
  frames: 135, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 15, 50), // afternoon, sun WSW ~el 16
  weather: 'few',
  start: { lat: 46.6010, lon: 7.9100, altM: 1350, headingDeg: 186 },
  settle: { maxSec: 600, minSec: 30, streamSec: 150 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const path = TR.path([
      { t: -3, lat: 46.6030, lon: 7.9102, alt: 1380 },
      { t: 0, lat: 46.5965, lon: 7.9092, alt: 1330 },
      { t: 2.5, lat: 46.5905, lon: 7.9080, alt: 1290 },
      { t: 5, lat: 46.5840, lon: 7.9058, alt: 1300 },
    ]);
    const fly = TR.flyPath(path, { bankGain: 1.3 });
    const cam = TR.cam.orbit({ az: (t) => 18 - 6 * t, el: 4, dist: 24, lookFwd: 160, lookUp: -6, fov: 56, bankShare: 0.3 });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: t > 1.0 }), camera: cam };
  },
};

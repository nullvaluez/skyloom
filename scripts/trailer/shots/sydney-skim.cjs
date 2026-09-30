// WATERFRONT (edit ~23.5-26). Skimming Port Jackson into the sunset glint,
// the Opera House and Harbour Bridge ahead.
module.exports = {
  id: 'sydney-skim',
  frames: 105, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 7, 22),
  weather: 'few',
  start: { lat: -33.8545, lon: 151.2450, altM: 50, headingDeg: 272 },
  settle: { maxSec: 600, minSec: 30, streamSec: 150 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const path = TR.path([
      { t: -3, lat: -33.8547, lon: 151.2470, alt: 48 },
      { t: 0, lat: -33.8551, lon: 151.2395, alt: 42 },
      { t: 4, lat: -33.8556, lon: 151.2295, alt: 40 },
    ]);
    const fly = TR.flyPath(path);
    const cam = TR.cam.orbit({ az: (t) => -8 + 3 * t, el: 1.2, dist: 22, lookFwd: 260, lookUp: 6, fov: 52 });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

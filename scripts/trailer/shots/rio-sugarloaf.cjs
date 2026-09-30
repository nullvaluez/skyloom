// WORLD (edit ~19-21). Past the Sugarloaf summit, Copacabana beyond, late sun.
module.exports = {
  id: 'rio-sugarloaf',
  frames: 105, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 20, 10),
  weather: 'few',
  start: { lat: -22.9455, lon: -43.1300, altM: 460, headingDeg: 268 },
  settle: { maxSec: 600, minSec: 30, streamSec: 150 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const path = TR.path([
      { t: -3, lat: -22.9457, lon: -43.1330, alt: 470 },
      { t: 0, lat: -22.9463, lon: -43.1420, alt: 455 },
      { t: 4, lat: -22.9472, lon: -43.1545, alt: 440 },
    ]);
    const fly = TR.flyPath(path);
    const cam = TR.cam.orbit({ az: (t) => 70 + 5 * t, el: 3, dist: 34, lookFwd: 18, lookUp: -2, fov: 50 });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

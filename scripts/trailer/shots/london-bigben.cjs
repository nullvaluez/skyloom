// LANDMARKS (edit 70.0-72.0). Up the Thames past Big Ben and Westminster.
module.exports = {
  id: 'london-bigben',
  frames: 90, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 16, 55),
  weather: 'scattered',
  start: { lat: 51.4950, lon: -0.1215, altM: 160, headingDeg: 3 },
  settle: { maxSec: 600, minSec: 30, streamSec: 180 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const path = TR.path([
      { t: -3, lat: 51.4948, lon: -0.1218, alt: 165 },
      { t: 0, lat: 51.4985, lon: -0.1216, alt: 155 },
      { t: 3, lat: 51.5025, lon: -0.1212, alt: 150 },
    ]);
    const fly = TR.flyPath(path);
    const cam = TR.cam.tripod({ lat: 51.5012, lon: -0.1178, alt: 75, fov: 44, lead: 0.5, leadTarget: { lat: 51.5007, lon: -0.1246, alt: 110 } });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

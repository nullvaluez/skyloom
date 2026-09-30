// LANDMARKS (edit 74.0-76.0). Climbing past the Burj Khalifa's spire at golden hour.
module.exports = {
  id: 'dubai-burj',
  frames: 90, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 13, 40),
  weather: 'clear',
  start: { lat: 25.1880, lon: 55.2700, altM: 780, headingDeg: 22 },
  settle: { maxSec: 600, minSec: 30, streamSec: 180 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const path = TR.path([
      { t: -3, lat: 25.1905, lon: 55.2718, alt: 760 },
      { t: 0, lat: 25.1950, lon: 55.2737, alt: 840 },
      { t: 3, lat: 25.1996, lon: 55.2757, alt: 960 },
    ]);
    const fly = TR.flyPath(path);
    const cam = TR.cam.tripod({ lat: 25.1958, lon: 55.2806, alt: 860, fov: 46, lead: 0.5, leadTarget: { lat: 25.1972, lon: 55.2744, alt: 900 } });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

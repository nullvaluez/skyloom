// CLIMAX (edit 86.0-88.0 and 92.0-94.0). Overcast: the Vector pitches up and
// punches out of the cloud tops into the sunset, boost lit, then climbs.
module.exports = {
  id: 'clouds-punch',
  frames: 150, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 22, 8),
  weather: { cloudCoverPct: 85, visM: 30000, windMps: 4, windDirDeg: 250, precip: 'none', tempC: 14 },
  start: { lat: 40.72, lon: -73.60, altM: 2000, headingDeg: 270 },
  settle: { maxSec: 600, minSec: 30, streamSec: 90 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const lat0 = 40.72, k = 1 / Math.cos(lat0 * TR.D2R);
    // climb: pitch ramps to 55 deg; altitude from 2400 (inside deck) to ~4200
    const alt = (t) => 2000 + Math.max(0, t + 1) * 80 + Math.pow(Math.max(0, t + 1), 2) * 55;
    const keys = [];
    for (let t = -2; t <= 6; t += 0.5) {
      const x = 260 * (t + 2); // metres west
      keys.push({ t, lat: lat0, lon: -73.60 - x / (111320 * Math.cos(lat0 * TR.D2R)), alt: alt(t) });
    }
    const fly = TR.flyPath(TR.path(keys));
    const cam = TR.cam.orbit({ az: (t) => -12 + 4 * t, el: (t) => -4 + 2 * t, dist: 26, lookFwd: 30, lookUp: 4, fov: 56 });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

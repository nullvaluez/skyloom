// COLD OPEN (edit 0.0-8.0). Dawn above a broken cloud deck at 9.5 km; the
// Vector slides through frame toward the rising sun trailing twin contrails.
module.exports = {
  id: 'clouds-dawn',
  frames: 270, runIn: 60,
  sunUtc: Date.UTC(2026, 8, 27, 11, 52), // morning el ~ +8 at NYC: warm but lit
  weather: 'scattered',
  start: { lat: 40.60, lon: -73.30, altM: 7200, headingDeg: 95 },
  settle: { maxSec: 600, minSec: 30, streamSec: 90 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const hdg = 95, spd = 220, lat0 = 40.60, lon0 = -73.30;
    const path = TR.straight(lat0, lon0, 7200, hdg, spd, 0);
    const fl = (t) => { const p = path(t); return { pos: p.pos, heading: p.heading, pitch: 0.01, bank: 0.05 * Math.sin(t * 0.3), speed: spd, latDeg: lat0 }; };
    // camera: 90 m to the right and a little ahead, low; slowly swinging behind as the jet passes
    const cam = (t, f) => {
      const u = TR.smoother(t / 9);
      const eye = TR.offset(f.pos, f.heading, lat0, 70 - 50 * u, -8 + 10 * u, 60 - 140 * u);
      const target = TR.offset(f.pos, f.heading, lat0, 0, -60 - 40 * u, 20 + 200 * u); // tilt down: cloud sea, less horizon
      return { eye, target, fov: 48 - 6 * u, roll: 0.02 };
    };
    TR.ambientFleet({ lat: 40.6, lon: -73.1, n: 14, radiusKm: 18, altMin: 9300, altMax: 11800, seed: 61 });
    window.__shot = { flight: fl, camera: cam };
  },
};

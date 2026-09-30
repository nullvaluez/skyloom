// CLIMAX (edit ~90-91). Knife-edge up 6th Avenue between Midtown towers.
module.exports = {
  id: 'nyc-knife',
  frames: 60, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 22, 0),
  weather: 'baseline',
  start: { lat: 40.7520, lon: -73.9862, altM: 160, headingDeg: 29 },
  settle: { maxSec: 600, minSec: 30, streamSec: 180 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    // 6th Ave centreline: 42nd St (40.75453,-73.98437) -> 57th St (40.76463,-73.97702)
    const A = [40.75453, -73.98437], B = [40.76463, -73.97702];
    const at = (u) => ({ lat: A[0] + (B[0] - A[0]) * u, lon: A[1] + (B[1] - A[1]) * u });
    const L = 1283; // metres 42nd->57th
    const v = 230;  // m/s
    const keys = [];
    for (let t = -2; t <= 3; t += 1) { const u = (t * v + 250) / L; const p = at(u); keys.push({ t, lat: p.lat, lon: p.lon, alt: 150 }); }
    const fly = TR.flyPath(TR.path(keys), { bankOffset: (t) => TR.D2R * 86 * TR.smooth((t + 1.2) / 0.9) });
    const cam = TR.cam.relative({ right: -2.5, up: 1.2, fwd: -19, lookFwd: 60, lookUp: 0, fov: 58, bankShare: 0.35 });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

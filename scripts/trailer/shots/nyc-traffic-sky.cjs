// LIVE TRAFFIC (edit 28.0-34.0), v2. 1.5 km up New York Harbor heading N,
// Manhattan side-lit on the right, golden hour. The visible sky ahead is
// seeded with airliners crossing the frame at 3-10 km (spotter trails) and
// high cruisers overhead laying contrails — "every aircraft in your sky".
module.exports = {
  id: 'nyc-traffic-sky',
  frames: 210, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 22, 0),
  weather: 'few',
  start: { lat: 40.6620, lon: -74.0400, altM: 1500, headingDeg: 12 },
  settle: { maxSec: 600, minSec: 30, streamSec: 150 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const lat0 = 40.662, lon0 = -74.040, hdg = 12, spd = 190;
    const H = hdg * TR.D2R, kLat = 111320, kLon = 111320 * Math.cos(lat0 * TR.D2R);
    const P = (fwdM, rightM) => ({ lat: lat0 + (fwdM * Math.cos(H) - rightM * Math.sin(H)) / kLat, lon: lon0 + (fwdM * Math.sin(H) + rightM * Math.cos(H)) / kLon });
    const path = TR.path([-3, 0, 9].map((t) => ({ t, ...P(spd * t, 0), alt: 1500 })));
    const fly = TR.flyPath(path);
    const cam = TR.cam.orbit({ az: (t) => -8 + 2.2 * t, el: 6, dist: 34, lookFwd: 700, lookUp: 170, fov: 62 });
    // crossing traffic in the view ahead: 12 airliners at 3-10 km, 1.9-5.5 km altitude
    const r = TR.rng(77);
    for (let i = 0; i < 12; i++) {
      const fwd = 3000 + r() * 7000, right = (r() - 0.5) * 2 * fwd * 0.55;
      const alt = 1900 + fwd * (0.12 + r() * 0.22);
      const cross = (r() < 0.5 ? 90 : -90) + (r() - 0.5) * 50;
      const p = P(fwd + spd * 3, right);
      const hex = (0xa2c000 + i).toString(16);
      TR.puppet({ hex, arch: 0, meta: { hex, flight: ['NVA', 'AUR', 'LUM', 'ORB'][i % 4] + (400 + i * 7), r: 'N4' + i + 'TR', t: TR.AIRLINER_TYPES[i % TR.AIRLINER_TYPES.length], squawk: null, category: 'A3', iconType: 'airliner', color: '#4ade80' },
        pose: TR.straight(p.lat, p.lon, alt, hdg + cross, 150 + r() * 80, 0) });
    }
    // high cruisers overhead-ahead laying contrails
    for (let i = 0; i < 7; i++) {
      const fwd = 1500 + r() * 9000, right = (r() - 0.5) * 12000;
      const p = P(fwd, right);
      const hex = (0xa2d000 + i).toString(16);
      TR.puppet({ hex, arch: i === 3 ? 5 : 0, meta: { hex, flight: ['NVA', 'KST', 'VRA'][i % 3] + (80 + i * 11), r: 'N8' + i + 'HC', t: ['B77W', 'A359', 'B789', 'B744', 'A388', 'A333', 'B788'][i], squawk: null, category: 'A5', iconType: 'airliner', color: '#4ade80' },
        pose: TR.straight(p.lat, p.lon, 9800 + r() * 1900, hdg + 60 + r() * 240, 230 + r() * 30, -6) });
    }
    window.__shot = { flight: (t) => fly(t), camera: cam };
  },
};

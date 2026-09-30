// NIGHT (edit 82.0-86.0). Low pass along JFK 04L at night: runway edge lights,
// arrivals behind with their lights, the Vector's plumes.
module.exports = {
  id: 'nyc-jfk-night',
  frames: 135, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 28, 0, 25),
  weather: 'few',
  start: { lat: 40.6180, lon: -73.7940, altM: 150, headingDeg: 44 },
  settle: { maxSec: 600, minSec: 30, streamSec: 180 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const hd = 44 * TR.D2R, kLat = 111320, kLon = 111320 * Math.cos(40.63 * TR.D2R);
    const P = (dM, alt) => ({ lat: 40.6245 + (dM * Math.cos(hd)) / kLat, lon: -73.7854 + (dM * Math.sin(hd)) / kLon, alt });
    const keys = [-3, 0, 5].map((t) => ({ t, ...P(-400 + t * 210, 70) }));
    const fly = TR.flyPath(TR.path(keys));
    // tripod beside the runway, 180 m right of centreline, 1.1 km down the runway, 25 m up
    const side = { lat: 40.6245 + (1100 * Math.cos(hd) + 180 * Math.cos(hd + Math.PI / 2)) / kLat, lon: -73.7854 + (1100 * Math.sin(hd) + 180 * Math.sin(hd + Math.PI / 2)) / kLon };
    const cam = TR.cam.tripod({ lat: side.lat, lon: side.lon, alt: 30, fov: 48, lookUp: 0 });
    for (let i = 0; i < 3; i++) {
      const d = -3500 - i * 4500; const p = P(d, 60 + (-d) * 0.052);
      const hex = (0xa1c300 + i).toString(16);
      TR.puppet({ hex, arch: 0, meta: { hex, flight: 'AUR' + (820 + i), r: 'N82' + i + 'AU', t: ['B77W', 'A359', 'B789'][i], squawk: null, category: 'A5', iconType: 'airliner', color: '#4ade80' },
        pose: (t) => { const q = P(d + 72 * t, 60 + Math.max(0, -(d + 72 * t)) * 0.052); return { pos: TR.geo(q.lat, q.lon, q.alt), heading: hd, speed: 72, vs: -3.7 }; } });
    }
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

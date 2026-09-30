// NIGHT (edit 82.0-86.0). Low pass down JFK 22R at night: runway edge lights
// streaming under the Vector's plumes, arrivals on the 04L glideslope ahead.
module.exports = {
  id: 'nyc-jfk-night',
  frames: 135, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 28, 0, 25),
  weather: 'few',
  start: { lat: 40.6380, lon: -73.7650, altM: 150, headingDeg: 224 },
  settle: { maxSec: 600, minSec: 30, streamSec: 180 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const hd = 44 * TR.D2R, kLat = 111320, kLon = 111320 * Math.cos(40.63 * TR.D2R);
    const P = (dM, alt) => ({ lat: 40.6245 + (dM * Math.cos(hd)) / kLat, lon: -73.7854 + (dM * Math.sin(hd)) / kLon, alt });
    // v2 (draft review: the static tripod lost the jet and the arrivals read as
    // dots): the Vector runs down 04L/22R the other way (heading 224) at 40 m,
    // chase camera low behind-right, edge lights streaming past, arrivals on
    // the 04L glideslope ahead with their lights.
    const keys = [-3, 0, 5].map((t) => ({ t, ...P(2000 - 200 * t, 42) }));
    const fly = TR.flyPath(TR.path(keys));
    const cam = TR.cam.orbit({ az: (t) => 18 - 1.5 * t, el: 5, dist: 26, lookFwd: 320, lookUp: 14, fov: 56 });
    const ARR = [-900, -4600, -8600];
    for (let i = 0; i < 3; i++) {
      const d = ARR[i];
      const hex = (0xa1c300 + i).toString(16);
      TR.puppet({ hex, arch: 0, meta: { hex, flight: 'AUR' + (820 + i), r: 'N82' + i + 'AU', t: ['B77W', 'A359', 'B789'][i], squawk: null, category: 'A5', iconType: 'airliner', color: '#4ade80' },
        pose: (t) => { const q = P(d + 72 * t, 20 + Math.max(0, -(d + 72 * t)) * 0.052); return { pos: TR.geo(q.lat, q.lon, q.alt), heading: hd, speed: 72, vs: -3.7 }; } });
    }
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

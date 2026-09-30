// LANDMARKS (edit 72.0-74.0). A banking pass around Bennelong Point.
module.exports = {
  id: 'sydney-opera',
  frames: 90, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 7, 30),
  weather: 'few',
  start: { lat: -33.8500, lon: 151.2230, altM: 140, headingDeg: 250 },
  settle: { maxSec: 600, minSec: 30, streamSec: 180 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    // arc of radius ~700 m centred just south-west of the Opera House
    const c = { lat: -33.8590, lon: 151.2140 }, R = 700, kLat = 111320, kLon = 111320 * Math.cos(33.86 * TR.D2R);
    const P = (a) => ({ lat: c.lat + (R * Math.cos(a)) / kLat, lon: c.lon + (R * Math.sin(a)) / kLon });
    const keys = [];
    for (let t = -3; t <= 4; t += 0.5) { const a = (70 - 14 * t) * TR.D2R; const p = P(a); keys.push({ t, lat: p.lat, lon: p.lon, alt: 140 }); }
    const fly = TR.flyPath(TR.path(keys), { bankGain: 1.0, bankMax: 78 * TR.D2R });
    const cam = TR.cam.tripod({ lat: -33.8532, lon: 151.2205, alt: 55, fov: 46, lead: 0.45, leadTarget: { lat: -33.8568, lon: 151.2153, alt: 40 } });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: true }), camera: cam };
  },
};

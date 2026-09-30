// LIVE TRAFFIC (edit 28.0-34.0). 2.3 km over Brooklyn heading WNW into the low
// sun toward the Manhattan skyline; a sky full of airliners drawing spotter
// trails and (above ~9 km) contrails; a JFK arrival stream below.
module.exports = {
  id: 'nyc-traffic-sky',
  frames: 210, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 22, 12),
  weather: 'baseline',
  start: { lat: 40.6900, lon: -73.8900, altM: 2300, headingDeg: 290 },
  settle: { maxSec: 600, minSec: 30, streamSec: 150 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const lat = (t) => 40.6900 + 0.000614 * t, lon = (t) => -73.8900 - 0.002228 * t;
    const path = TR.path([{ t: -3, lat: lat(-3), lon: lon(-3), alt: 2300 }, { t: 9, lat: lat(9), lon: lon(9), alt: 2300 }]);
    const fly = TR.flyPath(path);
    const cam = TR.cam.orbit({ az: (t) => 14 - 4 * t / 7, el: (t) => 9 - 3 * t / 7, dist: (t) => 55 + 10 * t / 7, lookFwd: 900, lookUp: 120, fov: 60 });
    // high cruisers with contrails
    TR.ambientFleet({ lat: 40.70, lon: -73.96, n: 16, radiusKm: 20, altMin: 9300, altMax: 11800, seed: 31 });
    // mid-level traffic
    TR.ambientFleet({ lat: 40.70, lon: -73.93, n: 10, radiusKm: 16, altMin: 3000, altMax: 7000, seed: 32, speed: [150, 200] });
    // JFK arrivals on a line toward 04L/04R from the SW (heading ~44)
    for (let i = 0; i < 5; i++) {
      const d = 6 + i * 5.5; // km from threshold
      const la = 40.6245 - (d * Math.cos(44 * TR.D2R)) / 111.32, lo = -73.7854 - (d * Math.sin(44 * TR.D2R)) / (111.32 * Math.cos(40.62 * TR.D2R));
      const hex = (0xa1b200 + i).toString(16);
      TR.puppet({ hex, arch: 0, meta: { hex, flight: 'NVA' + (310 + i), r: 'N31' + i + 'NV', t: ['B738', 'A321', 'B789', 'A359', 'E175'][i], squawk: null, category: 'A3', iconType: 'airliner', color: '#4ade80' },
        pose: TR.straight(la, lo, 90 + d * 52, 44, 75, 0) });
    }
    window.__shot = { flight: (t) => fly(t), camera: cam };
  },
};

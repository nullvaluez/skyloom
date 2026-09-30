// FAMILY (edit 34.0-50.0, several cuts from one continuous take).
// Sunset above a broken cloud deck at 8 km. "NVA 184", a 787-9 flying LAX->JFK,
// cruises with glowing contrails; the Vector closes from behind-right, then
// holds formation off its right wing. Camera beats by take time:
//   0-4   : chase from behind the Vector, airliner ahead (approach)
//   4-8   : camera eases abeam at 140 m, both aircraft side by side, sun behind
//   8-12  : slow pull-back and rise revealing both over the cloud sea
module.exports = {
  id: 'clouds-family',
  frames: 390, runIn: 60,
  sunUtc: Date.UTC(2026, 8, 27, 22, 32), // ~el +2.5 at lon -72.9
  weather: 'broken',
  start: { lat: 40.7600, lon: -72.9000, altM: 8000, headingDeg: 262 },
  settle: { maxSec: 600, minSec: 30, streamSec: 120 },
  inspect: {
    a4f2c1: {
      info: { found: true, hex: 'A4F2C1', registration: 'N184NV', manufacturer: 'Boeing', model: '787-9 Dreamliner', typeCode: 'B789', owner: 'Nova Air', operatorFlagCode: 'NVA', country: 'United States', countryIso: 'US', source: 'adsbdb' },
      route: { origin: 'KLAX', destination: 'KJFK', originIata: 'LAX', destinationIata: 'JFK', source: 'adsbdb' },
      photo: { photos: [] },
    },
  },
  page: function (args) {
    const TR = window.TR; TR.hideLetters = true;
    const native = args && args.nativeCamera;
    const hdg = 262, spd = 235;
    const lat0 = 40.76, lon0 = -72.90;
    const airliner = TR.straight(lat0, lon0, 8000, hdg, spd, 0);
    TR.puppet({ hex: 'a4f2c1', arch: 0, meta: { hex: 'a4f2c1', flight: 'NVA184', r: 'N184NV', t: 'B789', squawk: '2461', category: 'A5', iconType: 'airliner', color: '#4ade80' }, pose: airliner });
    // Vector: starts 700 m behind / 140 m right / 30 m above, closes to the slot (+62 right, +10 up, -22 back):
    // ~30 m of clearance off the 787's right wingtip, a close echelon.
    const slot = (t) => {
      const u = TR.smoother((t + 1) / 6);
      return { right: 140 + (62 - 140) * u, up: 30 + (10 - 30) * u, fwd: -700 + (-22 + 700) * u };
    };
    const fl = (t) => {
      const a = airliner(t), s = slot(t);
      const s2 = slot(t + 0.05);
      const pos = TR.offset(a.pos, a.heading, lat0, s.right, s.up, s.fwd);
      const closing = (s2.fwd - s.fwd) / 0.05; // m/s relative
      return { pos, heading: a.heading - 0.012 * (1 - TR.smooth((t - 3) / 3)), pitch: 0, bank: -0.08 * (1 - TR.smooth((t - 4) / 2)), speed: spd + closing, latDeg: lat0 };
    };
    const chase = TR.cam.orbit({ az: 6, el: 5, dist: 30, lookFwd: 260, lookUp: 10, fov: 50 });
    // v3 (draft review: v1 at 170-230 m read tiny; v2 abeam put the Vector
    // squarely in front of the 787): 3/4-rear from above the Vector's right
    // shoulder, looking slightly down so the pair sit over the cloud sea with
    // ~25 deg of separation — Vector large right of centre, 787 beyond it left.
    const abeam = (t, f) => {
      const a = airliner(t), u = (t - 4) / 4;
      const eye = TR.offset(f.pos, a.heading, lat0, 18 - 2 * u, 12, -38 + 6 * u);
      const target = TR.offset(f.pos.clone().lerp(a.pos, 0.5), a.heading, lat0, 0, -4, 0);
      return { eye, target, fov: 48, roll: 0 };
    };
    const reveal = (t, f) => {
      const u = TR.smoother((t - 8) / 4.5);
      const a = airliner(t);
      const eye = TR.offset(f.pos, a.heading, lat0, 16 + 120 * u, 12 + 50 * u, -36 - 80 * u);
      const target = TR.offset(f.pos.clone().lerp(a.pos, 0.5), a.heading, lat0, 0, -4 - 6 * u, 0);
      return { eye, target, fov: 48 - 4 * u, roll: 0 };
    };
    TR.ambientFleet({ lat: 40.8, lon: -73.1, n: 10, radiusKm: 30, altMin: 9000, altMax: 11800, seed: 51 });
    window.__shot = {
      flight: fl,
      camera: native ? null : (t, f, k) => (t < 4 ? chase(t, f, k) : t < 8 ? TR.cam.blend(abeam, abeam, 0)(t, f, k) : reveal(t, f)),
    };
  },
};

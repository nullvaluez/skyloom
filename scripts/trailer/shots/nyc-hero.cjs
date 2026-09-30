// HERO REVEAL (edit 8.0-16.0). New York Harbor, golden hour.
// t 0-4: the game's own chase camera — the Vector passes the Statue of Liberty
//        (left) with the Lower Manhattan skyline ahead.
// t 4.0: HARD CUT (in-capture camera switch) on boost ignition: side tracking
//        shot, plumes lit, Lower Manhattan towers streaming behind the jet.
module.exports = {
  id: 'nyc-hero',
  fps: 30,
  frames: 270, // 9.0 s (edit uses 0.0-8.0)
  runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 22, 5), // el ~ +8.5 deg, sun due W
  weather: 'baseline',
  start: { lat: 40.6789, lon: -74.0505, altM: 330, headingDeg: 35 },
  settle: { maxSec: 600, minSec: 30, streamSec: 150 },
  page: function () {
    const TR = window.TR;
    TR.hideLetters = true;
    const path = TR.path([
      { t: -4, lat: 40.6773, lon: -74.0521, alt: 335 },
      { t: 0, lat: 40.6840, lon: -74.0455, alt: 320 },
      { t: 4, lat: 40.6899, lon: -74.0395, alt: 300 },
      { t: 6, lat: 40.6962, lon: -74.0322, alt: 290 },
      { t: 8, lat: 40.7045, lon: -74.0235, alt: 285 },
      { t: 10, lat: 40.7148, lon: -74.0170, alt: 290 },
    ]);
    const fly = TR.flyPath(path, { bankGain: 1.0 });
    const side = TR.cam.orbit({
      az: (t) => -78 + 10 * TR.smooth((t - 4) / 5), // left side, drifting slightly forward
      el: 3, dist: (t) => 24 + 6 * TR.smooth((t - 4) / 5), lookFwd: 6, lookUp: 1,
      fov: (t) => 44 + 6 * TR.smooth((t - 4) / 1.5),
    });
    TR.ambientFleet({ lat: 40.70, lon: -73.95, n: 14, radiusKm: 28, altMin: 9200, altMax: 11800, seed: 11 });
    TR.ambientFleet({ lat: 40.66, lon: -73.84, n: 6, radiusKm: 10, altMin: 600, altMax: 1800, seed: 12, speed: [85, 110] });
    window.__shot = {
      flight: (t) => { const p = fly(t); p.boosting = t >= 4.0; return p; },
      camera: (t, fl, k) => (t < 4.0 ? null : side(t, fl, k)),
    };
  },
};

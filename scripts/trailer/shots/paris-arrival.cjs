// WARP ARRIVAL (edit 64.0-68.0) + LANDMARKS (68-70 from t>=4.5 tripod part).
// Paris at dusk: along the Seine toward the floodlit Eiffel Tower.
module.exports = {
  id: 'paris-arrival',
  frames: 225, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 17, 42), // el ~ -1
  weather: 'few',
  start: { lat: 48.8530, lon: 2.3190, altM: 390, headingDeg: 286 },
  settle: { maxSec: 600, minSec: 30, streamSec: 180 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const path = TR.path([
      { t: -3, lat: 48.8525, lon: 2.3228, alt: 400 },
      { t: 0, lat: 48.8540, lon: 2.3150, alt: 380 },
      { t: 4.5, lat: 48.8562, lon: 2.3030, alt: 330 },
      { t: 7.5, lat: 48.8592, lon: 2.2958, alt: 300 },
      { t: 9, lat: 48.8610, lon: 2.2905, alt: 300 },
    ]);
    const fly = TR.flyPath(path);
    const chase = TR.cam.orbit({ az: 4, el: 5, dist: 30, lookFwd: 500, lookUp: 20, fov: 50 });
    const tri = TR.cam.tripod({ lat: 48.8566, lon: 2.2985, alt: 240, fov: 44, lead: 0.55, leadTarget: { lat: 48.8584, lon: 2.2945, alt: 250 } });
    window.__shot = { flight: (t) => Object.assign(fly(t), { boosting: t > 4.5 }), camera: (t, f, k) => (t < 4.5 ? chase(t, f, k) : tri(t, f, k)) };
  },
};

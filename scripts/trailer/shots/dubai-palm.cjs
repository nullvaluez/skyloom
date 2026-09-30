// WORLD (edit ~21-23.5). High over Palm Jumeirah, looking down-forward along the trunk.
module.exports = {
  id: 'dubai-palm',
  frames: 105, runIn: 45,
  sunUtc: Date.UTC(2026, 8, 27, 13, 25),
  weather: 'clear',
  start: { lat: 25.0960, lon: 55.1610, altM: 1450, headingDeg: 313 },
  settle: { maxSec: 600, minSec: 30, streamSec: 150 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const path = TR.path([
      { t: -3, lat: 25.0948, lon: 55.1625, alt: 1460 },
      { t: 0, lat: 25.0990, lon: 55.1579, alt: 1450 },
      { t: 4, lat: 25.1046, lon: 55.1518, alt: 1440 },
    ]);
    const fly = TR.flyPath(path);
    const cam = TR.cam.relative({ right: -6, up: 34, fwd: -48, lookFwd: 900, lookUp: -820, lookRight: 30, fov: 54 });
    window.__shot = { flight: (t) => fly(t), camera: cam };
  },
};

// AIR FORCE (edit 50.0-60.0), one continuous take with in-capture cuts:
//   0.0-3.5  head-on reveal: tanker + four fighters over the Jungfrau massif
//   3.5-6.0  the Vector slides into the echelon (camera behind the Vector)
//   6.0-11.0 staggered break: fighters peel away right, climbing
module.exports = {
  id: 'alps-airforce',
  frames: 345, runIn: 60,
  sunUtc: Date.UTC(2026, 8, 27, 15, 45),
  weather: 'few',
  start: { lat: 46.5740, lon: 7.8700, altM: 4600, headingDeg: 88 },
  settle: { maxSec: 600, minSec: 30, streamSec: 150 },
  page: function () {
    const TR = window.TR; TR.hideLetters = true;
    const lat0 = 46.574, hdg = 88, spd = 175;
    const lead = TR.straight(lat0, 7.8700, 4600, hdg, spd, -1);
    const H = hdg * TR.D2R;
    const meta = (hex, call, t) => ({ hex, flight: call, r: null, t, squawk: null, category: 'A6', iconType: 'military', color: '#f87171' });
    TR.puppet({ hex: 'ae7a01', arch: 0, meta: { ...meta('ae7a01', 'TITAN21', 'A332'), category: 'A5', iconType: 'airliner' }, pose: lead });
    const slots = [[-42, -7, -48], [-84, -14, -96], [42, -7, -48], [84, -14, -96]];
    const fighters = slots.map((s, i) => {
      const hex = 'ae7b0' + i;
      const tb = 6.2 + i * 0.45; // break time
      const pose = (t) => {
        const tt = Math.min(t, tb);
        const a = lead(tt);
        let pos = TR.offset(a.pos, H, lat0, s[0], s[1], s[2]);
        let heading = H, vs = 0;
        if (t > tb) {
          // constant-rate climbing right turn from the break point
          const dt = t - tb, w = 0.32, v = spd + 30;
          const ang = w * dt;
          const fwd = (Math.sin(ang) / w) * v, right = ((1 - Math.cos(ang)) / w) * v, up = 45 * dt + 12 * dt * dt;
          pos = TR.offset(pos, H, lat0, right, up, fwd);
          heading = H + ang; vs = 45 + 24 * dt;
        }
        return { pos, heading, speed: spd, vs };
      };
      TR.puppetScale[hex] = 1 / 1.75;
      return TR.puppet({ hex, arch: 4, meta: meta(hex, 'VIPER1' + (i + 1), 'F22'), pose });
    });
    // the Vector: joins at the right echelon's #3 position (+126, -21, -144)
    const join = (t) => {
      const u = TR.smoother((t - 2.2) / 4.0);
      return { right: 175 + (126 - 175) * u, up: -60 + (-21 + 60) * u, fwd: -520 + (-144 + 520) * u };
    };
    const fl = (t) => {
      const a = lead(t), s = join(t), s2 = join(t + 0.05);
      return { pos: TR.offset(a.pos, H, lat0, s.right, s.up, s.fwd), heading: H, pitch: 0.02 * (1 - TR.smooth((t - 4) / 2)), bank: -0.12 * Math.sin(Math.PI * TR.smooth((t - 2.2) / 4)), speed: spd + (s2.fwd - s.fwd) / 0.05, latDeg: lat0 };
    };
    const headOn = (t) => {
      const a = lead(t); const center = TR.offset(a.pos, H, lat0, 0, -10, -60);
      const eye = TR.offset(a.pos, H, lat0, -150, 25, 420 - 60 * t);
      return { eye, target: center, fov: 40, roll: 0 };
    };
    const behind = TR.cam.orbit({ az: (t) => -10 + 3 * (t - 3.5), el: 6, dist: 32, lookFwd: 140, lookUp: 4, fov: 52 });
    const breakCam = (t, f) => {
      const eye = TR.offset(f.pos, H, lat0, -60, 14, -70 + 8 * (t - 6));
      const target = TR.offset(f.pos, H, lat0, 60, 30 + 20 * (t - 6), 160);
      return { eye, target, fov: 58, roll: 0 };
    };
    window.__shot = {
      flight: fl,
      camera: (t, f, k) => (t < 3.5 ? headOn(t) : t < 6.0 ? behind(t, f, k) : breakCam(t, f)),
    };
  },
};

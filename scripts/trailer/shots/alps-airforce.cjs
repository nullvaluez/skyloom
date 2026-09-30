// AIR FORCE (edit 50.0-60.0), one continuous take with in-capture cuts:
//   0.0-3.5  head-on reveal (close): tanker + four fighters over the Jungfrau massif
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
    // v2 (draft review: at 450 m the formation read as specks): a tight echelon
    const slots = [[-30, -5, -34], [-60, -10, -68], [30, -5, -34], [60, -10, -68]];
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
    // the Vector: joins at the right echelon's #3 position (+90, -15, -102)
    const join = (t) => {
      const u = TR.smoother((t - 2.2) / 4.0);
      return { right: 150 + (90 - 150) * u, up: -45 + (-15 + 45) * u, fwd: -420 + (-102 + 420) * u };
    };
    const fl = (t) => {
      const a = lead(t), s = join(t), s2 = join(t + 0.05);
      return { pos: TR.offset(a.pos, H, lat0, s.right, s.up, s.fwd), heading: H, pitch: 0.02 * (1 - TR.smooth((t - 4) / 2)), bank: -0.12 * Math.sin(Math.PI * TR.smooth((t - 2.2) / 4)), speed: spd + (s2.fwd - s.fwd) / 0.05, latDeg: lat0 };
    };
    // head-on, close: 170 -> 100 m ahead of the tanker, slightly left and high
    const headOn = (t) => {
      const a = lead(t); const center = TR.offset(a.pos, H, lat0, 8, -8, -45);
      const eye = TR.offset(a.pos, H, lat0, -34, 7, 170 - 20 * t);
      return { eye, target: center, fov: 50, roll: 0 };
    };
    const behind = TR.cam.orbit({ az: (t) => -14 + 3 * (t - 3.5), el: 5, dist: 26, lookFwd: 90, lookUp: 6, fov: 56 });
    // break: from just off the Vector's left shoulder, a long lens tracks the
    // centroid of the four breaking fighters as they peel up and right
    const fighterPoses = fighters.map((f) => f.pose);
    const breakCam = (t, f) => {
      const eye = TR.offset(f.pos, H, lat0, -20, 5, -26 + 4 * (t - 6));
      const c = new f.pos.constructor();
      for (const p of fighterPoses) c.add(p(t).pos);
      c.multiplyScalar(1 / fighterPoses.length);
      const u = TR.smooth((t - 6) / 1.2);
      const ahead = TR.offset(f.pos, H, lat0, 10, 8, 120);
      return { eye, target: ahead.lerp(c, u), fov: 54 - 12 * u, roll: 0 };
    };
    window.__shot = {
      flight: fl,
      camera: (t, f, k) => (t < 3.5 ? headOn(t) : t < 6.0 ? behind(t, f, k) : breakCam(t, f)),
    };
  },
};

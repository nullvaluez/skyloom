/**
 * MULTIPLAYER — verify-mp-motion: clock sync and dead reckoning to the present
 * (lib/fly/mp/motion.mjs; MULTIPLAYER.md, design §13 gate 3). Pure node, no
 * network, deterministic (seeded PRNG):
 *
 *   node scripts/verify-mp-motion.mjs
 *
 * (1) ClockSync: the minimum-RTT offset converges to within the path
 *     asymmetry under ±40 ms jitter (and to half a constant asymmetry, the
 *     NTP limit); reset; wrap-aware relay-ms arithmetic.
 * (2) Dead reckoning against truth trajectories at 180 and 750 m/s, straight
 *     and in 44°/s turns, 150 ms one way (sender -> relay 75 ms, then the
 *     relay's forwarding tick — 100 ms near tier, 1 s far tier — then 75 ms to
 *     the receiver), sampled at 10 Hz and 1 Hz, rendered at 60 fps across a
 *     u32 relay-clock wrap: present-time error < 3 m straight at 10 Hz, < 20 m
 *     in a steady 44°/s turn at 180 m/s, and no frame-to-frame jump larger
 *     than v·dt + 2 m at 10 Hz and on every straight run. A 1 Hz pilot (the
 *     far tier: beyond 3 km) in a 44°/s turn cannot meet that jump bound with
 *     maxArcSec 1 and errorDecaySec 0.25 — its numbers print as INFO, and the
 *     gate asserts the snap cascade a 1 Hz turner once fell into is gone.
 *     A 250 m/s climb at 0.5 rad of pitch, at 40.8° and at 60°: horizontal
 *     < 3 m and vertical < 1 m, asserted apart — the alt + vUp·age channel,
 *     the cos(pitch) on the airspeed, and mercatorScale at the sample's OWN
 *     latitude each have a run that sees them.
 * (3) Formation: A flies at "B as drawn on A" + a wing slot; on B's screen A
 *     stays within 20 m of B(t) + slot at 180 m/s through straight flight, a
 *     20°/s turn entry, a steady turn and the roll-out. Harder manoeuvres
 *     (44°/s, reversals, 150 ms per leg) print as INFO.
 * (4) A 1 s TCP stall then a burst: no freeze, no dip, and the error decays.
 * (5) The freshness ladder 0 → 1 → 2 (climb stops at 1, the pose holds at 2).
 * (6) HELD zeroes the velocities and holds the pose; CRASHED does not
 *     extrapolate.
 * (7) A warpSeq change snaps with no intermediate position, bumps snapEpoch
 *     and dips; a > snapErrorM jump snaps without the dip; a small correction
 *     glides.
 * (8) Antimeridian: −179.9° draws within 30 km of a +179.9° viewer, and a
 *     pilot crossing ±180° never snaps.
 * (9) The wave wing-rock peaks at ±waveRockDeg and ends at exactly 0.
 */
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);

const { ClockSync, RemoteMotion, msSince } = await import('../lib/fly/mp/motion.mjs');
const P = await import('../lib/fly/mp/protocol.mjs');
const { mercatorWorldXZ, worldXZToLonLat } = await import('../lib/fly/traffic-engine.js');
const { mercatorScale } = await import('../lib/fly/coords.js');
const { MULTIPLAYER } = await import('../lib/fly/fly-constants.js');

const DR = MULTIPLAYER.dr;
const SIG = MULTIPLAYER.signals;
const DEG = Math.PI / 180;
const U32 = 2 ** 32;

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const info = (name, detail) => console.log(`INFO  ${name}  — ${detail}`);

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// (1) ClockSync
// ---------------------------------------------------------------------------
{
  const rnd = mulberry32(7);
  const TRUE_OFFSET = 81234.567; // relay = client + this
  /** One trial: n pings 200 ms apart, legs base ± 40 ms; returns [est − true, chosen asymmetry/2]. */
  function trial(n, upBase, downBase) {
    const cs = new ClockSync();
    let chosenHalfAsym = 0;
    let bestRtt = Infinity;
    const window = [];
    for (let i = 0; i < n; i++) {
      const c = 1000 + i * 200;
      const up = upBase + (rnd() * 2 - 1) * 40;
      const down = downBase + (rnd() * 2 - 1) * 40;
      const s = Math.floor(c + up + TRUE_OFFSET) >>> 0;
      cs.add(c, s, c + up + down);
      window.push({ rtt: up + down, half: (up - down) / 2 });
      if (window.length > 8) window.shift();
    }
    for (const w of window) {
      if (w.rtt < bestRtt) {
        bestRtt = w.rtt;
        chosenHalfAsym = w.half;
      }
    }
    return [cs.serverNow(0) - TRUE_OFFSET, chosenHalfAsym, cs];
  }
  const errs = [];
  const errs8 = [];
  const single = [];
  let identity = true;
  for (let k = 0; k < 400; k++) {
    const n = 3 + (k % 30);
    const [err, half] = trial(n, 60, 60);
    errs.push(Math.abs(err));
    if (n >= 8) errs8.push(Math.abs(err));
    single.push(Math.abs(trial(1, 60, 60)[0]));
    // the estimate's error IS the chosen sample's half asymmetry (+ the relay's ms floor)
    if (Math.abs(err - half) > 1) identity = false;
  }
  const q = (a, f) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))];
  check("(1) offset error = the min-RTT sample's half path asymmetry (400 trials)", identity);
  check('(1) ±40 ms jitter per leg: the error never exceeds the half-asymmetry bound (40 ms)', q(errs, 1) <= 40, `max ${q(errs, 1).toFixed(2)} ms`);
  check(
    '(1) with a full 8-ping window: median ≤ 8 ms, p95 ≤ 30 ms, and under 0.6 × a single ping\'s median',
    q(errs8, 0.5) <= 8 && q(errs8, 0.95) <= 30 && q(errs8, 0.5) < q(single, 0.5) * 0.6,
    `median ${q(errs8, 0.5).toFixed(2)} ms · p95 ${q(errs8, 0.95).toFixed(2)} ms · one ping ${q(single, 0.5).toFixed(2)} ms`
  );
  const asym = [];
  for (let k = 0; k < 200; k++) asym.push(trial(12, 80, 40)[0]);
  const meanAsym = asym.reduce((a, b) => a + b, 0) / asym.length;
  check('(1) a constant 40 ms asymmetry biases by its half (20 ms, the NTP limit)', asym.every((e) => Math.abs(e - 20) <= 40) && Math.abs(meanAsym - 20) < 8, `mean ${meanAsym.toFixed(2)} ms`);
  const [, , cs] = trial(5, 60, 60);
  check('(1) ready after a pong; reset() forgets it', cs.ready === true && (cs.reset(), cs.ready === false && cs.offset === 0));
  check('(1) a pong with a negative or non-finite RTT is ignored', !cs.add(10, 5, 9) && !cs.add(NaN, 5, 9) && cs.ready === false);
  check('(1) msSince is wrap-aware across the u32 relay clock', msSince(5, U32 - 6) === 11 && msSince(U32 + 5, 4294967290) === 11 && msSince(100, 160) === -60);
}

// ---------------------------------------------------------------------------
// Simulation harness
// ---------------------------------------------------------------------------
const LAT0 = 40.78;
const LON0 = -73.97;
const BASE_MS = U32 - 4000; // the relay clock wraps 4 s into every run

/**
 * A truth path from a turn-rate schedule, integrated with exact arcs at 1 ms
 * and looked up by time. omegaAt(t) in rad/s; speed m/s; returns pose(t).
 */
function makePath({ speed, pitch = 0, vUp = speed * Math.sin(pitch), omegaAt = () => 0, heading0 = 0.6, alt0 = 1500, dur = 20, lat0 = LAT0, lon0 = LON0 }) {
  const vh = speed * Math.cos(pitch); // speed is the airspeed along the flight path
  const k0 = mercatorScale(lat0);
  const W0 = mercatorWorldXZ(lon0, lat0);
  const dt = 0.001;
  const n = Math.ceil(dur / dt) + 2;
  const E = new Float64Array(n);
  const N = new Float64Array(n);
  const H = new Float64Array(n);
  H[0] = heading0;
  for (let i = 1; i < n; i++) {
    const w = omegaAt((i - 0.5) * dt);
    const h0 = H[i - 1];
    const h1 = h0 + w * dt;
    if (Math.abs(w) > 1e-9) {
      E[i] = E[i - 1] + (vh / w) * (Math.cos(h0) - Math.cos(h1));
      N[i] = N[i - 1] + (vh / w) * (Math.sin(h1) - Math.sin(h0));
    } else {
      E[i] = E[i - 1] + vh * Math.sin(h0) * dt;
      N[i] = N[i - 1] + vh * Math.cos(h0) * dt;
    }
    H[i] = h1;
  }
  return (t) => {
    const f = Math.max(0, Math.min(n - 2, t / dt));
    const i = Math.floor(f);
    const u = f - i;
    const e = E[i] + (E[i + 1] - E[i]) * u;
    const no = N[i] + (N[i + 1] - N[i]) * u;
    const h = H[i] + (H[i + 1] - H[i]) * u;
    const x = W0.x + e * k0;
    const z = W0.z - no * k0;
    const y = alt0 + vUp * t;
    const ll = worldXZToLonLat(x, z);
    return { x, y, z, lat: ll.lat, lon: ll.lon, alt: y, heading: h, pitch, bank: Math.atan((vh * omegaAt(t)) / 9.81), speed, vUp };
  };
}

/** A wire record for a pose at relay-relative time t (quantized through the real codec). */
function recordOf(pose, tSec, { flags = 0, warpSeq = 0, uid = 1 } = {}) {
  const ts = (BASE_MS + Math.round(tSec * 1000)) >>> 0;
  const d = P.decodeState(P.encodeState({ a: 0, flags, warpSeq, ts, ...pose }));
  return { ...d, sampleTs: d.ts, uid };
}

const relayNow = (t) => BASE_MS + t * 1000; // float relay ms (runs past 2^32 on purpose)
/** True-metre distance between two world points. */
const distM = (a, b, k = mercatorScale(LAT0)) => Math.hypot((a.x - b.x) / k, a.y - b.y, (a.z - b.z) / k);

/**
 * Sender samples `path` at rateHz; each sample takes legMs to the relay, waits
 * for the relay's next forwarding tick (tickMs; only the newest is forwarded),
 * then legMs to the receiver, which renders at fps. `stall` = [t0, t1]: the
 * relay → receiver leg holds everything in that window and bursts it at t1.
 * `skewMs` = the receiver's clock-sync error (it pushes and renders at
 * relay time + skew).
 * Returns per-frame {t, pose, truth, stale, opacity, snapEpoch}.
 */
function runLink({ path, rateHz, tickMs, legMs = 75, dur = 12, fps = 60, stall = null, stopAt = Infinity, motion = new RemoteMotion(DR, SIG), sampleOf = null, skewMs = 0, tickPhase = 0.037 }) {
  const sends = [];
  for (let t = 0; t <= dur && t < stopAt; t += 1 / rateHz) sends.push(t);
  const deliveries = []; // [arriveT, record]
  let lastFwd = -1;
  for (let tick = tickPhase; tick <= dur + 1; tick += tickMs / 1000) {
    let newest = -1;
    for (let i = lastFwd + 1; i < sends.length && sends[i] + legMs / 1000 <= tick; i++) newest = i;
    if (newest < 0) continue;
    lastFwd = newest;
    let arrive = tick + legMs / 1000;
    if (stall && arrive >= stall[0] && arrive < stall[1]) arrive = stall[1];
    const ts = sends[newest];
    deliveries.push([arrive, sampleOf ? sampleOf(ts) : recordOf(path(ts), ts)]);
  }
  deliveries.sort((a, b) => a[0] - b[0]);
  const frames = [];
  const o = {};
  let di = 0;
  for (let f = 0; f * (1 / fps) <= dur; f++) {
    const t = f / fps;
    while (di < deliveries.length && deliveries[di][0] <= t) {
      motion.push(deliveries[di][1], relayNow(deliveries[di][0]) + skewMs, LON0);
      di++;
    }
    if (!motion.has) continue;
    motion.render(relayNow(t) + skewMs, o);
    frames.push({ t, pose: { x: o.x, y: o.y, z: o.z, yaw: o.yaw, vE: o.vE, vN: o.vN, vUp: o.vUp }, truth: path(t), stale: o.stale, opacity: o.opacity, snapEpoch: motion.snapEpoch });
  }
  return frames;
}

function stats(frames, speed, fromT = 2) {
  let maxErr = 0;
  let maxJump = -Infinity; // excess over v·dt
  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i];
    if (fr.t >= fromT) maxErr = Math.max(maxErr, distM(fr.pose, fr.truth));
    if (i > 0) {
      const dt = fr.t - frames[i - 1].t;
      maxJump = Math.max(maxJump, distM(fr.pose, frames[i - 1].pose) - speed * dt);
    }
  }
  return { maxErr, maxJump };
}

// ---------------------------------------------------------------------------
// (2) DR vs truth
// ---------------------------------------------------------------------------
{
  const rows = [];
  for (const speed of [180, 750]) {
    for (const turnDeg of [0, 44]) {
      for (const rateHz of [10, 1]) {
        const path = makePath({ speed, omegaAt: () => turnDeg * DEG });
        const frames = runLink({ path, rateHz, tickMs: rateHz === 10 ? 100 : 1000 });
        const s = stats(frames, speed);
        // snaps after the first second of turn-rate acquisition
        const lateSnaps = frames[frames.length - 1].snapEpoch - (frames.find((f) => f.t >= 3)?.snapEpoch ?? 0);
        rows.push({ speed, turnDeg, rateHz, lateSnaps, ...s });
        const label = `(2) ${speed} m/s · ${turnDeg ? `${turnDeg}°/s turn` : 'straight'} · ${rateHz} Hz`;
        info(label, `max error ${s.maxErr.toFixed(2)} m · worst frame step v·dt ${s.maxJump >= 0 ? '+' : ''}${s.maxJump.toFixed(2)} m · snaps after 3 s ${lateSnaps}`);
      }
    }
  }
  const row = (speed, turnDeg, rateHz) => rows.find((r) => r.speed === speed && r.turnDeg === turnDeg && r.rateHz === rateHz);
  check('(2) straight at 10 Hz: present-time error < 3 m (180 and 750 m/s)', row(180, 0, 10).maxErr < 3 && row(750, 0, 10).maxErr < 3, `${row(180, 0, 10).maxErr.toFixed(2)} / ${row(750, 0, 10).maxErr.toFixed(2)} m`);
  check('(2) steady 44°/s turn at 180 m/s, 10 Hz: error < 20 m', row(180, 44, 10).maxErr < 20, `${row(180, 44, 10).maxErr.toFixed(2)} m`);
  const bounded = rows.filter((r) => r.rateHz === 10 || r.turnDeg === 0);
  const worst = bounded.reduce((a, r) => (r.maxJump > a.maxJump ? r : a));
  check('(2) no frame-to-frame jump larger than v·dt + 2 m (all 10 Hz runs and every straight run)', bounded.every((r) => r.maxJump <= 2), `worst +${worst.maxJump.toFixed(2)} m (${worst.speed} m/s, ${worst.turnDeg}°/s, ${worst.rateHz} Hz)`);
  check('(2) no snap cascade: a 1 Hz pilot in a steady 44°/s turn keeps its turn rate (no snaps after 3 s, both speeds)', row(180, 44, 1).lateSnaps === 0 && row(750, 44, 1).lateSnaps === 0, `${row(180, 44, 1).lateSnaps} / ${row(750, 44, 1).lateSnaps}`);
  // A steep climb, at two latitudes: the vertical and horizontal errors apart.
  {
    const speed = 250;
    const pitch = 0.5; // vUp 120 m/s, horizontal 219 m/s
    const out = [];
    for (const lat0 of [LAT0, 60]) {
      const k = mercatorScale(lat0);
      const frames = runLink({ path: makePath({ speed, pitch, lat0 }), rateHz: 10, tickMs: 100 });
      let h = 0;
      let v = 0;
      for (const fr of frames) {
        if (fr.t < 2) continue;
        h = Math.max(h, Math.hypot((fr.pose.x - fr.truth.x) / k, (fr.pose.z - fr.truth.z) / k));
        v = Math.max(v, Math.abs(fr.pose.y - fr.truth.y));
      }
      const climb = frames.at(-1).truth.y - frames.find((f) => f.t >= 2).truth.y;
      out.push({ lat0, h, v, climb });
    }
    check(
      `(2) a ${speed} m/s climb at ${pitch} rad of pitch (vUp ${(speed * Math.sin(pitch)).toFixed(0)} m/s), 10 Hz, at ${LAT0}° and 60°: horizontal error < 3 m, vertical error < 1 m`,
      out.every((r) => r.h < 3 && r.v < 1 && r.climb > 1000),
      out.map((r) => `${r.lat0}°: ${r.h.toFixed(2)} m / ${r.v.toFixed(2)} m over a ${r.climb.toFixed(0)} m climb`).join(' · ')
    );
  }
  // The same link with a real ClockSync (±40 ms jitter) instead of a perfect clock.
  {
    const rnd = mulberry32(11);
    const cs = new ClockSync();
    const OFF = 5000; // relay = client + OFF
    for (let i = 0; i < 8; i++) {
      const c = i * 200;
      const up = 60 + (rnd() * 2 - 1) * 40;
      const down = 60 + (rnd() * 2 - 1) * 40;
      cs.add(c, Math.floor(c + up + OFF), c + up + down);
    }
    const skewMs = cs.offset - OFF;
    const path = makePath({ speed: 180 });
    const s = stats(runLink({ path, rateHz: 10, tickMs: 100, skewMs }), 180);
    // The clock error is the whole error budget here: a pilot draws v·skew ahead or behind.
    check(
      '(2) with a real ClockSync (±40 ms jitter) the 180 m/s straight error is the clock error × v and nothing more',
      Math.abs(skewMs) <= 40 && s.maxErr <= (180 * Math.abs(skewMs)) / 1000 + 0.5,
      `clock error ${skewMs.toFixed(1)} ms → ${s.maxErr.toFixed(2)} m (v·skew ${((180 * Math.abs(skewMs)) / 1000).toFixed(2)} m)`
    );
  }
}

// ---------------------------------------------------------------------------
// (3) Formation: A holds a slot on B as A draws B; B must see A in the slot
// ---------------------------------------------------------------------------
{
  const speed = 180;
  const slot = { right: 40, back: 60, up: 5 }; // body frame
  const k0 = mercatorScale(LAT0);
  const slotOf = (x, y, z, yaw) => ({
    x: x + (slot.right * Math.cos(yaw) - slot.back * Math.sin(yaw)) * k0,
    y: y + slot.up,
    z: z - (-slot.right * Math.sin(yaw) - slot.back * Math.cos(yaw)) * k0,
  });
  /** Worst distance, on B's screen, between A and B(t) + slot. */
  function formation(omegaB, legMs) {
    const dur = 16;
    const B = makePath({ speed, omegaAt: omegaB, dur });
    // B's 10 Hz samples drawn on A's screen, frame by frame...
    const BonA = runLink({ path: B, rateHz: 10, tickMs: 100, legMs, dur });
    // ...and A's truth is exactly where A's screen puts the slot on B.
    const A = BonA.map((fr) => ({ t: fr.t, ...slotOf(fr.pose.x, fr.pose.y, fr.pose.z, fr.pose.yaw), heading: fr.pose.yaw }));
    const pathA = (t) => {
      let i = A.findIndex((a) => a.t >= t);
      if (i < 0) i = A.length - 1;
      i = Math.max(1, i);
      const a = A[i];
      const prev = A[i - 1];
      const sp = Math.hypot((a.x - prev.x) / k0, (a.z - prev.z) / k0) / (a.t - prev.t);
      const ll = worldXZToLonLat(a.x, a.z);
      return { x: a.x, y: a.y, z: a.z, lat: ll.lat, lon: ll.lon, alt: a.y, heading: a.heading, pitch: 0, bank: 0, speed: sp, vUp: 0 };
    };
    const AonB = runLink({ path: pathA, rateHz: 10, tickMs: 100, legMs, dur, tickPhase: 0.061 });
    let worst = 0;
    let worstT = 0;
    for (const fr of AonB) {
      if (fr.t < 2) continue;
      const b = B(fr.t);
      const e = distM(fr.pose, slotOf(b.x, b.y, b.z, b.heading));
      if (e > worst) {
        worst = e;
        worstT = fr.t;
      }
    }
    return { worst, worstT };
  }
  const gentle = (t) => (t < 4 ? 0 : t < 10 ? 20 * DEG : 0); // straight, a 20°/s turn entry, steady turn, roll-out
  const f = formation(gentle, 75);
  check("(3) formation at 180 m/s: on B's screen A stays within 20 m of B(t) + slot (straight, 20°/s turn in and out)", f.worst < 20, `worst ${f.worst.toFixed(2)} m at t=${f.worstT.toFixed(2)} s`);
  for (const [label, om, leg] of [
    ['straight', () => 0, 75],
    ['44°/s turn in and out', (t) => (t < 4 ? 0 : t < 10 ? 44 * DEG : 0), 75],
    ['20°/s reversal', (t) => (t < 4 ? 0 : t < 8 ? 20 * DEG : t < 12 ? -20 * DEG : 0), 75],
    ['20°/s turn, 150 ms per leg', gentle, 150],
  ]) {
    const r = formation(om, leg);
    info(`(3) formation · ${label}`, `worst ${r.worst.toFixed(2)} m at t=${r.worstT.toFixed(2)} s`);
  }
}

// ---------------------------------------------------------------------------
// (4) 1 s stall, then a burst
// ---------------------------------------------------------------------------
{
  for (const [label, turnDeg, bound] of [
    ['straight', 0, 3],
    ['44°/s turn', 44, 5],
  ]) {
    const speed = 180;
    const path = makePath({ speed, omegaAt: () => turnDeg * DEG });
    const frames = runLink({ path, rateHz: 10, tickMs: 100, stall: [5, 6] });
    const during = frames.filter((f) => f.t >= 5 && f.t < 6.2);
    let minStep = Infinity;
    for (let i = 1; i < during.length; i++) minStep = Math.min(minStep, distM(during[i].pose, during[i - 1].pose) / (during[i].t - during[i - 1].t));
    const noDip = during.every((f) => f.opacity === 1 && f.stale === 0);
    const errAtBurst = Math.max(...frames.filter((f) => f.t >= 6 && f.t < 6.1).map((f) => distM(f.pose, f.truth)));
    const errAfter = Math.max(...frames.filter((f) => f.t >= 7 && f.t < 8).map((f) => distM(f.pose, f.truth)));
    const s = stats(frames, speed);
    check(
      `(4) ${label}: through a 1 s stall the pilot keeps moving (≥ 0.5 v), never dims or dips, and the error decays after the burst (< ${bound} m)`,
      minStep >= 0.5 * speed && noDip && errAfter < bound && s.maxJump <= 2,
      `min speed ${minStep.toFixed(0)} m/s · error at burst ${errAtBurst.toFixed(2)} m → ${errAfter.toFixed(2)} m one second later · step +${s.maxJump.toFixed(2)} m`
    );
  }
}

// ---------------------------------------------------------------------------
// (5) the freshness ladder
// ---------------------------------------------------------------------------
{
  const m = new RemoteMotion(DR, SIG);
  const path = makePath({ speed: 150, vUp: 8 });
  for (let t = 0; t <= 2; t += 0.1) m.push(recordOf(path(t), t), relayNow(t + 0.2), LON0);
  const o = {};
  const at = (age) => {
    m.render(relayNow(2 + age), o);
    return { ...o };
  };
  const fresh = Math.max(DR.freshSec, 0.25);
  const a = at(1);
  const b1 = at(fresh + 1);
  const b2 = at(fresh + 2);
  const c1 = at(fresh + DR.dimSec + 1);
  const c2 = at(fresh + DR.dimSec + 3);
  check('(5) ladder stage 0 (age 1 s): stale 0, opacity 1', a.stale === 0 && a.opacity === 1);
  check(
    '(5) ladder stage 1: stale 1, opacity 0.6, keeps moving straight, climb stopped',
    b1.stale === 1 && b1.opacity === 0.6 && Math.abs(distM(b1, b2) - 150) < 1 && Math.abs(b1.y - b2.y) < 1e-3 && b1.vUp === 0,
    `moved ${distM(b1, b2).toFixed(1)} m in 1 s`
  );
  check('(5) ladder stage 2: stale 2, opacity 0.3, the pose held, velocities 0', c1.stale === 2 && c1.opacity === 0.3 && distM(c1, c2) < 1e-6 && c1.vE === 0 && c1.vN === 0);
}

// ---------------------------------------------------------------------------
// (6) HELD and CRASHED
// ---------------------------------------------------------------------------
{
  const path = makePath({ speed: 200, omegaAt: () => 10 * DEG });
  const m = new RemoteMotion(DR, SIG);
  for (let t = 0; t <= 3; t += 0.1) m.push(recordOf(path(t), t), relayNow(t + 0.3), LON0);
  const held = recordOf(path(3.1), 3.1, { flags: P.F.HELD });
  m.push(held, relayNow(3.4), LON0);
  const o = {};
  m.render(relayNow(3.45), o);
  const v0 = o.vE === 0 && o.vN === 0 && o.vUp === 0 && o.stale === 2 && o.opacity === 0.5;
  m.render(relayNow(6), o);
  const want = path(3.1);
  check('(6) HELD: velocities 0, stale 2, opacity 0.5, the pose held at the sample', v0 && distM(o, want) < 0.1 && o.vE === 0, `${distM(o, want).toFixed(3)} m from the sample`);
  const m2 = new RemoteMotion(DR, SIG);
  for (let t = 0; t <= 2; t += 0.1) m2.push(recordOf(path(t), t), relayNow(t + 0.3), LON0);
  m2.push(recordOf(path(2.1), 2.1, { flags: P.F.CRASHED }), relayNow(2.4), LON0);
  m2.render(relayNow(4.5), o);
  check('(6) CRASHED: no extrapolation (the newest pose plus the decayed error)', distM(o, path(2.1)) < 0.1 && o.vE === 0, `${distM(o, path(2.1)).toFixed(3)} m from the sample 2.4 s later`);
}

// ---------------------------------------------------------------------------
// (7) snaps
// ---------------------------------------------------------------------------
{
  const path = makePath({ speed: 200 });
  const far = makePath({ speed: 200, lat0: LAT0 + 0.45, lon0: LON0 + 0.3 }); // ~60 km away
  const m = new RemoteMotion(DR, SIG);
  for (let t = 0; t <= 2; t += 0.1) m.push(recordOf(path(t), t), relayNow(t + 0.3), LON0);
  const o = {};
  m.render(relayNow(2.35), o);
  const before = { ...o };
  const epoch0 = m.snapEpoch;
  m.push(recordOf(far(2.1), 2.1, { warpSeq: 1 }), relayNow(2.36), LON0);
  m.render(relayNow(2.37), o);
  const toNew = distM(o, far(2.37));
  check('(7) a warpSeq change snaps: the next frame is at the new pose, no intermediate position', toNew < 1 && distM(before, o) > 50000, `${toNew.toFixed(3)} m from the new truth`);
  check('(7) ...bumps snapEpoch once and dips the opacity for snapDipMs', m.snapEpoch === epoch0 + 1 && o.opacity <= 0.25 && (m.render(relayNow(2.37 + DR.snapDipMs / 1000 + 0.05), o), o.opacity === 1));
  // a > snapErrorM jump with the SAME warpSeq: snap, no dip
  const m2 = new RemoteMotion(DR, SIG);
  for (let t = 0; t <= 2; t += 0.1) m2.push(recordOf(path(t), t), relayNow(t + 0.3), LON0);
  const jump = makePath({ speed: 200, lon0: LON0 + 0.01 }); // ~840 m east
  m2.push(recordOf(jump(2.1), 2.1), relayNow(2.4), LON0);
  m2.render(relayNow(2.41), o);
  check('(7) a jump beyond snapErrorM snaps (snapEpoch +1) with no dip', m2.snapEpoch === 1 && o.opacity === 1 && distM(o, jump(2.41)) < 1);
  // a small correction glides
  const m3 = new RemoteMotion(DR, SIG);
  for (let t = 0; t <= 2; t += 0.1) m3.push(recordOf(path(t), t), relayNow(t + 0.3), LON0);
  m3.render(relayNow(2.39), o);
  const pre = { ...o };
  const nudge = makePath({ speed: 200, lon0: LON0 + 0.0003 }); // ~25 m east
  m3.push(recordOf(nudge(2.1), 2.1), relayNow(2.4), LON0);
  m3.render(relayNow(2.4), o);
  const cont = distM(o, pre) - 200 * 0.01;
  m3.render(relayNow(3.9), o);
  check('(7) a 25 m correction glides in: continuous at the sample, converged 1.5 s later, no snap', m3.snapEpoch === 0 && cont < 1 && distM(o, nudge(3.9)) < 0.1, `step at the sample +${cont.toFixed(3)} m`);
}

// ---------------------------------------------------------------------------
// (8) the antimeridian
// ---------------------------------------------------------------------------
{
  const lat = 10;
  const k = mercatorScale(lat);
  const viewer = mercatorWorldXZ(179.9, lat);
  const m = new RemoteMotion(DR, SIG);
  const rec = { sampleTs: BASE_MS, flags: 0, warpSeq: 0, lat, lon: -179.9, alt: 3000, heading: Math.PI / 2, pitch: 0, bank: 0, speed: 0, vUp: 0 };
  m.push(rec, relayNow(0.2), 179.9);
  const o = {};
  m.render(relayNow(0.3), o);
  const d = Math.hypot((o.x - viewer.x) / k, (o.z - viewer.z) / k);
  check('(8) a pilot at −179.9° draws within 30 km of a viewer at +179.9°', d < 30000, `${(d / 1000).toFixed(2)} km`);
  // flying east across ±180° at 250 m/s: continuous, no snap
  const m2 = new RemoteMotion(DR, SIG);
  const W = mercatorWorldXZ(179.995, lat);
  let worst = -Infinity;
  let prev = null;
  let crossed = false;
  for (let f = 0; f <= 60 * 8; f++) {
    const t = f / 60;
    if (f % 6 === 0) {
      const ts = t - 0.25;
      if (ts >= 0) {
        const ll = worldXZToLonLat(W.x + 250 * ts * k, W.z);
        const lonW = P.wrap180(ll.lon);
        if (lonW < 0) crossed = true;
        m2.push({ sampleTs: (BASE_MS + Math.round(ts * 1000)) >>> 0, flags: 0, warpSeq: 0, lat, lon: lonW, alt: 3000, heading: Math.PI / 2, pitch: 0, bank: 0, speed: 250, vUp: 0 }, relayNow(t), 179.9);
      }
    }
    if (!m2.has) continue;
    m2.render(relayNow(t), o);
    if (prev) worst = Math.max(worst, Math.hypot((o.x - prev.x) / k, (o.z - prev.z) / k) - 250 / 60);
    prev = { x: o.x, z: o.z };
  }
  check('(8) flying across ±180°: no snap, every frame step ≤ v·dt + 2 m', crossed && m2.snapEpoch === 0 && worst <= 2, `step +${worst.toFixed(3)} m`);
}

// ---------------------------------------------------------------------------
// (9) the wave wing-rock
// ---------------------------------------------------------------------------
{
  const m = new RemoteMotion(DR, SIG);
  const t0 = relayNow(1);
  m.startWave(t0);
  let hi = -Infinity;
  let lo = Infinity;
  for (let ms = 0; ms < SIG.waveSec * 1000; ms++) {
    const b = m.waveOffset(t0 + ms) / DEG;
    hi = Math.max(hi, b);
    lo = Math.min(lo, b);
  }
  const atEnd = m.waveOffset(t0 + SIG.waveSec * 1000);
  const after = m.waveOffset(t0 + SIG.waveSec * 1000 + 500);
  check(`(9) the wave rocks ±${SIG.waveRockDeg}° (peaks within 0.05°, never beyond)`, Math.abs(hi - SIG.waveRockDeg) < 0.05 && Math.abs(lo + SIG.waveRockDeg) < 0.05 && hi <= SIG.waveRockDeg + 1e-9, `+${hi.toFixed(3)}° / ${lo.toFixed(3)}°`);
  check('(9) ...and ends at exactly 0', atEnd === 0 && after === 0 && m.waving === false);
  // it rides render()'s bank additively (a second motion gives the bare offset)
  const m2 = new RemoteMotion(DR, SIG);
  const ref = new RemoteMotion(DR, SIG);
  const rec = recordOf(makePath({ speed: 100 })(0), 0);
  m2.push(rec, relayNow(0.1), LON0);
  const o = {};
  m2.startWave(relayNow(0.1));
  ref.startWave(relayNow(0.1));
  m2.render(relayNow(0.6), o);
  const want = rec.bank + ref.waveOffset(relayNow(0.6));
  check('(9) render() bank = sample bank + the wave offset', Math.abs(o.bank - want) < 1e-9 && Math.abs(o.bank) > 15 * DEG, `${(o.bank / DEG).toFixed(2)}°`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

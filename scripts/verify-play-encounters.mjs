// PLAY PASS — ENCOUNTERS gate (ENCOUNTER_FEEL; FLY_PLAY_PASS.md F4, F5). Node only:
//   node scripts/verify-play-encounters.mjs
// It runs twice: this process with the flag ON (the shipped default), and a
// child with the flag OFF (ESCORT_FEEL_OFF=1 pins window.__flyEncounterFeelOverride
// before any import, exactly as ?flags=-ENCOUNTER_FEEL does in the browser).
//  ON:  1. the block's tunables; read only through lib/fly/play-pass.js
//       2. formation: speed along the track on both sides of the slot, a capped
//          heading correction, the classic law kept for a hover
//       3. a 100 kt helicopter is held alongside for 30 s through the REAL
//          FlightModel + Autopilot — the escort that looped and never paid out
//       4. the photo ship: near the target, beyond it, both aircraft in frame,
//          the target large; the sunlit side; the beat 0 → 1 → 0
//       5. honest trails: a line below contrail-forming air, vapour above,
//          the escorted aircraft's trail gone at escort range
//       6. the payoff: shutter, then release; adopted escorts; the held timer
//       7. seams: mounts and edits only inside PLAY PASS ENCOUNTERS blocks,
//          the escort card keeps the hud-chase-chip contract
//  OFF: the classic formation law (formationHold → null, the same commands as
//       before), the classic hold reset, and verify-escort's own ten checks
//       against the pre-pass rig.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const OFF = process.env.ESCORT_FEEL_OFF === '1';
if (OFF) globalThis.window = { __flyEncounterFeelOverride: { enabled: false } };
register('./_node-resolve.mjs', import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const { PerspectiveCamera, Vector3 } = await import('three');
const { playPassOn, playPassBlock } = await import('../lib/fly/play-pass.js');
const { ENCOUNTER_FEEL, TARGETING } = await import('../lib/fly/fly-constants.js');
const { formationHold } = await import('../lib/fly/escort-formation.js');
const { Autopilot } = await import('../lib/fly/autopilot.js');
const { FlightModel } = await import('../lib/fly/flight-model.js');
const { resolveAircraft } = await import('../lib/fly/player-aircraft.js');
const { EncounterController, ENCOUNTER_LIMITS } = await import('../lib/fly/encounters.mjs');
const { CinemaCamera } = await import('../lib/fly/cinema-camera.js');
const shot = await import('../lib/fly/escort-shot.js');
const feel = await import('../lib/fly/encounter-feel.js');

let n = 0;
const test = (label, fn) => {
  fn();
  n++;
  console.log(`PASS ${OFF ? '[off] ' : ''}${label}`);
};

// ---------------------------------------------------------------------------
// A live escort through the real FlightModel and Autopilot: a target flying a
// straight (or turning) track, the player starting `back` m behind and `right`
// m to its right. Returns the longest continuous run of the encounter's own
// "alongside" test (60–400 m, ±120 m, within 45° of its heading) and the
// separations seen after the join.
const DEG = Math.PI / 180;
function escortRun({ speed = 51.4, turnDegPerSec = 0, secs = 90, back = 380, right = 120, aircraft = 'fighter' } = {}) {
  const f = new FlightModel(resolveAircraft(aircraft).cfg);
  f.latDeg = 0;
  f.groundElev = 0;
  f.pos.set(right, 300, back);
  f.heading = 0;
  f.speed = 120;
  const t = { hex: 'heli01', rx: 0, ry: 300, ryd: 300, rz: 0, yaw: 0, stale: 0, distM: 0, fix1: { vE: 0, vN: speed, vUp: 0 } };
  const ap = new Autopilot();
  ap.engage('intercept');
  const dt = 1 / 30;
  let run = 0, best = 0, joined = false, maxAfterJoin = 0, minAfterJoin = Infinity;
  const neutral = { turn: 0, pitch: 0, boost: false, speedPreset: 'cruise', freeLook: false };
  for (let i = 0; i < secs / dt; i++) {
    t.yaw += turnDegPerSec * DEG * dt;
    t.fix1.vE = Math.sin(t.yaw) * speed;
    t.fix1.vN = Math.cos(t.yaw) * speed;
    t.rx += t.fix1.vE * dt;
    t.rz -= t.fix1.vN * dt;
    t.distM = Math.hypot(t.rx - f.pos.x, t.ryd - f.pos.y, t.rz - f.pos.z);
    const cmd = ap.update(dt, f, t, neutral) ?? neutral;
    f.step(dt, cmd);
    let dh = f.heading - t.yaw;
    dh = Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh)));
    const alongside = t.distM >= 60 && t.distM <= TARGETING.interceptHandoffM && Math.abs(t.ryd - f.pos.y) < 120 && dh < Math.PI / 4;
    run = alongside ? run + dt : 0;
    best = Math.max(best, run);
    if (ap.mode === 'formation' && alongside) joined = true;
    if (joined) {
      maxAfterJoin = Math.max(maxAfterJoin, t.distM);
      minAfterJoin = Math.min(minAfterJoin, t.distM);
    }
  }
  return { best, joined, maxAfterJoin, minAfterJoin, mode: ap.mode };
}

if (!OFF) {
  test('ENCOUNTER_FEEL carries its tunables and is read only through lib/fly/play-pass.js', () => {
    assert.equal(playPassOn('ENCOUNTER_FEEL'), true, 'shipped ON');
    const B = playPassBlock('ENCOUNTER_FEEL');
    for (const k of ['shot', 'formation', 'holdDecay', 'adoptEscorts', 'payoff', 'cleanFrame', 'trails']) assert.ok(k in ENCOUNTER_FEEL, k);
    assert.ok(B.shot.photoM < B.shot.pursuitM, 'photo ship inside pursuit');
    assert.ok(B.shot.minM > 0 && B.shot.maxM > B.shot.minM && B.shot.subjectK > 1);
    assert.ok(B.formation.minMps > 0 && B.formation.crossMaxDeg > 0 && B.formation.crossMaxDeg < 60);
    assert.ok(B.payoff.shutterSec > B.payoff.swingSec * 0.9 && B.payoff.shutterSec < B.payoff.swingSec + B.payoff.holdSec);
    assert.ok(B.trails.lineNearM[0] < B.trails.lineNearM[1] && B.trails.escortFadeM[0] < B.trails.escortFadeM[1]);
    // Nothing reads the block but the one reader (and the device report's flag list).
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSyncSafe(dir)) {
        const p = path.join(dir, name);
        if (/node_modules|\.next|\.graphics-review|\.git/.test(p)) continue;
        if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.mjs')) {
          const src = readFileSync(p, 'utf8');
          if (/import[^;]*\bENCOUNTER_FEEL\b[^;]*from\s+['"][^'"]*fly-constants/.test(src)) offenders.push(path.relative(ROOT, p));
        } else if (!name.includes('.')) walk(p);
      }
    };
    walk(path.join(ROOT, 'lib'));
    walk(path.join(ROOT, 'components'));
    assert.deepEqual(offenders.sort(), ['lib\\fly\\device-report.js', 'lib\\fly\\play-pass.js'].map((s) => s.replace(/\\/g, path.sep)).sort());
  });

  test('formation: speed along the track on both sides of the slot, a capped turn across it', () => {
    const F = resolveAircraft('fighter').cfg;
    const lam = TARGETING.formationLambda;
    const tv = { vE: 0, vN: 51, vUp: 0 };
    // Slot 200 m ahead of the player (yaw 0 = north = −z): faster than the target.
    const behind = formationHold(0, 0, -200, 0, tv, 51, F, lam);
    assert.ok(behind.speed > 51 + 30, `behind the slot: ${behind.speed.toFixed(1)} m/s`);
    // Slot 150 m BEHIND the player (overshoot): slower than the target, never below minMps.
    const ahead = formationHold(0, 0, 150, 0, tv, 51, F, lam);
    assert.ok(ahead.speed < 51 && ahead.speed >= ENCOUNTER_FEEL.formation.minMps, `ahead of the slot: ${ahead.speed.toFixed(1)} m/s`);
    // …and it keeps flying the target's way (no turn-around loop).
    assert.ok(ahead.vz < 0, 'still heading with the target');
    // Far to the side: the heading correction is capped.
    const side = formationHold(500, 0, 0, 0, tv, 51, F, lam);
    const corr = Math.atan2(side.vx, -side.vz) / DEG;
    assert.ok(corr > 0 && corr <= ENCOUNTER_FEEL.formation.crossMaxDeg + 1e-6, `capped correction ${corr.toFixed(1)}°`);
    // At the slot: the target's speed and course exactly.
    const at = formationHold(0, 0, 0, 0.7, { vE: Math.sin(0.7) * 51, vN: Math.cos(0.7) * 51, vUp: 0 }, 51, F, lam);
    assert.ok(Math.abs(at.speed - 51) < 1e-9 && Math.abs(Math.atan2(at.vx, -at.vz) - 0.7) < 1e-9);
    // A hover keeps the classic law (it orbits): null.
    assert.equal(formationHold(0, 0, 0, 0, { vE: 0, vN: 5, vUp: 0 }, 5, F, lam), null);
  });

  test('a 100 kt helicopter is held alongside for 30 s (real FlightModel + Autopilot), straight and turning', () => {
    for (const opts of [{}, { turnDegPerSec: 1.5 }, { back: -250, right: 60 }, { aircraft: 'prop', speed: 45 }, { speed: 120, back: 900 }]) {
      const r = escortRun(opts);
      assert.ok(r.joined, `${JSON.stringify(opts)}: never joined (${r.mode})`);
      assert.ok(r.best >= ENCOUNTER_LIMITS.holdSec, `${JSON.stringify(opts)}: longest alongside ${r.best.toFixed(1)} s (sep ${Math.round(r.minAfterJoin)}–${Math.round(r.maxAfterJoin)} m)`);
    }
  });

  // -------------------------------------------------------------------------
  // The photo ship, through CinemaCamera (the shipped seam).
  const k = 1 / Math.cos((40.7 * Math.PI) / 180);
  function film(sepM, aspect, { dAlt = 20, length = 13, bearing = 0.4, frames = 300, sun = { x: 0.5, y: 0.6, z: 0.62 } } = {}) {
    Object.assign(shot.escortShotState.sun, sun);
    shot.escortShotState.beat = null;
    const camera = new PerspectiveCamera(58, aspect, 1, 400000);
    const flight = { pos: new Vector3(500, 300, -800), cfg: { cameraOffsetScale: 1 }, heading: bearing, latDeg: 40.7 };
    const target = { rx: flight.pos.x + Math.sin(bearing) * sepM * k, ry: 300 + dAlt, ryd: 300 + dAlt, rz: flight.pos.z - Math.cos(bearing) * sepM * k, fleetType: { spec: { length } } };
    const rig = new CinemaCamera();
    rig.glide();
    camera.position.set(flight.pos.x, flight.pos.y + 8, flight.pos.z + 30 * k);
    for (let i = 0; i < frames; i++) rig.update(1 / 60, flight, target, camera, k, 0);
    camera.updateMatrixWorld(true);
    const p = flight.pos.clone().project(camera);
    const t = new Vector3(target.rx, target.ryd, target.rz).project(camera);
    const c = camera.position;
    const toT = Math.hypot((c.x - target.rx) / k, c.y - target.ryd, (c.z - target.rz) / k);
    const toP = Math.hypot((c.x - flight.pos.x) / k, c.y - flight.pos.y, (c.z - flight.pos.z) / k);
    const inside = (v) => Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && v.z < 1 && v.z > -1;
    return { p, t, toT, toP, inside: inside(p) && inside(t), heightPx: (length / toT) * (0.5 / Math.tan((58 * DEG) / 2)) };
  }

  test('photo ship: the target near and large, the player beyond it, both in frame on every aspect', () => {
    for (const aspect of [16 / 10, 390 / 844, 844 / 390])
      for (const [sep, dAlt, length] of [[100, 20, 13], [120, -40, 8.3], [160, 30, 37.6], [250, 0, 70]]) {
        const r = film(sep, aspect, { dAlt, length });
        assert.ok(r.inside, `aspect ${aspect.toFixed(2)} sep ${sep}: player ${r.p.x.toFixed(2)},${r.p.y.toFixed(2)} target ${r.t.x.toFixed(2)},${r.t.y.toFixed(2)}`);
        assert.ok(r.toT < r.toP, `aspect ${aspect.toFixed(2)} sep ${sep}: target ${r.toT.toFixed(0)} m, player ${r.toP.toFixed(0)} m`);
      }
    // Desktop: a 13 m helicopter 100 m off your wing fills a real share of the frame
    // (the abeam wing shot drew it at 5–10 px of 900 under its bracket).
    const heli = film(100, 16 / 10, { length: 13 });
    assert.ok(heli.heightPx > 0.12, `helicopter spans ${(heli.heightPx * 100).toFixed(1)}% of the frame height`);
  });

  test('the photo ship flies on the sunlit side, and the beat eases 0 → 1 → 0', () => {
    // Pair along −z (north), sun from the east: the camera hangs east of the line.
    const s = shot.sunlitSide(0, -1, 30 * DEG, { x: 1, y: 0.3, z: 0 });
    const w = { x: -1, z: 0 }; // ŵ = (uz, −ux) for ux 0, uz −1
    assert.ok((s.plus > s.minus) === (w.x * 1 > 0), JSON.stringify(s));
    const P = shot.PAYOFF;
    assert.equal(shot.beatWeight(null, 5), 0);
    assert.equal(shot.beatWeight({ t0: 0 }, 0), 0);
    assert.ok(Math.abs(shot.beatWeight({ t0: 0 }, P.swingSec) - 1) < 1e-9);
    assert.ok(Math.abs(shot.beatWeight({ t0: 0 }, P.swingSec + P.holdSec) - 1) < 1e-9);
    assert.equal(shot.beatWeight({ t0: 0 }, 2 * P.swingSec + P.holdSec), 0);
    // A pose that cannot fit backs off and narrows until it does.
    const pose = shot.photoShipPose(0, -1, 600, 0, 40, 60 * DEG, 0.1, 1, 20 * DEG);
    assert.ok(pose.angle <= 20 * DEG + 1e-9 && pose.R > 40 && pose.beta < 60 * DEG, JSON.stringify(pose));
  });

  test('honest trails: a light line below contrail-forming air, vapour above, none on the escort up close', () => {
    const base = { headM: 18, tailM: 48 };
    const out = {};
    const low = feel.honestTrail(out, 274, null, 6000, false, base);
    assert.ok(low.vapour < 0.01, `900 ft vapour ${low.vapour}`);
    assert.ok(low.tailM <= feel.FEEL.trails.lineTailM + 1e-9 && low.headM <= feel.FEEL.trails.lineHeadM + 1e-9, 'line widths');
    assert.ok(Math.abs(low.alphaK - feel.FEEL.trails.lineVapor) < 1e-9 && low.bodyK === 1);
    const high = feel.honestTrail({}, 10700, null, 6000, false, base);
    assert.ok(high.vapour > 0.99, `FL350 vapour ${high.vapour}`);
    assert.deepEqual([high.headM, high.tailM, high.alphaK, high.bodyK], [18, 48, 1, 1], 'contrail air is the trail as before');
    assert.equal(feel.honestTrail({}, 274, null, 200, false, base).bodyK, 0, 'up close the hull carries a low trail');
    assert.equal(feel.honestTrail({}, 10700, null, 300, true, base).bodyK, 0, 'the escorted aircraft drops its trail at escort range');
    assert.equal(feel.honestTrail({}, 10700, null, 9000, true, base).bodyK, 1, '…and keeps it far out, where it finds the target');
    // A hot surface day lifts the formation level (Schmidt–Appleman, not a fixed height).
    assert.ok(feel.honestTrail({}, 8200, { tempC: 38 }, 6000, false, base).vapour < feel.honestTrail({}, 8200, { tempC: -10 }, 6000, false, base).vapour);
  });

  test('the payoff: the shutter after the swing, then release; a quick one outside the cinema', () => {
    const p = feel.createPayoff();
    p.start({ id: 'm1', kind: 'traffic' }, { cinematic: true });
    assert.ok(shot.escortShotState.beat, 'the beat starts with the memory');
    const steps = [];
    for (let t = 0; t < 10; t += 1 / 30) {
      const s = p.tick(1 / 30);
      if (s) steps.push([s, +t.toFixed(2)]);
    }
    assert.deepEqual(steps.map((s) => s[0]), ['shutter', 'release']);
    assert.ok(Math.abs(steps[0][1] - shot.PAYOFF.shutterSec) < 0.1 && Math.abs(steps[1][1] - (shot.PAYOFF.swingSec + shot.PAYOFF.holdSec)) < 0.1, JSON.stringify(steps));
    assert.equal(p.live, null, 'over after the ease-out');
    assert.equal(shot.escortShotState.beat, null);
    const q = feel.createPayoff();
    q.start({ id: 'm2', kind: 'traffic' }, { cinematic: false });
    assert.equal(shot.escortShotState.beat, null, 'no beat outside the cinema');
    const quick = [];
    for (let t = 0; t < 2; t += 1 / 30) {
      const s = q.tick(1 / 30);
      if (s) quick.push(s);
    }
    assert.deepEqual(quick, ['shutter', 'release']);
  });

  test('adopted escorts, and a timer that drains instead of zeroing', () => {
    const memories = [];
    const c = new EncounterController(() => {}, (m) => memories.push(m));
    const cand = { id: 'live:abc', kind: 'traffic', hex: 'abc', name: 'N1', distanceM: 300 };
    assert.equal(c.adopt(cand, { exclusive: true, held: false, aircraftId: 'fighter', epoch: 0 }), false);
    assert.equal(c.adopt(cand, { exclusive: false, held: true, aircraftId: 'fighter', epoch: 0 }), false);
    assert.equal(c.adopt(cand, { exclusive: false, held: false, aircraftId: 'fighter', epoch: 0 }), true, 'not refused for its own assistance');
    assert.equal(c.active.adopted, true);
    assert.equal(c.adopt(cand, { exclusive: false, held: false, aircraftId: 'fighter', epoch: 0 }), false, 'one at a time');
    const track = { stale: 0, flags: 0, distM: 120, ryd: 300, yaw: 0, meta: { flight: 'N1', t: 'AS50', r: 'N1' } };
    const ctx = (extra) => ({ aircraftId: 'fighter', epoch: 0, altM: 300, heading: 0, track, position: { lat: 40, lon: -74, altM: 300 }, holdDecay: feel.FEEL.holdDecay, ...extra });
    for (let i = 0; i < 20 * 2; i++) c.tick(0.5, ctx());
    assert.ok(Math.abs(c.active.hold - 20) < 1e-9);
    track.distM = 700; // out of the slot for 4 s
    for (let i = 0; i < 8; i++) c.tick(0.5, ctx());
    assert.ok(Math.abs(c.active.hold - (20 - 4 * feel.FEEL.holdDecay)) < 1e-9, `drained to ${c.active.hold}`);
    track.distM = 120;
    for (let i = 0; i < 40 && c.active; i++) c.tick(0.5, ctx());
    assert.equal(memories.length, 1, 'the memory is earned');
    assert.equal(c.adopt(cand, { exclusive: false, held: false, aircraftId: 'fighter', epoch: 0 }), false, 'never twice for the same crossing');
  });

  test('seams: mounts and edits only inside PLAY PASS ENCOUNTERS blocks; the escort card keeps its contract', () => {
    const inBlock = (file, needles, begin, end) => {
      const src = read(file);
      const a = src.indexOf(begin), b = src.indexOf(end);
      assert.ok(a >= 0 && b > a, `${file}: markers`);
      for (const needle of needles) {
        let i = src.indexOf(needle);
        assert.ok(i >= 0, `${file}: ${needle}`);
        for (; i >= 0; i = src.indexOf(needle, i + 1)) assert.ok(i > a && i < b, `${file}: ${needle} outside its block`);
      }
    };
    inBlock('components/fly/FlyScene.jsx', ['EncounterFeelRig'], '// PLAY PASS ENCOUNTERS imports begin', '{/* PLAY PASS ENCOUNTERS end */}');
    inBlock('components/fly/FlyMode.jsx', ['EncounterMoment'], '// PLAY PASS ENCOUNTERS imports begin', '{/* PLAY PASS ENCOUNTERS end */}');
    for (const f of ['lib/fly/autopilot.js', 'lib/fly/cinema-camera.js']) {
      const src = read(f);
      assert.equal((src.match(/PLAY PASS ENCOUNTERS begin/g) || []).length, 1, `${f}: one block`);
      assert.equal((src.match(/PLAY PASS ENCOUNTERS imports begin/g) || []).length, 1, `${f}: one import block`);
    }
    for (const f of ['components/fly/TrafficLayer.jsx', 'lib/fly/operations-runtime.js', 'components/fly/PlayerPlane.jsx'])
      assert.ok(!/ENCOUNTER_FEEL|PLAY PASS ENCOUNTERS/.test(read(f)), `${f} is not touched`);
    const card = read('components/fly/hud/EscortCard.jsx');
    assert.ok(card.includes('data-testid="hud-chase-chip"'), 'testid kept');
    for (const word of ["'FORMATION'", "'INTERCEPT'", 'CINEMA']) assert.ok(card.includes(word), word);
    // The pill is still what renders with the flag off.
    const hud = read('components/fly/hud/EscortHud.jsx');
    assert.ok(/ENCOUNTER_FEEL_ACTIVE\.enabled === true \?\s*\(\s*<EscortCard/.test(hud) && hud.includes('<EscortPill'), 'flag-gated card, pill otherwise');
    // Honest trails are an exact identity with the flag off (×1 and the base widths).
    const tr = read('components/fly/TrafficTracers.jsx');
    for (const s of ['let tW = tailW;', 'let hW = S.width.headM;', 'let aK = 1;', 'let bK = 1;', 'if (FEEL_TRAILS) {', 'const w = pres * hazeB * eK * bK;', 'const a = P.alphaPeak * nearV * tp * w * aK;']) assert.ok(tr.includes(s), s);
  });

  // The flag-off arm, in a child process with the pin set before any import.
  const child = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-play-encounters.mjs')], { env: { ...process.env, ESCORT_FEEL_OFF: '1' }, encoding: 'utf8' });
  process.stdout.write(child.stdout.split('\n').filter((l) => /^(PASS|FAIL)|checks/.test(l)).map((l) => `${l}\n`).join(''));
  if (child.status !== 0) {
    console.error(child.stderr.split('\n').filter((l) => !/Warning|Reparsing|eliminate|trace-warnings/.test(l)).join('\n'));
    process.exit(1);
  }
  const escortOff = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-escort.mjs')], { env: { ...process.env, ESCORT_FEEL_OFF: '1' }, encoding: 'utf8' });
  assert.equal(escortOff.status, 0, `verify-escort, flag off:\n${escortOff.stdout}\n${escortOff.stderr}`);
  n++;
  console.log(`PASS [off] verify-escort's ten checks hold against the pre-pass rig (${(escortOff.stdout.match(/^PASS/gm) || []).length} passed)`);
  console.log(`${n}/${n} play-pass encounters checks passed (flag on), plus the flag-off arm.`);
} else {
  test('flag off: ENCOUNTER_FEEL reads off, and the formation law is the classic one', () => {
    assert.equal(playPassOn('ENCOUNTER_FEEL'), false);
    const F = resolveAircraft('fighter').cfg;
    assert.equal(formationHold(0, 0, 150, 0, { vE: 0, vN: 51, vUp: 0 }, 51, F, TARGETING.formationLambda), null);
    // The classic formation command, recomputed here from the pre-pass law.
    const f = new FlightModel(F);
    f.pos.set(30, 300, 200);
    f.heading = 0.1;
    const t = { rx: 0, ry: 300, ryd: 300, rz: 0, yaw: 0, stale: 0, fix1: { vE: 0, vN: 51, vUp: 0 } };
    const ap = new Autopilot();
    ap.engage('formation');
    const cmd = ap.update(1 / 30, f, t, { turn: 0, pitch: 0, speedPreset: 'cruise' });
    const slot = TARGETING.formationSlot;
    const ex = -30 + slot.right, ey = slot.up, ez = -200 + slot.back;
    const lam = TARGETING.formationLambda;
    const vx = ex * lam, vz = ez * lam - 51;
    const err = Math.hypot(ex, ey, ez);
    const speed = Math.max(40, Math.min(F.speeds.boost, 51 + 0.8 * Math.sqrt(2 * F.accel * err)));
    assert.ok(Math.abs(cmd.speedOverride - speed) < 1e-9, `${cmd.speedOverride} vs ${speed}`);
    const brg = Math.atan2(vx, -vz);
    const hErr = Math.atan2(Math.sin(brg - 0.1), Math.cos(brg - 0.1));
    assert.ok(Math.abs(cmd.turn - Math.max(-1, Math.min(1, hErr * 1.8))) < 1e-9);
  });

  test('flag off: drifting out of the slot zeroes the timer, as before', () => {
    const c = new EncounterController(() => {}, () => {});
    c.candidates = [{ id: 'live:abc', kind: 'traffic', hex: 'abc', name: 'N1', distanceM: 300 }];
    assert.ok(c.accept('live:abc', { blocked: false, aircraftId: 'fighter', epoch: 0 }));
    const track = { stale: 0, flags: 0, distM: 120, ryd: 300, yaw: 0, meta: {} };
    const ctx = { aircraftId: 'fighter', epoch: 0, altM: 300, heading: 0, track, position: { lat: 40, lon: -74, altM: 300 }, holdDecay: 0 };
    for (let i = 0; i < 20; i++) c.tick(0.5, ctx);
    track.distM = 700;
    c.tick(0.5, ctx);
    assert.equal(c.active.hold, 0);
  });

  test('flag off: the classic law loops round a 100 kt helicopter (the defect this pass fixes)', () => {
    const r = escortRun({});
    assert.ok(r.best < ENCOUNTER_LIMITS.holdSec, `classic longest alongside ${r.best.toFixed(1)} s`);
  });
  console.log(`${n}/${n} flag-off checks passed.`);
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

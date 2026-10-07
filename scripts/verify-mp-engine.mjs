/**
 * MULTIPLAYER — verify-mp-engine: remote pilots injected into the traffic
 * engine, and every consumer gate that must ignore them (MULTIPLAYER.md;
 * design §13 gate 4). Node only, no browser, no network:
 *
 *   node scripts/verify-mp-engine.mjs
 *
 * (1) An engine with NO origin and NO ADS-B ingest still renders a remote:
 *     update() returns it as items[0]; size 0, remoteCount 1.
 * (2) ADS-B identity: two engines fed the same synthetic batches (blends, an
 *     arc turn, a snap, a grounded pin, render lift, a clock jump and a track
 *     aging through the whole stale ladder), one also carrying a remote —
 *     every ADS-B track is bit-identical over 120 frames, and the remote
 *     leads items every frame. The no-remote arm's whole trace must also hash
 *     to ADSB_TRACE_SHA256, frozen from the PRE-MULTIPLAYER engine — the A/B
 *     alone shares the code under test, so a regression in the common ADS-B
 *     path would move both arms together and stay green.
 * (3) The ADS-B stale ladder never deletes a remote; removeRemote does (and
 *     never touches an ADS-B track). upsertRemote refreshes in place.
 * (4) dispose() clears remotes, remoteCount and the source.
 * (5) Remote flags stay 0 (bit 0 means GROUNDED to existing readers); the
 *     protocol bits live in mpFlags.
 * (6) worldXZToLonLat inverts mercatorWorldXZ to 1e-9 degrees.
 * (7) Consumer gates: encounters liveCandidate, the near-miss detector, the
 *     escort blockers (paused/busy BEFORE frozen; null for ADS-B), the
 *     freeFlightExclusive extraction and isRemote.
 * (8) Flag off: mpAvailable() is false with the shipped constants, and the
 *     TrafficLayer mounts its remote fleet only behind REMOTE_FLEET.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { Vector3 } from 'three';
register('./_node-resolve.mjs', import.meta.url);

const ROOT = path.resolve(import.meta.dirname, '..');
const { TrafficEngine, mercatorWorldXZ, worldXZToLonLat } = await import('../lib/fly/traffic-engine.js');
const { liveCandidate } = await import('../lib/fly/encounters.mjs');
const { createNearMissDetector } = await import('../lib/fly/juice.js');
const { escortBlocker, remoteEscortBlocker, startEscort, ESCORT_MESSAGES } = await import('../lib/fly/escort.js');
const { freeFlightExclusive, encounterContext } = await import('../lib/fly/encounter-runtime.js');
const { isRemote, mpAvailable } = await import('../lib/fly/mp/mp-flag.js');
const { F } = await import('../lib/fly/mp/protocol.mjs');
const { remoteMeta, remoteArchetype } = await import('../lib/fly/mp/remote-meta.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { resolveAircraft } = await import('../lib/fly/player-aircraft.js');
const { mercatorScale } = await import('../lib/fly/coords.js');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const DEG = Math.PI / 180;
const ORIGIN = mercatorWorldXZ(-73.97, 40.78); // Manhattan
const K = mercatorScale(40.78);

/** A remote step stub: what lib/fly/mp/session.js writes, minus the network. */
function remoteStep(engine, id, at = { east: 0, north: 1000, alt: 1500 }, sampleT = null) {
  const calls = { n: 0 };
  const fn = (clientSec, playerPos, items) => {
    calls.n++;
    const t = engine.tracks.get(id);
    if (!t) return;
    t.rx = ORIGIN.x + at.east * K;
    t.ry = at.alt;
    t.ryd = t.ry;
    t.rz = ORIGIN.z - at.north * K;
    t.yaw = 0.3;
    t.bank = 0.2;
    t.pitch = 0.05;
    Object.assign(t.fix1, { t: sampleT ?? clientSec, x: t.rx, y: t.ry, z: t.rz, vE: 50, vN: 150, vUp: 2, latRad: 40.78 * DEG });
    t.opacity = 1;
    t.scaleK = 1;
    t.stale = 0;
    if (playerPos) t.distM = Math.hypot((t.rx - playerPos.x) / K, t.ry - playerPos.y, (t.rz - playerPos.z) / K);
    items.push(t);
  };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------------------
// (1) remotes render with no ADS-B at all
// ---------------------------------------------------------------------------
{
  const e = new TrafficEngine();
  const id = 'p:1z';
  const t = e.upsertRemote(id, remoteMeta(id, 'HERON 27', 0, 3), remoteArchetype('fighter'));
  e.setRemoteSource(remoteStep(e, id));
  const player = new Vector3(ORIGIN.x, 1000, ORIGIN.z);
  const items = e.update(10, player);
  check('(1) no origin, no ingest: update() returns the remote as items[0]', items.length === 1 && items[0] === t && items[0].hex === id, `items ${items.length}`);
  check('(1) size counts live ADS-B only (0), remoteCount 1', e.size === 0 && e.remoteCount === 1 && e.tracks.size === 1, `size ${e.size} remoteCount ${e.remoteCount}`);
  check('(1) serverNow is still null (no ADS-B clock yet)', e.serverNow(10) == null);
  check('(1) the remote track carries the engine contract fields', t.remote === true && t.renderLift === 0 && t.snapEpoch === 0 && t.mpFlags === 0 && t.fix1 && t.meta.remote === true && t.archetype === 4);
  check('(1) distM is the engine formula (true metres)', Math.abs(t.distM - Math.hypot(1000, 500)) < 1e-6, t.distM.toFixed(3));
}

// ---------------------------------------------------------------------------
// (2) ADS-B identity with and without a remote, 120 frames
// ---------------------------------------------------------------------------
// sha256 of arm A's trace below (per frame: item hex order, then every track's
// hex + FIELDS as little-endian float64), recorded by running this arm on the
// engine as it stood BEFORE MULTIPLAYER (`git show f922d64:lib/fly/traffic-engine.js`).
// It moves only with an intentional ADS-B change (TRAFFIC knobs, the engine's
// motion or ladder) — re-record from the FAIL line's digest then, never to
// green a MULTIPLAYER edit.
const ADSB_TRACE_SHA256 = '50a803a5dfce706c1c738a2d1f9707f3b89fbfb2aa740b2c6f3c5718cafb68b1';
function makePlanes() {
  // [hex, east m, north m, alt, speed, headingDeg, arch, flags, lastBatch]
  const rows = [
    ['a00001', 2000, 3000, 9000, 230, 10, 0, 0, 99],
    ['a00002', -4000, 1500, 3000, 120, 95, 2, 0, 99],
    ['a00003', 800, -2500, 11000, 250, 200, 0, 2, 99], // emergency bit
    ['a00004', -300, 400, 0, 12, 270, 1, 1, 99], // grounded (pinned)
    ['a00005', 6000, -6000, 1500, 2, 0, 8, 0, 99], // hovering: yaw hold
    ['a00006', -9000, 7000, 7000, 210, 45, 4, 0, 99], // turner (arc)
    ['a00007', 12000, 500, 5000, 180, 300, 5, 0, 99], // jumper (snap)
    ['a00008', 3000, 9000, 4000, 160, 160, 6, 0, 0], // lost after batch 0: whole ladder
    ['a00009', -1500, -8000, 2500, 140, 120, 9, 0, 3], // lost after batch 3
  ];
  return rows.map(([hex, e, n, alt, speed, hdg, arch, flags, last]) => ({
    hex, e, n, alt, speed, hdg: hdg * DEG, arch, flags, last,
  }));
}
function batchFor(engine, planes, b, serverNow) {
  const live = planes.filter((p) => b <= p.last);
  const rows = new Float32Array(live.length * 9);
  const hexes = [];
  const meta = [];
  live.forEach((p, i) => {
    const o = i * 9;
    const vE = Math.sin(p.hdg) * p.speed;
    const vN = Math.cos(p.hdg) * p.speed;
    rows[o] = ORIGIN.x + p.e * K - engine._originX;
    rows[o + 1] = p.alt;
    rows[o + 2] = ORIGIN.z - p.n * K - engine._originZ;
    rows[o + 3] = vE;
    rows[o + 4] = p.hex === 'a00002' ? 6 : 0;
    rows[o + 5] = vN;
    rows[o + 6] = 0.4 + (i % 3) * 0.6; // fix age, s
    rows[o + 7] = p.arch;
    rows[o + 8] = p.flags;
    hexes.push(p.hex);
    meta.push({ hex: p.hex, flight: `T${p.hex.slice(-3)}`, r: null, t: 'B738', squawk: p.flags & 2 ? '7700' : '1200', category: 'A3', iconType: 'airliner', color: '#60a5fa' });
  });
  return { buffer: rows.buffer, count: live.length, hexes, meta, serverNow };
}
function advance(planes, dtSec, b) {
  for (const p of planes) {
    p.e += Math.sin(p.hdg) * p.speed * dtSec;
    p.n += Math.cos(p.hdg) * p.speed * dtSec;
    if (p.hex === 'a00006') p.hdg += 12 * DEG; // a sustained turn
    if (p.hex === 'a00007' && b === 2) p.e += 4000; // a teleport-grade correction
  }
}
{
  const A = new TrafficEngine();
  const B = new TrafficEngine();
  for (const e of [A, B]) {
    e.setOrigin(ORIGIN.x, ORIGIN.z);
    e.setElevationSampler(() => 30);
    e.setRenderLiftSampler((lon) => 8 + (lon % 1)); // varies by place
  }
  const rid = 'p:2a';
  B.upsertRemote(rid, remoteMeta(rid, 'KESTREL 41', 7, 1), remoteArchetype('airliner'));
  B.setRemoteSource(remoteStep(B, rid, { east: 500, north: 800, alt: 2000 }));

  const planesA = makePlanes();
  const planesB = makePlanes();
  const player = new Vector3(ORIGIN.x, 1200, ORIGIN.z);
  const FIELDS = ['rx', 'ry', 'ryd', 'rz', 'yaw', 'bank', 'opacity', 'stale', 'scaleK', 'distM', 'renderLift', 'archetype', 'flags'];
  const dt = 0.55; // 120 frames = 66 s: dim (15 s), freeze (30 s), remove (60 s + fade)
  let clientSec = 100;
  let skewJump = 0;
  let mismatches = 0;
  let firstMismatch = '';
  let remoteLed = 0;
  let remoteUntouched = 0;
  let deletedSeen = false;
  let jumpHeldRemote = true;
  let batch = 0;
  const trace = createHash('sha256');
  const word = new DataView(new ArrayBuffer(8));
  for (let f = 0; f < 120; f++) {
    if (f % 4 === 0 && batch < 12) {
      if (batch === 5) skewJump = 25; // upstream rotation: a clock discontinuity > clockJumpSec
      const serverNow = clientSec - 3 + skewJump;
      const before = B.tracks.get(rid).fix1.t;
      A.ingest(batchFor(A, planesA, batch, serverNow), clientSec);
      B.ingest(batchFor(B, planesB, batch, serverNow), clientSec);
      if (batch === 5) jumpHeldRemote = B.tracks.get(rid).fix1.t === before;
      advance(planesA, dt * 4, batch);
      advance(planesB, dt * 4, batch);
      batch++;
    }
    const ia = A.update(clientSec, player);
    const ib = B.update(clientSec, player);
    trace.update(`${ia.map((t) => t.hex).join(',')}|`);
    for (const ta of A.tracks.values()) {
      trace.update(ta.hex);
      for (const k of FIELDS) {
        word.setFloat64(0, ta[k], true);
        trace.update(new Uint8Array(word.buffer));
      }
    }
    if (ib[0]?.hex === rid) remoteLed++;
    // Exactly once in items, and exactly as the remote step wrote it (the
    // ADS-B loop would ease yaw/bank and add the render lift to ryd).
    const r = B.tracks.get(rid);
    if (ib.filter((t) => t === r).length === 1 && r.ryd === r.ry && r.yaw === 0.3 && r.bank === 0.2 && r.renderLift === 0) remoteUntouched++;
    const adsbB = ib.filter((t) => t.remote !== true);
    if (adsbB.length !== ia.length || adsbB.some((t, i) => t.hex !== ia[i].hex)) {
      mismatches++;
      firstMismatch ||= `frame ${f}: item order/count ${ia.length} vs ${adsbB.length}`;
    }
    for (const ta of A.tracks.values()) {
      const tb = B.tracks.get(ta.hex);
      if (!tb) {
        mismatches++;
        firstMismatch ||= `frame ${f}: ${ta.hex} missing in B`;
        continue;
      }
      for (const k of FIELDS) {
        if (!Object.is(ta[k], tb[k])) {
          mismatches++;
          firstMismatch ||= `frame ${f}: ${ta.hex}.${k} ${ta[k]} vs ${tb[k]}`;
        }
      }
    }
    if (B.tracks.size - B.remoteCount !== A.tracks.size) {
      mismatches++;
      firstMismatch ||= `frame ${f}: track count ${A.tracks.size} vs ${B.size}`;
    }
    if (!A.tracks.has('a00008')) deletedSeen = true;
    clientSec += dt;
  }
  const digest = trace.digest('hex');
  check('(2) the no-remote ADS-B trace matches the pre-MULTIPLAYER engine (frozen sha256)', digest === ADSB_TRACE_SHA256, digest);
  check('(2) ADS-B tracks bit-identical with and without a remote over 120 frames', mismatches === 0, firstMismatch || `${A.tracks.size} ADS-B tracks, ${batch} batches`);
  check('(2) the run exercised the stale ladder down to deletion', deletedSeen && !B.tracks.has('a00008'));
  check('(2) the remote leads items on every frame', remoteLed === 120, `${remoteLed}/120`);
  check('(2) the ADS-B loop never touches the remote (once in items, pose as written)', remoteUntouched === 120, `${remoteUntouched}/120`);
  check('(2) size excludes the remote; remoteCount counts it', B.size === A.size && B.remoteCount === 1 && B.tracks.has(rid));
  check('(2) the ingest clock-jump re-baseline skips remotes', jumpHeldRemote);
}

// ---------------------------------------------------------------------------
// (3) stale ladder vs remotes, removeRemote, upsert in place
// (4) dispose  (5) flags
// ---------------------------------------------------------------------------
{
  const e = new TrafficEngine();
  e.setOrigin(ORIGIN.x, ORIGIN.z);
  const rid = 'p:3b';
  const t = e.upsertRemote(rid, remoteMeta(rid, 'ALBATROSS 12', 4, 2), remoteArchetype('prop'));
  // A pilot whose newest sample is ancient (held for long): the ADS-B ladder
  // would delete it at once if it ever walked remote tracks.
  const step = remoteStep(e, rid, undefined, 0);
  e.setRemoteSource(step);
  const planes = makePlanes();
  e.ingest(batchFor(e, planes, 0, 997), 1000);
  const adsb = e.size;
  e.update(1000, new Vector3(ORIGIN.x, 0, ORIGIN.z));
  e.update(1000 + 5000, new Vector3(ORIGIN.x, 0, ORIGIN.z)); // every ADS-B fix is ancient
  check('(3) the ADS-B stale ladder deletes ADS-B tracks', adsb > 0 && e.size === 0, `before ${adsb}, after ${e.size}`);
  check('(3) …and never the remote', e.tracks.get(rid) === t && e.remoteCount === 1 && e.items[0] === t);

  const t2 = e.upsertRemote(rid, remoteMeta(rid, 'ALBATROSS 12', 8, 2), remoteArchetype('cargo'));
  check('(3) upsertRemote refreshes meta/archetype in place (no double count)', t2 === t && t.meta.aircraftId === 'cargo' && t.archetype === 5 && e.remoteCount === 1);

  e.ingest(batchFor(e, planes, 1, 6000), 6003);
  e.removeRemote('a00001');
  check('(3) removeRemote never touches an ADS-B track', e.tracks.has('a00001') && e.remoteCount === 1);
  t.mpFlags = F.HELD | F.SMOKE;
  e.update(6003, null);
  check('(5) remote flags === 0; protocol bits ride mpFlags', t.flags === 0 && t.mpFlags === (F.HELD | F.SMOKE));
  e.removeRemote(rid);
  check('(3) removeRemote deletes the remote', !e.tracks.has(rid) && e.remoteCount === 0 && e.size === e.tracks.size);
  e.removeRemote(rid);
  check('(3) removeRemote is idempotent', e.remoteCount === 0);

  // A session-style purge of several pilots, then dispose.
  for (const id of ['p:a', 'p:b', 'p:c']) e.upsertRemote(id, remoteMeta(id, 'X 1', 0, 0), 4);
  for (const id of ['p:a', 'p:b', 'p:c']) e.removeRemote(id);
  check('(3) a session purge leaves remoteCount 0', e.remoteCount === 0);
  e.upsertRemote('p:d', remoteMeta('p:d', 'X 2', 0, 0), 4);
  e.setRemoteSource(step);
  e.dispose();
  const n = step.calls.n;
  const after = e.update(7000, null);
  check('(4) dispose() clears remotes, remoteCount and the source', e.remoteCount === 0 && e.tracks.size === 0 && e._remoteStep === null && step.calls.n === n && after.length === 0);
}

// ---------------------------------------------------------------------------
// (6) worldXZToLonLat inverts mercatorWorldXZ
// ---------------------------------------------------------------------------
{
  let worst = 0;
  const out = {};
  for (let lat = -85; lat <= 85; lat += 8.5) {
    for (const lon of [-179.999, -120.5, -0.25, 0, 33.3, 179.999]) {
      const p = mercatorWorldXZ(lon, lat);
      worldXZToLonLat(p.x, p.z, out);
      worst = Math.max(worst, Math.abs(out.lon - lon), Math.abs(out.lat - lat));
    }
  }
  check('(6) worldXZToLonLat inverts mercatorWorldXZ to 1e-9°', worst < 1e-9, `worst ${worst.toExponential(2)}°`);
  const fresh = worldXZToLonLat(ORIGIN.x, ORIGIN.z);
  check('(6) …and allocates its own out when none is passed', Math.abs(fresh.lat - 40.78) < 1e-9 && Math.abs(fresh.lon + 73.97) < 1e-9);
}

// ---------------------------------------------------------------------------
// (7) consumer gates
// ---------------------------------------------------------------------------
{
  const flight = { cfg: resolveAircraft('fighter').cfg };
  const base = { hex: 'abc123', fix1: { vE: 80, vN: 0, vUp: 0 }, flags: 0, opacity: 1, stale: 0, distM: 200, rx: 0, ryd: 1000, rz: -200, yaw: 0, meta: { flight: 'REAL123', t: 'C172' } };
  const pilot = { ...base, hex: 'p:4c', remote: true, mpFlags: 0, meta: remoteMeta('p:4c', 'HERON 27', 0, 0) };
  check('(7) encounters: liveCandidate(ADS-B) is a candidate (precondition)', liveCandidate(base, flight) != null);
  check('(7) encounters: liveCandidate(remote) === null', liveCandidate(pilot, flight) === null);
}
{
  // A fly-by: 50 m abeam at 200 m/s closing, sampled at 20 Hz.
  const flyBy = (hex, remote) => {
    const det = createNearMissDetector();
    const it = { hex, distM: 0, meta: { flight: 'FLYBY' }, ...(remote ? { remote: true } : {}) };
    let fires = 0;
    for (let i = 0; i <= 160; i++) {
      it.distM = Math.hypot(-800 + 200 * i * 0.05, 50);
      fires += det.step([it], 0.05, 100 + i * 0.05).length;
    }
    return { fires, tracked: det.tracked };
  };
  const real = flyBy('abc123', false);
  const remote = flyBy('p:5d', true);
  check('(7) near-miss: an ADS-B fly-by fires (precondition)', real.fires === 1, `${real.fires} fire(s)`);
  check('(7) near-miss: a remote fly-by never fires and is never tracked', remote.fires === 0 && remote.tracked === 0);
}
{
  useFlyStore.setState({ runtimeReady: true, soundOn: false });
  const tr = (hex, over) => ({ hex, stale: 2, rx: 0, ry: 1000, ryd: 1000, rz: -3000, distM: 3000, fix1: { vE: 0, vN: 0, vUp: 0 }, meta: { flight: 'X' }, ...over });
  const rt = (t) => {
    let intercepts = 0;
    return {
      traffic: { tracks: new Map([[t.hex, t]]) },
      operations: { grounded: false, phase: 'airborne' },
      interceptHex: () => (intercepts++, true),
      get intercepts() {
        return intercepts;
      },
    };
  };
  const held = tr('p:6e', { remote: true, mpFlags: F.HELD });
  const busy = tr('p:6e', { remote: true, mpFlags: F.ASSISTED, stale: 0 });
  const both = tr('p:6e', { remote: true, mpFlags: F.HELD | F.ASSISTED });
  const quiet = tr('p:6e', { remote: true, mpFlags: F.SMOKE }); // stale 2, nothing to say
  const live = tr('p:6e', { remote: true, mpFlags: F.BOOST, stale: 0 });
  const adsb = tr('abc123', { mpFlags: F.HELD }); // even a stray field never makes it a pilot
  check('(7) escort: a HELD pilot is "paused" (before frozen)', escortBlocker(rt(held), 'p:6e') === 'paused');
  check('(7) escort: an ASSISTED pilot is "busy"', escortBlocker(rt(busy), 'p:6e') === 'busy');
  check('(7) escort: HELD wins over ASSISTED', escortBlocker(rt(both), 'p:6e') === 'paused');
  check('(7) escort: a quiet stale pilot is still "frozen"', escortBlocker(rt(quiet), 'p:6e') === 'frozen');
  check('(7) escort: a live pilot can be escorted', escortBlocker(rt(live), 'p:6e') === null && remoteEscortBlocker(rt(live), 'p:6e') === null);
  check('(7) escort: remoteEscortBlocker(ADS-B) === null; ADS-B keeps "frozen"', remoteEscortBlocker(rt(adsb), 'abc123') === null && escortBlocker(rt(adsb), 'abc123') === 'frozen');
  check('(7) escort: remoteEscortBlocker of a missing track === null', remoteEscortBlocker(rt(adsb), 'p:gone') === null);
  const r = rt(held);
  const res = startEscort(r, 'p:6e');
  check('(7) escort: startEscort explains a paused pilot and never intercepts', res.ok === false && res.reason === 'paused' && res.message === ESCORT_MESSAGES.paused && r.intercepts === 0 && r.escort === undefined);
  check('(7) escort: the new messages are player words', ESCORT_MESSAGES.paused === 'That pilot is paused.' && ESCORT_MESSAGES.busy === 'That pilot is following someone.');
}
{
  // The pre-extraction expression, verbatim (encounter-runtime.js before MULTIPLAYER).
  const OLD = (runtime, state) => {
    const adventure = runtime.adventures?.controller.progress.active;
    return state.screen !== 'flight' || state.flightMode !== 'free' || ['flying', 'finish'].includes(adventure?.status);
  };
  const base = useFlyStore.getState();
  let rows = 0;
  let bad = 0;
  let ctxBad = 0;
  for (const screen of ['flight', 'title', 'hangar']) {
    for (const flightMode of ['free', 'ops', 'adventure', undefined]) {
      for (const status of [null, undefined, 'flying', 'finish', 'paused', 'briefing']) {
        const runtime = status === null ? { flight: null } : { flight: null, adventures: { controller: { progress: { active: status === undefined ? undefined : { status } } } } };
        const state = { ...base, screen, flightMode };
        rows++;
        if (freeFlightExclusive(runtime, state) !== OLD(runtime, state)) bad++;
        if (encounterContext(runtime, state).exclusive !== OLD(runtime, state)) ctxBad++;
      }
    }
  }
  check('(7) freeFlightExclusive ≡ the old inline expression', bad === 0, `${rows} states`);
  check('(7) encounterContext().exclusive still reads the same predicate', ctxBad === 0);
}
{
  const cases = [['p:1z', true], ['p:', true], ['abc123', false], ['~a1b2c3', false], ['P:1Z', false], [null, false], [undefined, false], [42, false]];
  const wrong = cases.filter(([v, want]) => isRemote(v) !== want);
  check('(7) isRemote: p:* only', wrong.length === 0, wrong.map(([v]) => String(v)).join(', '));
}

// ---------------------------------------------------------------------------
// (8) flag off ⇒ no remote fleet
// ---------------------------------------------------------------------------
{
  check('(8) mpAvailable() is false with the shipped constants', mpAvailable() === false);
  const src = readFileSync(path.join(ROOT, 'components/fly/TrafficLayer.jsx'), 'utf8');
  check(
    '(8) TrafficLayer builds and mounts its remote fleet only behind REMOTE_FLEET = mpAvailable()',
    /const REMOTE_FLEET = mpAvailable\(\);/.test(src) &&
      /\{REMOTE_FLEET && <group ref=\{remoteMount\} \/>\}/.test(src) &&
      /REMOTE_FLEET\s*\?\s*\{ meshes:/.test(src),
  );
  check('(8) archetype and remote hulls share one material recipe', (src.match(/hullMaterial\(/g) || []).length === 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * ONE REVEAL (FLY_HORIZON_FILL.md "Second round", stream L) gate.
 *
 * Pure logic under a fake runtime and a fake clock; no GPU, no network.
 *   A  the reveal area (cone + radius) and tile rectangles;
 *   B  the readiness terms: ready, and each term missing on its own, with
 *      what lies outside the area ignored;
 *   C  the hold policy: final release, release at the cap when nothing
 *      advances, a progress-extended hold, the hard ceiling, never hanging
 *      with a dead provider or no cap;
 *   D  with the gate off, bootDecision / warpDecision equal the HEAD
 *      expressions over a grid of inputs, and the screens call them;
 *   E  born final: roof answer arrives, unavailable, timeout, near field;
 *      group photo ready / failed / loading / timeout / no slot / near field;
 *      the reveal photo lane;
 *   F  the carpet hold: held blocks inside the mapped reach, nothing hidden
 *      that was drawn, release on census and on timeout, bounded rebuilds,
 *      and with the hold off the request stream equals HEAD's carpet engine;
 *   G  FillCoverage's new methods next to the existing four;
 *   H  the after-reveal counters and the terrain promotion counter.
 * Prints PASS / FAIL lines; exits non-zero on any failure.
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

register('./_node-resolve.mjs', import.meta.url);

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const ROOT = path.resolve(import.meta.dirname, '..');
globalThis.window = { location: { search: '?flags=HORIZON_FILL,ONE_REVEAL' }, __flyWorldPassTierOverride: true };
const { installUrlFlags } = await import('../lib/fly/fly-pins.js');
installUrlFlags();
const OR = await import('../lib/fly/one-reveal.js');
const ST = await import('../lib/fly/one-reveal-state.js');
const GT = await import('../lib/fly/one-reveal-gate.js');
const BN = await import('../lib/fly/one-reveal-born.js');
const { FillCoverage } = await import('../lib/fly/horizon-fill/coverage.js');
const { createCriticalTerrainGate } = await import('../lib/fly/critical-terrain-prewarm.mjs');
const { ONE_REVEAL } = await import('../lib/fly/fly-constants.js');

check('pins: ?flags=ONE_REVEAL turns the reader and its three switches on', OR.ONE_REVEAL_ON && OR.oneRevealOn('gate') && OR.oneRevealOn('bornFinal') && OR.oneRevealOn('carpetHold'));
check('shipped: the block ships enabled:false', ONE_REVEAL.enabled === false);
const CFG = OR.ONE_REVEAL_ACTIVE;
check('config: area, hold, born and carpet numbers are present and sane',
  CFG.revealArea.groundM > CFG.revealArea.radiusM && CFG.revealHold.ceilingMs.boot > 20000 && CFG.revealHold.ceilingMs.warp > 15000 &&
  CFG.revealHold.stallMs > 0 && CFG.bornWait.roofSec > 0 && CFG.bornWait.photoSec > 0 && CFG.bornWait.nearFieldM > 0 &&
  CFG.carpetWait.timeoutSec > 0 && CFG.carpetWait.minRebuildSec > 0 && CFG.afterWindowMs > 0);

// --- A: the area ---------------------------------------------------------------
const WORLD = 40075016.68557849;
const flight = { pos: { x: 0, y: 900, z: 0 }, heading: 0 }; // heading 0: view axis (0, -1) = north
const area = ST.revealArea(flight);
check('A area: k = 1 on the equator, ranges in world units', Math.abs(area.k - 1) < 1e-9 && area.groundW === CFG.revealArea.groundM && area.radiusW === CFG.revealArea.radiusM);
check('A area: ahead inside the ground range is in', ST.inRevealArea(area, 0, -5000, 10));
check('A area: ahead beyond the ground range is out', !ST.inRevealArea(area, 0, -9000, 10));
check('A area: behind, outside the radius, is out', !ST.inRevealArea(area, 0, 3000, 10));
check('A area: behind, inside the radius, is in', ST.inRevealArea(area, 0, 1000, 10));
check('A area: beside at 70 deg, outside the radius, is out', !ST.inRevealArea(area, 4000 * Math.sin(1.22), -4000 * Math.cos(1.22), 10));
check('A area: a large square straddling the axis is in', ST.inRevealArea(area, 3000, -4000, 3500));
check('A area: no heading means all round', ST.inRevealArea(ST.revealArea({ pos: { x: 0, z: 0 } }), 0, 5000, 0));
check('A area: no position, no area', ST.revealArea({}) === null && !ST.inRevealArea(null, 0, 0));
const r14 = ST.keyRect('14/8192/8191');
check('A keyRect: z14 tile just north of the origin', Math.abs(r14.cx - WORLD / 2 ** 15) < 1e-6 && r14.cz < 0 && Math.abs(r14.half - WORLD / 2 ** 15) < 1e-6);

// --- B: the terms ---------------------------------------------------------------
const span14 = WORLD / 2 ** 14;
const tileKey = (x, z) => `14/${Math.floor((x + WORLD / 2) / span14)}/${Math.floor((z + WORLD / 2) / span14)}`;
function fakeRuntime() {
  const pending = new Set();
  const be = { chunks: new Map([[tileKey(0, -2000), { state: 'ready' }], [tileKey(0, -4000), { state: 'draping' }], [tileKey(0, 8000), { state: 'ready' }]]) };
  const atlas = { zoom: 11, span: 8, x0: 1020, slots: new Map(), born: new Float32Array(64) };
  const zx = 1024, zy = 1023; // the z11 tile just north of the origin
  atlas.slots.set(`${zx % 8},${zy % 8}`, { x: zx, y: zy, state: 'ok' });
  atlas.slots.set(`${(zx + 6) % 8},${zy % 8}`, { x: zx + 6, y: zy, state: 'pending' }); // 117 km east: outside
  atlas.born[(zy % 8) * 8 + (zx % 8)] = -100;
  const g = 4;
  const gspan = span14 * g;
  const gx = Math.floor((0 + WORLD / 2) / gspan), gy = Math.floor((-4000 + WORLD / 2) / gspan);
  const photoStatus = new Map();
  const se = {
    _photos: { status: (k) => photoStatus.get(k) ?? 'none' }, _atlas: { available: () => true }, _horizon: { groupN: g }, _photoRamps: new Map(),
    chunks: new Map([['g1', { state: 'ready', group: { z: 14, gx, gy }, standIns: { slot: 3 } }], ['g2', { state: 'ready', group: { z: 14, gx: gx + 40, gy }, standIns: { slot: -1 } }]]),
  };
  const rt = { criticalTerrain: { required: true, status: 'ready' }, satBuildings: be, satSkyline: se, horizonFill: { _births: [] } };
  let births = 0;
  const deps = { roofPending: (e, k) => pending.has(k), birthsRunning: () => births, colorRef: () => atlas, photoStatus: (e, k) => e._photos.status(k) };
  return { rt, deps, pending, atlas, se, photoStatus, setBirths: (n) => { births = n; } };
}
const T = (f, nowSec = 1000) => GT.revealTerms(f.rt, area, f.deps, { nowMs: nowSec * 1000, nowSec });
{
  const f = fakeRuntime();
  const t = T(f);
  check('B ready: every term ready on a settled fake', GT.missingTerms(t).length === 0 && !t.advancing, JSON.stringify(GT.missingTerms(t)));
  check('B counts: the far tile, the far group and the far colour slot are outside the area', t.roofs.total === 2 && t.farPhotos.total === 1 && t.colorRef.total === 1, `${t.roofs.total}/${t.farPhotos.total}/${t.colorRef.total}`);
}
{
  const f = fakeRuntime();
  f.rt.criticalTerrain.status = 'compiling';
  const t = T(f);
  check('B terrain: a link in flight holds and counts as advancing', GT.missingTerms(t).join() === 'terrain' && t.advancing);
  f.rt.criticalTerrain.status = 'bypassed';
  check('B terrain: a bypassed (preview) program still holds, without advancing', GT.missingTerms(T(f)).join() === 'terrain' && !T(f).advancing);
  f.rt.criticalTerrain.required = false;
  check('B terrain: not required (no parallel compile) is ready', GT.missingTerms(T(f)).length === 0);
}
{
  const f = fakeRuntime();
  f.pending.add(tileKey(0, -4000));
  check('B roofs: a draping tile waiting for its roof answer holds', GT.missingTerms(T(f)).join() === 'roofs');
  f.pending.clear();
  f.pending.add(tileKey(0, 8000));
  check('B roofs: the same wait behind the camera, outside the area, does not', GT.missingTerms(T(f)).length === 0);
}
{
  const f = fakeRuntime();
  const [k] = [...f.atlas.slots.keys()];
  f.atlas.slots.get(k).state = 'pending';
  check('B colorRef: a pending slot over the area holds', GT.missingTerms(T(f)).join() === 'colorRef');
  f.atlas.slots.get(k).state = 'ok';
  f.atlas.born[(1023 % 8) * 8 + (1024 % 8)] = 999.5;
  check('B colorRef: a slot still fading in (0.5 s of 1.2) holds', GT.missingTerms(T(f)).join() === 'colorRef');
  check('B colorRef: the same slot 1.2 s on is ready', GT.missingTerms(T(f, 1000.8)).length === 0);
  f.atlas.slots.get(k).state = 'miss';
  check('B colorRef: a missing slot is resolved', GT.missingTerms(T(f)).length === 0);
}
{
  const f = fakeRuntime();
  f.se._photoRamps.set(3, 0);
  check('B farPhotos: a photo still ramping in holds', GT.missingTerms(T(f)).join() === 'farPhotos');
  f.se._photoRamps.clear();
  const g1 = f.se.chunks.get('g1');
  g1.standIns.slot = -1;
  f.photoStatus.set('g1', 'loading');
  check('B farPhotos: a drawn group whose photo is loading holds', GT.missingTerms(T(f)).join() === 'farPhotos');
  f.photoStatus.set('g1', 'failed');
  check('B farPhotos: a failed photo is resolved', GT.missingTerms(T(f)).length === 0);
  f.photoStatus.set('g1', 'none');
  f.se._atlas.available = () => false;
  check('B farPhotos: no atlas slot to hold it is resolved', GT.missingTerms(T(f)).length === 0);
  f.se._atlas.available = () => true;
  g1.state = 'draping';
  check('B farPhotos: a group in the area still streaming holds', GT.missingTerms(T(f)).join() === 'farPhotos');
}
{
  const f = fakeRuntime();
  f.setBirths(2);
  const t = T(f);
  check('B births: a running soft birth holds and advances', GT.missingTerms(t).join() === 'births' && t.advancing);
  f.setBirths(0);
  f.rt.horizonFill._births.push({ chunk: { cx: 30000, cz: 0, span: 4000 } });
  check('B births: a carpet birth outside the area does not hold', GT.missingTerms(T(f)).length === 0);
  f.rt.horizonFill._births.push({ chunk: { cx: 0, cz: -3000, span: 4000 } });
  check('B births: a carpet birth in the area holds', GT.missingTerms(T(f)).join() === 'births');
}
{
  const t = GT.revealTerms({}, area, {}, { nowMs: 0, nowSec: 0 });
  check('B dead providers: an empty runtime and no deps resolve (only terrain is read, and not required)', GT.missingTerms(t).length === 0);
  const t2 = GT.revealTerms(fakeRuntime().rt, null, fakeRuntime().deps, { nowMs: 0, nowSec: 0 });
  check('B no area: only the terrain term can hold', GT.missingTerms(t2).length === 0 && t2.roofs.total === 0);
}

// --- C: the policy ------------------------------------------------------------------
function simulate({ kind = 'boot', capMs = 20000, until = 90000, baseReadyAt = 0, finalAt = Infinity, advanceUntil = 0, advanceEvery = 1000, linkUntil = 0, cfg = CFG.revealHold }) {
  const clock = GT.makeHoldClock(kind, 0);
  for (let t = 0; t <= until; t += 150) {
    const sig = t < advanceUntil ? Math.floor(t / advanceEvery) : Math.floor(advanceUntil / advanceEvery);
    const s = GT.stepHold(clock, { nowMs: t, capMs, baseReady: t >= baseReadyAt, termsReady: t >= finalAt, sig, advancing: t < linkUntil, missing: t >= finalAt ? [] : ['roofs'], cfg });
    if (s.finalReady) return { t, reason: 'final', clock };
    if (s.release) return { t, reason: s.reason, clock };
  }
  return { t: Infinity, reason: 'hung', clock };
}
{
  const r = simulate({ finalAt: 6000 });
  check('C final: the final picture releases (the caller reveals)', r.reason === 'final' && r.t === 6000, `${r.reason} ${r.t}`);
  const s = simulate({});
  check('C cap: nothing advancing releases at the cap', s.reason === 'stall' && s.t >= 20000 && s.t < 20150, `${s.reason} ${s.t}`);
  const p = simulate({ advanceUntil: 27000 });
  check('C progress: advancing past the cap extends the hold, then releases stallMs after the last advance', p.reason === 'stall' && p.t >= 27000 + CFG.revealHold.stallMs - 1000 && p.t <= 27000 + CFG.revealHold.stallMs + 150, `${p.reason} ${p.t}`);
  check('C progress: the extension is recorded', p.clock.extendedMs > 5000, `${Math.round(p.clock.extendedMs)} ms`);
  const l = simulate({ linkUntil: 24000 });
  check('C progress: a terrain link in flight (the owner\'s 24 s cold link) extends the hold past the 20 s cap', l.reason === 'stall' && l.t >= 24000 && l.t < 24000 + CFG.revealHold.stallMs + 150, `${l.reason} ${l.t}`);
  const c = simulate({ advanceUntil: 1e9 });
  check('C ceiling: progress forever stops at the hard ceiling', c.reason === 'ceiling' && c.t >= CFG.revealHold.ceilingMs.boot && c.t < CFG.revealHold.ceilingMs.boot + 150, `${c.reason} ${c.t}`);
  const w = simulate({ kind: 'warp', capMs: 15000, advanceUntil: 1e9 });
  check('C ceiling: a warp stops at its own ceiling', w.reason === 'ceiling' && w.t >= CFG.revealHold.ceilingMs.warp && w.t < CFG.revealHold.ceilingMs.warp + 150, `${w.t}`);
  const u = simulate({ capMs: null });
  check('C uncapped (LOAD_GUARD off): never hangs, released at the latest at the ceiling', u.reason !== 'hung' && u.t <= CFG.revealHold.ceilingMs.boot + 150, `${u.reason} ${u.t}`);
  const h = simulate({ finalAt: 12000 });
  check('C held time: each missing term accumulates the time it held', Math.abs((h.clock.held.roofs ?? 0) - 12000) <= 150, `${h.clock.held.roofs}`);
  // A dead provider: the terms read a runtime whose roof answer never comes.
  const f = fakeRuntime();
  f.pending.add(tileKey(0, -2000));
  const clock = GT.makeHoldClock('boot', 0);
  let out = null;
  for (let t = 0; t <= 60000 && !out; t += 150) {
    const terms = T(f, t / 1000);
    const st = GT.stepHold(clock, { nowMs: t, capMs: 20000, baseReady: true, termsReady: GT.missingTerms(terms).length === 0, sig: GT.progressSig({ parts: { a: true } }, terms), advancing: terms.advancing, missing: GT.missingTerms(terms) });
    if (st.release) out = { t, reason: st.reason };
  }
  check('C dead provider: a roof answer that never comes cannot hold past the cap', out && out.t < 20150 && out.reason === 'stall', JSON.stringify(out));
  // Full boot decision loop, gate on: the reveal comes from the decision, not the clock alone.
  const clk = GT.makeHoldClock('boot', 0);
  let revealAt = null;
  for (let t = 0; t <= 60000 && revealAt == null; t += 150) {
    const termsReady = t >= 23000;
    const step = GT.stepHold(clk, { nowMs: t, capMs: 20000, baseReady: t >= 5000, termsReady, sig: Math.floor(Math.min(t, 23000) / 2000), missing: [] });
    const d = GT.bootDecision(true, { living: true, elapsedMs: t, capMs: 20000, spawn: true, frames: 10, minFrames: 2, contentReady: step.finalReady, worldDone: step.finalReady && t >= 24000, reduced: false, step });
    if (d.allDone) revealAt = { t, timedOut: d.timedOut };
  }
  check('C boot loop: terms advancing past the cap reveal on the final picture, not on the cap', revealAt && !revealAt.timedOut && revealAt.t === 24000, JSON.stringify(revealAt));
}

// --- D: flag-off parity -------------------------------------------------------------
// HEAD (caba420) BootScreen.jsx, transcribed:
//   bootCapped = bootCapMs != null && now - t0 >= bootCapMs && !!store.spawn && frames >= BOOT.minFrames && !content?.ready;
//   timedOut = living ? reducedEntry.current || bootCapped : now - t0 >= BOOT.maxBootMs;
//   allDone = timedOut || (living ? content.ready && worldDone && frames>=BOOT.minFrames && !!store.spawn : worldDone && modelsP === 1 && shadersP === 1 && !!store.spawn);
const headBoot = (i) => {
  const bootCapped = i.capMs != null && i.elapsedMs >= i.capMs && !!i.spawn && i.frames >= i.minFrames && !i.contentReady;
  const timedOut = i.living ? i.reduced || bootCapped : i.elapsedMs >= i.maxBootMs;
  const allDone = timedOut || (i.living ? i.contentReady && i.worldDone && i.frames >= i.minFrames && !!i.spawn : i.worldDone && i.modelsP === 1 && i.shadersP === 1 && !!i.spawn);
  return { allDone, timedOut };
};
// HEAD (caba420) WarpFlash.jsx, transcribed:
//   settled = readySince!==null && now-readySince>=600 && now-t0>=WARP.flashMs;
//   capped = !settled && capMs!=null && now-t0>=capMs;   release = settled || reducedEntry.current || capped
const headWarp = (i) => {
  const settled = i.readySinceMs !== null && i.nowMs - i.readySinceMs >= 600 && i.elapsedMs >= i.flashMs;
  const capped = !settled && i.capMs != null && i.elapsedMs >= i.capMs;
  return { release: settled || !!i.reduced || capped, settled, capped };
};
{
  let n = 0, bad = 0;
  const bools = [false, true];
  for (const living of bools) for (const capMs of [null, 20000]) for (const elapsedMs of [0, 5000, 19999, 20000, 46000]) for (const spawn of bools)
    for (const frames of [0, 2]) for (const contentReady of bools) for (const worldDone of bools) for (const reduced of bools) for (const modelsP of [0, 1]) for (const shadersP of [0.5, 1]) {
      const i = { living, capMs, elapsedMs, maxBootMs: 45000, spawn, frames, minFrames: 2, contentReady, worldDone, reduced, modelsP, shadersP, step: { release: true } };
      const a = GT.bootDecision(false, i), b = headBoot(i);
      n += 1;
      if (a.allDone !== b.allDone || a.timedOut !== b.timedOut) bad += 1;
    }
  check('D boot: gate off, bootDecision equals HEAD on every input of the grid', bad === 0, `${n} cases, ${bad} differ`);
  n = 0; bad = 0;
  for (const readySinceMs of [null, 0, 9000, 9500]) for (const nowMs of [500, 1000, 10000, 16000]) for (const capMs of [null, 15000]) for (const reduced of bools) {
    const i = { readySinceMs, nowMs, elapsedMs: nowMs, flashMs: 900, capMs, reduced, step: { release: true } };
    const a = GT.warpDecision(false, i), b = headWarp(i);
    n += 1;
    if (a.release !== b.release || a.settled !== b.settled || a.capped !== b.capped) bad += 1;
  }
  check('D warp: gate off, warpDecision equals HEAD on every input of the grid', bad === 0, `${n} cases, ${bad} differ`);
  const living = { living: true, capMs: 20000, elapsedMs: 25000, spawn: true, frames: 2, minFrames: 2, contentReady: false, worldDone: false, reduced: false };
  check('D boot: gate on, the cap alone does not release while the policy holds', !GT.bootDecision(true, { ...living, step: { release: false } }).allDone && GT.bootDecision(true, { ...living, step: { release: true } }).timedOut);
  const toy = [{ ...living, living: false, maxBootMs: 45000, elapsedMs: 46000 }, { ...living, living: false, maxBootMs: 45000, elapsedMs: 3000, worldDone: true, modelsP: 1, shadersP: 1 }, { ...living, living: false, maxBootMs: 45000, elapsedMs: 3000 }];
  check('D boot: gate on, a Neon (toy) boot keeps HEAD logic', toy.every((i) => { const a = GT.bootDecision(true, i), b = headBoot(i); return a.allDone === b.allDone && a.timedOut === b.timedOut; }));
  const bs = readFileSync(path.join(ROOT, 'components/fly/hud/BootScreen.jsx'), 'utf8');
  const wf = readFileSync(path.join(ROOT, 'components/fly/hud/WarpFlash.jsx'), 'utf8');
  check('D source: BootScreen decides through bootDecision(REVEAL_GATE, ...) and feeds the world hold from the final picture only with the gate', /bootDecision\(REVEAL_GATE,/.test(bs) && /worldSteady=REVEAL_GATE\?finalReady:content\.ready/.test(bs) && !/const bootCapped/.test(bs));
  check('D source: WarpFlash decides through warpDecision(REVEAL_GATE, ...) and its ready is content.ready with the gate off', /warpDecision\(REVEAL_GATE,/.test(wf) && /const ready=REVEAL_GATE\?revealStep\.finalReady:content\.ready/.test(wf));
}

// --- E: born final --------------------------------------------------------------------
{
  const key = tileKey(0, -5000);
  const engine = { _velPx: 0, _velPz: 0, _lookRoofJobs: new Map([[key, { delay: 0 }]]), chunks: new Map([[key, { state: 'draping' }]]) };
  const p = { key, result: { lookPatch: 7 } };
  check('E roof: a far tile waits for its first roof answer', BN.holdBuildingBirth(engine, p, 10, true) === true);
  engine._lookRoofJobs.delete(key);
  check('E roof: the answer arrives (job done) and it is born at once', BN.holdBuildingBirth(engine, p, 10.5, true) === false);
  const p2 = { key, result: { lookPatch: 8 } };
  engine._lookRoofJobs.set(key, { delay: 5000 });
  check('E roof: a photo known to be unavailable (a retrying, already-answered job) does not wait', BN.holdBuildingBirth(engine, p2, 11, true) === false);
  const p3 = { key, result: { lookPatch: 9 } };
  engine._lookRoofJobs.set(key, { delay: 0 });
  const waits = [10, 11, 11.99].map((t) => BN.holdBuildingBirth(engine, p3, t, true));
  check('E roof: the wait is bounded by bornWait.roofSec', waits.every(Boolean) && BN.holdBuildingBirth(engine, p3, 10 + CFG.bornWait.roofSec, true) === false && BN.holdBuildingBirth(engine, p3, 10, true) === false);
  const nearKey = tileKey(0, -200);
  const near = { _velPx: 0, _velPz: 0, _lookRoofJobs: new Map([[nearKey, { delay: 0 }]]), chunks: new Map() };
  check('E roof: a tile in the near field never waits', BN.holdBuildingBirth(near, { key: nearKey, result: { lookPatch: 1 } }, 0, true) === false);
  check('E roof: unknown player position is treated as near', BN.holdBuildingBirth({ ...engine, _velPx: undefined }, { key, result: { lookPatch: 1 } }, 0, true) === false);
  check('E roof: no late patch asked, no wait; switch off, no wait', BN.holdBuildingBirth(engine, { key, result: {} }, 0, true) === false && BN.holdBuildingBirth(engine, { key, result: { lookPatch: 2 } }, 0, false) === false);
}
{
  const g = 4, gspan = span14 * g;
  const group = { z: 14, gx: Math.floor(WORLD / 2 / gspan), gy: Math.floor((WORLD / 2 - 12000) / gspan) };
  const st = new Map();
  const mk = () => ({ _velPx: 0, _velPz: 0, _horizon: { groupN: g }, _photos: { status: (k) => st.get(k) ?? 'none' }, _atlas: { available: () => true } });
  const e = mk();
  st.set('a', 'loading');
  const pa = { key: 'a', group };
  check('E group: a far group whose photo is loading waits and is queued for its photo', BN.holdGroupBirth(e, pa, 0, true) === true && e._orWaiting?.has('a'));
  check('E group: bounded by bornWait.photoSec', BN.holdGroupBirth(e, pa, CFG.bornWait.photoSec - 0.01, true) === true && BN.holdGroupBirth(e, pa, CFG.bornWait.photoSec, true) === false && !e._orWaiting.has('a'));
  st.set('b', 'ready');
  check('E group: photo here, no wait', BN.holdGroupBirth(mk(), { key: 'b', group }, 0, true) === false);
  st.set('c', 'failed');
  check('E group: photo failed, no wait', BN.holdGroupBirth(mk(), { key: 'c', group }, 0, true) === false);
  const full = mk();
  full._atlas.available = () => false;
  check('E group: no free atlas slot, no wait', BN.holdGroupBirth(full, { key: 'd', group }, 0, true) === false);
  const nearGroup = { z: 14, gx: Math.floor(WORLD / 2 / gspan), gy: Math.floor(WORLD / 2 / gspan) };
  check('E group: a group touching the near field never waits', BN.holdGroupBirth(mk(), { key: 'e', group: nearGroup }, 0, true) === false);
  check('E group: preparation already started, or switch off: no wait', BN.holdGroupBirth(mk(), { key: 'f', group, standInPrep: {} }, 0, true) === false && BN.holdGroupBirth(mk(), { key: 'g', group }, 0, false) === false);
  // The photo lane.
  const asked = [];
  const lane = {
    _horizon: { groupN: g }, _photoArrived: [], _photoPatch: null, _photoWantT: -Infinity, _atlas: { available: () => true },
    _photos: { want: (list) => asked.push(list.map((w) => w.key)), get: () => null },
    chunks: new Map([['far', { group, standIns: { slot: -1 }, standInD: 9000 }], ['nearer', { group, standIns: { slot: -1 }, standInD: 5000 }], ['has', { group, standIns: { slot: 2 }, standInD: 1 }], ['w', { group, state: 'draping', standInD: 7000 }]]),
  };
  check('E lane: gate value true with nothing waiting leaves HEAD admission alone', BN.pumpRevealPhotos(lane, 1, true) === false && asked.length === 0);
  check('E lane: \'reveal\' asks every resident group without a photo, nearest first, and replaces HEAD admission', BN.pumpRevealPhotos(lane, 1, 'reveal') === true && asked[0].join() === 'nearer,far');
  lane._orWaiting = new Set(['w']);
  asked.length = 0;
  check('E lane: in flight, a waiting group is asked for at once and HEAD admission still runs', BN.pumpRevealPhotos(lane, 2, true) === false && asked[0].join() === 'w');
  lane.chunks.get('w').state = 'ready';
  BN.pumpRevealPhotos(lane, 3, true);
  check('E lane: a waiting group that left draping is dropped from the wait list', !lane._orWaiting.has('w'));
}

// --- F: the carpet hold ------------------------------------------------------------------
const hf = await import('../lib/fly/horizon-fill.js');
const G = await import('../lib/fly/horizon-fill/carpet-grid.js');
const { CarpetEngine, holdMask } = await import('../lib/fly/horizon-fill/carpet-engine.js');
const { resetWpFrameSlice } = await import('../lib/fly/toy-world/wp-frame-slice.js');
resetWpFrameSlice();
const BASE = JSON.parse(JSON.stringify(hf.horizonFillConfig()));
function fakeCoverage(reachM = 24000) {
  const cov = new FillCoverage();
  cov.reachOf = () => reachM;
  return cov;
}
function carpetRun(EngineClass, { hold, coverage, steps, holdCfg }) {
  const reqs = [];
  const api = {
    buildChunk(req) {
      reqs.push({ ...req, mask: req.mask ? req.mask.slice() : null });
      return Promise.resolve({ v: 1, key: `${req.level}/${req.tx}/${req.ty}/${req.qx}/${req.qy}`, tx: req.tx, ty: req.ty, level: req.level, qx: req.qx, qy: req.qy, maskEpoch: req.maskEpoch, status: 'empty', n: 0, cx: 0, cz: 0, span: G.S, maxH: 0 });
    },
    prefetch() {},
  };
  const opts = { api, config: BASE, tier: 'high', groundAt: () => ({ elev: 0, tileZ: 14 }), coverage: () => coverage, now: () => 0 };
  if (hold !== undefined) Object.assign(opts, { hold, holdCfg });
  const engine = new EngineClass(opts);
  return { engine, reqs, step: async (t, px, pz) => { engine.update(t, px, pz, 900, 0); await Promise.resolve(); await Promise.resolve(); } };
}
const visible = (mask) => {
  const v = new Uint8Array(128 * 128);
  for (let i = 0; i < v.length; i++) v[i] = mask && mask[i] ? 0 : 1;
  return v;
};
{
  check('F holdMask: block bits map to their 16 x 16 cells', (() => {
    const m = holdMask(`${1 << 9}:0`); // block 9 = (x 1, y 1)
    let n = 0;
    for (let i = 0; i < m.length; i++) if (m[i]) n += 1;
    return n === 256 && m[16 * 128 + 16] === 255 && m[32 * 128 + 32] === 0;
  })());
  const px = G.tileMinX(1100) + G.S / 2, pz = G.tileMinZ(800) + G.S / 2; // the player over the middle of z11 tile (1100, 800)
  const cov = fakeCoverage(24000);
  const run = carpetRun(CarpetEngine, { hold: true, coverage: cov, holdCfg: { reachM: 24000, timeoutSec: 15, minRebuildSec: 4 } });
  for (let s = 0; s < 3; s += 0.05) await run.step(s, px, pz); // drain the first wave, inside minRebuildSec
  const home = run.reqs.filter((r) => r.tx === 1100 && r.ty === 800);
  const anyHeld = home.length && home[0].mask && home[0].mask.some((v) => v === 255);
  check('F hold: with no census yet, the tile under the player is built with its in-reach blocks hidden', !!anyHeld, `${home.length} requests`);
  const farTile = run.reqs.find((r) => G.rectDist(px, pz, G.tileMinX(r.tx), G.tileMinZ(r.ty), G.S) / G.mercK(pz) > 25000);
  check('F hold: a tile wholly beyond the mapped reach draws at once (no held block)', !!farTile && !(farTile.mask && farTile.mask.some((v) => v === 255)), farTile ? `${farTile.tx}/${farTile.ty}` : 'none');
  check('F hold: the engine reports held blocks', run.engine.stats.heldBlocks > 0, `${run.engine.stats.heldBlocks}`);
  // Census arrives for every z14 tile of the home tile; mapped cells in a few.
  const cells = new Uint8Array(256);
  cells[0] = 3;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) cov.setTile(1100 * 8 + i, 800 * 8 + j, i === 3 && j === 3 ? cells : new Uint8Array(256));
  const before = run.reqs.length;
  await run.step(3.2, px, pz); // inside minRebuildSec of the first build: no rebuild yet
  const early = run.reqs.slice(before).filter((r) => r.tx === 1100 && r.ty === 800).length;
  for (let t = 3.5; t <= 12; t += 0.5) await run.step(t, px + t, pz);
  const after = run.reqs.slice(before).filter((r) => r.tx === 1100 && r.ty === 800 && r.level === home[0].level && r.qx === home[0].qx && r.qy === home[0].qy);
  check('F release: the census does not rebuild inside minRebuildSec of the first build', early === 0, `${early}`);
  check('F release: one rebuild when the census lands (bounded churn)', after.length === 1, `${after.length}`);
  const last = after.at(-1);
  const v0 = visible(home[0].mask), v1 = visible(last?.mask);
  let hidden = 0, shown = 0, mappedShown = 0;
  for (let i = 0; i < v0.length; i++) {
    if (v0[i] && !v1[i]) hidden += 1;
    if (!v0[i] && v1[i]) shown += 1;
  }
  const mappedIdx = (3 * 16) * 128 + 3 * 16; // block (3, 3), cell 0
  if (last?.mask && !last.mask[mappedIdx]) mappedShown = 1;
  check('F never rearranges: no cell drawn before the census is hidden after it', hidden === 0, `${hidden} hidden, ${shown} newly shown`);
  check('F mapped wins: the mapped cell stays empty after the release', !!last && mappedShown === 0);
  // Timeout: a tile with no census at all releases after timeoutSec.
  const cov2 = fakeCoverage(24000);
  const run2 = carpetRun(CarpetEngine, { hold: true, coverage: cov2, holdCfg: { reachM: 24000, timeoutSec: 15, minRebuildSec: 4 } });
  for (let s = 0; s < 3; s += 0.05) await run2.step(s, px, pz);
  const n0 = run2.reqs.length;
  for (let s = 3; s <= 40; s += 0.5) await run2.step(s, px, pz);
  const rel = run2.reqs.slice(n0).filter((r) => r.tx === 1100 && r.ty === 800);
  check('F timeout: unreported blocks are released after carpetWait.timeoutSec', run2.engine.stats.holdTimeouts > 0 && rel.length >= 1 && !(rel.at(-1).mask && rel.at(-1).mask.some((v) => v === 255)), `${run2.engine.stats.holdTimeouts} timeouts, ${rel.length} rebuilds`);
  // Hold off: the request stream equals HEAD's carpet engine.
  let HeadEngine = null;
  try {
    const src = execFileSync('git', ['show', 'HEAD:lib/fly/horizon-fill/carpet-engine.js'], { cwd: ROOT, encoding: 'utf8' });
    const dir = path.join(tmpdir(), `one-reveal-head-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    const fly = pathToFileURL(path.join(ROOT, 'lib/fly')).href;
    const file = path.join(dir, 'carpet-engine-head.mjs');
    writeFileSync(file, src.replace(/from '\.\.\//g, `from '${fly}/`).replace(/from '\.\//g, `from '${fly}/horizon-fill/`).replace(/from 'three'/g, `from '${import.meta.resolve('three')}'`));
    ({ CarpetEngine: HeadEngine } = await import(pathToFileURL(file).href));
  } catch (err) {
    console.log(`note: HEAD carpet engine unavailable (${err.message.split('\n')[0]})`);
  }
  if (HeadEngine) {
    const script = async (E, hold) => {
      const c = fakeCoverage(24000);
      const r = carpetRun(E, { hold, coverage: c });
      for (let s = 0; s < 30; s += 0.5) {
        if (s === 5) for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) c.setTile(1100 * 8 + i, 800 * 8 + j, j === 2 ? cells : new Uint8Array(256));
        await r.step(s, px + s * 200, pz);
      }
      return { reqs: r.reqs.map((q) => `${q.tx}/${q.ty}/${q.level}/${q.qx}/${q.qy}/${q.maskEpoch}/${q.mask ? Buffer.from(q.mask).toString('base64').length + ':' + q.mask.reduce((a, v, i) => (a + v * (i + 1)) % 1e9, 0) : '-'}`), stats: r.engine.stats };
    };
    const a = await script(CarpetEngine, false), b = await script(HeadEngine, undefined);
    check('F parity: hold off, the request stream equals HEAD\'s carpet engine on the same script', a.reqs.join('|') === b.reqs.join('|') && a.reqs.length > 0, `${a.reqs.length} vs ${b.reqs.length} requests`);
    check('F parity: hold off, the stats keys and counts equal HEAD\'s', JSON.stringify(a.stats) === JSON.stringify(b.stats));
  } else check('F parity: HEAD carpet engine loaded', false);
}

// --- G: FillCoverage ----------------------------------------------------------------------
{
  const c = new FillCoverage();
  const out = new Uint8Array(64);
  check('G knownBlocks: zero for an unknown tile', c.knownBlocks(3, 4, out) === 0 && out.every((v) => v === 0));
  const cells = new Uint8Array(256);
  cells[5] = 2;
  c.setTile(3 * 8 + 2, 4 * 8 + 5, cells);
  c.setTile(3 * 8 + 7, 4 * 8 + 0, new Uint8Array(256));
  check('G knownBlocks: two reports, at their bits', c.knownBlocks(3, 4, out) === 2 && out[5 * 8 + 2] === 1 && out[7] === 1 && out.reduce((a, v) => a + v, 0) === 2);
  check('G isKnown: true for a reported z14 tile, false otherwise', c.isKnown(3 * 8 + 2, 4 * 8 + 5) && !c.isKnown(3 * 8 + 1, 4 * 8 + 5));
  c.setTile(3 * 8 + 7, 4 * 8 + 0, null);
  check('G forget: a forgotten tile is no longer known', !c.isKnown(3 * 8 + 7, 4 * 8) && c.knownBlocks(3, 4, out) === 1);
  check('G existing four: epochOf, maskFor, knownFraction keep their meaning', c.epochOf(3, 4) > 0 && c.maskFor(3, 4)[(5 * 16) * 128 + 2 * 16 + 5] === 2 && c.knownFraction(3, 4) === 1 / 64 && c.epochOf(9, 9) === 0 && c.maskFor(9, 9) === null);
  check('G reachM: null until the skyline sets reachOf, then its value', c.reachM === null && ((c.reachOf = () => 16000), c.reachM === 16000));
}

// --- H: the instrument ----------------------------------------------------------------------
{
  ST.setRevealCovered(true);
  check('H covered: colour arrivals land instantly under the curtain with the gate on', ST.landInstantly() === true);
  ST.noteAfterReveal('roofFades', 0, -1000);
  check('H covered: nothing counts before the reveal', ST.oneRevealStats().after.roofFades === 0);
  const ts = { promoted: 4 };
  ST.noteReveal('boot', flight, ts, 1000);
  check('H reveal: the curtain is down', ST.revealCovered() === false && ST.landInstantly() === false);
  ST.noteAfterReveal('roofFades', 0, -1000, 0, 2000);
  ST.noteAfterReveal('photoFades', 0, 9000, 100, 2000); // behind and far: outside
  ST.noteAfterReveal('carpetRebuilds', 0, -3000, 10, 1000 + CFG.afterWindowMs + 1); // after the window
  ts.promoted = 7;
  const s = ST.oneRevealStats();
  check('H counters: in-area events count, outside ones are recorded apart, the window closes', s.after.roofFades === 1 && s.after.photoFades === 0 && s.outside === 1 && s.after.carpetRebuilds === 0, JSON.stringify(s.after));
  check('H counters: terrain promotions are the counter delta since the reveal', s.after.terrainPromotions === 3 && s.afterTotal === 4);
  ST.noteHold({ kind: 'boot', released: 'final' });
  check('H record: the hold record is published', ST.oneRevealStats().hold.released === 'final');
  globalThis.window.__flyStats = {};
  ST.publishOneReveal();
  check('H publish: window.__flyStats.oneReveal is a live getter', globalThis.window.__flyStats.oneReveal.after.roofFades === 1 && Object.getOwnPropertyDescriptor(globalThis.window.__flyStats, 'oneReveal').get != null);
  // The terrain gate counts the preview tiles it promotes after the reveal.
  let t = 0;
  const gate = createCriticalTerrainGate({ now: () => t });
  const mats = [1, 2, 3].map(() => ({ visible: true, addEventListener() {}, removeEventListener() {} }));
  for (const m of mats) gate.hold(m);
  gate.tick({ key: 'k', compile: () => Promise.resolve(), parallel: true, covered: true, style: 's' });
  await Promise.resolve();
  await Promise.resolve();
  t = 10;
  gate.tick({ key: 'k', compile: () => Promise.resolve(), parallel: true, covered: false, style: 's' });
  check('H terrain: promotions after the reveal are counted (state.promoted)', gate.state.promoted === 3 && gate.state.status === 'ready', `${gate.state.promoted} ${gate.state.status}`);
  const gate2 = createCriticalTerrainGate({ now: () => t });
  for (const m of mats) gate2.hold(m);
  gate2.tick({ key: 'k', compile: () => Promise.resolve(), parallel: true, covered: true, style: 's' });
  await Promise.resolve();
  await Promise.resolve();
  gate2.tick({ key: 'k', compile: () => Promise.resolve(), parallel: true, covered: true, style: 's' });
  check('H terrain: a link finished under the curtain promotes nothing late', gate2.state.promoted === 0 && gate2.state.status === 'ready');
}

// --- I: the owner's cold start, as a timeline model ------------------------------------
// FLY_HORIZON_FILL.md "What was measured": the lit terrain linked at about
// 24 s, roofs and the colour reference land late, 24 distant groups take their
// photos one at a time to 32.7 s. A MODEL of that run (event times, not a
// browser), fed to both arms' decisions: when each reveals, and how many of the
// in-area events land after its reveal. Not a measurement of the app.
{
  const BOOT_HOLD = 1000; // BOOT.worldHoldMs
  const photoTimes = Array.from({ length: 24 }, (_, i) => 24400 + Math.round((i * (32700 - 24400)) / 23));
  const ev = { link: 24000, roofs: [14000, 17500, 21000], colorRef: 18000, photos: photoTimes.slice(0, 6) }; // 6 of the 24 groups in the area
  const runArm = (gateOn) => {
    const clock = GT.makeHoldClock('boot', 0);
    let hold = null;
    for (let t = 0; t <= 60000; t += 150) {
      const baseReady = t >= ev.link; // readiness: shaders wait for the link; the rest is in by 12 s
      const doneRoofs = ev.roofs.filter((x) => x <= t).length, doneP = ev.photos.filter((x) => x <= t).length;
      const termsReady = t >= ev.link && doneRoofs === ev.roofs.length && t >= ev.colorRef && doneP === ev.photos.length;
      const step = GT.stepHold(clock, { nowMs: t, capMs: 20000, baseReady, termsReady, sig: doneRoofs + doneP + (t >= ev.colorRef) + (t >= 12000) + baseReady, advancing: t >= 12000 && t < ev.link, missing: [] });
      const ready = gateOn ? step.finalReady : baseReady;
      if (ready) hold ??= t; else hold = null;
      const d = GT.bootDecision(gateOn, { living: true, elapsedMs: t, capMs: 20000, spawn: true, frames: 10, minFrames: 2, contentReady: ready, worldDone: hold != null && t - hold >= BOOT_HOLD, reduced: false, step });
      if (d.allDone) {
        const after = [ev.link, ...ev.roofs, ev.colorRef, ...ev.photos].filter((x) => x > t).length;
        return { revealMs: t, timedOut: d.timedOut, after };
      }
    }
    return null;
  };
  const off = runArm(false), on = runArm(true);
  console.log(`model: owner's cold start  off: reveal ${off.revealMs} ms (cap ${off.timedOut}), ${off.after} in-area changes after it  |  on: reveal ${on.revealMs} ms (cap ${on.timedOut}), ${on.after} after it`);
  check('I model: gate off reveals at the 20 s cap with the terrain swap and the late colour still to come', off.revealMs >= 20000 && off.revealMs < 20200 && off.timedOut && off.after === 8, JSON.stringify(off));
  check('I model: gate on holds while the link and the photos advance, reveals on the final picture, nothing in the area after it', on && !on.timedOut && on.after === 0 && on.revealMs <= CFG.revealHold.ceilingMs.boot, JSON.stringify(on));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

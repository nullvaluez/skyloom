/**
 * FRAME LEAN, stream R (FLY_HORIZON_FILL.md, second round): the node gate for
 * the frame-loop mechanisms in lib/fly/frame-loop-lean.js. No GPU, no network.
 *
 *   node scripts/verify-frame-loop.mjs
 *
 * 1. Uniform dedupe: a skipped upload is exactly one that would not change
 *    the program's value. Proven against a model of GL uniform state (per
 *    location, persistent): after any sequence of uploads, with and without
 *    the dedupe, every location holds the same bits.
 * 2. Empty instanced meshes: only instanced meshes with count 0 are hidden,
 *    never one the owner hid, every one comes back on the refresh frame, and
 *    the lean off restores `visible` exactly.
 * 3. With FRAME_LEAN pinned off (`window.__flyFrameLeanOverride`), every
 *    mechanism is bypassed: the context is not wrapped and nothing is hidden
 *    (run in a child process, since the readers resolve once at import).
 *
 * Prints PASS / FAIL lines; exits 1 on any failure.
 */
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFF = process.env.FRAME_LOOP_GATE_ARM === 'off';

register('./_node-resolve.mjs', import.meta.url);
globalThis.window = OFF ? { location: { search: '' }, __flyFrameLeanOverride: { enabled: false } } : { location: { search: '' } };
const { installUrlFlags } = await import('../lib/fly/fly-pins.js');
installUrlFlags();
const lean = await import('../lib/fly/frame-loop-lean.js');
const { frameLeanOn } = await import('../lib/fly/frame-lean.js');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`PASS ${OFF ? '[off] ' : ''}${name}`);
  else {
    failures++;
    console.log(`FAIL ${OFF ? '[off] ' : ''}${name}${detail ? ` (${detail})` : ''}`);
  }
};

/* A fake WebGL2 context: records each call reaching the "driver" and keeps the
 * uniform state GL would keep (per location, the bits last uploaded). */
const UNIFORM_METHODS = Object.keys(lean.DEDUPE_METHODS);
function fakeContext() {
  const driver = { calls: 0, state: new Map(), log: [] };
  const ctx = { canvas: { addEventListener() {} } };
  for (const name of UNIFORM_METHODS) {
    const matrix = name.startsWith('uniformMatrix');
    ctx[name] = function (loc, a, b, c, d) {
      driver.calls++;
      const data = matrix ? b : a;
      const off = matrix ? c ?? 0 : b ?? 0;
      const len = matrix ? d ?? data.length - off : c ?? data.length - off;
      const kind = lean.DEDUPE_METHODS[name];
      const T = kind === 'i' ? Int32Array : kind === 'u' ? Uint32Array : Float32Array;
      const view = new T(len);
      for (let i = 0; i < len; i++) view[i] = data[off + i];
      // GL keeps the bits last uploaded to the location
      driver.state.set(loc, new Uint8Array(view.buffer.slice(0)));
      driver.log.push(name);
    };
  }
  return { ctx, driver };
}

/* A tiny deterministic random source. */
let seed = 0x9e3779b9;
const rnd = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296);

/* ----------------------------------------------------------------------- */
if (!OFF) {
  check('the loop lean resolves on at the shipped flag', frameLeanOn('loop') === true && lean.loopLeanLive() === true);

  // --- sameAndStore ---------------------------------------------------------
  {
    let [eq, c] = lean.sameAndStore(undefined, new Float32Array([1, 2, 3]), 'f');
    check('a first upload is never skipped', eq === false && c.length === 3 && c[2] === 3);
    [eq] = lean.sameAndStore(c, new Float32Array([1, 2, 3]), 'f');
    check('an equal upload is recognised', eq === true);
    [eq, c] = lean.sameAndStore(c, [1, 2, 4], 'f');
    check('a changed upload passes and is stored', eq === false && c[2] === 4);
    [eq] = lean.sameAndStore(new Float32Array([0]), new Float32Array([-0]), 'f');
    check('0 and -0 are different uploads (bitwise, not numeric)', eq === false);
    [eq] = lean.sameAndStore(new Float32Array([NaN]), new Float32Array([NaN]), 'f');
    check('an identical NaN is the same upload', eq === true);
    [eq] = lean.sameAndStore(new Float32Array([1, 2]), new Float32Array([1, 2, 3]), 'f');
    check('a length change passes', eq === false);
    [eq] = lean.sameAndStore(new Float32Array([0.1]), [0.1], 'f');
    check('a plain-array upload compares as the float32 GL receives', eq === true);
    [eq] = lean.sameAndStore(new Int32Array([3, 4]), new Int32Array([3, 4]), 'i');
    check('integer uploads compare exactly', eq === true);
  }

  // --- the allocation-free hot path agrees with sameAndStore ----------------
  {
    let seed = 0x9e3779b9;
    const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) >>> 0), seed / 4294967296);
    const specials = [0, -0, NaN, 1, -1, 0.1, 1e-40, Infinity];
    let agree = true;
    let skips = 0;
    for (const kind of ['f', 'm', 'i', 'u']) {
      const float = kind === 'f' || kind === 'm';
      const n = kind === 'm' ? 16 : 4;
      const make = () => {
        const v = float ? new Float32Array(n) : kind === 'i' ? new Int32Array(n) : new Uint32Array(n);
        for (let i = 0; i < n; i++) v[i] = float ? specials[Math.floor(rnd() * specials.length)] : Math.floor(rnd() * 3);
        return v;
      };
      let ref;
      const entry = lean.newDedupeEntry(kind, n);
      let first = true;
      for (let step = 0; step < 400; step++) {
        const data = rnd() < 0.5 && !first ? prev : make();
        var prev = data;
        const [eqRef, next] = lean.sameAndStore(ref, data, kind);
        ref = next;
        const eqHot = first ? (lean.sameBitsAndStore(entry, data, n, float), false) : lean.sameBitsAndStore(entry, data, n, float);
        first = false;
        if (eqRef !== eqHot) agree = false;
        if (eqHot) skips++;
      }
    }
    check('the hot path skips exactly the uploads sameAndStore would (floats bitwise, ints exact)', agree && skips > 100, `skips ${skips}`);
    const entry = lean.newDedupeEntry('f', 16);
    const data = new Float32Array(16).fill(0.25);
    lean.sameBitsAndStore(entry, data, 16, true);
    const before = process.memoryUsage().heapUsed;
    let same = 0;
    for (let i = 0; i < 200000; i++) if (lean.sameBitsAndStore(entry, data, 16, true)) same++;
    const grew = process.memoryUsage().heapUsed - before;
    check('200,000 repeated uploads through the hot path allocate nothing measurable', same === 200000 && grew < 1024 * 1024, `heap +${Math.round(grew / 1024)} KiB`);
  }

  // --- installUniformDedupe against the GL state model ----------------------
  {
    const direct = fakeContext();
    const deduped = fakeContext();
    const stats = lean.installUniformDedupe(deduped.ctx);
    check('the dedupe installs on the context instance', !!stats && deduped.ctx.__flyUniformDedupe === stats);
    check('installing twice returns the same wrapper', lean.installUniformDedupe(deduped.ctx) === stats);
    const locs = Array.from({ length: 12 }, (_, i) => ({ id: i }));
    const values = [new Float32Array(16).fill(1), new Float32Array(16).fill(2), new Float32Array(16), new Float32Array(16).fill(-0)];
    let toggles = 0;
    for (let step = 0; step < 6000; step++) {
      const loc = locs[Math.floor(rnd() * locs.length)];
      const name = ['uniform4fv', 'uniformMatrix4fv', 'uniform1fv', 'uniform4iv'][loc.id % 4];
      const kind = lean.DEDUPE_METHODS[name];
      const src = values[Math.floor(rnd() * values.length)];
      const data = kind === 'i' ? Int32Array.from(src.subarray(0, 4)) : name === 'uniform4fv' ? src.subarray(0, 4) : name === 'uniform1fv' ? src.subarray(0, 3) : src;
      const r = rnd();
      // sometimes a srcOffset upload, sometimes a flip of the live switch
      const offset = r < 0.03 ? 1 : undefined;
      if (r > 0.995) {
        lean.setLoopLeanLive(!lean.loopLeanLive());
        toggles++;
      }
      for (const t of [direct, deduped]) {
        if (name === 'uniformMatrix4fv') t.ctx[name](loc, false, data, offset);
        else t.ctx[name](loc, data, offset);
      }
    }
    lean.setLoopLeanLive(true);
    let same = direct.driver.state.size === deduped.driver.state.size;
    for (const [loc, bits] of direct.driver.state) {
      const other = deduped.driver.state.get(loc);
      if (!other || other.length !== bits.length || other.some((b, i) => b !== bits[i])) same = false;
    }
    check('every location holds the same bits with and without the dedupe (6000 random uploads)', same);
    check('the dedupe skipped uploads that changed nothing', deduped.driver.calls < direct.driver.calls,
      `${deduped.driver.calls} of ${direct.driver.calls} reached the driver`);
    check('the live switch was exercised during the sequence', toggles > 0, `${toggles} flips`);
    console.log(`  (uniform model: ${direct.driver.calls} uploads, ${deduped.driver.calls} reached the driver, ${stats.skipped} skipped, cache cleared ${stats.cleared} times)`);

    // flipping the lean off: everything passes; back on: the cache starts empty
    const f = fakeContext();
    lean.installUniformDedupe(f.ctx);
    const loc = { id: 'x' };
    const v = new Float32Array([1, 2, 3, 4]);
    f.ctx.uniform4fv(loc, v); f.ctx.uniform4fv(loc, v);
    check('a repeated equal upload is skipped', f.driver.calls === 1);
    lean.setLoopLeanLive(false);
    f.ctx.uniform4fv(loc, v); f.ctx.uniform4fv(loc, v);
    check('with the lean off every upload reaches the driver', f.driver.calls === 3);
    lean.setLoopLeanLive(true);
    f.ctx.uniform4fv(loc, v);
    check('turning the lean back on starts from an empty cache (the bypassed upload is never trusted)', f.driver.calls === 4);
    f.ctx.uniformMatrix4fv(loc, true, new Float32Array(16));
    f.ctx.uniformMatrix4fv(loc, true, new Float32Array(16));
    check('a transposed matrix upload is never deduped', f.driver.calls === 6);
  }

  // --- leanEmptyInstances ----------------------------------------------------
  {
    const mk = (count, visible = true) => ({ isInstancedMesh: true, count, visible, userData: {} });
    const a = mk(0), b = mk(3), c = mk(0, false), d = mk(0);
    const list = [a, b, c, d];
    const state = { frame: -1 };
    const cfg = { ...lean.loopLeanConfig(), refreshFrames: 4 };
    const seen = [];
    for (let i = 0; i < 8; i++) {
      lean.leanEmptyInstances(list, state, cfg);
      seen.push(list.map((m) => (m.visible ? 1 : 0)).join(''));
    }
    // frame 0 and 4 are refresh frames: our hidden meshes are submitted
    check('the refresh frame submits every empty mesh (frames 0 and 4)', seen[0] === '1101' && seen[4] === '1101', seen.join(' '));
    check('between refreshes exactly the count-0 meshes are hidden', seen[1] === '0100' && seen[3] === '0100' && seen[5] === '0100', seen.join(' '));
    check('a mesh the owner hid is never shown by the lean', list[2].visible === false && !c.userData.__leanHidden);
    a.count = 5;
    lean.leanEmptyInstances(list, state, cfg);
    check('a mesh shows the frame its count becomes non-zero', a.visible === true && a.userData.__leanHidden === false);
    lean.setLoopLeanLive(false);
    lean.leanEmptyInstances(list, state, cfg);
    check('with the lean off every mesh it hid is visible again, the owner-hidden one is not', list.map((m) => (m.visible ? 1 : 0)).join('') === '1101');
    lean.setLoopLeanLive(true);
    check('the per-frame helper allocates nothing it keeps', Object.keys(state).sort().join(',') === 'frame,hidden');
  }

  // --- the wiring in the components ------------------------------------------
  {
    const traffic = readFileSync(path.join(ROOT, 'components/fly/TrafficLayer.jsx'), 'utf8');
    const canvas = readFileSync(path.join(ROOT, 'components/fly/FlyCanvas.jsx'), 'utf8');
    check('TrafficLayer runs the empty-instance lean only under frameLeanOn("loop")',
      /const LEAN_LOOP = frameLeanOn\('loop'\);/.test(traffic) && /if \(LEAN_LOOP\) \{[\s\S]{0,600}leanEmptyInstances\(/.test(traffic));
    check('the live fleet joins only once its programs are compiled (detailed.stats.ready)', /if \(detailed\.stats\.ready\) for \(const child of detailed\.group\.children\)/.test(traffic));
    check('FlyCanvas installs the uniform dedupe on its context', /installUniformDedupe\(gl\.getContext\(\)\)/.test(canvas));
    // The dedupe must not sit inside another gate's onCreated wiring window:
    // verify-true-scale (14) needs installTrueScaleCamera(camera) within 1600
    // characters of the onCreated opener (the review found R's block had
    // pushed it to 1629). Mirror that regex here and keep the dedupe after it.
    const trueScaleAt = canvas.indexOf('installTrueScaleCamera(camera);');
    const dedupeAt = canvas.indexOf('installUniformDedupe(gl.getContext())');
    check('FlyCanvas keeps the true-scale wiring window (verify-true-scale 14) and installs the dedupe after it',
      /onCreated=\{\(\{ gl, camera \}\) => \{[\s\S]{0,1600}installTrueScaleCamera\(camera\);/.test(canvas) && trueScaleAt > 0 && dedupeAt > trueScaleAt,
      `trueScale@${trueScaleAt} dedupe@${dedupeAt}`);
  }

  // --- the off arm, in its own process ---------------------------------------
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, FRAME_LOOP_GATE_ARM: 'off' }, encoding: 'utf8' });
  process.stdout.write(child.stdout);
  if (child.status !== 0) {
    failures++;
    console.log(`FAIL the FRAME_LEAN-off arm (exit ${child.status})${child.stderr ? `\n${child.stderr}` : ''}`);
  }
} else {
  // ---- FRAME_LEAN pinned off: every mechanism is bypassed --------------------
  check('frameLeanOn("loop") is false with the pin', frameLeanOn('loop') === false && lean.loopLeanLive() === false);
  check('setLoopLeanLive(true) cannot turn it on', lean.setLoopLeanLive(true) === false && lean.loopLeanLive() === false);
  const f = fakeContext();
  const before = Object.fromEntries(UNIFORM_METHODS.map((n) => [n, f.ctx[n]]));
  const stats = lean.installUniformDedupe(f.ctx);
  check('the uniform dedupe is not installed', stats === null && f.ctx.__flyUniformDedupe === undefined && UNIFORM_METHODS.every((n) => f.ctx[n] === before[n]));
  const list = [{ isInstancedMesh: true, count: 0, visible: true, userData: {} }, { isInstancedMesh: true, count: 2, visible: true, userData: {} }];
  const state = { frame: -1 };
  for (let i = 0; i < 5; i++) lean.leanEmptyInstances(list, state);
  check('no empty instanced mesh is ever hidden', list.every((m) => m.visible === true && !m.userData.__leanHidden));
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
if (!OFF) console.log('\nverify-frame-loop: all checks passed');

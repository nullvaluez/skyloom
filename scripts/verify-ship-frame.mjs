/**
 * SHIP PASS FRAME — verify-ship-frame: the FRAME stream's node gate
 * (FLY_SHIP_PASS.md 5.1 "Gates"). No browser, no GPU: every check runs the
 * app's own modules (through scripts/_node-resolve.mjs) on synthetic inputs.
 *
 *   node scripts/verify-ship-frame.mjs
 *
 * Rows print PASS / FAIL; the last line is "N passed, M failed"; exit 1 on
 * any failure. Sections:
 *   FR-2  the production/dev split of checkShaderErrors
 *   FR-1  the program census (acquire, first use, after-reveal, link failure)
 *   FR-3  the prewarm-registry consumer (coverage, reachability, dedupe)
 *   FR-4  the layer and GPU-memory census
 *   FR-5  the 30 Hz hold (5 simulated minutes at rung 0) and the 30 Hz overload step
 *   FR-6  the one budget table and its consumers
 *   FR-7  the stall classifier
 *   FR-9  frame-rate modes, holds, the session summary
 *   FR-10 the benchmark decision table
 *   FR-11 the policy table (every class, W0 seed rows unchanged, no new raw class calls)
 *   FR-13 the dynamic near plane (flag-off and reversed-depth identity)
 *   flags flag-off identity of every FRAME seam
 * CRLF is normalized wherever a source file is read.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';

register('./_node-resolve.mjs', import.meta.url);

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 }).replace(/\r\n/g, '\n');
const mod = (rel) => import(path.join(ROOT, rel));

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    passed++;
    console.log(`PASS  ${name}${typeof detail === 'string' && detail ? `  — ${detail}` : ''}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}  — ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
function assert(ok, msg) {
  if (!ok) throw new Error(msg || 'assertion failed');
}
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg ?? 'not equal'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

/** The base of this branch (merge-base with main), or null outside a git checkout. */
let BASE = null;
try {
  BASE = git('merge-base', 'HEAD', 'main').trim();
} catch {
  BASE = null;
}
const atBase = (rel) => {
  if (!BASE) return null;
  try {
    return git('show', `${BASE}:${rel}`);
  } catch {
    return null;
  }
};

// ===========================================================================
// FR-2 — checkShaderErrors: false only in production, outside automation
// ===========================================================================
{
  const { shaderErrorsChecked, applyShaderErrorPolicy } = await mod('lib/fly/shader-ready.js');
  await check('FR-2 (a) the split: only flag on + production + not automated skips diagnostics', () => {
    const rows = [];
    for (const flagOn of [false, true])
      for (const production of [false, true])
        for (const automation of [false, true]) {
          const want = !(flagOn && production && !automation);
          const got = shaderErrorsChecked({ flagOn, production, automation });
          rows.push(`${+flagOn}${+production}${+automation}:${+got}`);
          assert(got === want, `flag ${flagOn} prod ${production} auto ${automation} → ${got}, want ${want}`);
        }
    return rows.join(' ');
  });
  await check('FR-2 (b) flag off / dev / harness never write the renderer field; production writes false', () => {
    for (const opts of [{ flagOn: false, production: true, automation: false }, { flagOn: true, production: false, automation: false }, { flagOn: true, production: true, automation: true }]) {
      const debug = { checkShaderErrors: true };
      const gl = { debug };
      applyShaderErrorPolicy(gl, opts);
      eq(Object.keys(debug), ['checkShaderErrors']);
      assert(debug.checkShaderErrors === true, `wrote ${debug.checkShaderErrors} for ${JSON.stringify(opts)}`);
    }
    const gl = { debug: { checkShaderErrors: true } };
    assert(applyShaderErrorPolicy(gl, { flagOn: true, production: true, automation: false }) === false && gl.debug.checkShaderErrors === false);
  });
  await check('FR-2 (c) FlyCanvas applies the policy first thing in onCreated (before any program exists)', () => {
    const src = read('components/fly/FlyCanvas.jsx');
    const at = src.indexOf('onCreated={({ gl, camera }) => {');
    const install = src.indexOf('installFrameRenderer(gl);', at);
    const first = src.indexOf('installContextResourceLifetime(gl.getContext())', at);
    assert(at > 0 && install > at && first > install, 'order: onCreated → installFrameRenderer → the rest');
    const hub = read('lib/fly/census.js');
    const body = hub.slice(hub.indexOf('export function installFrameRenderer'));
    const policy = body.indexOf('applyShaderErrorPolicy(gl)');
    const census = body.indexOf('installCensus(gl)');
    const lost = body.indexOf("track('client_error', { kind: 'context_lost' })");
    assert(policy > 0 && census > policy && lost > census, 'installFrameRenderer: policy → census → context-loss telemetry');
  });
}

// ===========================================================================
// FR-1 — the program census
// ===========================================================================
{
  const { hookProgramList, createCensusState, programKey, fnv1a } = await mod('lib/fly/program-census.js');
  let clock = 0;
  let since = -1;
  const fails = [];
  const state = createCensusState();
  const list = [];
  hookProgramList(list, state, { now: () => clock, sinceReveal: () => since, linkOk: (p) => p.ok, onLinkFail: (e) => fails.push(e.key) });
  const makeProgram = (name, ok = true, costMs = 5) => {
    const p = { type: 'MeshStandardMaterial', name, cacheKey: `key-${name}`, ok, calls: 0 };
    p.getUniforms = function () {
      clock += costMs;
      this.calls++;
      return 'u';
    };
    p.getAttributes = function () {
      return 'a';
    };
    return p;
  };
  await check('FR-1 (a) acquisition is seen at push; the first use is timed once and the originals restored', () => {
    const a = makeProgram('a', true, 7);
    const orig = a.getUniforms;
    list.push(a);
    assert(state.total === 1 && state.live === 1, `total ${state.total} live ${state.live}`);
    assert(a.getUniforms !== orig, 'getUniforms not wrapped');
    clock += 3;
    a.getUniforms();
    assert(a.getUniforms === orig, 'original not restored after the first use');
    a.getUniforms();
    assert(state.preReveal === 1 && state.afterRevealCount === 0, 'a pre-reveal first use');
    assert(state.events.length === 1 && state.events[0].ms === 7, `first-use ms ${state.events[0]?.ms}`);
  });
  await check('FR-1 (b) a program first used after the reveal is listed with key, ms, t and waitMs', () => {
    const b = makeProgram('b', true, 12);
    list.push(b);
    since = 4000;
    clock += 20;
    b.getAttributes(); // getAttributes is a first use too (three calls either first)
    b.getUniforms();
    eq(state.afterReveal.map((x) => [x.key, x.ms, x.t, x.waitMs]), [[programKey(b), 0, 4000, 20]]);
    assert(state.afterRevealCount === 1);
  });
  await check('FR-1 (c) a link failure counts and reports track(client_error, shader_link) once', () => {
    const c = makeProgram('c', false, 1);
    list.push(c);
    c.getUniforms();
    c.getUniforms();
    assert(state.linkFailures === 1 && fails.length === 1 && fails[0] === programKey(c), `failures ${state.linkFailures}`);
    const d = makeProgram('d', true, 1);
    d.diagnostics = { runnable: false }; // checkShaderErrors on: three's own verdict wins
    list.push(d);
    d.getUniforms();
    assert(state.linkFailures === 2);
  });
  await check('FR-1 (d) release (splice) keeps `live` honest; keys are short and stable', () => {
    list.splice(0, 1);
    assert(state.live === list.length, `live ${state.live} vs ${list.length}`);
    assert(/^MeshStandardMaterial:a#[0-9a-f]{8}$/.test(programKey({ type: 'MeshStandardMaterial', name: 'a', cacheKey: 'x' })));
    assert(fnv1a('abc') === fnv1a('abc') && fnv1a('abc') !== fnv1a('abd'));
  });
  await check('FR-1 (e) zero per-frame cost: nothing in the census runs from a frame loop', () => {
    const src = read('lib/fly/program-census.js');
    assert(!/useFrame|requestAnimationFrame|setInterval/.test(src), 'the program census must not poll');
  });
}

// ===========================================================================
// FR-4 — layers and GPU memory
// ===========================================================================
{
  const { layerOf, createLayerState, installLayerCensus, createMemoryState, installMemoryCensus, imageBytes } = await mod('lib/fly/render-census.js');
  await check('FR-4 (a) per-layer draws/triangles sum to the renderer totals; shadow and pass draws are booked apart', () => {
    const info = { render: { calls: 0, triangles: 0 } };
    const scene = { isScene: true, name: '' };
    const passScene = { isScene: true, name: 'bloom' };
    const grp = { type: 'Group', name: 'satBuildings', parent: scene };
    const meshA = { type: 'Mesh', name: '', parent: grp, material: { type: 'MeshStandardMaterial' } };
    const meshB = { type: 'Mesh', name: '', parent: { type: 'Group', name: '', parent: scene }, material: { type: 'MeshBasicMaterial' } };
    const gl = {
      info,
      renderBufferDirect(cam, sc, geo, mat, obj) {
        info.render.calls += 1;
        info.render.triangles += obj.tris ?? 10;
      },
    };
    const st = createLayerState();
    const ctl = installLayerCensus(gl, st, () => scene);
    for (let i = 0; i < 5; i++) gl.renderBufferDirect(null, scene, null, null, meshA);
    gl.renderBufferDirect(null, scene, null, null, meshB);
    gl.renderBufferDirect(null, null, null, null, meshA);
    gl.renderBufferDirect(null, passScene, null, null, { type: 'Mesh', material: { type: 'ShaderMaterial' } });
    ctl.tick(true);
    const rows = Object.fromEntries(st.rows.map((r) => [r.key, r.calls]));
    eq(rows, { satBuildings: 5, 'Group~MeshBasicMaterial': 1, 'shadow/satBuildings': 1, 'pass/bloom': 1 }, 'layers');
    assert(st.calls === info.render.calls && st.triangles === info.render.triangles, `sum ${st.calls}/${st.triangles} vs ${info.render.calls}/${info.render.triangles}`);
    assert(st.glCalls === info.render.calls, 'glCalls cross-check');
    assert(layerOf(meshA) === 'satBuildings');
    ctl.uninstall();
    return `${st.calls} draws in ${st.rows.length} layers, exact`;
  });
  await check('FR-4 (b) logical texture/renderbuffer bytes, RGBA16F audit, deletes', () => {
    let t = 0;
    const handles = [];
    const ctx = {};
    for (const n of ['activeTexture', 'bindTexture', 'deleteTexture', 'texStorage2D', 'texStorage3D', 'texImage2D', 'texImage3D', 'compressedTexImage2D', 'compressedTexImage3D', 'texSubImage2D', 'texSubImage3D', 'compressedTexSubImage2D', 'bufferData', 'bufferSubData', 'generateMipmap', 'bindRenderbuffer', 'renderbufferStorage', 'renderbufferStorageMultisample', 'deleteRenderbuffer'])
      ctx[n] = n === 'texSubImage2D' ? () => (t += 2) : () => {};
    const st = createMemoryState();
    installMemoryCensus(ctx, st, () => t);
    const TEX = 0x0de1;
    const a = { id: 'a' };
    const b = { id: 'b' };
    handles.push(a, b);
    ctx.activeTexture(0x84c0);
    ctx.bindTexture(TEX, a);
    ctx.texStorage2D(TEX, 1, 0x8058, 256, 256); // RGBA8
    ctx.bindTexture(TEX, b);
    ctx.texStorage2D(TEX, 1, 0x881a, 512, 512); // RGBA16F
    const rb = { id: 'rb' };
    ctx.bindRenderbuffer(0x8d41, rb);
    ctx.renderbufferStorageMultisample(0x8d41, 4, 0x881a, 100, 100);
    assert(st.textureBytes === 256 * 256 * 4 + 512 * 512 * 8, `texture bytes ${st.textureBytes}`);
    assert(st.renderbufferBytes === 100 * 100 * 8 * 4, `renderbuffer bytes ${st.renderbufferBytes}`);
    assert(st.rgba16f.count === 2 && st.rgba16f.bytes === 512 * 512 * 8 + 100 * 100 * 8 * 4, `rgba16f ${JSON.stringify(st.rgba16f)}`);
    ctx.deleteTexture(b);
    ctx.deleteRenderbuffer(rb);
    assert(st.textureBytes === 256 * 256 * 4 && st.rgba16f.count === 0 && st.rgba16f.bytes === 0 && st.renderbufferBytes === 0, 'after delete');
    assert(st.peakBytes >= 512 * 512 * 8, 'peak kept');
    ctx.bindTexture(TEX, a);
    ctx.texSubImage2D(TEX, 0, 0, 0, 1, 1, 0x1908, 0x1401, null);
    assert(st.uploadEvents.length === 1 && st.uploadEvents[0].ms === 2, 'a long upload lands in the ring');
    assert(imageBytes(0x83f1, null, null, 256, 256) === (256 / 4) * (256 / 4) * 8, 'DXT1 blocks');
    assert(imageBytes(0x1908, 0x1908, 0x1401, 10, 10) === 400, 'unsized RGBA/UNSIGNED_BYTE');
  });
}

// ===========================================================================
// FR-7 — the stall classifier
// ===========================================================================
{
  const { classifyInterval, tallyIntervals } = await mod('lib/fly/stall-classify.mjs');
  await check('FR-7 (a) each phase wins on its own evidence; nothing invented', () => {
    eq(classifyInterval({ dtMs: 300, programMs: 240 }).phase, 'program-link');
    eq(classifyInterval({ dtMs: 200, uploadMs: 120, programMs: 10 }).phase, 'tile-upload');
    eq(classifyInterval({ dtMs: 150, phases: ['finalize:sat-building'] }).phase, 'worker-finalize');
    eq(classifyInterval({ dtMs: 150, scripts: [{ invoker: 'Worker.onmessage', duration: 120 }] }).phase, 'worker-finalize');
    eq(classifyInterval({ dtMs: 180, heapDropMB: 40 }).phase, 'gc');
    eq(classifyInterval({ dtMs: 160, scripts: [{ invoker: 'MessagePort.onmessage', sourceURL: '/_next/static/chunks/react-dom.js', duration: 140 }] }).phase, 'react-commit');
    eq(classifyInterval({ dtMs: 400, programMs: 20 }).phase, 'unattributed');
  });
  await check('FR-7 (b) a tally counts every interval exactly once', () => {
    const t = tallyIntervals([{ dtMs: 300, programMs: 240 }, { dtMs: 150, uploadMs: 140 }, { dtMs: 500 }]);
    eq([t.count, t.byPhase['program-link'], t.byPhase['tile-upload'], t.byPhase.unattributed, t.worstMs], [3, 1, 1, 1, 500]);
  });
}

// ===========================================================================
// FR-5 — the 30 Hz hold and the 30 Hz overload step (the governor itself)
// ===========================================================================
{
  const { createGovernor, paceConfig } = await mod('lib/fly/perf-governor.js');
  const { PACE_ADAPT, PERF_GOVERNOR } = await mod('lib/fly/fly-constants.js');
  const paceOn = { ...PACE_ADAPT, enabled: true };
  const session = (pace, { allowLock } = {}) => {
    const events = [];
    const p = pace ? { ...pace, ...(allowLock !== undefined ? { allowLock: () => allowLock } : {}) } : null;
    const g = createGovernor({ dpr0: 1, tier0: 'high', pace: p, applyDpr: (v) => events.push(`dpr:${v}`), applyTier: (v) => events.push(`tier:${v}`), applyEffects: () => {} });
    let clock = 0;
    const run = (seconds, dtMs, workMs, opts = {}) => {
      const end = clock + seconds;
      while (clock < end) {
        clock += dtMs / 1000;
        g.tick(dtMs / 1000, clock, { bootPct: 100, workMs, ...opts });
      }
    };
    return { g, events, run };
  };
  await check('FR-5 (a) PACE_ADAPT adds 30, 48 and 50 to the refresh snap (PERF_GOVERNOR stays as shipped)', () => {
    for (const hz of [30, 48, 50]) assert(PACE_ADAPT.refreshSnap.includes(hz), `missing ${hz}`);
    for (const hz of PERF_GOVERNOR.refreshSnap) assert(PACE_ADAPT.refreshSnap.includes(hz), `dropped ${hz}`);
    eq(PERF_GOVERNOR.refreshSnap, [60, 90, 120, 144], 'the pre-marker constant is untouched');
  });
  await check('FR-5 (b) a synthetic 30 Hz stream holds rung 0 for 5 simulated minutes (target 30, no step)', () => {
    const s = session(paceConfig(true, paceOn));
    s.run(300, 1000 / 30, 6);
    assert(s.g.refresh === 30 && s.g.targetFps === 30, `refresh ${s.g.refresh} target ${s.g.targetFps}`);
    assert(s.g.idx === 0 && s.events.length === 0, `stepped: ${s.events.join(',')}`);
    return `refresh ${s.g.refresh}, target ${s.g.targetFps}, rung ${s.g.idx}, ${s.g.sampled} samples`;
  });
  await check('FR-5 (c) control: the same stream with PACE_ADAPT off reads 30 Hz as overload and steps (PF-05)', () => {
    const s = session(null);
    s.run(300, 1000 / 30, 6);
    assert(s.events.length > 0 && s.g.idx > 0, 'the flag-off governor was expected to step');
    return s.events.join(',');
  });
  await check('FR-5 (d) a synthetic overload at 30 Hz still steps (frames at 45 ms on a 30 Hz page)', () => {
    const s = session(paceConfig(true, paceOn));
    s.run(10, 1000 / 30, 6);
    s.run(60, 45, 40);
    assert(s.events.length > 0 && s.g.idx > 0, `no step; target ${s.g.targetFps} ema ${s.g.emaFps}`);
    return s.events.join(',');
  });
  await check('FR-5 (e) a cap that starts mid-session locks to 30 on a touch device and holds; a GPU-bound 33 ms desktop still steps', () => {
    const touch = session(paceConfig(true, paceOn), { allowLock: true });
    touch.run(20, 1000 / 60, 4);
    assert(touch.g.refresh === 60 && touch.g.targetFps === 60, 'boot at 60');
    touch.run(240, 1000 / 30, 6);
    assert(touch.g.locked === 30 && touch.g.targetFps === 30 && touch.events.length === 0, `touch: lock ${touch.g.locked} target ${touch.g.targetFps} events ${touch.events}`);
    const desk = session(paceConfig(true, paceOn), { allowLock: false });
    desk.run(20, 1000 / 60, 4);
    desk.run(60, 1000 / 30, 6);
    assert(desk.g.locked == null && desk.events.length > 0, 'a desktop 33 ms cadence is not trusted as a cap');
    const busy = session(paceConfig(true, paceOn), { allowLock: true });
    busy.run(20, 1000 / 60, 4);
    busy.run(60, 1000 / 30, 30); // the frame's own work fills the interval: not a cap
    assert(busy.g.locked == null && busy.events.length > 0, 'a busy 33 ms frame is overload, not a cap');
  });
  await check('FR-5 (f) a locked page that gets slower still steps; the lock releases when the cap lifts', () => {
    const s = session(paceConfig(true, paceOn), { allowLock: true });
    s.run(20, 1000 / 60, 4);
    s.run(240, 1000 / 30, 6);
    assert(s.g.locked === 30);
    s.run(30, 48, 40);
    assert(s.events.length > 0, 'overload under the lock must step');
    s.run(60, 1000 / 60, 4);
    assert(s.g.locked == null, 'the lock should release at 60 Hz');
  });
  await check('FR-5 (g) holdGovernor freezes stepping both ways (pinned); release resumes', async () => {
    const { holdGovernor, governorHeld, governorHolds } = await mod('lib/fly/frame-api.js');
    const release = holdGovernor('photo');
    assert(governorHeld() && governorHolds().includes('photo'));
    const s = session(paceConfig(true, paceOn));
    s.run(10, 1000 / 60, 4);
    s.run(60, 60, 50, { pinned: governorHeld() });
    assert(s.events.length === 0, 'held governor stepped');
    release();
    release(); // idempotent
    assert(!governorHeld());
    s.run(10, 60, 50, { pinned: governorHeld() });
    assert(s.events.length > 0, 'released governor did not step');
    const src = read('lib/fly/perf-governor.js');
    assert(/window\.__flyGovPin === 'hold'\) \|\| governorHeld\(\)/.test(src), 'the React shell must OR the holds into `pinned`');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

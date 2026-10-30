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
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
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
  await check('FR-1 (d) release (three pops; splice too) keeps `live` honest; keys are short and stable', () => {
    list[0] = list[list.length - 1];
    list.pop(); // WebGLPrograms.releaseProgram
    assert(state.live === list.length, `live ${state.live} vs ${list.length}`);
    list.splice(0, 1);
    assert(state.live === list.length, `live ${state.live} vs ${list.length}`);
    assert(/^MeshStandardMaterial:a#[0-9a-f]{8}$/.test(programKey({ type: 'MeshStandardMaterial', name: 'a', cacheKey: 'x' })));
    assert(fnv1a('abc') === fnv1a('abc') && fnv1a('abc') !== fnv1a('abd'));
  });
  await check('FR-1 (e) zero per-frame cost: nothing in the program census runs from a frame loop; per-draw census only with ?diag=1 or automation', () => {
    const src = read('lib/fly/program-census.js');
    assert(!/useFrame|requestAnimationFrame|setInterval/.test(src), 'the program census must not poll');
    assert(/export function deepCensusWanted\(\) \{\n  return diagRequested\(\) \|\| automated\(\);/.test(src), 'deep census = diag or automation');
    const hub = read('lib/fly/census.js');
    assert(/if \(!deepCensusWanted\(\)\) return true;/.test(hub), 'memory/stall census gated');
    assert(/\{deepCensusWanted\(\) && <CensusRig \/>\}/.test(read('components/fly/FlyCanvas.jsx')), 'CensusRig gated');
  });
}

// ===========================================================================
// FR-3 — the prewarm-registry consumer
// ===========================================================================
{
  const reg = await mod('lib/fly/prewarm-registry.js');
  const rw = await mod('lib/fly/registry-warm.js');
  const { DEVICE_CLASSES } = await mod('lib/fly/device-policy.js');
  const streamEntries = reg.prewarmEntries(); // what the streams registered (their blocks), before the gate's own
  await check('FR-3 (a) registry coverage: every registered entry builds and is reachable somewhere', () => {
    const tiers = ['low', 'medium', 'high', 'ultra'];
    const bad = [];
    for (const e of streamEntries) {
      if (typeof e.build !== 'function') bad.push(`${e.key}: no build`);
      const anywhere = tiers.some((t) => DEVICE_CLASSES.some((d) => reg.entryReachable(e, { tier: t === 'ultra' ? 'high' : t, preset: t, device: d, flagOn: () => true })));
      if (!anywhere) bad.push(`${e.key}: reachable nowhere`);
    }
    assert(!bad.length, bad.join('; '));
    return `${streamEntries.length} entr${streamEntries.length === 1 ? 'y' : 'ies'} registered by the streams on this tree`;
  });
  // The gate's own entries (FRAME keys, this process only).
  const built = [];
  const mk = (key, when, opts = {}) =>
    reg.registerPrewarm({
      stream: 'FRAME',
      key: `FRAME:gate-${key}`,
      when,
      build: () => {
        built.push(key);
        if (opts.throws) throw new Error('boom');
        return { isObject3D: true, key, parent: null, removeFromParent() {}, dispatchEvent() {}, children: [], layers: { test: () => true } };
      },
    });
  mk('everywhere', {});
  mk('high-only', { tiers: ['high'] });
  mk('phone-only', { devices: ['phone'] });
  mk('flag-on', { flags: ['SHADER_READY'] });
  mk('broken', { tiers: ['low'] }, { throws: true });
  const gateEntries = reg.prewarmEntries().filter((e) => e.key.startsWith('FRAME:gate-'));
  const compiled = [];
  const fakeScene = (env) => ({ environment: env, fog: null });
  const compile = async (holder) => compiled.push(holder.children.map((c) => c.key).join(','));
  // three's Scene.add() wants Object3D instances: give the consumer a plain holder instead.
  await check('FR-3 (b) reachable-here only: tier, device and Ship Pass flags narrow; failures are counted, never thrown', async () => {
    const { Object3D } = await import('three');
    const realBuild = (key) => {
      const o = new Object3D();
      o.key = key;
      return o;
    };
    // Re-register with real Object3Ds (same keys: registerPrewarm replaces).
    for (const e of gateEntries) reg.registerPrewarm({ ...e, when: { ...e.when }, build: e.key.endsWith('broken') ? e.build : () => (built.push(e.key), realBuild(e.key.slice(11))) });
    const entries = reg.prewarmEntries().filter((e) => e.key.startsWith('FRAME:gate-'));
    const ctxHigh = rw.registryContext({ tier: 'high', preset: 'high', device: 'dgpu', flagOn: () => false });
    const n = await rw.warmRegistry({ gl: { shadowMap: { enabled: true } }, scene: fakeScene(null), ctx: ctxHigh, compile, entries });
    eq(compiled.sort(), ['everywhere', 'high-only'], 'dgpu/high/flags off');
    assert(n === 2, `warmed ${n}`);
    const ctxLow = rw.registryContext({ tier: 'low', preset: 'low', device: 'phone', flagOn: (f) => f === 'SHADER_READY' });
    compiled.length = 0;
    await rw.warmRegistry({ gl: { shadowMap: { enabled: true } }, scene: fakeScene(null), ctx: ctxLow, compile, entries });
    eq(compiled.sort(), ['everywhere', 'flag-on', 'phone-only'], 'phone/low/flag on (+ the broken one counted)');
    assert(rw.registryWarmState().failed === 1 && rw.registryWarmState().errors[0].includes('broken'), 'the throwing entry is counted');
  });
  await check('FR-3 (c) an entry warms once per compile signature; a new environment (day/night bucket) re-warms', async () => {
    const entries = reg.prewarmEntries().filter((e) => e.key.startsWith('FRAME:gate-') && !e.key.endsWith('broken'));
    const ctx = rw.registryContext({ tier: 'high', preset: 'high', device: 'dgpu', flagOn: () => false });
    compiled.length = 0;
    const gl = { shadowMap: { enabled: true } };
    await rw.warmRegistry({ gl, scene: fakeScene(null), ctx, compile, entries });
    assert(compiled.length === 0, `re-warmed under the same signature: ${compiled}`);
    await rw.warmRegistry({ gl, scene: fakeScene({ mapping: 306, image: { height: 2048 } }), ctx, compile, entries });
    eq(compiled.sort(), ['everywhere', 'high-only'], 'a new environment signature');
  });
  await check('FR-3 (d) an empty registry is a no-op; a lost context forgets every retained program', async () => {
    const n = await rw.warmRegistry({ gl: {}, scene: fakeScene(null), ctx: rw.registryContext({ tier: 'high', device: 'dgpu' }), compile, entries: [] });
    assert(n === 0);
    rw.resetRegistryWarm();
    assert(rw.registryWarmState().warmed === 0);
  });
  await check('FR-3 (f) ENV_UNIFORM is read through its pin (?flags=ENV_UNIFORM A/Bs it), the constant untouched', async () => {
    const { ENV_UNIFORM } = await mod('lib/fly/fly-constants.js');
    assert(ENV_UNIFORM.enabled === false, 'the shipped constant is not edited by FRAME');
    for (const f of ['lib/fly/prewarm.js', 'components/fly/PrewarmRig.jsx']) assert(/const ENV_UNIFORM = pinned\(ENV_UNIFORM_BLOCK, '__flyEnvUniformOverride'\);/.test(read(f)), f);
  });
  await check('FR-3 (g) ENV_UNIFORM ruling instrument: its equirect half cannot change anything (IMMERSIVE normalizes every PMREM input to the same width unconditionally)', async () => {
    // SatEnvironment.jsx (not FRAME's; read only): the resize condition is
    // `(ENV_UNIFORM.enabled || immersive)` and `immersive = immersiveOn('lighting')`,
    // which IMMERSIVE.features.lighting hard-wires true ("URL parameters and old
    // preview switches cannot disable it"); the target width is
    // IMMERSIVE.environmentSize (2048 = ENV_UNIFORM.equirectWidth) unless the
    // stylized earth's own width wins first. So ENV_UNIFORM.enabled is dead in
    // that file: what the flag still changes is prewarm.js's two idle-frame
    // halves (warmBothShadowStates, requeueForEnvironment).
    const env = read('components/fly/SatEnvironment.jsx');
    assert(/const immersive = immersiveOn\('lighting'\);/.test(env), 'immersive is the lighting feature');
    assert(/\(ENV_UNIFORM\.enabled \|\| immersive\) && !blending/.test(env), 'resize condition ORs the flag with immersive');
    assert(/stylizedEarthOn\(\) \? STYLIZED_EARTH\.environmentWidth : immersive \? IMMERSIVE\.environmentSize : ENV_UNIFORM\.enabled/.test(env), 'width: immersive wins before the flag');
    const { IMMERSIVE, immersiveOn } = await mod('lib/fly/immersive.js');
    const { ENV_UNIFORM } = await mod('lib/fly/fly-constants.js');
    assert(immersiveOn('lighting') === true && IMMERSIVE.features.lighting === true, 'IMMERSIVE lighting is always on');
    assert(IMMERSIVE.environmentSize === ENV_UNIFORM.equirectWidth, 'same width');
    const pre = read('lib/fly/prewarm.js');
    const live = (pre.match(/ENV_UNIFORM\.(enabled|warmBothShadowStates|requeueForEnvironment|idleFrameMs|idleBudget)/g) ?? []).length;
    assert(live >= 5, 'prewarm.js still reads the two idle halves');
    return `equirect half dead (immersive ${IMMERSIVE.environmentSize} px); the flag reaches ${live} reads in prewarm.js (shadow-twin warm + environment re-queue, both on frames <= ${ENV_UNIFORM.idleFrameMs} ms)`;
  });
  await check('FR-3 (e) wiring: boot tier rides the boot drain, the ladder queues after it, PrewarmRig rescans tier/env/late entries; flag-gated', () => {
    const src = read('lib/fly/prewarm.js');
    const run = src.slice(src.indexOf('export async function runPrewarm'));
    const boot = run.indexOf("queueRegistryWarm({ gl, camera, scene, tiers: [tier], reason: 'boot' })");
    const drainAt = run.indexOf('await drain(t0');
    const ladder = run.indexOf("reason: 'ladder'");
    assert(boot > 0 && drainAt > boot && ladder > drainAt, 'boot → drain → ladder');
    assert(/if \(!PREWARM\.enabled \|\| !shipPassOn\('SHADER_READY'\)/.test(src), 'queueRegistryWarm is flag-gated');
    const rig = read('components/fly/PrewarmRig.jsx');
    for (const r of ["run('tier'", "run('rescan')", "run('env')", "addEventListener('webglcontextrestored', lost)"]) assert(rig.includes(r), `PrewarmRig: ${r}`);
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

// ===========================================================================
// FR-6 — the one budget table
// ===========================================================================
{
  const tb = await mod('lib/fly/tier-budgets.js');
  const { CINEMA_PROFILES } = await mod('lib/fly/cinema-profile.js');
  await check('FR-6 (a) every consumer imports the one table (cinema-profile, device report, report gate, soak, soak analysis, this gate)', () => {
    const want = {
      'lib/fly/cinema-profile.js': /from '\.\/tier-budgets'/,
      'lib/fly/device-report.js': /from '\.\/tier-budgets'/,
      'scripts/verify-device-report.mjs': /import\('\.\.\/lib\/fly\/tier-budgets\.js'\)/,
      'scripts/beta-soak.cjs': /import\('\.\.\/lib\/fly\/tier-budgets\.js'\)/,
      'scripts/analyze-beta-soak.mjs': /from '\.\.\/lib\/fly\/tier-budgets\.js'/,
      'scripts/derive-budget-table.mjs': /import\('\.\.\/lib\/fly\/tier-budgets\.js'\)/,
    };
    const missing = Object.entries(want).filter(([f, re]) => !re.test(read(f))).map(([f]) => f);
    assert(!missing.length, `not reading the table: ${missing.join(', ')}`);
    const cinema = read('lib/fly/cinema-profile.js');
    assert(!/draws:\s*\d|triangles:\s*\d|textureBytes:\s*\d/.test(cinema), 'cinema-profile.js still carries a literal budget');
    const soak = read('scripts/beta-soak.cjs');
    assert(!/p95Draws:375|<=375|<=2200000/.test(soak), 'beta-soak.cjs still carries literal draw/triangle limits');
  });
  await check('FR-6 (b) cinema profiles carry exactly their table rows (verdict thresholds only)', () => {
    const MiB = 1048576;
    for (const [name, id] of [['ultra', 'ultra'], ['high', 'high'], ['medium', 'medium'], ['phone', 'phone'], ['low', 'low'], ['phoneLow', 'phone'], ['phoneLean', 'phone'], ['ultraBalanced', 'ultra'], ['highBalanced', 'high']]) {
      const p = CINEMA_PROFILES[name];
      const b = tb.BUDGET_TABLE[id];
      assert(p.draws === b.draws && p.triangles === b.triangles && p.textureBytes === b.textureMiB * MiB, `${name} vs ${id}`);
      assert(tb.budgetIdFor(p.name) === id, `budgetIdFor(${p.name}) = ${tb.budgetIdFor(p.name)}, want ${id}`);
    }
    assert(CINEMA_PROFILES.high.textureBytes === 300 * MiB, 'verify-cinema-overhaul\'s 300 MiB high texture budget');
  });
  await check('FR-6 (c) a synthetic 60 Hz report with no missed vblank grades as a pass; a 33.4 ms train fails', () => {
    const sixty = Array.from({ length: 600 }, (_, i) => (i % 2 ? 16.6 : 16.8));
    const base = { gpu: { class: 'high' }, quality: { preset: 'high' }, renderer: { trianglesPeak: 2e6, callsPeak: 360, textureBytes: 250 * 1048576 } };
    const ok = tb.gradeReport({ ...base, frame: { p95: 16.8, p99: 16.8, long100PerMin: 0, missed: tb.missedShare(sixty, 60) } });
    assert(ok.pass === true, JSON.stringify(ok.rows.filter((r) => r.pass !== true)));
    const bad = tb.gradeReport({ ...base, frame: { p95: 33.4, p99: 33.4, long100PerMin: 0, missed: tb.missedShare(sixty.map((v, i) => (i % 10 ? v : 33.4)), 60) } });
    assert(bad.pass === false && bad.rows[0].pass === false, 'a 10% miss share must fail');
    const old = tb.gradeReport({ ...base, frame: { p95: 16.8, long100PerMin: 0 } });
    assert(old.rows[0].pass === null && old.pass === false, 'a report without the share is unmeasured, never a pass');
  });
  await check('FR-6 (d) every row is provisional and cites its sources (no W0.6 report exists in this venue)', () => {
    for (const [id, b] of Object.entries(tb.BUDGET_TABLE)) assert(b.provisional === true && b.sources.length > 0, id);
    eq(tb.BUDGET_IDS, ['ultra', 'high', 'medium', 'phone', 'tablet', 'low']);
  });
  await check('FR-6 (e) derive-budget-table re-derives a row from a device report (peak + 5%), dry run', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const os = await import('node:os');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ship-frame-'));
    const f = path.join(dir, 'r.json');
    writeFileSync(f, JSON.stringify({ at: '2026-10-30', gpu: { class: 'high', renderer: 'RTX 5080 (synthetic)' }, quality: { preset: 'high' }, frame: { long100PerMin: 0.5 }, renderer: { callsPeak: 340, trianglesPeak: 1.9e6, textureBytes: 280 * 1048576 } }));
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/derive-budget-table.mjs'), f], { encoding: 'utf8' });
    assert(/high\s+MEASURED\s+draws 375 → 357, triangles 2200000 → 1995000, textureMiB 300 → 294/.test(out), out.split('\n').find((l) => l.startsWith('high')) ?? out.slice(0, 200));
    assert(/dry run/.test(out) && /ultra\s+provisional\s+unchanged/.test(out));
  });
}

// ===========================================================================
// FR-7 / FR-8 — the slice bar and the turn budget (PACE_ADAPT sub-switches)
// ===========================================================================
{
  const { sliceBarSec } = await mod('lib/fly/pace-adapt.js');
  const { PACE_ADAPT } = await mod('lib/fly/fly-constants.js');
  await check('FR-7 (c) the prewarm slice bar follows the target: today\'s 24 ms at 60, 48 ms at 30; off = 24 ms', () => {
    const cfg = PACE_ADAPT.sliceBar;
    assert(cfg.enabled === true, 'sliceBar ships on with PACE_ADAPT (its 60 Hz value is today\'s bar)');
    assert(Math.abs(sliceBarSec(0.024, 60, cfg) - 0.024) < 0.0005, `60: ${sliceBarSec(0.024, 60, cfg)}`);
    assert(Math.abs(sliceBarSec(0.024, 30, cfg) - 0.0483) < 0.0005, `30: ${sliceBarSec(0.024, 30, cfg)}`);
    assert(sliceBarSec(0.024, 30, null) === 0.024 && sliceBarSec(0.024, null, cfg) === 0.024, 'off / unknown target = today');
  });
  await check('FR-8 (a) the turn budget ships OFF; armed, a fast yaw scales the shared finalize allowance and a straight flight does not', async () => {
    assert(PACE_ADAPT.turn.enabled === false, 'turn sub-switch must ship off (5080/iPhone turn measurement decides)');
    const fp = await mod('lib/fly/finalize-pace.js');
    const tb = await mod('lib/fly/turn-budget.js');
    fp.resetFinalizePace();
    tb.resetTurnBudget();
    tb.noteHeading(0, 1 / 60);
    tb.noteHeading(0.05, 1 / 60); // 172 deg/s, but unarmed (the shipped state)
    assert(fp.turnBudgetK() === 1, 'unarmed: no turn scale');
    const armed = { ...PACE_ADAPT.turn, enabled: true };
    tb.noteHeading(0, 1 / 60, armed);
    assert(tb.noteHeading(0.05, 1 / 60, armed) === armed.budgetK && fp.turnBudgetK() === armed.budgetK, 'a 172 deg/s yaw scales the allowance');
    assert(tb.noteHeading(0.052, 1 / 60, armed) === 1 && fp.turnBudgetK() === 1, 'a 7 deg/s drift does not');
    tb.resetTurnBudget();
    assert(/config\(\)\.budgetMs \* budgetK\(\) \* turnK/.test(read('lib/fly/finalize-pace.js')), 'rule 2 multiplies the turn scale');
    const scene = read('components/fly/FlyScene.jsx');
    const block = scene.slice(scene.indexOf('// SHIP PASS FRAME frame begin'), scene.indexOf('// SHIP PASS FRAME frame end'));
    assert(block.includes('noteHeading(flight.heading, delta)'), 'FlyScene FRAME block feeds the yaw rate');
  });
}

// ===========================================================================
// FR-9 — frame-rate modes, the presentation cadence, the session summary
// ===========================================================================
{
  const store = new Map();
  globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } };
  const fa = await import(path.join(ROOT, 'lib/fly/frame-api.js') + '?fr9');
  const { presentationFps, paceTarget } = await mod('lib/fly/pace-adapt.js');
  await check('FR-9 (a) setFrameCadence persists to fly-frame-rate-v1, notifies, ignores junk; the default is 60', () => {
    assert(fa.FRAME_RATE_KEY === 'fly-frame-rate-v1');
    assert(fa.frameCadence() === '60', 'default');
    const seen = [];
    const un = fa.subscribeFrameCadence((m) => seen.push(m));
    fa.setFrameCadence('30');
    fa.setFrameCadence('bogus');
    fa.setFrameCadence('display');
    un();
    eq(seen, ['30', 'display']);
    assert(store.get('fly-frame-rate-v1') === 'display' && fa.frameCadence() === 'display');
  });
  await check('FR-9 (b) the measured cadence matches the mode: 30 pumps 30; 60 caps a 144 Hz desktop and leaves 60 Hz alone; Match display renders native (refresh/2 on Ultra >= 100 Hz)', () => {
    const P = (o) => presentationFps({ paceOn: true, always: true, ...o });
    eq([P({ mode: '30' }), P({ mode: '30', mobile: true }), P({ mode: '60', displayHz: 144 }), P({ mode: '60', displayHz: 60 }), P({ mode: 'display', displayHz: 144 }), P({ mode: 'display', displayHz: 144, heavy: true }), P({ mode: 'display', displayHz: 60, heavy: true }), P({ mode: '60', mobile: true }), P({ mode: '60', observing: true, displayHz: 144 })], [30, 30, 60, null, null, 72, null, 60, 60]);
    // Off: today's rule exactly (mobile flight or the seated lounge at 60).
    for (const mobile of [false, true]) for (const observing of [false, true]) for (const always of [false, true]) for (const mode of ['60', 'display', '30'])
      assert(presentationFps({ paceOn: false, mode, always, mobile, observing, displayHz: 144 }) === (always && (mobile || observing) ? 60 : null), 'flag-off legacy rule');
    // The governor target the mode implies.
    eq([paceTarget({ mode: '30', refresh: 60 }), paceTarget({ mode: 'display', refresh: 144 }), paceTarget({ mode: 'display', refresh: 144, heavy: true }), paceTarget({ mode: 'display', refresh: 144, mobile: true }), paceTarget({ mode: '60', refresh: 144 }), paceTarget({ mode: '60', refresh: 60, locked: 30 })], [30, 144, 72, null, null, 30]);
  });
  await check('FR-9 (c) frameSessionSummary carries coarse buckets only', () => {
    eq([fa.p95Bucket(15), fa.p95Bucket(16.7), fa.p95Bucket(22), fa.p95Bucket(40), fa.p95Bucket(250), fa.p95Bucket(null)], ['<=16.7', '<=16.7', '<=33.3', '<=50', '>100', null]);
    eq([fa.stallBucket(0), fa.stallBucket(0.4), fa.stallBucket(3), fa.stallBucket(30)], [0, 1, 5, '>10']);
    window.__flyStats = { frame: { sample: () => ({ p95: 18.2, long100PerMin: 1.6 }) } };
    fa.noteCadence({ rung: 2 });
    eq(fa.frameSessionSummary(), { p95Bucket: '<=20', stallsPerMin: 2, rung: 2 });
  });
  await check('FR-9 (d) Settings rows live in the FRAME blocks only and render nothing with PACE_ADAPT off; store field + setter exist', () => {
    const rows = read('components/fly/hud/SettingsRows.jsx');
    const block = rows.slice(rows.indexOf('// SHIP PASS FRAME rows begin'), rows.indexOf('// SHIP PASS FRAME rows end'));
    assert(/const frameRows = !FRAME_ROWS_ON \? null :/.test(block), 'frameRows is null with the flag off');
    for (const id of ['settings-battery-saver', 'settings-frame-rate']) assert(block.includes(id), id);
    assert(/deviceFeature\('BATTERY_SAVER'\)/.test(block) && /deviceFeature\('MATCH_DISPLAY'\)/.test(block), 'rows gate through the policy');
    const st = read('stores/fly-store.js');
    assert(/frameRateMode: '60'/.test(st) && /setFrameRateMode:/.test(st));
    const hint = read('components/fly/hud/BatterySaverHint.jsx');
    assert(/publishNotice\(/.test(hint) && !/CalmHud/.test(hint.replace(/\/\*[\s\S]*?\*\//g, '')), 'the hint uses the notice lane, never CalmHud');
  });
  delete globalThis.window;
}

// ===========================================================================
// FR-10 — the boot benchmark decision table
// ===========================================================================
{
  const { decideStart, gradeScore } = await mod('lib/fly/gpu-benchmark.js');
  const { DEVICE_POLICY } = await mod('lib/fly/fly-constants.js');
  const t = DEVICE_POLICY.benchmark.thresholds;
  const hi = { fillMpixPerMs: 10, cloudMs: 1 };
  const mid = { fillMpixPerMs: 1.5, cloudMs: 8 };
  const lo = { fillMpixPerMs: 0.2, cloudMs: 40 };
  await check('FR-10 (a) grades: high / medium / low from fill and cloud throughput', () => {
    eq([gradeScore(hi, t), gradeScore(mid, t), gradeScore(lo, t), gradeScore(null, t)], ['high', 'medium', 'low', null]);
  });
  await check('FR-10 (b) the decision table: start tier, preset, Ultra DPR cap, tablet desktop effects', () => {
    const row = (score, cls, masked = false) => {
      const d = decideStart({ score, cls, masked, thresholds: t });
      return `${d.tier}/${d.preset}/${d.dprCap}/${d.tabletDesktopEffects ? 'T' : '-'}`;
    };
    const table = {
      'dgpu hi': row(hi, 'dgpu'), 'dgpu mid': row(mid, 'dgpu'), 'igpu hi': row(hi, 'igpu'), 'igpu lo': row(lo, 'igpu'),
      'mac(masked) hi': row(hi, 'igpu', true), 'mac(masked) mid': row(mid, 'igpu', true),
      'phone hi': row(hi, 'phone'), 'phone lo': row(lo, 'phone'), 'tablet hi': row(hi, 'tablet'), 'tablet mid': row(mid, 'tablet'), 'tablet lo': row(lo, 'tablet'), software: row(hi, 'software'),
    };
    eq(table, {
      'dgpu hi': 'high/ultra/2/-', 'dgpu mid': 'medium/medium/1.5/-', 'igpu hi': 'high/high/1.5/-', 'igpu lo': 'low/low/1.5/-',
      'mac(masked) hi': 'high/ultra/2/-', 'mac(masked) mid': 'medium/medium/1.5/-',
      'phone hi': 'high/high/1.5/-', 'phone lo': 'medium/medium/1.5/-', 'tablet hi': 'high/high/1.5/T', 'tablet mid': 'high/high/1.5/T', 'tablet lo': 'medium/medium/1.5/-', software: 'low/low/1/-',
    });
    eq(decideStart({ score: null }).tier, null, 'no score: no decision (today\'s hints stand)');
    return Object.entries(table).map(([k, v]) => `${k} ${v}`).join('; ');
  });
  await check('FR-10 (c) the benchmark never runs with DEVICE_POLICY off, is capped at 1.5 s, and runs on a throwaway context', async () => {
    const src = read('lib/fly/gpu-benchmark.js');
    assert(/if \(!shipPassOn\('DEVICE_POLICY'\)/.test(src), 'flag gate');
    assert(DEVICE_POLICY.benchmark.maxMs <= 1500, 'cap');
    assert(/document\.createElement\('canvas'\)/.test(src) && /loseContext\(\)/.test(src), 'throwaway context released');
    const { benchmarkScore, resetBenchmark } = await mod('lib/fly/gpu-benchmark.js');
    resetBenchmark(undefined);
    let measured = 0;
    assert(benchmarkScore({ measure: () => (measured++, hi) }) === null && measured === 0, 'flag off: no score, no measurement');
    const fs = read('lib/fly/fly-settings.js');
    const block = fs.slice(fs.indexOf('// SHIP PASS FRAME start tier begin'), fs.indexOf('// SHIP PASS FRAME start tier end'));
    assert(/benchmarkStart\(\)/.test(block) && /if \(bench\?\.tier\) return bench\.tier;/.test(block), 'the start-tier block consults the benchmark first');
  });
}

// ===========================================================================
// FR-11 — the device policy table
// ===========================================================================
{
  const dp = await mod('lib/fly/device-policy.js');
  const seedSrc = atBase('lib/fly/device-policy.js');
  await check('FR-11 (a) every feature answers {allowed:boolean, budget:object} for every class x tier x preset', () => {
    let n = 0;
    for (const f of dp.POLICY_FEATURES)
      for (const cls of dp.DEVICE_CLASSES)
        for (const tier of ['low', 'medium', 'high'])
          for (const preset of [tier, 'ultra']) {
            const r = dp.deviceFeature(f, { cls, tier, preset, score: null, reversedDepth: true });
            assert(typeof r.allowed === 'boolean' && r.budget && typeof r.budget === 'object', `${f} ${cls} ${tier}`);
            n++;
          }
    eq(dp.DEVICE_CLASSES, ['phone', 'tablet', 'igpu', 'dgpu', 'software']);
    for (const need of ['SKY_LITE', 'NIGHT_LITE', 'TERRAIN_SHADOW', 'TRAFFIC_SHADOWS', 'AIRFRAME_DETAIL', 'BATTERY_SAVER', 'MATCH_DISPLAY', 'CADENCE_LOCK', 'DYNAMIC_NEAR', 'ULTRA_SUPERSAMPLE']) assert(dp.POLICY_FEATURES.includes(need), need);
    return `${dp.POLICY_FEATURES.length} features, ${n} answers`;
  });
  // The ONE sanctioned seed-row move (a contract request, recorded in the
  // FRAME report): LIGHT asked for PHOTO_HIRES touch maxScale 2 → 3 (at 2 a
  // 585×1266 phone buffer exports 2,532 px, short of LT-6's 2,560 px). The
  // gate applies exactly that move to the W0 answer and nothing else.
  const SANCTIONED = {
    PHOTO_HIRES: (cls, w0) => (cls === 'phone' || cls === 'tablet' ? { ...w0, budget: { ...w0.budget, maxScale: 3 } } : w0),
  };
  await check('FR-11 (b) with no benchmark score every W0 seed row answers exactly what it answered at W0 (one sanctioned move: PHOTO_HIRES touch maxScale 3)', () => {
    if (!seedSrc) return 'no merge-base (not a git checkout): skipped';
    const code = seedSrc.replace(/\r\n/g, '\n').replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
    const ctx = vm.createContext({ isMobileGraphicsClass: () => false, isPhoneClass: () => false, sessionGpuClass: () => ({ cls: 'high' }), window: undefined });
    vm.runInContext(`${code}\nthis.__api = { deviceFeature, POLICY_FEATURES };`, ctx);
    const seed = ctx.__api;
    let n = 0;
    let moved = 0;
    for (const f of seed.POLICY_FEATURES)
      for (const cls of dp.DEVICE_CLASSES)
        for (const tier of ['low', 'medium', 'high'])
          for (const preset of [tier, 'ultra']) {
            const w0 = JSON.parse(JSON.stringify(seed.deviceFeature(f, { cls, tier, preset })));
            const want = SANCTIONED[f] ? SANCTIONED[f](cls, w0) : w0;
            if (JSON.stringify(want) !== JSON.stringify(w0)) moved++;
            const a = JSON.stringify(want);
            const b = JSON.stringify(dp.deviceFeature(f, { cls, tier, preset, score: null }));
            assert(a === b, `${f} ${cls} ${tier}/${preset}: W0 ${a} now ${b}`);
            n++;
          }
    // 2 touch classes × 3 tiers × 2 presets — and only if W0 still had 2 there.
    assert(moved === 0 || moved === 12, `sanctioned move touched ${moved} answers, want 12`);
    return `${seed.POLICY_FEATURES.length} seed rows, ${n} answers identical (${moved} by the sanctioned PHOTO_HIRES move)`;
  });
  await check('FR-11 (e) LIGHT contract: PHOTO_HIRES touch maxScale 3 reaches LT-6\'s 2,560 px from a 585x1266 phone buffer; maxLongPx stays 4096', () => {
    for (const cls of dp.DEVICE_CLASSES) {
      const r = dp.deviceFeature('PHOTO_HIRES', { cls, tier: 'medium' });
      assert(r.allowed === (cls !== 'software'), `${cls} allowed ${r.allowed}`);
      eq(r.budget, { maxScale: 3, maxLongPx: 4096 }, cls);
    }
    const { budget } = dp.deviceFeature('PHOTO_HIRES', { cls: 'phone' });
    const long = Math.min(1266 * budget.maxScale, budget.maxLongPx);
    assert(long >= 2560, `phone export long edge ${long}`);
    return `phone 1266 px × ${budget.maxScale} → ${long} px (cap ${budget.maxLongPx})`;
  });
  await check('FR-11 (f) LIGHT contract: window.__flyDeviceClassOverride pins deviceClassOf() to any DEVICE_CLASSES value; anything else is ignored; ctx.cls still wins', async () => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const prev = globalThis.window;
    const rows = [];
    try {
      for (const cls of dp.DEVICE_CLASSES) {
        globalThis.window = { __flyDeviceClassOverride: cls };
        assert(dp.deviceClassOf() === cls, `pin ${cls} → ${dp.deviceClassOf()}`);
        // The table follows the pin (SwiftShader pinned to 'phone' gets the phone policy).
        const sky = dp.deviceFeature('SKY_LITE', { tier: 'high' }).allowed;
        assert(sky === (cls === 'phone' || cls === 'tablet'), `${cls} SKY_LITE at high ${sky}`);
        assert(dp.deviceClassOf({ cls: 'dgpu' }) === 'dgpu', 'ctx.cls wins over the pin');
        rows.push(cls);
      }
      // An unknown value falls through to the live classification (stubbed
      // here: the classifier must be reached, i.e. the pin did not answer).
      const src = read('lib/fly/device-policy.js');
      const fn = src.slice(src.indexOf('export function deviceClassOf'), src.indexOf('\n}\n', src.indexOf('export function deviceClassOf')));
      assert(/const pin = window\.__flyDeviceClassOverride;\n\s*if \(pin != null && CLASS_PINS\.has\(pin\)\) return pin;/.test(fn), 'pin read guarded by CLASS_PINS');
      assert(fn.indexOf('CLASS_PINS.has(pin)') < fn.indexOf('isPhoneClass()'), 'the pin is read before the live classifiers');
      const pins = src.match(/const CLASS_PINS = new Set\((\[[^\]]*\])\)/);
      eq(JSON.parse(pins[1].replace(/'/g, '"')), [...dp.DEVICE_CLASSES], 'CLASS_PINS === DEVICE_CLASSES');
      globalThis.window = { __flyDeviceClassOverride: 'gpu-of-the-future' };
      let got;
      try {
        got = dp.deviceClassOf();
      } catch {
        got = '(the live classifier ran and needs a browser)'; // the pin did not answer
      }
      assert(got !== 'gpu-of-the-future', 'an unknown pin value must be ignored');
      rows.push(`unknown → ${got}`);
    } finally {
      if (had) globalThis.window = prev;
      else delete globalThis.window;
    }
    // Flag-off/unpinned identity: no window → 'dgpu', exactly W0.
    assert(dp.deviceClassOf() === 'dgpu', 'node (no window) still dgpu');
    return `pinned ${rows.join(', ')}`;
  });
  await check('FR-11 (c) a score changes only what FR-10 says: tablet sky, tablet airframe detail, Ultra supersample', () => {
    const hi = { grade: 'high' };
    const lo = { grade: 'low' };
    assert(dp.deviceFeature('SKY_LITE', { cls: 'tablet', tier: 'high', score: hi }).allowed === false, 'a high tablet keeps the full sky');
    assert(dp.deviceFeature('SKY_LITE', { cls: 'phone', tier: 'high', score: hi }).allowed === true, 'phones keep the lite sky');
    assert(dp.deviceFeature('AIRFRAME_DETAIL', { cls: 'tablet', tier: 'high', score: lo }).allowed === false);
    assert(dp.deviceFeature('ULTRA_SUPERSAMPLE', { cls: 'dgpu', preset: 'ultra', score: lo }).allowed === false);
    assert(dp.deviceFeature('ULTRA_SUPERSAMPLE', { cls: 'dgpu', preset: 'ultra', score: hi }).allowed === true);
  });
  await check('FR-11 (d) grep gate: this stream adds no raw isPhoneClass()/isMobileGraphicsClass() call outside device-class.js / device-policy.js', () => {
    if (!BASE) return 'no merge-base: skipped';
    // Per file, the number of raw class CALLS may not grow (a moved or
    // rewritten call is not a new one; a new gate is).
    const RAW = /\b(isPhoneClass|isMobileGraphicsClass)\(/g;
    const files = git('diff', '--name-only', BASE, '--', 'lib', 'components', 'stores', 'hooks', 'app').split('\n').filter((f) => /\.(m?js|jsx)$/.test(f) && !/device-(class|policy)\.js$/.test(f));
    const bad = [];
    for (const f of files) {
      let now = '';
      try {
        now = read(f);
      } catch {
        continue; // deleted
      }
      const then = atBase(f) ?? '';
      const count = (t) => (t.replace(/\r\n/g, '\n').replace(/^\s*(\/\/|\*).*$/gm, '').match(RAW) ?? []).length;
      if (count(now) > count(then)) bad.push(`${f}: ${count(then)} → ${count(now)}`);
    }
    assert(!bad.length, bad.join(' | '));
    return `${files.length} changed source files checked`;
  });
}

// ===========================================================================
// FR-12 — ULTRA_SUPERSAMPLE: the top rung, shed first
// ===========================================================================
{
  const { createGovernor } = await mod('lib/fly/perf-governor.js');
  await check('FR-12 (a) a supersampled boot is the ladder\'s top rung and the first one shed', () => {
    const events = [];
    const g = createGovernor({ dpr0: 1.5, tier0: 'high', supersample: 1.5, pace: null, applyDpr: (v) => events.push(`dpr:${v}`), applyTier: (v) => events.push(`tier:${v}`), applyEffects: (v) => events.push(`fx:${v}`) });
    const plain = createGovernor({ dpr0: 1, tier0: 'high', supersample: null, pace: null, applyDpr: () => {}, applyTier: () => {}, applyEffects: () => {} });
    assert(g.ladder[0].dpr === 1.5 && g.ladder.length === plain.ladder.length + 1, `ladder ${JSON.stringify(g.ladder.slice(0, 3))}`);
    eq(g.ladder.slice(1), plain.ladder, 'below the top rung: the native ladder, unchanged');
    g.force(-1, 0);
    eq(events, ['dpr:1'], 'the first step sheds supersampling and nothing else');
  });
  await check('FR-12 (b) off by default; needs a DPR-1 display, Ultra, a dGPU and a high benchmark', async () => {
    const { ULTRA_SUPERSAMPLE } = await mod('lib/fly/fly-constants.js');
    assert(ULTRA_SUPERSAMPLE.enabled === false && ULTRA_SUPERSAMPLE.maxScale === 1.5);
    const src = read('lib/fly/render-resolution.js');
    for (const need of ["shipPassOn('ULTRA_SUPERSAMPLE')", '(window.devicePixelRatio || 1) !== 1', "deviceFeature('ULTRA_SUPERSAMPLE'", "benchmarkStart()?.grade !== 'high'"]) assert(src.includes(need), need);
  });
}

// ===========================================================================
// FR-13 — the dynamic near plane
// ===========================================================================
{
  const dn = await mod('lib/fly/dynamic-near.js');
  await check('FR-13 (a) near = clamp(0.02 x AGL, 2.5 m, 60 m)', () => {
    eq([dn.dynamicNearFor(0), dn.dynamicNearFor(100), dn.dynamicNearFor(1000), dn.dynamicNearFor(2000), dn.dynamicNearFor(10000), dn.dynamicNearFor(NaN)], [2.5, 2.5, 20, 40, 60, 2.5]);
  });
  await check('FR-13 (b) only where reversed depth is unavailable, only with DEVICE_POLICY + its sub-switch; desktop (reversed depth) never', () => {
    assert(dn.dynamicNearBudget({ reversedDepth: true, flagOn: true, sub: true, cls: 'phone' }) === null, 'reversed depth: never');
    assert(dn.dynamicNearBudget({ reversedDepth: false, flagOn: false, sub: true, cls: 'phone' }) === null, 'flag off: never');
    assert(dn.dynamicNearBudget({ reversedDepth: false, flagOn: true, sub: false, cls: 'phone' }) === null, 'sub-switch off: never');
    assert(dn.dynamicNearBudget({ reversedDepth: false, flagOn: true, sub: true, cls: 'phone' })?.maxM === 60, 'no reversed depth + on: runs');
    // Applied through the real entry point on a fake renderer with reversed depth: nothing written.
    const cam = { near: 2.5, updates: 0, updateProjectionMatrix() { this.updates++; } };
    assert(dn.applyDynamicNear({ capabilities: { reversedDepthBuffer: true } }, cam, 2000, false) === false && cam.near === 2.5 && cam.updates === 0);
    const scene = read('components/fly/FlyScene.jsx');
    const block = scene.slice(scene.indexOf('// SHIP PASS FRAME frame begin'), scene.indexOf('// SHIP PASS FRAME frame end'));
    assert(block.includes('applyDynamicNear(gl, camera, flight.agl, !!runtime.airportWatch?.active)'), 'FlyScene FRAME block');
  });
}

// ===========================================================================
// Flags — the FRAME blocks and their flag-off identity
// ===========================================================================
{
  const C = await mod('lib/fly/fly-constants.js');
  await check('flags (a) DEVICE_POLICY and ULTRA_SUPERSAMPLE ship off (device evidence); PACE_ADAPT.turn ships off', () => {
    assert(C.DEVICE_POLICY.enabled === false && C.ULTRA_SUPERSAMPLE.enabled === false && C.PACE_ADAPT.turn.enabled === false);
    return `SHADER_READY ${C.SHADER_READY.enabled}, PACE_ADAPT ${C.PACE_ADAPT.enabled}, DEVICE_POLICY ${C.DEVICE_POLICY.enabled}, ULTRA_SUPERSAMPLE ${C.ULTRA_SUPERSAMPLE.enabled}`;
  });
  await check('flags (b) flag-off identity: every cinema profile\'s rendering fields and every resolveCinemaProfile answer equal the W0 module', async () => {
    const seed = atBase('lib/fly/cinema-profile.js');
    if (!seed) return 'no merge-base: skipped';
    const before = await import(`data:text/javascript,${encodeURIComponent(seed.replace(/\r\n/g, '\n'))}`);
    const now = await mod('lib/fly/cinema-profile.js');
    const VERDICT = new Set(['draws', 'triangles', 'textureBytes', 'geometryBytes']);
    const strip = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !VERDICT.has(k)));
    for (const k of Object.keys(before.CINEMA_PROFILES)) eq(strip(now.CINEMA_PROFILES[k]), strip(before.CINEMA_PROFILES[k]), k);
    let n = 0;
    for (const preset of ['ultra', 'high', 'medium', 'low']) for (const tier of ['high', 'medium', 'low']) for (const phone of [false, true]) for (const effectLevel of [0, 1, 2, 3]) for (const scale of [1, 0.85, 0.75]) for (const scaleDemotes of [true, false]) {
      const o = { preset, tier, phone, effectLevel, scale, scaleDemotes };
      eq(strip(now.resolveCinemaProfile(o)), strip(before.resolveCinemaProfile(o)), JSON.stringify(o));
      n++;
    }
    return `${n} profile resolutions identical in every rendering field`;
  });
  await check('flags (c) FRAME edits no shader text: no anchored substitution, onBeforeCompile or customProgramCacheKey in FRAME\'s diff', () => {
    if (!BASE) return 'no merge-base: skipped';
    const diff = git('diff', '-U0', BASE, '--', 'lib', 'components');
    const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    const bad = added.filter((l) => /onBeforeCompile|customProgramCacheKey|ShaderChunk|fragmentShader\s*=|vertexShader\s*=/.test(l) && !/gpu-benchmark/.test(l));
    assert(!bad.length, bad.slice(0, 3).join(' | '));
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

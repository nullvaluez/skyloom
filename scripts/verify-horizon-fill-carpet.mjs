/**
 * HORIZON FILL stream B (CARPET) gate. FLY_HORIZON_FILL.md.
 *
 * Drives lib/fly/horizon-fill/carpet-engine.js in node with a fake fill worker
 * (synthetic FillChunks), a fake ground and a fake mapped-cell census, and
 * proves: ring selection, cap and hysteresis; the level bands; the triangle
 * budget on every simulated frame of a flight with a turn and a warp; the
 * drawn prefix shrinking with distance; swaps without a gap; one mask epoch
 * change -> exactly one rebuild of the affected chunks; eviction disposing
 * geometry; steady-state frames not growing any array; upload admission; the
 * drape; the near hole, outer taper and altitude dissolve; the program cache
 * key against the skyline stand-in material; and with the flag off, the layer
 * module renders nothing and constructs nothing.
 *
 * No GPU, no network. Prints PASS / FAIL lines; exits non-zero on a failure.
 */
import { register } from 'node:module';

register('./_node-resolve.mjs', import.meta.url);
register('./_r25-c-jsx-loader.mjs', import.meta.url);

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

// --- flag off first: the layer renders null, starts no worker, publishes nothing --
let workersMade = 0;
globalThis.Worker = class {
  constructor() {
    workersMade += 1;
  }
  terminate() {}
};
globalThis.window = { location: { search: '' }, __flyWorldPassTierOverride: true };
const { installUrlFlags } = await import('../lib/fly/fly-pins.js');
installUrlFlags();
const hf = await import('../lib/fly/horizon-fill.js');
{
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { HorizonFillLayer } = await import('../components/fly/HorizonFillLayer.jsx');
  const runtime = {};
  const html = renderToStaticMarkup(createElement(HorizonFillLayer, { runtime, flight: { pos: { x: 0, z: 0 } } }));
  check('flag off: horizonFillOn() and the carpet are off', hf.horizonFillOn() === false && hf.horizonFillOn('carpet') === false);
  check('flag off: the layer renders nothing', html === '', JSON.stringify(html));
  check('flag off: no worker, no runtime.horizonFill, no window.__horizonFill', workersMade === 0 && !('horizonFill' in runtime) && !('__horizonFill' in globalThis.window));
}

// --- flag on (the reader with the World Pass tier pinned) ----------------------
hf.__resetHorizonFillLatchForTests();
globalThis.window = { location: { search: '?flags=HORIZON_FILL' }, __flyWorldPassTierOverride: true };
installUrlFlags();
check('flag on: the reader turns the carpet on (World Pass tier pinned)', hf.horizonFillOn('carpet') === true, `tier ${hf.horizonFillTier()}`);

const THREE = await import('three');
const { ShaderLib, UniformsUtils } = THREE;
const { CarpetEngine } = await import('../lib/fly/horizon-fill/carpet-engine.js');
const G = await import('../lib/fly/horizon-fill/carpet-grid.js');
const { worldPassConfig } = await import('../lib/fly/world-pass.js');
const { createStandInMaterial, createStandInUniforms } = await import('../lib/fly/sat-stand-in-material.js');
const { satelliteVisualsOn } = await import('../lib/fly/satellite-visuals.js');
const { STAND_IN_TRIANGLES } = await import('../lib/fly/toy-world/sat-stand-ins.js');
const { resetWpFrameSlice } = await import('../lib/fly/toy-world/wp-frame-slice.js');
resetWpFrameSlice();

const BASE = JSON.parse(JSON.stringify(hf.horizonFillConfig()));
const reachCfg = worldPassConfig('reach');
const R = G.EARTH_R;
const toWorld = (lat, lon) => ({ x: (lon * Math.PI * R) / 180, z: -R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) });

// --- fakes ------------------------------------------------------------------
function hash(a, b, c, d) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) ^ Math.imul(c + 17, 0x165667b1) ^ Math.imul(d + 31, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
}

/** A synthetic FillChunk with the contract's fields and encodings. */
function synthChunk(req) {
  const { tx, ty, level, qx = 0, qy = 0, mask = null, maskEpoch = 0 } = req;
  const span = level === 0 ? G.S / 2 : G.S;
  const minX = G.tileMinX(tx) + (level === 0 ? qx * span : 0);
  const minZ = G.tileMinZ(ty) + (level === 0 ? qy * span : 0);
  const cx = minX + span / 2;
  const cz = minZ + span / 2;
  const cell = G.S / 128;
  const k = G.mercK(cz);
  const step = level === 2 ? 2 : 1;
  const i0 = level === 0 ? qx * 64 : 0;
  const j0 = level === 0 ? qy * 64 : 0;
  const nCells = level === 0 ? 64 : 128;
  const items = [];
  let maskedCells = 0;
  let builtCells = 0;
  for (let j = j0; j < j0 + nCells; j += step) {
    for (let i = i0; i < i0 + nCells; i += step) {
      let masked = false;
      let built = false;
      for (let b = 0; b < step * step; b++) {
        const ci = i + (b % step);
        const cj = j + Math.floor(b / step);
        if (mask && mask[cj * 128 + ci]) masked = true;
        if (hash(tx, ty, ci, cj) % 1000 < 40) built = true;
      }
      if (masked) {
        maskedCells += 1;
        continue;
      }
      if (!built) continue;
      builtCells += 1;
      const per = level === 0 ? 2 : 1;
      for (let p = 0; p < per; p++) {
        const h = hash(tx * 7 + p, ty, i, j);
        const height = 4 + (h % 41);
        const halfW = (6 + (h % 9)) * k * step;
        items.push({ x: minX + (i + 0.5 * step) * cell - cx + (p ? cell * 0.25 : 0), z: minZ + (j + 0.5 * step) * cell - cz, halfW, height, h });
      }
    }
  }
  for (const it of items) it.size = Math.max(it.height, 0.5 * Math.sqrt((2 * it.halfW / k) ** 2));
  items.sort((a, b) => b.size - a.size || a.h - b.h);
  const n = items.length;
  const ax = new Float32Array(n);
  const az = new Float32Array(n);
  const dim = new Uint16Array(n * 4);
  const wall = new Uint8Array(n * 4);
  const roof = new Uint8Array(n * 4);
  const gnd = new Uint8Array(n * 4);
  const size = new Float32Array(n);
  const q = (v, s) => Math.max(0, Math.min(65535, Math.round((v / s) * 65535)));
  let maxH = 0;
  items.forEach((it, o) => {
    ax[o] = it.x;
    az[o] = it.z;
    dim[o * 4] = q(it.halfW, 1000);
    dim[o * 4 + 1] = q(it.halfW, 1000);
    dim[o * 4 + 2] = q(it.height, 1000);
    dim[o * 4 + 3] = 0;
    wall.set([180, 170, 160, 1], o * 4);
    roof.set([120, 110, 100, it.h & 255], o * 4);
    gnd.set([120, 110, 100, 0], o * 4);
    size[o] = it.size;
    if (it.height > maxH) maxH = it.height;
  });
  return {
    v: 1, key: `${level}/${tx}/${ty}/${qx}/${qy}`, tx, ty, level, qx, qy, maskEpoch,
    status: n ? 'ok' : 'empty', reason: n ? null : 'no-built-cells', cx, cz, span, n, ax, az, dim, wall, roof, gnd, size, maxH, builtCells, maskedCells,
  };
}

function makeApi({ latency = 2, missingFirst = new Set() } = {}) {
  const api = {
    frame: 0,
    pending: [],
    calls: [],
    prefetches: [],
    missingLeft: new Set(missingFirst),
    buildChunk(req) {
      let maskCells = 0;
      if (req.mask) for (let i = 0; i < req.mask.length; i++) if (req.mask[i]) maskCells += 1;
      api.calls.push({ ...req, mask: req.mask ? 'mask' : null, maskCells, frame: api.frame });
      return new Promise((resolve) => {
        const key = `${req.tx}/${req.ty}`;
        if (api.missingLeft.has(key)) {
          api.missingLeft.delete(key);
          api.pending.push({ due: api.frame + latency, resolve, value: { v: 1, key: `${req.level}/${req.tx}/${req.ty}/0/0`, status: 'missing', reason: 'not-loaded', n: 0 } });
          return;
        }
        api.pending.push({ due: api.frame + latency, resolve, value: synthChunk(req) });
      });
    },
    prefetch(tiles) {
      api.prefetches.push(tiles.map((t) => `${t[0]}/${t[1]}`));
      return Promise.resolve();
    },
    tick() {
      api.frame += 1;
      for (let i = api.pending.length - 1; i >= 0; i--) {
        if (api.pending[i].due <= api.frame) {
          api.pending[i].resolve(api.pending[i].value);
          api.pending.splice(i, 1);
        }
      }
    },
  };
  return api;
}

const ground = { z: 10, calls: 0 };
const groundAt = (lon, lat) => {
  ground.calls += 1;
  return { elev: 20 + 15 * Math.sin(lon * 3.1) + 10 * Math.cos(lat * 2.3) + (ground.z >= 12 ? 3 * Math.sin(lon * 40) : 0), tileZ: ground.z };
};
const groundY = (x, z) => groundAt(G.lonOf(x), G.latOf(z)).elev;

function makeCoverage() {
  const epochs = new Map();
  return {
    epochs,
    masks: 0,
    epochOf(tx, ty) {
      return epochs.get(`${tx}/${ty}`) ?? 0;
    },
    maskFor() {
      this.masks += 1;
      const m = new Uint8Array(16384);
      for (let j = 0; j < 16; j++) m.fill(1, j * 128, j * 128 + 128);
      return m;
    },
    knownFraction() {
      return 1;
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

function makeEngine(over = {}) {
  const config = JSON.parse(JSON.stringify(BASE));
  if (over.budget) Object.assign(config.budget, over.budget);
  if (over.ring) Object.assign(config.ring, over.ring);
  const api = over.api ?? makeApi();
  const engine = new CarpetEngine({
    api, config, tier: over.tier ?? 'high', groundAt, coverage: over.coverage ?? null,
    houses: over.houses ?? true, preload: over.preload ?? false, reachCfg, lighting: satelliteVisualsOn('lighting'),
  });
  engine.setView(800, 900);
  if (over.admit) engine.setAdmit(over.admit);
  return { engine, api, config };
}

async function frame(ctx, t, x, z, agl = 600) {
  ctx.api.tick();
  await flush();
  ctx.engine.update(t, x, z, agl, 0);
}

function meshes(engine) {
  return engine.object.children;
}
function drawnInstances(engine) {
  let n = 0;
  for (const m of meshes(engine)) if (m.visible) n += m.geometry.instanceCount;
  return n;
}
function gpuInstances(engine) {
  let n = 0;
  for (const m of meshes(engine)) n += m.geometry.instanceCount;
  return n;
}

const NYC = toWorld(40.72, -73.99);
const PARIS = toWorld(48.85, 2.35);
const dt = 1 / 30;

// --- 1. program key and uniforms ---------------------------------------------------
{
  const { engine } = makeEngine();
  const sky = createStandInMaterial({ lighting: satelliteVisualsOn('lighting'), uniforms: createStandInUniforms(reachCfg), footprintK: reachCfg.worker?.footprintK ?? 0.5 });
  const key = engine.material.customProgramCacheKey();
  check('program key equals the skyline stand-in material', key === sky.customProgramCacheKey(), key.slice(-60));
  const twin = engine._fadePool.acquire();
  check('fade twin has the same program key', twin.material.customProgramCacheKey() === key);
  const compile = (mat) => {
    const shader = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    mat.onBeforeCompile(shader, null);
    return shader;
  };
  const a = compile(engine.material);
  const b = compile(sky);
  check('same GLSL as the skyline stand-ins', a.vertexShader === b.vertexShader && a.fragmentShader === b.fragmentShader);
  check('own near hole, outer taper and altitude fade uniforms', a.uniforms.uSkyHole === engine._hole && a.uniforms.uSkyFade === engine._fadeU && (!a.uniforms.uCityHorizonBand || a.uniforms.uCityHorizonBand === engine._band) && b.uniforms.uSkyHole !== engine._hole);
  check('own stand-in view uniform (not the skyline\'s)', a.uniforms.uStandInView === engine.uniforms.uStandInView && b.uniforms.uStandInView !== engine.uniforms.uStandInView);
  const tw = compile(twin.material);
  check('twin shares the base architecture uniforms, has its own fade', tw.uniforms.uArchitectureTiles === a.uniforms.uArchitectureTiles && tw.uniforms.uSkyFade === twin.uniform);
  engine._fadePool.release(twin);
  // syncSkyline copies the detailed ring's coverage into the carpet's own uniforms.
  const su = sky.userData.architecture.uniforms;
  su.uArchitectureTileCount.value = 2;
  su.uArchitectureTiles.value[1].set(1, 2, 3, 4);
  su.uArchitectureTileK.value[1] = 0.5;
  su.uArchitectureNearFade.value = 0.75;
  su.uArchitectureNight.value = 0.3;
  engine.syncSkyline(sky, 1);
  const mu = engine.material.userData.architecture.uniforms;
  check('syncSkyline copies the detailed coverage mask and the night mix', mu.uArchitectureTileCount.value === 2 && mu.uArchitectureTiles.value[1].w === 4 && mu.uArchitectureTileK.value[1] === 0.5 && mu.uArchitectureNearFade.value === 0.75 && mu.uArchitectureNight.value === 0.3);
  engine.syncSkyline(null, 0);
  check('no skyline: no coverage mask, night from the sun', mu.uArchitectureTileCount.value === 0 && mu.uArchitectureNight.value > 0.9);
  engine.dispose();
  sky.dispose();
}

// --- 2. ring selection, cap, hysteresis, levels -----------------------------------
{
  const ctx = makeEngine({ tier: 'high' });
  const { engine, config } = ctx;
  let t = 0;
  for (let i = 0; i < 90; i++) await frame(ctx, (t += dt), NYC.x, NYC.z);
  const k = G.mercK(NYC.z);
  const reach = config.ring.reachM.high;
  const tiles = [...engine.tiles.values()];
  check('ring: resident tiles within the cap', tiles.length > 0 && tiles.length <= config.ring.maxTiles.high, `${tiles.length} <= ${config.ring.maxTiles.high}`);
  const dists = tiles.map((tl) => G.rectDist(NYC.x, NYC.z, tl.minX, tl.minZ, G.S) / k);
  const maxIn = Math.max(...dists);
  let nearerOutside = 0;
  let candidates = 0;
  const c0 = G.tileIndex(NYC.x), r0 = G.tileIndex(NYC.z);
  for (let ty = r0 - 6; ty <= r0 + 6; ty++) {
    for (let tx = c0 - 6; tx <= c0 + 6; tx++) {
      const d = G.rectDist(NYC.x, NYC.z, G.tileMinX(tx), G.tileMinZ(ty), G.S) / k;
      if (d < reach) candidates += 1;
      if (!engine.tiles.has(`${tx}/${ty}`) && d < maxIn - 1) nearerOutside += 1;
    }
  }
  check('ring: nearest first (no unselected tile nearer than a resident one)', nearerOutside === 0 && maxIn <= reach, `max resident ${Math.round(maxIn)} m, ${candidates} within reach`);
  check('ring: the cap binds at High reach', candidates > config.ring.maxTiles.high ? tiles.length === config.ring.maxTiles.high : true, `${candidates} candidates`);
  // Levels.
  let levelOk = true;
  let quarterOk = true;
  let n0 = 0;
  for (const tl of engine.tiles.values()) {
    const d = G.rectDist(NYC.x, NYC.z, tl.minX, tl.minZ, G.S) / k;
    const whole = tl.live.filter((c) => c.level !== 0);
    for (const c of whole) if (c.level !== (d < config.ring.districtsM ? 1 : 2)) levelOk = false;
    for (let q = 0; q < 4; q++) {
      const dq = G.rectDist(NYC.x, NYC.z, tl.minX + (q & 1) * (G.S / 2), tl.minZ + (q >> 1) * (G.S / 2), G.S / 2) / k;
      const has0 = tl.live.some((c) => c.level === 0 && c.qx === (q & 1) && c.qy === q >> 1);
      if (has0) n0 += 1;
      // Fresh from a stationary start a quarter is a house quarter inside
      // housesM - levelHystM and never past housesM + levelHystM.
      if (has0 && dq > config.ring.housesM + config.ring.levelHystM) quarterOk = false;
      if (!has0 && dq < config.ring.housesM - config.ring.levelHystM) quarterOk = false;
      const excluded = whole.length ? whole.some((c) => c.excl & (1 << q)) : tl.qbits === 15;
      if (excluded !== has0) quarterOk = false;
    }
  }
  check('levels: level 1 inside districtsM, level 2 beyond', levelOk);
  check('levels: level 0 quarters inside housesM (with its hysteresis), masked out of the whole-tile chunk', quarterOk && n0 > 0, `${n0} quarters`);
  check('levels: stats.levels published', engine.stats.levels[0] === n0 && engine.stats.levels[1] + engine.stats.levels[2] > 0, JSON.stringify(engine.stats.levels));
  // Hysteresis: weave 1 km either side at 80 m/s (the lead swings with it).
  // The first sweep may settle a band edge once (the stationary start had no
  // history); a second minute of the same weave must not change anything.
  let ox = 0;
  let dir = 1;
  const weave = async (frames) => {
    for (let i = 0; i < frames; i++) {
      ox += dir * 80 * dt;
      if (Math.abs(ox) >= 1000) dir = -dir;
      await frame(ctx, (t += dt), NYC.x + ox * k, NYC.z);
    }
  };
  await weave(1800);
  const ev0 = engine.stats.evictions;
  const b0 = engine.stats.builds;
  await weave(1800);
  check('hysteresis: a 1 km weave evicts nothing', engine.stats.evictions === ev0, `${engine.stats.evictions - ev0} evictions`);
  check('hysteresis: a 1 km weave rebuilds nothing', engine.stats.builds === b0, `${engine.stats.builds - b0} builds`);
  engine.dispose();
  check('dispose: every geometry released', engine.liveGeometries === 0 && engine.object.children.length === 0, `${engine.liveGeometries}`);

  // Houses off: no level 0.
  const off = makeEngine({ houses: false });
  for (let i = 0; i < 60; i++) await frame(off, i * dt, NYC.x, NYC.z);
  const any0 = [...off.engine.tiles.values()].some((tl) => tl.live.some((c) => c.level === 0));
  check('houses off: level 0 is level 1', !any0 && off.api.calls.every((c) => c.level !== 0));
  off.engine.dispose();
}

// --- 3. a flight with a turn and a warp: budget, gaps, eviction ----------------------
{
  const ctx = makeEngine({ budget: { maxTriangles: { high: 60000, ultra: 120000 } }, preload: true, api: makeApi({ missingFirst: new Set([`${G.tileIndex(NYC.x) + 1}/${G.tileIndex(NYC.z)}`]) }) });
  const { engine, api, config } = ctx;
  const maxT = config.budget.maxTriangles.high;
  let t = 0;
  let x = NYC.x;
  let z = NYC.z;
  let heading = 0; // radians, 0 = east
  let worstTri = 0;
  let worstGpu = 0;
  let overFrames = 0;
  let gapFrames = 0;
  let maxUploadsInFrame = 0;
  let fRose = false;
  const covered = new Map(); // tile key -> quarters ever covered
  const speed = 250; // m/s true
  for (let i = 0; i < 2400; i++) {
    const s = i / 30;
    if (s > 40 && s < 50) heading += (Math.PI / 2 / 10) * dt; // a 90 degree turn over 10 s
    if (i === 1800) {
      x = PARIS.x;
      z = PARIS.z;
      engine.notifyWarp(t);
    }
    const kk = G.mercK(z);
    x += Math.cos(heading) * speed * kk * dt;
    z += Math.sin(heading) * speed * kk * dt;
    const up0 = engine.stats.uploads;
    await frame(ctx, (t += dt), x, z, 900);
    maxUploadsInFrame = Math.max(maxUploadsInFrame, engine.stats.uploads - up0);
    const tri = drawnInstances(engine) * STAND_IN_TRIANGLES;
    const gpu = gpuInstances(engine) * STAND_IN_TRIANGLES;
    worstTri = Math.max(worstTri, tri);
    worstGpu = Math.max(worstGpu, gpu);
    if (gpu > maxT) overFrames += 1;
    if (engine._f > 1.01) fRose = true;
    // Gap check: every quarter of a resident tile that was covered stays covered
    // at full strength (the altitude fade) by some mesh of that tile.
    if (i === 1800) covered.clear();
    const byTile = new Map();
    for (const m of meshes(engine)) {
      const c = m.userData.carpetChunk;
      if (c) (byTile.get(c.tile) ?? byTile.set(c.tile, []).get(c.tile)).push({ c, m });
    }
    for (const tile of engine.tiles.values()) {
      const list = byTile.get(tile) ?? [];
      const seen = covered.get(tile.key) ?? 0;
      let now = 0;
      for (let q = 0; q < 4; q++) {
        let best = 0;
        for (const { c, m } of list) {
          const owns = c.level === 0 ? c.qx === (q & 1) && c.qy === q >> 1 : !(c.excl & (1 << q));
          if (!owns) continue;
          const fade = m.material.userData.__fadeU ? m.material.userData.__fadeU.value : engine._fadeU.value;
          best = Math.max(best, fade);
        }
        if (best >= engine._fadeU.value * 0.999 && engine._fadeU.value > 0) now |= 1 << q;
      }
      if (seen & ~now) gapFrames += 1;
      covered.set(tile.key, seen | now);
    }
  }
  check('budget: never over maxTriangles on any frame (every mesh on the GPU)', overFrames === 0, `worst ${worstGpu} of ${maxT}, drawn worst ${worstTri}`);
  check('budget: the factor rose under a tight budget', fRose, `f ${engine._f.toFixed(2)}`);
  check('swaps: no quarter ever left without a whole mesh', gapFrames === 0, `${gapFrames} gap frames, ${engine.stats.swaps} swaps`);
  check('swaps happened during the flight', engine.stats.swaps > 0, `${engine.stats.swaps}`);
  check('uploads: at most uploadsPerFrame a frame', maxUploadsInFrame <= config.budget.uploadsPerFrame, `${maxUploadsInFrame}`);
  check('missing height tile: retried and built', api.calls.filter((c) => `${c.tx}/${c.ty}` === `${G.tileIndex(NYC.x) + 1}/${G.tileIndex(NYC.z)}`).length >= 2);
  const parisTile = `${G.tileIndex(PARIS.x)}/${G.tileIndex(PARIS.z)}`;
  check('warp: the ring moved to the destination', engine.tiles.has(parisTile) && [...engine.tiles.values()].every((tl) => Math.abs(tl.tx - G.tileIndex(PARIS.x)) < 8));
  check('preload: prefetch asked for tiles', api.prefetches.length > 0 && api.prefetches.some((p) => p.includes(parisTile)), `${api.prefetches.length} calls`);
  let pendingMeshes = 0;
  for (const tl of engine.tiles.values()) if (tl.next) for (const c of tl.next.chunks) if (c.mesh && !tl.live.includes(c)) pendingMeshes += 1;
  check('eviction: live geometries = meshes in the scene + uploaded-not-committed', engine.liveGeometries === meshes(engine).length + pendingMeshes, `${engine.liveGeometries} vs ${meshes(engine).length} + ${pendingMeshes}`);
  check('eviction: tiles were evicted', engine.stats.evictions > 0, `${engine.stats.evictions}`);
  engine.dispose();
  check('dispose after a flight: zero live geometries', engine.liveGeometries === 0 && engine.object.children.length === 0);
}

// --- 4. drawn prefix shrinks with distance; reflection draws zero; shadows off -----------
{
  const ctx = makeEngine({ budget: { maxTriangles: { high: 1e9, ultra: 1e9 } }, ring: { reachM: { high: 200000, ultra: 200000 }, maxTiles: { high: 4, ultra: 4 }, ringHystM: 400000, refreshSec: 1e9, refreshMoveM: 1e9 } });
  const { engine } = ctx;
  let t = 0;
  for (let i = 0; i < 60; i++) await frame(ctx, (t += dt), NYC.x, NYC.z, 600);
  const target = [...engine.tiles.values()].flatMap((tl) => tl.live).find((c) => c.mesh && c.level === 2) ?? [...engine.tiles.values()].flatMap((tl) => tl.live).find((c) => c.mesh);
  const k = G.mercK(NYC.z);
  let mono = true;
  let prev = Infinity;
  const seen = [];
  for (let i = 0; i < 300; i++) {
    const x = NYC.x - i * 250 * k;
    engine.update((t += 0.11), x, NYC.z, 600, 0);
    if (!target.mesh) break;
    const n = target.mesh.geometry.instanceCount;
    if (n > prev) mono = false;
    prev = n;
    if (i % 60 === 0) seen.push(n);
  }
  check('LOD: the drawn prefix never grows while the chunk recedes', mono && seen[0] > seen[seen.length - 1], seen.join(' > '));
  const m = target.mesh;
  const main = m.geometry.instanceCount;
  m.onBeforeRender({ getRenderTarget: () => ({ texture: { name: 'coastal-city-reflection' } }) });
  const refl = m.geometry.instanceCount;
  m.onBeforeRender({ getRenderTarget: () => null });
  check('reflection pass draws zero instances; the main pass gets its count back', refl === 0 && m.geometry.instanceCount === main);
  check('no shadow casting, default layer only', meshes(engine).every((x) => !x.castShadow && !x.receiveShadow && x.layers.mask === 1));
  // Altitude dissolve and the fades' uniforms.
  const R0 = ctx.config.ring;
  engine.update((t += 0.2), NYC.x, NYC.z, R0.aglFade.endM + 100, 0);
  check('altitude dissolve: above aglFade.endM nothing draws', !engine.object.visible && engine._fadeU.value === 0 && drawnInstances(engine) === 0);
  engine.update((t += 0.2), NYC.x, NYC.z, (R0.aglFade.startM + R0.aglFade.endM) / 2, 0);
  check('altitude dissolve: half way, half faded', Math.abs(engine._fadeU.value - 0.5) < 1e-6 && engine.object.visible);
  check('near hole: none inside nearM.start, full by nearM.end (world units)', Math.abs(engine._hole.value.x - R0.nearM.start * k) < 1e-6 && Math.abs(engine._hole.value.x + engine._hole.value.y - R0.nearM.end * k) < 1e-6);
  check('outer taper: edgeFadeM before reachM', Math.abs(engine._band.value.y - R0.reachM.high * k) < 1e-6 && Math.abs(engine._band.value.y - engine._band.value.x - R0.edgeFadeM * k) < 1e-6);
  engine.dispose();
}

// --- 5. mapped handoff: one epoch change, one rebuild ---------------------------------
{
  const coverage = makeCoverage();
  const T = `${G.tileIndex(NYC.x)}/${G.tileIndex(NYC.z)}`;
  coverage.epochs.set(T, 1);
  const ctx = makeEngine({ coverage });
  const { engine, api, config } = ctx;
  let t = 0;
  for (let i = 0; i < 240; i++) await frame(ctx, (t += dt), NYC.x, NYC.z);
  const tile = engine.tiles.get(T);
  const firstMasked = api.calls.filter((c) => `${c.tx}/${c.ty}` === T);
  check('handoff: the first known mask is in the first build', firstMasked.length > 0 && firstMasked.every((c) => c.maskEpoch === 1 && c.mask === 'mask' && c.maskCells >= 16 * 128 / (c.level === 0 ? 2 : 1)));
  const before = api.calls.length;
  const chunksOfT = tile.live.length;
  coverage.epochs.set(T, 2);
  for (let i = 0; i < Math.ceil((config.budget.maskMinSec + config.ring.refreshSec * 2 + 3) / dt); i++) await frame(ctx, (t += dt), NYC.x, NYC.z);
  const after = api.calls.slice(before);
  const forT = after.filter((c) => `${c.tx}/${c.ty}` === T);
  check('handoff: one epoch change rebuilds exactly the affected chunks once', forT.length === chunksOfT && forT.every((c) => c.maskEpoch === 2) && after.length === forT.length, `${forT.length} of ${chunksOfT} chunks, ${after.length} builds in all`);
  check('handoff: the new set is live with the new epoch', tile.live.every((c) => c.epoch === 2) && engine.stats.rebuilds >= 1);
  // A null coverage means no mask.
  const plain = makeEngine({ coverage: null });
  for (let i = 0; i < 30; i++) await frame(plain, i * dt, NYC.x, NYC.z);
  check('null coverage: whole-tile chunks carry only the quarter mask', plain.api.calls.every((c) => c.maskEpoch === 0 && (c.level === 0 ? c.mask === null : c.maskCells % 4096 === 0 && (c.mask === null) === (c.maskCells === 0))));
  plain.engine.dispose();

  // Steady state: no array grows, nothing builds, nothing uploads.
  const lens = () => [engine.queue.length, engine.ready.length, engine._births.length, engine._dying.length, engine._lodChunks.length, engine._lodD.length, engine._cand.length, engine.tiles.size, engine.object.children.length, engine._fadePool.size, api.pending.length];
  for (let i = 0; i < 120; i++) await frame(ctx, (t += dt), NYC.x, NYC.z);
  const l0 = lens();
  const b0 = api.calls.length;
  const u0 = engine.stats.uploads;
  for (let i = 0; i < 600; i++) await frame(ctx, (t += dt), NYC.x + Math.sin(i / 20) * 50, NYC.z);
  const l1 = lens();
  check('steady state: no array grows over 600 frames', l0.every((v, i) => l1[i] <= v), `${l0.join(',')} -> ${l1.join(',')}`);
  check('steady state: no builds, no uploads', api.calls.length === b0 && engine.stats.uploads === u0);

  // Drape: coarse first, then every drawn instance re-seated on finer ground.
  ground.z = 13;
  for (let i = 0; i < 600; i++) await frame(ctx, (t += dt), NYC.x, NYC.z);
  let floating = 0;
  let checked = 0;
  for (const tl of engine.tiles.values()) {
    for (const c of tl.live) {
      if (!c.mesh) continue;
      const base = c.base.array;
      const lim = Math.min(c.n, c.count);
      for (let i = 0; i < lim; i++) {
        checked += 1;
        if (base[i] > groundY(c.cx + c.ax[i], c.cz + c.az[i]) + 0.05) floating += 1;
      }
    }
  }
  check('drape: refined ground re-seats every drawn instance (none floats)', checked > 0 && floating === 0 && engine.stats.refined > 0, `${floating} of ${checked}`);
  ground.z = 10;
  engine.dispose();
  check('dispose after the handoff: zero live geometries', engine.liveGeometries === 0);
}

// --- 6. upload admission ------------------------------------------------------------
{
  let allow = false;
  const ctx = makeEngine({ admit: () => allow });
  let t = 0;
  for (let i = 0; i < 60; i++) await frame(ctx, (t += dt), NYC.x, NYC.z);
  check('admission: a refusing frame uploads nothing', ctx.engine.stats.uploads === 0 && ctx.engine.ready.length > 0);
  allow = true;
  for (let i = 0; i < 60; i++) await frame(ctx, (t += dt), NYC.x, NYC.z);
  check('admission: allowed frames upload', ctx.engine.stats.uploads > 0);
  ctx.engine.dispose();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

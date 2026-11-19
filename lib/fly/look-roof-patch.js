/**
 * World Pass D (LOOK, round 2): the late roof photo on the main thread.
 * Stream D owns this file.
 *
 * A 'sat-buildings' build never waits for its photo any more
 * (lib/fly/toy-world/worker/look-roofs.js). It arrives with its roofs on the
 * regional fallback and `result.lookPatch` set; the engine hands that result
 * here (one marked line in sat-building-engine.js), this module asks the SAME
 * worker for the patch, and when it lands:
 *
 *   - the tile is still draping (no mesh yet): the new colours are written
 *     into the bundle's colour array before the geometry is made from it, so
 *     the tile is born with them (CHUNK_FADE's birth hides nothing new);
 *   - the tile is drawn, from THIS bundle (its colour attribute is this very
 *     array, so a rebuild or a re-stream can never be patched by a stale
 *     answer): the roof vertices are faded from the old colour to the new one
 *     over `FADE_MS`, written at most every `STEP_MS`, as one update range of
 *     the colour attribute. No rebuild, no new geometry, no new program;
 *   - anything else (evicted, rebuilt, disposed): dropped.
 *
 * Nothing here runs unless a result carries `lookPatch`, which only a build
 * with look.roofPhoto in the request does: with the flag off this module is
 * never called and starts no frame loop. The fade runs on its own
 * requestAnimationFrame only while a fade is in flight.
 *
 * Live counters (the round-2 acceptance read, never per frame): every engine
 * that handed a result is remembered, and lookRoofStats() sums the roof
 * sources of its READY chunks. window.__flyLookRoofs is that function.
 */

const FADE_MS = 900;
const STEP_MS = 50;
const ENGINES = new Set();
const FADES = [];
let raf = 0;
const totals = { asked: 0, landed: 0, empty: 0, stale: 0, intoBundle: 0, faded: 0, failed: 0, verts: 0, landMsMax: 0 };

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function register(engine) {
  if (ENGINES.has(engine)) return;
  ENGINES.add(engine);
  if (typeof window !== 'undefined') window.__flyLookRoofs = lookRoofStats;
}

/**
 * Called by the engine when a build result arrives (state 'draping').
 * @param engine  the SatBuildingEngine (its `chunks` map and `_disposed`)
 * @param api     the worker that built the result (comlink proxy)
 * @param key     the chunk key 'z/x/y'
 * @param result  the build result (result.lookPatch, result.lookRoofs, result.satBuilding.col)
 */
export function requestLookRoofPatch(engine, api, key, result) {
  if (!result || !result.lookPatch || !api || typeof api.lookRoofPatch !== 'function') return;
  register(engine);
  const chunk = engine.chunks.get(key);
  if (chunk) chunk.lookCounts = result.lookRoofs ?? null;
  if (!chunk) return;
  cancelLookRoofPatch(engine, key);
  const jobs = engine._lookRoofJobs ??= new Map();
  const job = { key, id: result.lookPatch, col: result.satBuilding.col, api, chunk, delay: 0, at: Infinity };
  jobs.set(key, job);
  ask(engine, job);
}

function ask(engine, job) {
  totals.asked += 1;
  const t0 = now();
  job.at = Infinity;
  const current = () => {
    if (engine._lookRoofJobs?.get(job.key) !== job) return false;
    const resident = engine.chunks.get(job.key);
    if (!engine._disposed && resident === job.chunk &&
      (resident.mesh?.geometry.getAttribute('color')?.array === job.col ||
       engine.pendingFinalize.some(p => p.key === job.key && p.result?.satBuilding?.col === job.col))) return true;
    cancelLookRoofPatch(engine, job.key);
    return false;
  };
  Promise.resolve().then(() => current() ? job.api.lookRoofPatch(job.id) : null)
    .then(patch => {
      if (!current()) return;
      if (!patch?.unchanged && (patch?.verts?.length || !patch?.retry)) land(engine, job, patch, t0);
      if (patch?.retry) retry(job);
      else engine._lookRoofJobs.delete(job.key);
    }).catch(() => {
      if (current()) { totals.failed++; retry(job); }
    });
}

function retry(job) {
  job.delay = Math.min(60000, (job.delay || 2500) * 2);
  job.at = now() + job.delay;
}

// Flight ticks admit one due retry per second. Sleeping jobs have no timer,
// no reference to the full geometry bundle, and end with the chunk residency.
export function pumpLookRoofRetries(engine) {
  const jobs = engine._lookRoofJobs;
  if (!jobs?.size) return;
  const t = now();
  if (t < (engine._lookRoofPoll ?? 0)) return;
  engine._lookRoofPoll = t + 1000;
  let inFlight = 0, next = null;
  for (const job of jobs.values()) {
    if (job.at === Infinity && job.delay > 0) inFlight++;
    else if (job.at <= t && (!next || job.at < next.at)) next = job;
  }
  if (next && inFlight < 2) ask(engine, next);
}

export function cancelLookRoofPatch(engine, key) {
  const jobs = engine._lookRoofJobs;
  const job = jobs?.get(key);
  if (!job) return;
  jobs.delete(key);
  Promise.resolve().then(() => job.api.lookRoofPatch(job.id, 'cancel')).catch(() => {});
  job.col = null;
  job.chunk = null;
}

export function disposeLookRoofPatches(engine) {
  for (const key of engine._lookRoofJobs?.keys() ?? []) cancelLookRoofPatch(engine, key);
  ENGINES.delete(engine);
}

function land(engine, job, patch, t0) {
  const { key, col } = job;
  const ms = now() - t0;
  if (ms > totals.landMsMax) totals.landMsMax = ms;
  const chunk = engine.chunks.get(key);
  if (engine._disposed || !chunk || !col) return void (totals.stale += 1);
  if (!patch || !patch.verts || !patch.verts.length) {
    totals.empty += 1;
    if (chunk.lookCounts) chunk.lookCounts = { ...chunk.lookCounts, photoMissing: 1 };
    return;
  }
  const attr = chunk.mesh && chunk.mesh.geometry ? chunk.mesh.geometry.getAttribute('color') : null;
  if (attr && attr.array === col) {
    if (!chunk.mesh.parent) return void (totals.stale += 1);
    startFade(chunk, chunk.mesh, attr, patch);
  } else if (!chunk.mesh && chunk.state === 'draping' && engine.pendingFinalize.some((p) => p.key === key && p.result?.satBuilding?.col === col)) {
    writeAll(col, patch.verts, patch.col);
    totals.intoBundle += 1;
  } else return void (totals.stale += 1);
  totals.landed += 1;
  totals.verts += patch.verts.length;
  chunk.lookCounts = patch.counts ?? chunk.lookCounts;
  chunk.lookLandedMs = ms;
}

function writeAll(arr, verts, to) {
  for (let i = 0; i < verts.length; i++) {
    const o = verts[i] * 3;
    arr[o] = to[i * 3];
    arr[o + 1] = to[i * 3 + 1];
    arr[o + 2] = to[i * 3 + 2];
  }
}

function startFade(chunk, mesh, attr, patch) {
  const arr = attr.array;
  const v = patch.verts;
  const from = new arr.constructor(v.length * 3);
  let lo = Infinity, hi = -1;
  for (let i = 0; i < v.length; i++) {
    const o = v[i] * 3;
    from[i * 3] = arr[o];
    from[i * 3 + 1] = arr[o + 1];
    from[i * 3 + 2] = arr[o + 2];
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
  }
  FADES.push({ chunk, mesh, attr, v, from, to: patch.col, int: arr instanceof Uint8Array, lo, hi, t0: now(), last: -Infinity });
  totals.faded += 1;
  if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
}

function tick() {
  raf = 0;
  const t = now();
  for (let f = FADES.length - 1; f >= 0; f--) {
    const F = FADES[f];
    const alive = F.chunk.mesh === F.mesh && !!F.mesh.parent;
    if (!alive) {
      FADES.splice(f, 1);
      continue;
    }
    const done = t - F.t0 >= FADE_MS;
    if (!done && t - F.last < STEP_MS) continue;
    F.last = t;
    const x = Math.min(1, (t - F.t0) / FADE_MS);
    const k = x * x * (3 - 2 * x);
    const arr = F.attr.array;
    for (let i = 0; i < F.v.length; i++) {
      const o = F.v[i] * 3;
      for (let c = 0; c < 3; c++) {
        const a = F.from[i * 3 + c], b = F.to[i * 3 + c];
        arr[o + c] = F.int ? Math.round(a + (b - a) * k) : a + (b - a) * k;
      }
    }
    if (typeof F.attr.addUpdateRange === 'function') {
      F.attr.clearUpdateRanges?.();
      F.attr.addUpdateRange(F.lo * 3, (F.hi - F.lo + 1) * 3);
    }
    F.attr.needsUpdate = true;
    if (done) FADES.splice(f, 1);
  }
  if (FADES.length && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
}

/**
 * The roof sources over every READY chunk of the engines seen so far, plus the
 * patch totals. `photoShare` = roofs coloured from the z16 photo (own read,
 * structure mates, block median, tall family with the photo's luma) over all
 * roofs; `ownShare` = own reads only.
 */
export function lookRoofStats() {
  const s = { chunks: 0, waiting: 0, roofs: 0, photo: 0, structure: 0, block: 0, tall: 0, tallFallback: 0, regional: 0, neighbour: 0, neutral: 0, photoMissing: 0, fading: FADES.length, ...totals };
  for (const engine of ENGINES) {
    if (engine._disposed) continue;
    for (const chunk of engine.chunks.values()) {
      if (chunk.state !== 'ready' || !chunk.mesh || !chunk.lookCounts) continue;
      const c = chunk.lookCounts;
      s.chunks += 1;
      if (c.photoMissing) s.photoMissing += 1;
      s.roofs += c.n || 0;
      for (const k of ['photo', 'structure', 'block', 'tall', 'tallFallback', 'regional', 'neighbour', 'neutral']) s[k] += c[k] || 0;
      if (!(c.photo || c.structure || c.block || c.tall)) s.waiting += 1;
    }
  }
  const fromPhoto = s.photo + s.structure + s.block + s.tall;
  s.photoShare = s.roofs ? fromPhoto / s.roofs : 0;
  s.ownShare = s.roofs ? s.photo / s.roofs : 0;
  return s;
}

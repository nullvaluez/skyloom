/**
 * World Pass W0 (worker split): ONE context object per satellite build,
 * handed to every builder module in this folder.
 *
 * It carries the tile frame the worker has always computed (tileSpan,
 * mercX0, mercYTop, cx, cz, k, t0 and the per-mode request fields such as
 * visuals / trueAreas / cityRange / worldCover), spread first so every field
 * keeps the exact value the builders used to read off `frame`, plus:
 *   z, x, y, detail   the tile id and the detail mode
 *   vt, layers        the decoded tile (@mapbox/vector-tile) and its layers
 *   extent            the building layer's extent (null when the tile has none)
 *   areaK, kA         the TRUE_AREAS latitude terms (exactly the expressions
 *                     the near and far builders computed inline)
 *   options           the raw build request
 *   v                 WORKER_PROTOCOL (the worker owns the constant)
 *   diag, clutterOnly the worker-global api.setDiag / api.setClutterOnly
 *                     switches, read once per build (the builders are
 *                     synchronous, so this is the value they read before)
 *   worldPass         the request's `worldPass` object (lib/fly/world-pass.js
 *                     worldPassRequest()) or WORLD_PASS_OFF
 *
 * Rule 1 of the World Pass: a worker has no pins (lib/fly/fly-pins.js), so it
 * never reads a World Pass flag block. Flags are resolved on the main thread
 * and arrive here, in the request, as `options.worldPass`. A builder asks
 * `tileCtx.worldPass.<stream>.on` (and its sub-switches); with every flag off
 * that is WORLD_PASS_OFF and nothing may read differently from an absent one.
 */
import { areaNormK } from '../../true-areas';

const OFF_STREAMS = {
  truth: ['heights', 'typology', 'smallBand', 'roofs'],
  arrival: ['fastQuery', 'drapeCap', 'workerPrep', 'uploads', 'footings', 'readiness'],
  reach: ['standIns'],
  look: ['roofPhoto', 'walls', 'structures', 'authority'],
  ground: ['trees', 'bridges'],
};

function freezeDeep(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') freezeDeep(v);
  return Object.freeze(o);
}

/**
 * The all-off request, the same shape lib/fly/world-pass.js builds with every
 * flag off (schema v1, key 'wp1-0'). Kept here because the worker cannot import
 * that module (it reads the store and the pins).
 */
const WORLD_PASS_OFF = (() => {
  const req = { v: 1, key: 'wp1-0', any: false, tier: null };
  for (const [stream, subs] of Object.entries(OFF_STREAMS)) {
    const sec = { on: false };
    for (const s of subs) sec[s] = false;
    sec.worker = null;
    req[stream] = sec;
  }
  return freezeDeep(req);
})();

/** The request's worldPass object, or WORLD_PASS_OFF when it is absent or malformed. */
function worldPassOf(options) {
  const wp = options ? options.worldPass : null;
  return wp && typeof wp === 'object' && wp.any === true ? wp : WORLD_PASS_OFF;
}

/**
 * @param vt     decoded VectorTile
 * @param frame  the tile frame object the worker builds for this mode
 * @param meta   { z, x, y, detail, options, v, diag, clutterOnly }
 */
function createTileCtx(vt, frame, meta) {
  const k = frame.k;
  const areaK = areaNormK(k, frame.trueAreas === true);
  const kA = areaK === 1 ? k : k * Math.sqrt(areaK);
  const building = vt.layers.building;
  return {
    ...frame,
    z: meta.z,
    x: meta.x,
    y: meta.y,
    detail: meta.detail,
    vt,
    layers: vt.layers,
    extent: building ? building.extent : null,
    areaK,
    kA,
    options: meta.options || {},
    v: meta.v,
    diag: meta.diag === true,
    clutterOnly: meta.clutterOnly === true,
    worldPass: worldPassOf(meta.options),
  };
}

export { createTileCtx, worldPassOf, WORLD_PASS_OFF };

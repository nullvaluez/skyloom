/**
 * HORIZON FILL (FLY_HORIZON_FILL.md, stream A DATA): the fill worker.
 *
 * A thin comlink wrapper over the height-tile source (height-tiles.js) and
 * the generator (fill-gen.js). It never reads a flag or `window`: the resolved
 * config arrives in init(config) (`{ ...horizonFillConfig(), footprintK }`).
 * Next.js compiles `typeof window` to "object" inside worker bundles, so
 * nothing this file imports may touch `window`, fly-constants, three or
 * zustand.
 *
 *   api.init(config)       -> { ok: true, v }
 *   api.prefetch(tiles)    [[tx, ty], ...] nearest first; returns at once
 *   api.buildChunk(req)    -> FillChunk, its typed arrays transferred
 *   api.stats()            source and generator counters
 */
import { expose, transfer } from 'comlink';
import { createHeightTiles } from './height-tiles.js';
import { FILL_GEN_VERSION, emptyFillChunk, generateFillChunk, normaliseFillConfig } from './fill-gen.js';

let source = null;
let config = null;
const gen = { chunks: 0, instances: 0, genMsMax: 0, genMsSum: 0, missing: 0, empty: 0, errors: 0 };

function transferChunk(chunk) {
  const list = [];
  for (const k of ['ax', 'az', 'dim', 'wall', 'roof', 'gnd', 'size']) {
    const a = chunk[k];
    if (a && a.buffer && a.byteLength > 0) list.push(a.buffer);
  }
  return list.length ? transfer(chunk, list) : chunk;
}

const api = {
  init(cfg = {}) {
    config = normaliseFillConfig(cfg);
    source = createHeightTiles({
      fetchImpl: typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      cachesImpl: globalThis.caches ?? null,
      config: cfg,
    });
    return { ok: true, v: FILL_GEN_VERSION };
  },

  prefetch(tiles) {
    if (!source || !Array.isArray(tiles)) return 0;
    return source.prefetch(tiles);
  },

  async buildChunk(req = {}) {
    if (!source) source = createHeightTiles({ fetchImpl: typeof fetch === 'function' ? fetch.bind(globalThis) : null, cachesImpl: globalThis.caches ?? null, config: {} });
    if (!config) config = normaliseFillConfig({});
    let chunk;
    try {
      const codes = await source.get(req.tx, req.ty);
      if (!codes) {
        gen.missing++;
        chunk = emptyFillChunk(req, 'missing', 'height tile unavailable');
      } else {
        const t0 = performance.now();
        chunk = generateFillChunk(codes, req, config);
        const ms = performance.now() - t0;
        gen.chunks++;
        gen.instances += chunk.n;
        gen.genMsSum += ms;
        if (ms > gen.genMsMax) gen.genMsMax = ms;
        if (chunk.status === 'empty') gen.empty++;
      }
    } catch (error) {
      gen.errors++;
      chunk = emptyFillChunk(req, 'missing', String(error?.message ?? error));
    }
    return transferChunk(chunk);
  },

  stats() {
    return { ...(source ? source.stats() : {}), ...gen, genMsAvg: gen.chunks ? gen.genMsSum / gen.chunks : 0 };
  },
};

expose(api);

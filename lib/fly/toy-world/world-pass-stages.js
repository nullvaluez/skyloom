/**
 * World Pass W0: main-thread sums of the worker's per-tile stage counters
 * (lib/fly/toy-world/worker/stages.js), for satBuildings.stats.wpStages and
 * satSkyline.stats.wpStages. Present only while the engine turned the worker's
 * diag switch on (lib/fly/world-pass.js worldPassDiag), so the shipped stats
 * keep their key set.
 *
 * Numbers add; `*Hist` objects (integer-metre bins) add bin-wise, and the
 * matching `*P50` / `*P90` are recomputed from the summed histogram; `ring`
 * is carried; anything else is ignored.
 */
import { histPercentile } from './worker/stages';

function addInto(acc, rec) {
  for (const [k, v] of Object.entries(rec)) {
    if (k === 'tiles') continue; // counted by sumStageRecords
    if (typeof v === 'number') acc[k] = (acc[k] ?? 0) + v;
    else if (k.endsWith('Hist') && v && typeof v === 'object') {
      const h = (acc[k] ??= {});
      for (const [b, n] of Object.entries(v)) h[b] = (h[b] ?? 0) + n;
    } else if (v && typeof v === 'object') addInto((acc[k] ??= {}), v);
    else if (k === 'ring' && acc.ring === undefined) acc.ring = v;
  }
}

function percentiles(o) {
  for (const [k, v] of Object.entries(o)) {
    if (k.endsWith('Hist')) {
      const base = k.slice(0, -4);
      o[`${base}P50`] = histPercentile(v, 0.5);
      o[`${base}P90`] = histPercentile(v, 0.9);
    } else if (v && typeof v === 'object') percentiles(v);
  }
}

/**
 * Sum per-tile stage records. `records` is any iterable of objects (null
 * entries skipped); a record that is itself a sum (it has `tiles`) counts as
 * that many tiles, so a skyline group's record can be summed again. Returns
 * { tiles, ...summed counters }.
 */
export function sumStageRecords(records) {
  const acc = { tiles: 0 };
  for (const r of records) {
    if (!r) continue;
    acc.tiles += typeof r.tiles === 'number' ? r.tiles : 1;
    addInto(acc, r);
  }
  percentiles(acc);
  return acc;
}

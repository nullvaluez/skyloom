/**
 * R25 B FLIGHT PLAN — the Atlas search ranking and warp parameters, moved out
 * of components/fly/hud/Atlas.jsx so the hangar's Free Flight search ranks
 * exactly the way the Atlas always has. Atlas imports both; its behaviour is
 * unchanged (scripts/verify-r25-flight-plan.mjs replays the old inline ranking
 * over 60 queries and requires identical result lists).
 *
 * Pure functions: no React, no store, no DOM.
 */

/**
 * Rank Atlas entries (lib/fly/poi buildAtlasList shape: {name, search, ...})
 * for a free-text query. Verbatim the Atlas.jsx ranking: name-start match
 * first, then any-name match, then tags/sub; ties by match index, then by
 * shorter name. The scan stops after 401 hits exactly as before.
 *
 * @param {Array} entries  Atlas entries
 * @param {string} query   raw user text
 * @param {number} max     result cap
 * @returns {Array} up to `max` entries
 */
export function rankAtlasEntries(entries, query, max) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const e of entries) {
    const idx = e.search.indexOf(q);
    if (idx < 0) continue;
    // rank: name-start match first, then any-name match, then tags/sub
    const nameIdx = e.name.toLowerCase().indexOf(q);
    hits.push({ e, rank: nameIdx === 0 ? 0 : nameIdx > 0 ? 1 : 2, idx });
    if (hits.length > 400) break;
  }
  hits.sort((a, b) => a.rank - b.rank || a.idx - b.idx || a.e.name.length - b.e.name.length);
  return hits.slice(0, max).map((h) => h.e);
}

/**
 * Warp spawn parameters per destination kind (FLY_ATLAS_REWORK §4.1).
 * `rand` defaults to Math.random (the Atlas's randomized approach bearing, so
 * revisits vary); Free Flight passes a deterministic one so a staged
 * destination and its launch agree, and Continue relaunches exactly.
 */
export function warpOptsFor(entry, rand = Math.random) {
  if (entry.kind === 'military' || entry.kind === 'hotspot') {
    // The planes are AROUND a base, not on it: arrive ~4km out at ~1200m,
    // nose toward the point (bearing randomized so revisits vary).
    return { altM: 1200, offsetM: 4000, offsetBearingRad: rand() * Math.PI * 2 };
  }
  return { altM: 800 };
}

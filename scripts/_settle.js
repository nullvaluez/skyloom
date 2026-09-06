/**
 * R24 (E CERT) — ONE definition of "the world has settled".
 *
 * Every content gate in this venue needs it, and a fixed `waitForTimeout` is
 * the wrong instrument for two opposite reasons, both measured here:
 *
 *  · TOO SHORT. The terrain quadtree takes ~150 s to descend from z2 to z17 at
 *    Powell under SwiftShader, throttled by three-tile's
 *    `downloadingThreads + 4 >= maxThreads` freeze (recon T3; measured pinned
 *    at 8–9 of 10 for the whole descent). A 45 s settle censuses a world whose
 *    ground is still a z6 average — 193 m against the true 276 m — and every
 *    satellite building drape sample then reads below `SAT_BUILDINGS.demZ`.
 *  · TOO LONG, AND STILL WRONG. With the finalize-budget scaler on, chunks can
 *    reach `ready` in 13 s — but at maxZ 5, i.e. with `coarse: true`, because
 *    the drape exhausted `drapeMaxTries` on a shallow DEM and committed
 *    anyway. A gate that sleeps and then counts would count real chunks draped
 *    at the wrong height and call it settled.
 *
 * So "settled" is a CONDITION, not a duration:
 *   1. the terrain has descended (maxZ >= `minZ`, default 14), and
 *   2. the ground elevation under the aircraft has stopped moving (< 0.5 m
 *      over the last two samples), and
 *   3. every satellite building chunk has RESOLVED — `ready + empty ===
 *      chunks` — so nothing is still draping, and
 *   4. `__flyStats.drawCalls` has been republished since we asked (FlyScene
 *      publishes every 60 frames, which at ~2 fps is every 30 s, so a total
 *      read without this is the PREVIOUS pose's).
 *
 * Every wait is capped and every return says WHY it returned, so a gate can
 * report "settled in 74 s" or "gave up at the cap with 3 chunks still draping"
 * instead of silently measuring a half-built world.
 */

const DEFAULTS = {
  minZ: 14,
  capMs: 420000,
  pollMs: 4000,
  quietSamples: 2,
  requireChunks: true,
};

/**
 * @returns {Promise<{settled: boolean, why: string, ms: number, maxZ: number,
 *   groundElev: number, sb: object|null, tiles: number}>}
 */
async function settleWorld(page, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const t0 = Date.now();
  let lastGe = null;
  let quiet = 0;
  let last = null;

  while (Date.now() - t0 < o.capMs) {
    last = await page.evaluate(() => {
      const eng = window.__fly?.engine;
      let maxZ = 0;
      let tiles = 0;
      eng?.object?.traverse((t) => {
        if (t.isTile) {
          tiles++;
          if ((t.z ?? 0) > maxZ) maxZ = t.z;
        }
      });
      const s = window.__satBuildings?.stats ?? null;
      return {
        maxZ,
        tiles,
        groundElev: window.__fly?.flight?.groundElev ?? null,
        sb: s ? { chunks: s.chunks, ready: s.ready, empty: s.empty } : null,
      };
    });

    const geQuiet =
      lastGe != null && last.groundElev != null && Math.abs(last.groundElev - lastGe) < 0.5;
    lastGe = last.groundElev;
    quiet = geQuiet ? quiet + 1 : 0;

    const chunksResolved =
      !o.requireChunks ||
      !last.sb ||
      last.sb.chunks === 0 ||
      last.sb.ready + last.sb.empty >= last.sb.chunks;

    if (last.maxZ >= o.minZ && quiet >= o.quietSamples && chunksResolved) {
      // One more thing: force a FRESH scene-total publish, because FlyScene
      // republishes __flyStats only every 60 frames.
      await page.evaluate(() => {
        if (window.__flyStats) window.__flyStats.drawCalls = null;
      });
      const got = await page
        .waitForFunction(() => typeof window.__flyStats?.drawCalls === 'number', undefined, {
          timeout: Math.max(30000, o.capMs - (Date.now() - t0)),
          polling: 500,
        })
        .then(() => true)
        .catch(() => false);
      return {
        settled: true,
        why: got ? 'terrain + chunks + fresh totals' : 'terrain + chunks (totals stale)',
        ms: Date.now() - t0,
        ...last,
      };
    }
    await page.waitForTimeout(o.pollMs);
  }

  const why = [];
  if ((last?.maxZ ?? 0) < o.minZ) why.push(`terrain only reached z${last?.maxZ ?? 0} of ${o.minZ}`);
  if (quiet < o.quietSamples) why.push('ground elevation still moving');
  if (last?.sb && last.sb.ready + last.sb.empty < last.sb.chunks)
    why.push(`${last.sb.chunks - last.sb.ready - last.sb.empty} chunk(s) still draping`);
  return {
    settled: false,
    why: why.join('; ') || 'cap reached',
    ms: Date.now() - t0,
    ...(last || {}),
  };
}

module.exports = { settleWorld };

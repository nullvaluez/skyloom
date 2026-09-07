/**
 * R24 (E CERT) — THE STATIC-TERRAIN WITNESS for pixel A/B pairs.
 *
 * WHY THIS EXISTS. Every pixel A/B in the night gates rests on an unstated
 * premise: that the only thing changing between two captures is the thing the
 * probe toggled. That premise was true enough when terrain was a static
 * surface. It is not true with LOD_CROSSFADE shipped ON: a blend interpolates a
 * tile's texels between parent and child over a FADE CLOCK of 0.25 s advanced
 * by min(dt, 0.05) per RENDERED frame — a floor of five rendered frames, which
 * at this venue's ~0.5 fps is about TEN SECONDS. A two-second capture pair
 * routinely straddles one, and then both frames of the pair differ everywhere
 * the terrain is mid-blend.
 *
 * MEASURED, on the w6 flipped tree (scripts/r24-out/w6/evict-diag.log): the
 * sat-night eviction A/B read gone 8.69 against 2.55 on the unflipped tree —
 * but its own SAME-STATE noise control rose further, 1.04 -> 4.12 (x3.96
 * against the signal's x3.41), and the delta images show both pairs spread
 * across the WHOLE terrain band (noise grid min 2.12 / max 70.7; A/B min 0.44 /
 * max 41.9) rather than confined to building footprints. A same-state pair
 * contains no eviction and no building change, so a common additive term lifted
 * both pairs together. The eviction did not become visible; the terrain stopped
 * holding still.
 *
 * THE FIX IS TO RESTORE THE PREMISE, NOT TO WIDEN THE TOLERANCE. No bound in
 * any gate moves. A pair is taken only when the terrain is quiet, and "quiet"
 * is counted in RENDERED FRAMES, never in wall clock — the round's own lesson,
 * six times over.
 *
 * TWO CONDITIONS, because either alone passes a bad pair:
 *   - `terra.fades.active === 0` — no crossfade in progress. D's counter, read
 *     at the address D publishes: `window.__flyStats.terra.fades`. (My first
 *     diagnostic read `window.__flyTerra.fades()`, which nothing writes, and
 *     duly reported `null` at all four captures — §6, in the instrument written
 *     to settle a §6 argument.)
 *   - `downloading === 0` — no tile arrivals in flight. A crossfade witness
 *     alone would happily pass a pair that straddles a HARD arrival, and the
 *     diagnostic's own draw counts show exactly that risk: 80 / 80 / 100 / 127
 *     across four captures at one pinned pose. Read the way A's converged
 *     settle reads it, from the engine or the map.
 *
 * RED: FLY_TERRAIN_WITNESS=0 disables the wait entirely, restoring the
 * pre-witness program — which on this venue reproduces the numbers above.
 */

const WITNESS_ON = process.env.FLY_TERRAIN_WITNESS !== '0';
const STABLE_FRAMES = Number(process.env.FLY_WITNESS_FRAMES || 3);
const CAP_MS = Number(process.env.FLY_WITNESS_CAP_MS || 120000);

/** In-page: resolve once terrain has been still for `stableFrames` rAF ticks. */
const WAIT_STILL = ([stableFrames, capMs]) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    let frames = 0;
    let stable = 0;
    let moving = 'nothing yet';
    const read = () => {
      const f = window.__flyStats?.terra?.fades;
      const eng = window.__flyTerra?.engine?.();
      const map = eng?.map ?? window.__flyTerra?.get?.();
      const dl = typeof eng?.downloading === 'number' ? eng.downloading : (map?.downloading ?? 0);
      return { active: f?.active ?? null, faded: f?.faded ?? null, dl };
    };
    const step = () => {
      frames++;
      const { active, faded, dl } = read();
      if (dl !== 0) moving = `downloads in flight (${dl})`;
      else if (active) moving = `crossfades active (${active})`;
      else moving = null;
      stable = moving ? 0 : stable + 1;
      if (stable >= stableFrames)
        return resolve({ ok: true, frames, ms: performance.now() - t0, active, faded, dl });
      if (performance.now() - t0 > capMs)
        return resolve({ ok: false, frames, ms: performance.now() - t0, active, faded, dl, moving });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

/**
 * Returns `still(label)`. Awaiting it holds until the terrain is quiet, and
 * returns what it observed either way — a capped wait is REPORTED, never
 * silent, because a pair taken on moving terrain is not a measurement and the
 * next reader has to be able to see that it was one.
 */
function makeStillTerrain(page, { label: gateLabel = '' } = {}) {
  let capped = 0;
  return {
    still: async (label = '') => {
      if (!WITNESS_ON) return { ok: null, skipped: true };
      const r = await page.evaluate(WAIT_STILL, [STABLE_FRAMES, CAP_MS]);
      if (!r.ok) {
        capped += 1;
        console.log(
          `      *** terrain never held still${gateLabel ? ` [${gateLabel}]` : ''}${
            label ? ` before ${label}` : ''
          }: still ${r.moving} after ${(r.ms / 1000).toFixed(0)}s / ${r.frames} frames ` +
            `(fades.active ${r.active}, downloading ${r.dl}). The capture below is taken on ` +
            'MOVING terrain, so any A/B computed from it carries the terrain\'s own delta.'
        );
      }
      return r;
    },
    cappedCount: () => capped,
  };
}

module.exports = { makeStillTerrain, WITNESS_ON };

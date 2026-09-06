/**
 * R24 C (POST_ORDER, recon L6) — the ONE place that decides per-PASS state the
 * descriptor list cannot express.
 *
 * `buildPassList` (components/fly/Effects.jsx) is the single source of truth
 * for WHICH effects exist and in what order, and both the production composer
 * and `lib/fly/prewarm.js` build their chains from it. But dithering is a
 * property of the merged EffectPass, not of any one effect, and it is only
 * correct on the LAST pass — so it cannot live in a descriptor. Putting it in
 * one exported function that BOTH assemblers call is what keeps the pre-warm
 * compiling the same program production runs: `EffectPass.dithering = true`
 * sets `material.dithering`, which makes three inject `#define DITHERING`, so
 * a dithered pass and an un-dithered one are DIFFERENT PROGRAMS.
 *
 * WHY DITHER AT ALL: the final pass encodes to 8-bit sRGB
 * (`<colorspace_fragment>` under ENCODE_OUTPUT, then the canvas). Nothing added
 * noise before that quantisation, so the SkyDome's `pow(y, 0.55)` gradient and
 * every deep-night sky banded — visible contours across a smooth ramp, and
 * exactly the kind of large-scale low-contrast structure that reads as the
 * screen "glitching" rather than as a shading artifact.
 *
 * WHAT THE DITHER IS: three's `<dithering_fragment>` chunk — a PER-PIXEL hash
 * of `gl_FragCoord` scaled to ±0.5 LSB, applied AFTER the color-space encode
 * and immediately before quantisation. It is deliberately NOT an ordered /
 * Bayer / screen-door pattern: an ordered matrix is a fixed spatial texture
 * that survives every frame in the same place and can itself read as a crawling
 * grid at reduced DPR (recon A7's complaint about the R21 Bayer dissolve). A
 * per-pixel hash has no repeating structure to alias.
 */
import { POST_ORDER } from './fly-constants';

/**
 * Apply per-pass policy to an assembled chain. Idempotent, never throws, and
 * an exact no-op with the flag off (which is what makes flag-off byte-identity
 * a property of the code rather than of a measurement).
 *
 * @param {Array} passes assembled EffectPass/Pass list, in composer order
 * @returns {Array} the same array
 */
export function finishPassChain(passes) {
  if (!POST_ORDER.enabled || !POST_ORDER.dither || !Array.isArray(passes)) return passes;
  for (let i = passes.length - 1; i >= 0; i--) {
    const p = passes[i];
    if (!p) continue;
    try {
      // Only an EffectPass exposes `dithering`; a bare Pass child (none today)
      // is skipped rather than crashing the assembly.
      if ('dithering' in p) {
        if (p.dithering !== true) p.dithering = true;
        return passes;
      }
    } catch {
      // A library shape change must cost a dither, never a frame.
      return passes;
    }
  }
  return passes;
}

/**
 * R24 C (SHADOW_CALM — recon L5 / FL-12) — a stable shadow kernel, and the
 * reversed-depth BIAS SIGN three r185 flips in two of its three shadow paths
 * and not in the third.
 *
 * ── DEFECT 1: THE BIAS SIGN ──────────────────────────────────────────────
 * This canvas runs `reversedDepthBuffer: true`, and three propagates that into
 * the shadow path properly in most places: `shadow.camera._reversedDepth =
 * reversedDepthBuffer` (three.module.js:9250) and the sampler comparison flips
 * to `GreaterEqualCompare` (:9312). But look at `shadowmap_pars_fragment`:
 *
 *   SHADOWMAP_TYPE_VSM    -> #ifdef USE_REVERSED_DEPTH_BUFFER  z -= bias  #else z += bias
 *   SHADOWMAP_TYPE_BASIC  -> #ifdef USE_REVERSED_DEPTH_BUFFER  z -= bias  #else z += bias
 *   SHADOWMAP_TYPE_PCF    -> z += bias            (unconditional)
 *
 * PCF is the type this app runs (R3F passes `shadows` -> PCFSoftShadowMap,
 * which three r185 deprecates to PCFShadowMap at :9148). Under a REVERSED
 * shadow map, near = 1 and far = 0, and the comparison is "lit if ref >=
 * stored" — so biasing toward LIT means making the reference LARGER. The
 * authored bias is NEGATIVE (`-0.0002` toy, `-0.0004` satellite), which was
 * correct for the non-reversed convention it was tuned in, so `z += bias`
 * makes the reference SMALLER and biases every receiver toward SHADOWED. It
 * is the R21 P8 polygonOffset-units defect one layer down: three flips the
 * sign for you in the branches it thought about, and not in the one you use.
 *
 * SCALE: the toy shadow camera is `near 1 / far 8000` orthographic, so depth
 * is linear and 0.0002 of depth is 0.0002 x 7999 = ~1.6 m of world depth,
 * pushed the wrong way. THAT is what `normalBias: 4` is compensating for —
 * 4 m of normal offset on a 0.78 m/texel map is 5.1 texels of peter-panning
 * bought to hide a 1.6 m sign error. Fixing the sign is what makes
 * `SHADOW_CALM.toyNormalBias` credible.
 *
 * ── DEFECT 2: THE ROTATING KERNEL ────────────────────────────────────────
 * PCF's 5-tap Vogel disk is rotated by
 * `interleavedGradientNoise( gl_FragCoord.xy )`. That is a SCREEN-SPACE hash:
 * when the camera moves, every fragment gets a different rotation than the
 * one that covered that piece of world last frame, so the filtered edge
 * changes shape every frame. There is no temporal filter anywhere in this
 * renderer to average it out (recon FL-11), so it reads as crawling sparkle —
 * and on buildings, as the buildings themselves flickering.
 *
 *   kernel 'world' (default): hash the SHADOW-MAP texel coordinate instead.
 *     Identical cost, identical tap pattern statistics, but the rotation is
 *     glued to the world: the camera can move without changing any fragment's
 *     kernel. Combined with the texel snap in FlyScene (which quantises the
 *     shadow UV origin), the pattern is stationary while the sun holds still.
 *   kernel 'fixed': phi = 0. Fully deterministic, trades the dither for mild
 *     banding on soft edges. Kept as the fallback if 'world' still shimmers on
 *     the user's machine.
 *
 * ── WHY A ShaderChunk OVERRIDE AND NOT three's CSM.js ────────────────────
 * CSM.js patches materials through `onBeforeCompile`, which is precisely the
 * hook every world-bend variant already owns, and it would re-key all 15 FINAL
 * cache keys (recon L5). A ShaderChunk edit changes the TEXT every shadow
 * receiver compiles without touching a single material, a single cache key or
 * a single prewarm entry. It must therefore run BEFORE the first compile:
 * `installShadowKernel()` is called from FlyScene's module body.
 *
 * Flag off: this module makes no edit at all and every shadow program is
 * byte-identical.
 */
import { ShaderChunk } from 'three';
import { SHADOW_CALM } from './fly-constants';

// The exact PCF-branch text, verbatim from three 0.185.1. Matching the WHOLE
// three-line prologue (rather than the `z += shadowBias` line alone) is what
// keeps this scoped to the PCF getShadow: VSM and BASIC already carry the
// #ifdef form and must not be touched, and getPointShadow does not contain it.
const PCF_BIAS_FROM =
  'float shadow = 1.0;\n\t\t\tshadowCoord.xyz /= shadowCoord.w;\n\t\t\tshadowCoord.z += shadowBias;';
const PCF_BIAS_TO =
  'float shadow = 1.0;\n\t\t\tshadowCoord.xyz /= shadowCoord.w;\n' +
  '\t\t\t#ifdef USE_REVERSED_DEPTH_BUFFER\n' +
  '\t\t\t\tshadowCoord.z -= shadowBias;\n' +
  '\t\t\t#else\n' +
  '\t\t\t\tshadowCoord.z += shadowBias;\n' +
  '\t\t\t#endif';

// Anchored on the line above it so only the DIRECTIONAL getShadow is rewritten;
// getPointShadow has the same phi line and no point lights exist in this scene.
const PHI_FROM =
  'float radius = shadowRadius * texelSize.x;\n' +
  '\t\t\t\tfloat phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;';
// R24 C: an ALLOW-LIST, not a default. Written as a set after
// `scripts/verify-shadow-calm.mjs` caught the first version treating every
// unrecognised name as 'world' — so a typo in the constants block would have
// silently shipped a kernel nobody asked for, in a feature whose whole subject
// is a kernel nobody could see. Unknown names now fall through to "no patch",
// which is the same outcome as 'three' and is the safe direction.
const KERNELS = new Set(['world', 'fixed']);
const PHI_TO = (mode) =>
  'float radius = shadowRadius * texelSize.x;\n' +
  (mode === 'fixed'
    ? '\t\t\t\tfloat phi = 0.0;'
    : '\t\t\t\tfloat phi = interleavedGradientNoise( shadowCoord.xy * shadowMapSize ) * PI2;');

const _state = { installed: false, biasSign: false, kernel: null };

/**
 * The patch itself, as a PURE function of the chunk text — no module state, no
 * three, no flags read from anywhere but the argument.
 *
 * It is separated from `installShadowKernel` for one reason: this is the only
 * part of SHADOW_CALM a node gate can execute. `scripts/verify-shadow-calm.mjs`
 * calls it against three's REAL chunk text with the options forced BOTH ways,
 * which is a stronger statement than any structural scan of this file — it
 * proves what the renderer would actually compile, in a container that cannot
 * run a renderer. Keep it pure.
 *
 * @param {string} src three's `ShaderChunk.shadowmap_pars_fragment`
 * @param {{biasSignFix?: boolean, kernel?: string}} opts
 * @returns {{src: string, biasSign: boolean, kernel: string|null}}
 */
export function r24PatchShadowChunk(src, opts = {}) {
  let out = src;
  let biasSign = false;
  let kernel = null;
  if (opts.biasSignFix && out.includes(PCF_BIAS_FROM)) {
    out = out.replace(PCF_BIAS_FROM, PCF_BIAS_TO);
    biasSign = true;
  }
  const mode = opts.kernel;
  if (KERNELS.has(mode) && out.includes(PHI_FROM)) {
    out = out.replace(PHI_FROM, PHI_TO(mode));
    kernel = mode;
  }
  return { src: out, biasSign, kernel };
}

/**
 * Install the kernel patches into three's shared ShaderChunk table. Idempotent,
 * never throws: a library text change must cost a shadow refinement, never a
 * boot. Returns the state object (also read by verify-shadow-calm).
 */
export function installShadowKernel() {
  if (_state.installed || !SHADOW_CALM.enabled) return _state;
  _state.installed = true;
  try {
    const r = r24PatchShadowChunk(ShaderChunk.shadowmap_pars_fragment, {
      biasSignFix: SHADOW_CALM.biasSignFix,
      kernel: SHADOW_CALM.kernel,
    });
    _state.biasSign = r.biasSign;
    _state.kernel = r.kernel;
    ShaderChunk.shadowmap_pars_fragment = r.src;
  } catch {
    // leave three's chunk exactly as shipped
  }
  return _state;
}

/** Dev/harness introspection — what actually got patched, not what was asked for. */
export function shadowKernelState() {
  return { ..._state, enabled: SHADOW_CALM.enabled };
}

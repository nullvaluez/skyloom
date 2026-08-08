'use client';

/**
 * ROUND 22 (D "DEPTH") — N8AO ambient occlusion, made safe for this canvas.
 *
 * WHY A WRAPPER AND NOT `new N8AOPostPass(...)`: n8ao@1.10.3 is correct on a
 * conventional depth buffer and silently wrong on ours in THREE separate
 * places. FlyCanvas runs the renderer with `reversedDepthBuffer: true` (three
 * r184+, near-uniform precision to a 600 km far plane without logarithmic
 * depth's early-z cost) — the same trap that made R19's aerial perspective mix
 * exactly 0.00/255 until it was found. Each defect and its fix:
 *
 * ── (1) THE AUTO-DETECT NEVER FIRES ──────────────────────────────────────
 * N8AOPostPass.render() reconfigures itself from
 * `renderer.capabilities.reverseDepthBuffer`. That property does not exist.
 * three r185 spells it `reversedDepthBuffer` (WebGLCapabilities.js:129,
 * WebGLRenderer.js:439) and the string `reverseDepthBuffer` — no "d" — occurs
 * ZERO times across every file in three/build. So the expression is
 * `undefined`, the branch is dead, `depthBufferType` stays `DepthType.Default`
 * and every one of n8ao's four shaders reads a reversed buffer as if it were a
 * forward one. We set `DepthType.Reverse` explicitly, from the same live
 * `renderer.state.buffers.depth.getReversed()` probe AerialPerspective uses
 * (three DOWNGRADES the request when EXT_clip_control is missing, so this is
 * asked, never assumed). And because the Proxy on `configuration` does NOT
 * rebuild shaders for a `depthBufferType` write — it only reacts to
 * aoSamples/denoiseSamples/halfRes/depthAwareUpsampling — the three
 * `configure*` calls are made by hand.
 *
 * ── (2) THE PROJECTION MATRIX IS ALSO REVERSED ───────────────────────────
 * n8ao's `#define REVERSEDEPTH` does exactly one thing: `depth = 1.0 - raw`.
 * That recovers the value a CONVENTIONAL depth buffer would have held — proven
 * arithmetically: for the reverse-Z projection three builds when
 * `camera.reversedDepth` is true (Matrix4.makePerspective: c = n/(f-n),
 * d = fn/(f-n)), a fragment at view z = -10 m with n=0.1 f=1000 stores
 * 0.00990099, and 1 - 0.00990099 = 0.990099 is precisely the conventional
 * buffer's value for the same fragment. But n8ao then unprojects that
 * CONVENTIONAL depth with `camera.projectionMatrixInverse` — which three has
 * ALSO swapped to the reverse-Z inverse (WebGLRenderer.js:2563 sets
 * `camera._reversedDepth = true` and re-runs updateProjectionMatrix the first
 * time the camera is used). Feeding conventional depth to a reverse-Z inverse
 * puts that same 10 m fragment at 0.102 m: a 100x error, an AO radius that
 * covers the whole screen, and normals from noise.
 *
 * The fix is a PROXY CAMERA. n8ao never renders with its camera here (see (3)),
 * it only reads matrices off it, so we hand it a PerspectiveCamera that mirrors
 * the live one — same fov (including the live boost-FOV kick), aspect, near,
 * far, matrixWorld, matrixWorldInverse — but whose `_reversedDepth` stays false
 * and whose projection matrix is therefore the CONVENTIONAL one. Depth and
 * matrix then speak the same convention and the unprojection is exact. The
 * proxy has matrixAutoUpdate/matrixWorldAutoUpdate FALSE, which is what makes
 * n8ao's own `updateMatrixWorld()` / `getWorldPosition()` calls no-ops over our
 * copied matrices instead of recomposing them.
 *
 * ── (3) HALF-RES NORMALS ARE COMPUTED FROM UNFLIPPED DEPTH ───────────────
 * `configureHalfResTargets()` builds the depth-downsample material with NO
 * defines — ever, for any `depthBufferType`. DepthDownSample.js HAS
 * `#ifdef REVERSEDEPTH` branches; nothing in the library can reach them. The
 * consequence is subtle and is why this needed writing down: the downsample
 * PASSES THROUGH raw depth (which is what the AO/blur/composite shaders want,
 * since they flip it themselves), so the depth path is accidentally correct —
 * but the same shader also derives the half-res NORMAL buffer through
 * `getWorldPos(rawReversedDepth)`, which collapses the entire scene into a
 * 0.1-0.2 m shell and yields garbage normals. Half-res AO would be noise.
 *
 * We inject the define AND retarget the store so both halves are right:
 * `#define REVERSEDEPTH` (normals now computed from flipped depth, under the
 * proxy's conventional matrix) plus a one-token rewrite of the output line so
 * the texture still holds RAW depth for the downstream shaders that flip it
 * themselves. The rewrite is anchored on an exact source string; if the anchor
 * is ever missing (an n8ao upgrade), we do NOT ship wrong normals — halfRes is
 * turned off, which routes AO through EffectShader's own `computeNormal` (which
 * DOES honour the define) at full resolution, and the degrade is recorded in
 * `__flyN8AO.get().downsamplePatch`.
 *
 * ── (4) TRANSPARENCY IS ON BEFORE YOU CAN SWITCH IT OFF ──────────────────
 * The constructor itself calls `detectTransparency()`, so `transparencyAware`
 * is already true by the time any caller sees the instance — this scene has
 * transparent materials everywhere. That arms `renderTransparency()`: two
 * additional FULL-SCENE renders per frame, through n8ao's own camera, which is
 * how the proxy of (2) got re-reversed every frame by three's setProgram and
 * how the AO buffer ended up a flat 255. See createN8AOPass for the fix and
 * the measurement.
 *
 * ── DRAW COST ────────────────────────────────────────────────────────────
 * Six to seven `gl.drawArrays` per frame, not the plan's "+3": downsample (1,
 * halfRes only), AO (1), Poisson blur (x denoiseIterations), accumulate (1),
 * composite (1), copy-to-output (1). `denoiseIterations: 1` is the cheapest
 * honest configuration; the copy is upstream's (the direct-to-outputBuffer path
 * is commented out in their source). Measured numbers live in the D report.
 */

import { PerspectiveCamera } from 'three';
import { N8AOPostPass, DepthType } from 'n8ao';
import { DEPTH_PASS } from '@/lib/fly/fly-constants';

// The exact source line DepthDownSample.js writes its chosen sample with. The
// patch is anchored on it so an n8ao upgrade fails LOUDLY (fall back to
// full-res) instead of silently shipping a double-flipped depth texture.
const DS_ANCHOR = 'gl_FragColor = vec4(samples[chosenIndex], 0.0, 0.0, 1.0);';
const DS_REPLACEMENT = 'gl_FragColor = vec4(1.0 - samples[chosenIndex], 0.0, 0.0, 1.0);';
const DS_MARK = '// R22 D: REVERSEDEPTH normals, raw-depth store';

/** Module state — one satellite composer exists at a time (the _state idiom). */
const _stats = {
  mounted: false,
  reversed: null, // resolved from the live renderer, never assumed
  depthBufferType: null,
  halfRes: null,
  downsamplePatch: 'n/a',
  warm: null,
  gpuMs: 0, // n8ao's own EXT_disjoint_timer_query_webgl2 rolling average
  drawsPerFrame: null,
  proxyResyncs: 0, // how often the conventional projection had to be restored
  projZ: null, // live proof of which projection the AO is unprojecting with
};

/** Dev/harness introspection — verify-depth2 reads this. */
export function getN8AOState() {
  return { ..._stats };
}

/**
 * Ask the LIVE renderer whether it really got a reversed depth buffer. Same
 * probe as AerialPerspective.update() — three quietly falls back to an ordinary
 * depth buffer when EXT_clip_control is unavailable, and a hard-coded answer
 * would invert the world on exactly those devices.
 */
export function detectReversedDepth(gl) {
  try {
    const got = gl?.state?.buffers?.depth?.getReversed?.();
    if (got !== undefined) return !!got;
  } catch {
    // fall through to the capability read
  }
  return gl?.capabilities?.reversedDepthBuffer === true;
}

/**
 * Inject `#define REVERSEDEPTH` into the half-res depth-downsample material and
 * retarget its store to RAW depth. See header (3). Returns a status string.
 */
function patchDownsample(pass) {
  const quad = pass?.depthDownsampleQuad;
  if (!quad?.material) return 'no-halfres';
  const m = quad.material;
  const src = m.fragmentShader ?? '';
  if (src.includes(DS_MARK)) return 'ok';
  if (!src.includes(DS_ANCHOR)) return 'anchor-missing';
  m.fragmentShader = `#define REVERSEDEPTH\n${DS_MARK}\n${src.replace(
    DS_ANCHOR,
    DS_REPLACEMENT
  )}`;
  m.needsUpdate = true;
  return 'ok';
}

/**
 * The pass. Everything it overrides is about keeping the proxy camera in step
 * with the real one — n8ao itself is otherwise untouched.
 */
class FlyN8AOPass extends N8AOPostPass {
  constructor(scene, proxyCamera, sourceCamera, width, height) {
    super(scene, proxyCamera, width, height);
    this._source = sourceCamera;
    this._drawProbe = null;
  }

  /**
   * Mirror the live camera onto the proxy. Runs every frame because the boost
   * FOV kick and the quality ladder both move the projection mid-flight; the
   * matrix rebuild is guarded on an actual change so a steady cruise frame
   * costs four float compares.
   */
  _syncProxy() {
    const src = this._source;
    const p = this.camera;
    if (!src || !p) return;
    // Element 10 of a column-major projection matrix is the z scale term: it is
    // NEGATIVE (about -1) for the conventional projection and POSITIVE (about
    // near/(far-near), 4.2e-6 on this canvas) for the reverse-Z one. Reading it
    // every frame is how the proxy stays conventional no matter who flips it,
    // and it is not paranoia: MEASURED, the proxy came back reverse-Z on its
    // own, which put NaN in the half-res normal buffer (normalize() of the
    // cross product of two collapsed gradients) and left the AO buffer a flat
    // 255 — a silently disabled effect, the exact failure mode the R19 trap
    // produced for the aerial pass. Two float compares per frame is the price
    // of never shipping that again.
    const flipped = p.projectionMatrix.elements[10] >= 0;
    if (
      flipped ||
      p.fov !== src.fov ||
      p.aspect !== src.aspect ||
      p.near !== src.near ||
      p.far !== src.far ||
      p.zoom !== src.zoom
    ) {
      p.fov = src.fov;
      p.aspect = src.aspect;
      p.near = src.near;
      p.far = src.far;
      p.zoom = src.zoom;
      // THE line this whole proxy exists for: keep the CONVENTIONAL projection
      // even while the renderer has flipped the real camera to reverse-Z.
      p._reversedDepth = false;
      p.updateProjectionMatrix();
      _stats.proxyResyncs++;
    }
    // Copied, not composed. With matrixAutoUpdate/matrixWorldAutoUpdate false,
    // n8ao's updateMatrixWorld()/getWorldPosition() read these back unchanged.
    p.matrixWorld.copy(src.matrixWorld);
    p.matrixWorldInverse.copy(src.matrixWorldInverse);
  }

  render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    this._syncProxy();
    if (this._drawProbe) {
      const before = renderer.info.render.calls;
      super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
      _stats.drawsPerFrame = renderer.info.render.calls - before;
      return;
    }
    super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
    if (this.debugMode) _stats.gpuMs = +(this.lastTime ?? 0).toFixed(3);
    _stats.projZ = +this.camera.projectionMatrix.elements[10].toFixed(7);
  }
}

/**
 * Build + fully configure the pass. Order is load-bearing: `halfRes` last among
 * the plain options (its Proxy setter rebuilds the AO pass, the half-res
 * targets and the compositer), THEN the depth-type reconfiguration, THEN the
 * downsample patch — which needs the material the halfRes setter just made.
 */
export function createN8AOPass({ gl, scene, camera, cfg = DEPTH_PASS.n8ao, size }) {
  const reversed = detectReversedDepth(gl);
  const proxy = new PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
  proxy.name = 'n8ao-proxy-camera';
  proxy.matrixAutoUpdate = false;
  proxy.matrixWorldAutoUpdate = false;
  proxy._reversedDepth = false;
  proxy.updateProjectionMatrix();
  proxy.matrixWorld.copy(camera.matrixWorld);
  proxy.matrixWorldInverse.copy(camera.matrixWorldInverse);

  const w = Math.max(1, size?.width ?? 1);
  const h = Math.max(1, size?.height ?? 1);
  const pass = new FlyN8AOPass(scene, proxy, camera, w, h);
  // postprocessing's Pass defaults `name` to the class name it was given at
  // super(), which for N8AOPostPass is the bare string "Pass". verify-depth2
  // (7) identifies the AO pass by /n8ao/i over the composer's pass list, so an
  // unnamed pass reads as ABSENT — the gate reported "no AO pass in the
  // composer" while the AO was running. Naming it is the whole fix.
  pass.name = 'N8AOPass';

  // ---- transparency: OFF, and this took measuring to get right -----------
  // N8AOPostPass's CONSTRUCTOR calls `detectTransparency()` (src line ~145),
  // which walks the whole scene and sets `configuration.transparencyAware =
  // true` on the first transparent material it finds. It has therefore ALREADY
  // fired by the time this function gets the instance, and this scene is full
  // of transparent materials (tracers, clouds, precip, the catcher, every HUD
  // billboard). The consequences were both a perf disaster and a correctness
  // break, and the second one is why the AO buffer was a flat 255:
  //
  //   · `renderTransparency()` renders the ENTIRE SCENE TWICE MORE per frame
  //     (depth-write-off pass + depth-write-on pass) — three full scene draws
  //     per frame instead of one.
  //   · those renders go through `this.camera` — our proxy — and three's
  //     setProgram flips ANY camera it renders with to reverse-Z
  //     (WebGLRenderer.js:2563). So the proxy was re-reversed every single
  //     frame, immediately after _syncProxy had just made it conventional
  //     (measured: 490 resyncs in 490 frames), the AO unprojected conventional
  //     depth through a reverse-Z inverse, and every sample collapsed into a
  //     0.1 m shell where nothing occludes anything.
  //
  // Found by trapping the `_reversedDepth` setter on the proxy and reading the
  // stack — the frame is worth recording, because from the outside this looked
  // exactly like a depth-convention bug and no amount of depth-convention
  // reasoning would have reached it.
  //
  // Order matters: `autoDetectTransparency` first so the per-frame
  // `detectTransparency()` cannot turn it back on, THEN the flip — which the
  // Proxy handler only honours because the value genuinely changes.
  pass.autoDetectTransparency = false;
  if (pass.configuration.transparencyAware) pass.configuration.transparencyAware = false;

  const c = pass.configuration;
  c.aoSamples = cfg.aoSamples ?? 16;
  c.denoiseSamples = cfg.denoiseSamples ?? 8;
  c.denoiseRadius = cfg.denoiseRadius ?? 12;
  c.denoiseIterations = cfg.denoiseIterations ?? 1;
  c.aoRadius = cfg.aoRadius ?? 24;
  c.distanceFalloff = cfg.distanceFalloff ?? 1;
  c.intensity = cfg.intensity ?? 2.2;
  c.screenSpaceRadius = cfg.screenSpaceRadius ?? false;
  c.colorMultiply = cfg.colorMultiply ?? true;
  c.depthAwareUpsampling = cfg.depthAwareUpsampling ?? true;
  c.accumulate = false; // the camera moves every frame in flight; accumulation would smear
  c.halfRes = cfg.halfRes !== false;

  // ---- depth convention, applied by hand (header (1)) --------------------
  const applyDepthType = () => {
    const dt = reversed ? DepthType.Reverse : DepthType.Default;
    const ortho = !!pass.camera.isOrthographicCamera;
    c.depthBufferType = dt;
    pass.configureAOPass(dt, ortho);
    pass.configureDenoisePass(dt, ortho);
    pass.configureEffectCompositer(dt, ortho);
    return dt;
  };
  let depthType = applyDepthType();

  // ---- half-res normals (header (3)) ------------------------------------
  let patch = reversed && c.halfRes ? patchDownsample(pass) : 'n/a';
  if (patch === 'anchor-missing') {
    // Correctness over speed: full-res AO derives its own normals through the
    // define-aware computeNormal, so it is right where half-res would be noise.
    c.halfRes = false;
    depthType = applyDepthType();
    patch = 'anchor-missing:halfres-off';
  }

  _stats.mounted = true;
  _stats.reversed = reversed;
  _stats.depthBufferType = depthType === DepthType.Reverse ? 'Reverse' : 'Default';
  _stats.halfRes = c.halfRes;
  _stats.downsamplePatch = patch;
  return pass;
}

/**
 * Self-warm. `buildPassList` IS the prewarm's single source, but prewarm.js
 * builds `new EffectPass(camera, ...effects)` out of the descriptors' `raw()`
 * results and calls `effect.getAttributes()` on each — a postprocessing `Pass`
 * has no such method, and the throw is caught by runPrewarm's OUTER try, which
 * would abort B's ENTIRE warm. So the n8ao descriptor returns `raw: () => null`
 * (dropped by prewarm's `if (e) push`) and the four fullscreen materials are
 * compiled here instead, under a bound render target so the program cache key
 * matches production's 'srgb-linear' output space (the prewarm.js compileUnder
 * finding, applied to our own quads).
 */
export async function warmN8AOPass(gl, pass) {
  if (!gl || !pass) return 'no-pass';
  const quads = [
    pass.depthDownsampleQuad,
    pass.effectShaderQuad,
    pass.poissonBlurQuad,
    pass.effectCompositerQuad,
    pass.copyQuad,
  ].filter(Boolean);
  const prev = gl.getRenderTarget();
  let ok = 0;
  try {
    gl.setRenderTarget(pass.writeTargetInternal ?? null);
    for (const q of quads) {
      const mesh = q?._mesh;
      if (!mesh) continue;
      try {
        await gl.compileAsync(mesh, _WARM_CAM);
        ok++;
      } catch {
        // one quad failed to warm — a missed optimisation, never a broken frame
      }
    }
  } catch {
    // no target to bind — warm without one rather than not at all
  } finally {
    gl.setRenderTarget(prev);
  }
  _stats.warm = `${ok}/${quads.length}`;
  return _stats.warm;
}

// n8ao renders its quads with a private module-scope OrthographicCamera; any
// ortho camera produces the same program (the camera is not part of the cache
// key for these materials — no lights, no fog, no shadows).
const _WARM_CAM = /* @__PURE__ */ (() => {
  const c = new PerspectiveCamera();
  c.matrixAutoUpdate = false;
  return c;
})();

export function disposeN8AOPass(pass) {
  try {
    pass?.dispose?.();
  } catch {
    // a pass that fails to dispose must never take the frame loop with it
  }
  _stats.mounted = false;
  _stats.drawsPerFrame = null;
}

/** verify-depth2 / the A-B capture toggle the timer + draw probe through this. */
export function setN8AOProbes(pass, { gpu = false, draws = false } = {}) {
  if (!pass) return;
  if (gpu) pass.enableDebugMode?.();
  else pass.disableDebugMode?.();
  pass._drawProbe = !!draws;
}

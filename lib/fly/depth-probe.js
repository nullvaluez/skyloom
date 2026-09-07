/**
 * R24 C (DEPTH_FIX, recon L2 / FL-07) — THE DEPTH PROBE HOOK.
 *
 * `verify-depth-roundtrip` stops at its gate (0) without this: it must
 * reconstruct a view Z from the depth buffer the renderer actually wrote, and
 * re-implementing that reconstruction inside the harness would test the
 * HARNESS'S copy of the bug rather than the app's. So the app publishes the
 * number, and the harness only judges it.
 *
 * PRODUCTION IS BYTE-IDENTICAL. Everything here is installed from a
 * `process.env.NODE_ENV !== 'production'` branch at the single call site
 * (FlyEffectComposer), the R19 TrafficLayer park-handle idiom: in a production
 * build the branch is statically false, nothing in this module is constructed,
 * no render target is allocated, no global is written, and no frame does any
 * extra work. The probe also renders NOTHING on its own schedule — it draws one
 * 1×1 quad only when a harness calls it, between frames.
 *
 * WHICH BUFFER THE NUMBER COMES FROM — the question the gate has to be able to
 * answer, so it is answered in the return value as well as here:
 *   `raw`  is `composer.depthTexture`, i.e. the DEPTH ATTACHMENT of the
 *          composer's input buffer — the same texture postprocessing hands to
 *          every EffectAttribute.DEPTH effect, and therefore the same texel
 *          AerialPerspective and the DoF CoC material read. It is the value AS
 *          STORED: no un-reversing, no normalisation, no packing.
 *   `coc`  is the DepthOfFieldEffect's own `renderTargetCoC`, sampled at the
 *          same normalised UV (that target is half-resolution by default, and a
 *          normalised UV is resolution-independent, which is why the probe
 *          samples rather than reads it back). `null` with a `cocReason` when
 *          the DoF effect is not mounted — toy + tier high is the only
 *          composition that mounts it.
 *
 * A depth ATTACHMENT cannot be read back with `readPixels`, so the probe
 * samples it in a one-pixel copy pass and reads THAT. 8-bit is not an option —
 * reversed depth at 700 m is 3.6e-3, and the reconstruction's relative error IS
 * the texel's relative error — so the copy target is a float, by this ladder:
 *
 *   EXT_color_buffer_float       -> FloatType,     precision 'float32'
 *   EXT_color_buffer_half_float  -> HalfFloatType, precision 'float16'
 *   neither                      -> no number at all, and an `error` saying so
 *
 * The half-float rung exists because REFUSING would have been stricter than the
 * gate it serves. Measured worst-case reconstruction error at the three probe
 * depths, round-tripping the reversed texel through each format
 * (`scripts/r24-c-depth-roundtrip-proof.mjs` asserts these):
 *
 *      z        float16      float32
 *     50 m      0.0165 %     0.000002 %
 *    700 m      0.0150 %     0.000000 %
 *   4000 m      0.0754 %     0.000001 %
 *
 * — every one of them 13x to 60x inside `verify-depth-roundtrip`'s 1 % bound.
 * So the probe reports the number AND `precision`, and the gate prints which
 * path produced it rather than having to trust that they are equivalent. What
 * the probe still will not do is return a number when NEITHER float target
 * renders: an unquantified value is worse than an honest absence.
 */
import {
  DataUtils,
  FloatType,
  HalfFloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Raycaster,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
// R24 C: the CPU mirror of the LIVE bend uniforms — the `__flyAirDrop` /
// `horizonFade` idiom. The truth raycast must un-bend by the same k the vertex
// shader is using this frame, never by a constant.
import { airDrop, getBend } from '@/lib/fly/toy-world/world-bend';

/**
 * three's own `perspectiveDepthToViewZ`, mirrored in JS.
 *
 * Both branches are transcribed from the packing chunk, which in three 0.185.1
 * reads:
 *
 *   float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
 *     #ifdef USE_REVERSED_DEPTH_BUFFER
 *       return ( near * far ) / ( ( near - far ) * depth - near );
 *     #else
 *       return ( near * far ) / ( ( far - near ) * depth - far );
 *     #endif
 *   }
 *
 * The reversed branch expects RAW REVERSED depth, which is exactly what the
 * depth attachment stores and exactly what `raw` carries — that is the whole
 * point of recon L2: postprocessing un-reverses first and then hands the result
 * to this function, converting twice.
 *
 * `scripts/r24-c-depth-roundtrip-proof.mjs` EXTRACTS those two return
 * expressions from the installed three build and evaluates them against this
 * function over a sweep, so the mirror cannot silently drift from the GLSL —
 * or carry its own copy of the bug.
 */
export function perspectiveDepthToViewZ(depth, near, far, reversed) {
  return reversed
    ? (near * far) / ((near - far) * depth - near)
    : (near * far) / ((far - near) * depth - far);
}

/**
 * Worst-case reconstruction error at `verify-depth-roundtrip`'s three probe
 * depths (50 m / 700 m / 4000 m), as a percentage of the true distance, for
 * each copy-target format. Declared here so the probe can hand the gate the
 * cost of the path it actually took; ASSERTED against a live round-trip in
 * `scripts/r24-c-depth-roundtrip-proof.mjs`, which is the oracle — if these
 * drift from the arithmetic, that proof goes red.
 */
const PRECISION_WORST_PCT = { float32: 0.000002, float16: 0.0754 };
const PRECISION_NOTE = {
  float32:
    'EXT_color_buffer_float: worst 0.000002% of z across 50/700/4000 m — exact for this gate',
  float16:
    'EXT_color_buffer_half_float fallback: worst 0.0754% of z (0.0165% at 50 m, 0.0150% at 700 m, 0.0754% at 4000 m) — 13x inside the 1% bound',
};

const VERT = /* glsl */ `
void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;
const FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform sampler2D tCoC;
uniform vec2 uUv;
uniform float uHasCoC;
void main() {
  float d = texture2D( tDepth, uUv ).r;
  vec2 c = uHasCoC > 0.5 ? texture2D( tCoC, uUv ).rg : vec2( -1.0 );
  gl_FragColor = vec4( d, c.x, c.y, 1.0 );
}
`;

/**
 * Install `window.__flyDepthProbe(x, y)`. Returns a disposer, or null when the
 * probe cannot exist (production, no window, no renderer).
 *
 * @param {object} ctx { gl, composer, camera, scene }
 */
export function installDepthProbe({ gl, composer, camera, scene: worldScene }) {
  if (typeof window === 'undefined' || !gl || !composer) return null;

  let rt = null;
  let scene = null;
  let cam = null;
  let mat = null;
  let buf = null;
  let precision = null;

  const build = () => {
    if (rt) return true;
    // The ladder, in order of how much of the reconstruction it preserves.
    const ext = (n) => !!gl.extensions?.get?.(n);
    const type = ext('EXT_color_buffer_float')
      ? FloatType
      : ext('EXT_color_buffer_half_float')
        ? HalfFloatType
        : null;
    if (type === null) return false;
    precision = type === FloatType ? 'float32' : 'float16';
    // `readRenderTargetPixels` reads the GL type of the target, so the buffer
    // must match it: FLOAT wants Float32Array, HALF_FLOAT wants the raw 16-bit
    // pattern in a Uint16Array, which `DataUtils.fromHalfFloat` decodes.
    buf = type === FloatType ? new Float32Array(4) : new Uint16Array(4);
    rt = new WebGLRenderTarget(1, 1, {
      type,
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDepth: new Uniform(null),
        tCoC: new Uniform(null),
        uUv: new Uniform(new Vector2()),
        uHasCoC: new Uniform(0),
      },
      depthTest: false,
      depthWrite: false,
    });
    scene = new Scene();
    cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    scene.add(new Mesh(new PlaneGeometry(2, 2), mat));
    return true;
  };

  /**
   * @param {number} x DRAWING-BUFFER pixel, top-left origin
   * @param {number} y DRAWING-BUFFER pixel, top-left origin
   */
  const probe = (x, y) => {
    const size = gl.getDrawingBufferSize(new Vector2());
    const out = {
      raw: null,
      viewZ: null,
      coc: null,
      // Asked for by name; read from the renderer rather than from the request,
      // because three quietly falls back to an ordinary depth buffer when
      // EXT_clip_control is missing (the R16 "a texture TYPE is a device
      // contract" lesson, applied to a depth convention).
      reversed: gl.state?.buffers?.depth?.getReversed?.() === true,
      near: camera?.near ?? null,
      far: camera?.far ?? null,
      x,
      y,
      drawingBuffer: [size.x, size.y],
      // Which float path produced `raw`, and what that path costs the
      // reconstruction at the gate's own probe depths. Reported rather than
      // assumed, so a green row says WHICH number it is green on.
      precision: null,
      precisionWorstPct: null,
      precisionNote: null,
      source: 'composer.depthTexture (the composer input buffer\'s depth attachment)',
      cocSource: null,
      cocReason: null,
      // Populated on every full read (see the tail of this function). Stays
      // null on the early returns, where there is no depth number to be true
      // ABOUT — an absent truth beside an absent depth, not a silent zero.
      truth: null,
      error: null,
    };
    const depthTexture = composer.depthTexture ?? null;
    if (!depthTexture) {
      out.error =
        'composer.depthTexture is null — no pass declares EffectAttribute.DEPTH in this composition (toy+high mounts DoF; satellite+high mounts AerialPerspective)';
      return out;
    }
    if (!build()) {
      out.error =
        'neither EXT_color_buffer_float nor EXT_color_buffer_half_float renders here — refusing to report a depth this probe cannot quantify';
      return out;
    }
    out.precision = precision;
    out.precisionWorstPct = PRECISION_WORST_PCT[precision];
    out.precisionNote = PRECISION_NOTE[precision];
    const dof = window.__flyDof ?? null;
    const cocTex = dof?.renderTargetCoC?.texture ?? null;
    if (cocTex) {
      // Name the PASS, not the shape: (3)/(4) judge a CoC term, and "which
      // effect instance produced it" is the difference between a released term
      // and a configuration. `window.__flyDof` is the live instance published
      // by Effects.jsx's setDof callback ref — NOT `__flyStats.effects.dof`,
      // which is a config mirror and reads null in compositions that do mount
      // the pass.
      out.cocSource =
        `${dof?.constructor?.name ?? 'DepthOfFieldEffect'}.renderTargetCoC ` +
        '(half-resolution; sampled at the same normalised UV) via window.__flyDof';
      // MIRROR IT WHERE THE READER LOOKS. The name was already on this return
      // value — `coc` and `cocSource` are set from the same `cocTex` in one
      // branch, so a finite `coc` PROVES a published `cocSource` — but the gate
      // reads `__flyStats.effects.cocSource`, which nothing wrote, and reported
      // the name as missing while printing the number. Publishing both costs an
      // assignment and removes a whole class of "published somewhere else".
      const st = (window.__flyStats ??= {});
      (st.effects ??= {}).cocSource = out.cocSource;
    } else {
      out.cocReason = dof
        ? 'the DoF effect is mounted but exposes no renderTargetCoC'
        : 'no DepthOfFieldEffect mounted (window.__flyDof is null) — toy + tier high is the only composition that mounts it';
    }
    // Top-left origin in, bottom-left origin out: a texture UV's v axis runs the
    // other way from a drawing-buffer row index, and the +0.5 lands on the texel
    // CENTRE so the probe cannot straddle two texels under NearestFilter.
    mat.uniforms.uUv.value.set((x + 0.5) / size.x, 1 - (y + 0.5) / size.y);
    mat.uniforms.tDepth.value = depthTexture;
    mat.uniforms.tCoC.value = cocTex;
    mat.uniforms.uHasCoC.value = cocTex ? 1 : 0;
    const prevRT = gl.getRenderTarget();
    const prevAutoClear = gl.autoClear;
    try {
      gl.autoClear = true;
      gl.setRenderTarget(rt);
      gl.render(scene, cam);
      gl.readRenderTargetPixels(rt, 0, 0, 1, 1, buf);
    } finally {
      gl.setRenderTarget(prevRT);
      gl.autoClear = prevAutoClear;
    }
    const px = (i) => (precision === 'float16' ? DataUtils.fromHalfFloat(buf[i]) : buf[i]);
    out.raw = px(0);
    out.coc = cocTex ? Math.max(px(1), px(2)) : null;
    if (out.near != null && out.far != null) {
      out.viewZ = perspectiveDepthToViewZ(out.raw, out.near, out.far, out.reversed);
    }
    // THE TRUTH, IN THE SAME CALL. Read separately, the two numbers are not
    // simultaneous: the depth read and the raycast then straddle frames, and a
    // streaming world moves the surface between them. That is not theoretical —
    // two probes of the SAME pixel in one run differed by 2.5 m of
    // reconstructed depth, so the surface at that texel was not stable. Both
    // happen in one synchronous turn here, so no frame can land between them
    // and the difference is about the surface, never about the clock.
    out.truth = truth(x, y);
    return out;
  };

  // ------------------------------------------------------------------------
  // R24 C — THE TRUTH RAYCAST, `window.__flyDepthTruth(x, y)`.
  //
  // A harness cannot build this from outside: a bundled app publishes no
  // `window.THREE` and no camera, so `verify-depth-roundtrip` read 0 hits of 15
  // probes and every miss said "handle absent". The truth has to be computed
  // where the camera and three are already in scope — here.
  //
  // WHICH CAMERA. `camera` is FlyEffectComposer's own `_camera || defaultCamera`
  // — the same object it hands to `new RenderPass(scene, camera)`, so it is by
  // construction the camera whose depth the probe reads, not the inspect
  // turntable's (that lives in a second Canvas with its own renderer).
  //
  // WHICH GEOMETRY. Only what WRITES depth, or the truth would not describe the
  // buffer: meshes, visible through every ancestor, `material.depthWrite`, not
  // sprites, not transparent non-writers. Billboarded traffic and tracers are
  // excluded by exactly that test rather than by name.
  //
  // THE BEND, and this is the part a naive raycast gets silently wrong. Every
  // world vertex is displaced by `wPos.y -= bendD * bendD * uBendK` in the
  // vertex shader (world-bend.js:579), so the CPU geometry a Raycaster sees is
  // NOT the surface the depth buffer recorded — at 4 km the drop is metres to
  // tens of metres. Shifting the ray ORIGIN up by the drop shifts the whole
  // line vertically while leaving its XZ path identical, so solving "shifted
  // line meets un-bent geometry" is the same equation as "original line meets
  // bent geometry" for a locally constant drop; iterating the drop at the
  // current hit converges in two or three steps because the drop is smooth.
  //
  // AND IT CHECKS ITSELF. `reprojectionPx` projects the answer back through the
  // same camera and reports how far it lands from the pixel that was asked for.
  // That is the falsification instrument: a wrong space (the floating-origin
  // anchor is the obvious candidate — FlyScene rebases the camera back at
  // :1735, so a between-frames call sees camera and objects in ONE space, but
  // this hook does not get to assume that), a stale matrix or a bad bend all
  // show up there as a large number instead of as a plausible distance.
  const _ndc = new Vector2();
  const _org = new Vector3();

  const raycaster2 = new Raycaster();
  const _p = new Vector3();
  const _v = new Vector3();
  const _perp = new Vector3();

  /**
   * WHICH BEND A HIT CARRIES, read from the material's own world-bend cache key
   * rather than guessed from what the object looks like. Every air variant
   * registers a key beginning `world-bend-air` (world-bend.js:716/777/847);
   * everything else displaces on the ground formula.
   */
  const bendKeyOf = (o) => {
    const m = o.material;
    const mm = Array.isArray(m) ? m[0] : m;
    try {
      return typeof mm?.customProgramCacheKey === 'function' ? mm.customProgramCacheKey() : '';
    } catch {
      return '';
    }
  };
  const isAirBent = (o) => bendKeyOf(o).startsWith('world-bend-air');

  /** The displacement the GPU applies to THIS hit, by its own variant's formula. */
  const dropFor = (o, pt, k, cx, cz) => {
    const dx = pt.x - cx;
    const dz = pt.z - cz;
    if (isAirBent(o)) return airDrop(Math.hypot(dx, dz), pt.y, k);
    return (dx * dx + dz * dz) * k;
  };

  /** Raw hits along the pixel's ray at a given vertical LIFT. */
  const castAt = (px, py, lift, size, list) => {
    _ndc.set(((px + 0.5) / size.x) * 2 - 1, 1 - ((py + 0.5) / size.y) * 2);
    raycaster2.setFromCamera(_ndc, camera);
    _org.copy(raycaster2.ray.origin);
    raycaster2.ray.origin.y += lift;
    const hits = raycaster2.intersectObjects(list, false);
    raycaster2.ray.origin.copy(_org);
    return hits.slice(0, 8);
  };

  /**
   * THE BEND SOLVE, per family — and the reason it cannot be replaced by a
   * closed form.
   *
   * The GPU LOWERS the world. A pixel's ray therefore meets the DISPLACED
   * surface farther along and at a DIFFERENT XZ than it meets the CPU geometry,
   * so "take the ray point at the CPU hit's XZ" is not the answer for a
   * continuous surface — it is the un-bent intersection wearing a correction's
   * name. (It is exact only for the converged case below, where the two
   * coincide.) The previous revision made exactly that error: with the unlifted
   * cast, `impliedDrop = hit.y − rayY(sameXZ)` is IDENTICALLY ZERO, the
   * interval test 0 <= 0 <= groundDrop passed honestly, and the truth became
   * the un-bent geometry — reading 2282.3 m where the buffer held 2356.3, the
   * ground drop (26 m) divided by the tangent of a grazing ray.
   *
   * So: lift the ray by the drop at the current hit and re-cast until the lift
   * stops moving. At convergence lift == drop, and `hit − (0, drop, 0)` lies on
   * the ORIGINAL ray by construction — which is why the residual and the
   * reprojection are the validity test here, and the implied drop is only ever
   * reported.
   *
   * Two families, because the displacement is not one function: ground/anchor
   * geometry drops by `d² · k`, while air-anchor actors (traffic, contrails,
   * the player) drop by `airDrop(d, y)` with R7's altitude lift. Running the
   * iteration once per family, each matching only its own hits, is what lets an
   * air-bent actor in front of terrain be found at all.
   */
  const solveFamily = (px, py, size, list, k, cx, cz, wantAir, pool) => {
    let lift = 0;
    let hit = null;
    let drop = 0;
    let converged = false;
    let iters = 0;
    for (let i = 0; i < 5; i += 1) {
      const cast = castAt(px, py, lift, size, list);
      iters = i + 1;
      for (const h of cast) {
        pool.push({
          object: h.object.name || h.object.type,
          key: bendKeyOf(h.object),
          air: isAirBent(h.object),
          rawDistance: h.distance,
          lift,
        });
      }
      const h = cast.find((c) => isAirBent(c.object) === wantAir);
      if (!h) break;
      const d = dropFor(h.object, h.point, k, cx, cz);
      hit = h;
      drop = d;
      if (Math.abs(d - lift) < 0.05) {
        converged = true;
        break;
      }
      lift = d;
    }
    if (!hit) return null;
    // The rendered point: the CPU hit, displaced by its own variant's drop.
    _p.copy(hit.point);
    _p.y -= drop;
    // On the ORIGINAL ray? At convergence it must be, so this is a TEST and no
    // longer a correction. A non-zero residual means the solve did not settle
    // (a cliff, a seam) and the candidate is not trustworthy at this pixel.
    _ndc.set(((px + 0.5) / size.x) * 2 - 1, 1 - ((py + 0.5) / size.y) * 2);
    raycaster2.setFromCamera(_ndc, camera);
    _perp.copy(_p).sub(raycaster2.ray.origin);
    const along = _perp.dot(raycaster2.ray.direction);
    const residual = _perp
      .sub(_v.copy(raycaster2.ray.direction).multiplyScalar(along))
      .length();
    _v.copy(_p).project(camera);
    const reproj = Math.hypot(
      ((_v.x + 1) / 2) * size.x - (px + 0.5),
      ((1 - _v.y) / 2) * size.y - (py + 0.5)
    );
    const distance = _p.distanceTo(camera.position);
    _v.copy(_p).applyMatrix4(camera.matrixWorldInverse);
    const dx = hit.point.x - cx;
    const dz = hit.point.z - cz;
    return {
      object: hit.object.name || hit.object.type,
      key: bendKeyOf(hit.object),
      family: wantAir ? 'air' : 'ground',
      point: _p.clone(),
      t: along,
      impliedDrop: drop,
      groundDrop: (dx * dx + dz * dz) * k,
      converged,
      iters,
      residual,
      reproj,
      viewZ: _v.z,
      distance,
      // CONVERGENCE FIRST. The degenerate zero of the previous revision passed
      // an interval test honestly; nothing but "the lift stopped moving, and
      // the answer landed on the ray and on the pixel" can exclude it.
      valid: converged && residual <= Math.max(0.5, distance * 1e-3) && reproj <= 1.5,
    };
  };

  /** The nearest VALID surface through a pixel — nearest, as a depth buffer keeps. */
  const solve = (px, py, size, list, k, cx, cz) => {
    const pool = [];
    const cands = [];
    for (const wantAir of [false, true]) {
      const c = solveFamily(px, py, size, list, k, cx, cz, wantAir, pool);
      if (c) cands.push(c);
    }
    const valid = cands.filter((c) => c.valid);
    valid.sort((c1, c2) => c1.t - c2.t);
    return {
      pick: valid[0] ?? null,
      cands,
      pool,
      tried: cands.length,
      rejected: cands.length - valid.length,
      iters: cands.reduce((n, c) => Math.max(n, c.iters), 0),
    };
  };

  const truth = (x, y) => {
    const size = gl.getDrawingBufferSize(new Vector2());
    const out = {
      hit: false,
      distance: null,
      viewZ: null,
      object: null,
      via: null,
      family: null,
      converged: null,
      impliedDropM: null,
      groundDropM: null,
      hits: null,
      rayHits: null,
      x,
      y,
      drawingBuffer: [size.x, size.y],
      bendK: null,
      bendDropM: null,
      bendIters: 0,
      residualM: null,
      reprojectionPx: null,
      slopeMPerPx: null,
      candidates: 0,
      tried: 0,
      rejected: 0,
      // THE EYE THIS ANSWER BELONGS TO. probe() and truth() run in ONE
      // synchronous turn, so they share these matrices and the same depth
      // texture — but two SEPARATE calls (a pick sweep, then a per-pick
      // assertion) are two turns, and the aircraft keeps flying between them.
      // Publishing the eye turns "the truth moved" from an argument into a
      // measurement: if this differs between two reads, the world moved under
      // the pixel and no comparison across them is meaningful.
      eye: null,
      source:
        'in-app Raycaster through the composer\'s own camera against depth-writing meshes, un-bent by the live uBendK; nearest candidate that reprojects onto the pixel',
      reason: null,
    };
    if (!camera || !worldScene) {
      out.reason = `no ${!camera ? 'camera' : 'scene'} reference in the composer context`;
      return out;
    }
    // Depth-writing, visible-through-every-ancestor meshes only.
    const list = [];
    worldScene.traverse((o) => {
      if (!o.isMesh || o.isSprite) return;
      const m = o.material;
      const mats = Array.isArray(m) ? m : [m];
      if (!mats.some((mm) => mm && mm.depthWrite !== false && !mm.isSpriteMaterial)) return;
      for (let a = o; a; a = a.parent) if (!a.visible) return;
      list.push(o);
    });
    out.candidates = list.length;
    if (!list.length) {
      out.reason = 'no depth-writing visible mesh in the scene graph';
      return out;
    }
    camera.updateMatrixWorld();
    out.eye = [
      +camera.position.x.toFixed(3),
      +camera.position.y.toFixed(3),
      +camera.position.z.toFixed(3),
    ];
    const bend = getBend();
    out.bendK = bend?.k ?? 0;
    const k = out.bendK;
    const cx = bend?.cx ?? 0;
    const cz = bend?.cz ?? 0;

    const r = solve(x, y, size, list, k, cx, cz);
    out.tried = r.tried;
    out.rejected = r.rejected;
    out.bendIters = r.iters;
    if (!r.pick) {
      out.reason = r.tried
        ? `${r.tried} candidate(s) found, none reprojected onto the pixel (bend solve did not converge here)`
        : 'no intersection through that pixel — sky, or the ray cleared every depth-writing mesh';
      return out;
    }
    const c = r.pick;
    out.hit = true;
    out.object = c.object;
    out.via = c.impliedDrop < 0.05 ? 'unlifted' : 'bend-solved';
    out.family = c.family;
    out.converged = c.converged;
    // MEASURED, not modelled: how far the GPU actually moved this actor down,
    // and the ground bend at the same XZ for comparison. A ground hit reads
    // impliedDrop == groundDrop; an AIR-bent actor reads noticeably less. That
    // difference is the tell for which bend family the buffer was holding.
    out.impliedDropM = c.impliedDrop;
    out.groundDropM = c.groundDrop;
    out.bendDropM = c.impliedDrop; // kept: the previous field name
    out.distance = c.distance;
    out.viewZ = c.viewZ;
    // EVERY candidate the ray met, so a disagreement can be read instead of
    // theorised: what else was on this ray, how far the GPU moved it, and why
    // it was or was not the answer.
    out.hits = r.cands.map((h) => ({
      object: h.object,
      family: h.family,
      key: h.key,
      distance: +h.distance.toFixed(2),
      viewZ: +h.viewZ.toFixed(2),
      impliedDropM: +h.impliedDrop.toFixed(3),
      groundDropM: +h.groundDrop.toFixed(3),
      converged: h.converged,
      iters: h.iters,
      residualM: +h.residual.toFixed(3),
      reprojectionPx: +h.reproj.toFixed(2),
      valid: h.valid,
    }));
    // Every RAW hit the casts met, whether or not its family owned it — so a
    // disagreement names what was on the ray instead of only what survived.
    out.rayHits = r.pool.slice(0, 12).map((h) => ({
      object: h.object,
      key: h.key,
      air: h.air,
      rawDistance: +h.rawDistance.toFixed(2),
      lift: +h.lift.toFixed(2),
    }));
    // Both numbers are the candidate's OWN validity terms, reported so a reader
    // sees what the pick had to satisfy: the solve converged (the lift stopped
    // moving), the displaced point landed back on the ORIGINAL ray, and it
    // reprojects onto the pixel that was asked for. A zero here is earned by an
    // iteration, not asserted by construction — which is exactly what the
    // previous revision's degenerate zero was not.
    out.residualM = c.residual;
    out.reprojectionPx = c.reproj;
    // ONE TEXEL OF SURFACE SLOPE, measured rather than assumed. A flat 1 %
    // bound is the wrong contract for a SURFACE comparison: at 1.2 km one pixel
    // subtends metres of ground, and on a grazing face — a tile skirt, a cliff,
    // a seam between two LODs — the depth across one texel can change by tens
    // of metres. The honest bound is 1 % of the truth PLUS this, and publishing
    // it lets the gate state that without guessing a constant.
    let slope = 0;
    for (const [ox, oy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const n = solve(x + ox, y + oy, size, list, k, cx, cz).pick;
      if (n) slope = Math.max(slope, Math.abs(n.viewZ - c.viewZ));
    }
    out.slopeMPerPx = slope;
    return out;
  };

  window.__flyDepthProbe = probe;
  window.__flyDepthTruth = truth;
  return () => {
    if (window.__flyDepthTruth === truth) delete window.__flyDepthTruth;
    if (window.__flyDepthProbe === probe) delete window.__flyDepthProbe;
    rt?.dispose();
    mat?.dispose();
    scene?.traverse?.((o) => o.geometry?.dispose?.());
    rt = null;
    mat = null;
    scene = null;
    buf = null;
    precision = null;
  };
}

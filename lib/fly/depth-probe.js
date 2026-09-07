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
import { getBend } from '@/lib/fly/toy-world/world-bend';

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
  const raycaster = new Raycaster();
  const _ndc = new Vector2();
  const _org = new Vector3();
  const _pt = new Vector3();
  const _tmp = new Vector3();

  const truth = (x, y) => {
    const size = gl.getDrawingBufferSize(new Vector2());
    const out = {
      hit: false,
      distance: null,
      viewZ: null,
      object: null,
      x,
      y,
      drawingBuffer: [size.x, size.y],
      bendK: null,
      bendDropM: null,
      bendIters: 0,
      residualM: null,
      reprojectionPx: null,
      candidates: 0,
      source:
        'in-app Raycaster through the composer\'s own camera against depth-writing meshes, un-bent by the live uBendK',
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
    // Drawing-buffer pixel (top-left origin) -> NDC, the inverse of the probe's
    // own UV conversion so both hooks address the same texel.
    _ndc.set(((x + 0.5) / size.x) * 2 - 1, 1 - ((y + 0.5) / size.y) * 2);
    camera.updateMatrixWorld();
    const bend = getBend();
    out.bendK = bend?.k ?? 0;
    const cx = bend?.cx ?? 0;
    const cz = bend?.cz ?? 0;
    const k = out.bendK;

    let drop = 0;
    let hit = null;
    for (let i = 0; i < 4; i += 1) {
      raycaster.setFromCamera(_ndc, camera);
      _org.copy(raycaster.ray.origin);
      raycaster.ray.origin.y += drop; // lift the line by the current drop
      const hits = raycaster.intersectObjects(list, false);
      raycaster.ray.origin.copy(_org);
      out.bendIters = i + 1;
      if (!hits.length) {
        hit = null;
        break;
      }
      hit = hits[0];
      if (!k) break;
      const dx = hit.point.x - cx;
      const dz = hit.point.z - cz;
      const next = (dx * dx + dz * dz) * k;
      const converged = Math.abs(next - drop) < 0.01; // 1 cm of vertical drop
      drop = next;
      if (converged) break;
    }
    if (!hit) {
      out.bendDropM = k ? drop : 0;
      out.reason =
        'no intersection through that pixel — sky, or the ray cleared every depth-writing mesh';
      return out;
    }
    // The RENDERED point: the un-bent hit, pushed down by the drop the vertex
    // shader applies at its XZ distance.
    _pt.copy(hit.point);
    _pt.y -= drop;
    out.bendDropM = drop;
    out.hit = true;
    out.object = hit.object.name || hit.object.type;
    out.distance = _pt.distanceTo(camera.position);
    // Same units and same sign convention as the probe's `viewZ`: three's view
    // space, negative in front of the camera, world metres. E can difference
    // the two without converting anything.
    _tmp.copy(_pt).applyMatrix4(camera.matrixWorldInverse);
    out.viewZ = _tmp.z;
    // Residual: how far the answer sits off the ORIGINAL ray. The bend solve is
    // a fixed point, not an exact inverse, and this is the number that says
    // whether it converged at this pose.
    raycaster.setFromCamera(_ndc, camera);
    _tmp.copy(_pt).sub(raycaster.ray.origin);
    const along = _tmp.dot(raycaster.ray.direction);
    out.residualM = _tmp.sub(raycaster.ray.direction.clone().multiplyScalar(along)).length();
    // Self-check: project the answer back to a pixel.
    _tmp.copy(_pt).project(camera);
    out.reprojectionPx = Math.hypot(
      ((_tmp.x + 1) / 2) * size.x - (x + 0.5),
      ((1 - _tmp.y) / 2) * size.y - (y + 0.5)
    );
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

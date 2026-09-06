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
 * samples it in a one-pixel copy pass and reads THAT. The copy target is
 * FloatType: 8-bit would be useless (reversed depth at 700 m is 3.6e-3, and the
 * reconstruction's relative error is the texel's relative error), and half
 * float's ~11-bit mantissa would put ~0.05 % on a gate whose bound is 1 %.
 * Without `EXT_color_buffer_float` the probe refuses and says so rather than
 * returning a number it cannot stand behind.
 */
import {
  FloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  WebGLRenderTarget,
} from 'three';

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
 * @param {object} ctx { gl, composer, camera }
 */
export function installDepthProbe({ gl, composer, camera }) {
  if (typeof window === 'undefined' || !gl || !composer) return null;

  let rt = null;
  let scene = null;
  let cam = null;
  let mat = null;
  const buf = new Float32Array(4);

  const build = () => {
    if (rt) return true;
    // FloatType or nothing — see the header. `readRenderTargetPixels` on a
    // half-float target returns raw half BITS, and decoding them here to save
    // an extension check would be a second place for this number to go wrong.
    if (!gl.extensions?.get?.('EXT_color_buffer_float')) return false;
    rt = new WebGLRenderTarget(1, 1, {
      type: FloatType,
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
      out.error = 'EXT_color_buffer_float unavailable — refusing to report a depth this probe cannot resolve to 1%';
      return out;
    }
    const dof = window.__flyDof ?? null;
    const cocTex = dof?.renderTargetCoC?.texture ?? null;
    if (cocTex) {
      out.cocSource = 'DepthOfFieldEffect.renderTargetCoC (half-resolution; sampled at the same normalised UV)';
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
    out.raw = buf[0];
    out.coc = cocTex ? Math.max(buf[1], buf[2]) : null;
    if (out.near != null && out.far != null) {
      out.viewZ = perspectiveDepthToViewZ(out.raw, out.near, out.far, out.reversed);
    }
    return out;
  };

  window.__flyDepthProbe = probe;
  return () => {
    if (window.__flyDepthProbe === probe) delete window.__flyDepthProbe;
    rt?.dispose();
    mat?.dispose();
    scene?.traverse?.((o) => o.geometry?.dispose?.());
    rt = null;
    mat = null;
    scene = null;
  };
}

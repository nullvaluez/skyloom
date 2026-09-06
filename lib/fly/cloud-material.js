/**
 * R24 C (CLOUD_LIT — recon L7) — a lit cloud material for drei's SAME sprite
 * instancer. Zero extra draws, zero extra geometry, zero new passes.
 *
 * THE DEFECT: `<Clouds material={MeshLambertMaterial}>` shades camera-facing
 * billboards. A billboard's normal points AT the camera, so `N·L` is one
 * constant per sprite: the sun cannot shape a puff, there is no lit side and
 * no shadow side, and a cumulus reads as a grey cotton disc (recon L7, and the
 * R22 handoff's "flat grey-blue wash").
 *
 * THE FIX: give each fragment a FAKE HEMISPHERE NORMAL from its position on
 * the sprite quad — `n = (p.x, p.y, sqrt(1 - |p|²))` in VIEW space, which is
 * exactly the normal field of a sphere seen head-on — rotate it into world
 * space, and shade with that. Then add a Henyey-Greenstein back-scatter lobe
 * toward `runtime.sun`, which is the silver lining: real cloud droplets scatter
 * strongly FORWARD, so a puff between you and the sun glows at its edge.
 *
 * ~20 extra ALU on the ~5-10% of pixels a cloud deck covers, and an exact
 * early-out at `uCloudMix <= 0` so a flag-off frame is bit-identical.
 *
 * ── WHY AN ACCESSOR AND NOT A CONSTRUCTOR ASSIGNMENT ─────────────────────
 * drei's `<Clouds material={X}>` builds `class CloudMaterial extends X` and,
 * IN ITS OWN CONSTRUCTOR (Cloud.js), assigns `this.onBeforeCompile = ...` to
 * inject the per-instance `cloudOpacity` attribute. `super()` runs first, so
 * anything this class assigned in its constructor is overwritten a line later.
 * The only stable hook is a prototype ACCESSOR: drei's assignment lands in our
 * setter, we keep it, and our getter returns a composed function that runs
 * drei's edits first and ours second. That ordering is required, not stylistic
 * — our fragment edit rewrites the exact `gl_FragColor` line drei writes.
 */
import { Color, MeshLambertMaterial, Vector3 } from 'three';
import { CLOUD_LIT } from './fly-constants';

// Live state, written on CloudField's existing ~10 s tint cadence. Module scope
// for the same reason AerialPerspective's is: one cloud deck exists at a time,
// and a plain object survives a StrictMode double-mount with no bookkeeping.
const cloudUniforms = {
  uCloudSun: { value: new Vector3(0, 1, 0) }, // world direction TO the key light
  uCloudSunCol: { value: new Color(1, 1, 1) },
  uCloudShadeCol: { value: new Color(0.55, 0.6, 0.72) },
  uCloudRim: { value: 0 },
  uCloudG: { value: 0.6 },
  uCloudMix: { value: 0 }, // MASTER. 0 = exact identity (shader early-out).
};

/**
 * Per-cadence feed. `mix` 0 hands the deck back to plain Lambert exactly.
 * @param {number[]} dir world direction TO the sun (or the moon after dark)
 */
export function setCloudLight(dir, sunHex, shadeHex, rim, g, mix) {
  const u = cloudUniforms;
  u.uCloudSun.value.set(dir[0], dir[1], dir[2]).normalize();
  u.uCloudSunCol.value.set(sunHex);
  u.uCloudShadeCol.value.set(shadeHex);
  u.uCloudRim.value = rim;
  u.uCloudG.value = g;
  u.uCloudMix.value = mix;
}

/** Hand the deck back to Lambert (style flip / unmount / flag off). */
export function clearCloudLight() {
  cloudUniforms.uCloudMix.value = 0;
}

/** Dev/harness introspection — verify-cloud-lit reads the live shaping. */
export function getCloudLight() {
  const u = cloudUniforms;
  return {
    dir: [u.uCloudSun.value.x, u.uCloudSun.value.y, u.uCloudSun.value.z],
    rim: u.uCloudRim.value,
    g: u.uCloudG.value,
    mix: u.uCloudMix.value,
  };
}

const VERT_HEAD = 'varying vec2 vR24CloudP;\n';
// The sprite quad is a PlaneGeometry normalised so its LONGER side is 1
// (drei Cloud.js: imageBounds / max), so position.xy spans at most ±0.5 —
// ×2 puts the disc edge at |p| = 1 and `clamp` handles the shorter axis.
const VERT_SET = 'vR24CloudP = position.xy * 2.0;\n';

const FRAG_HEAD = /* glsl */ `
varying vec2 vR24CloudP;
uniform vec3 uCloudSun;
uniform vec3 uCloudSunCol;
uniform vec3 uCloudShadeCol;
uniform float uCloudRim;
uniform float uCloudG;
uniform float uCloudMix;
vec3 r24CloudShade( vec3 col ) {
  if ( uCloudMix <= 0.0 ) return col;
  vec2 p = clamp( vR24CloudP, vec2( -1.0 ), vec2( 1.0 ) );
  float r2 = min( 1.0, dot( p, p ) );
  // The sprite faces the camera, so a head-on sphere's normal field in VIEW
  // space is exactly (p.x, p.y, sqrt(1 - |p|^2)).
  vec3 nV = vec3( p, sqrt( max( 0.0, 1.0 - r2 ) ) );
  // Direction (w = 0) from view space to world = multiply by the TRANSPOSE of
  // the view rotation, which in GLSL is the vector-times-matrix product.
  vec3 nW = normalize( ( vec4( nV, 0.0 ) * viewMatrix ).xyz );
  vec3 toCam = normalize( ( vec4( 0.0, 0.0, 1.0, 0.0 ) * viewMatrix ).xyz );
  float ndl = dot( nW, uCloudSun );
  float lit = smoothstep( -0.35, 0.85, ndl );
  // Henyey-Greenstein, forward lobe: cloud droplets scatter strongly toward
  // the viewer when the sun is BEHIND the puff, which is the silver lining.
  float cosT = dot( uCloudSun, -toCam );
  float g = uCloudG;
  float denom = max( 1e-3, 1.0 + g * g - 2.0 * g * cosT );
  float hg = ( 1.0 - g * g ) / ( 4.0 * PI * pow( denom, 1.5 ) );
  vec3 shaped = mix( col * uCloudShadeCol, col * uCloudSunCol, lit );
  // The rim rides the DISC EDGE (1 - r2) and only where the sun is not fully
  // behind the normal, so a shadow-side puff cannot glow.
  shaped += uCloudSunCol * ( uCloudRim * hg * ( 1.0 - r2 ) * smoothstep( -0.5, 0.3, ndl ) );
  return mix( col, shaped, uCloudMix );
}
`;

/**
 * Build the lit variant of a cloud material class. `Base` is whatever the
 * caller would have passed drei (MeshLambertMaterial in satellite); the toy
 * deck is MeshBasic and never comes through here, so Neon is untouched.
 */
export function makeLitCloudMaterial(Base = MeshLambertMaterial) {
  return class R24LitCloudMaterial extends Base {
    // drei assigns `this.onBeforeCompile = fn` from ITS constructor, one line
    // after `super()`. A prototype accessor is the only hook that survives it.
    get onBeforeCompile() {
      const chain = this._r24Chain;
      return (shader, renderer) => {
        chain?.(shader, renderer);
        shader.uniforms.uCloudSun = cloudUniforms.uCloudSun;
        shader.uniforms.uCloudSunCol = cloudUniforms.uCloudSunCol;
        shader.uniforms.uCloudShadeCol = cloudUniforms.uCloudShadeCol;
        shader.uniforms.uCloudRim = cloudUniforms.uCloudRim;
        shader.uniforms.uCloudG = cloudUniforms.uCloudG;
        shader.uniforms.uCloudMix = cloudUniforms.uCloudMix;
        shader.vertexShader = (VERT_HEAD + shader.vertexShader).replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n' + VERT_SET
        );
        // drei has already replaced <opaque_fragment> with the include plus
        // its own gl_FragColor line; we rewrite exactly that line. If drei
        // ever stops emitting it the replace is a no-op and the deck falls
        // back to plain Lambert — a missing flourish, never a broken frame.
        shader.fragmentShader = (FRAG_HEAD + shader.fragmentShader).replace(
          'gl_FragColor = vec4(outgoingLight, diffuseColor.a * vOpacity);',
          'gl_FragColor = vec4(r24CloudShade(outgoingLight), diffuseColor.a * vOpacity);'
        );
      };
    }

    set onBeforeCompile(fn) {
      this._r24Chain = fn;
    }

    // The onBeforeCompile source IS the key (the R4 lesson: patch closures
    // stringify identically). This variant is registered in the world-bend
    // registry header's R24 note even though it is not a world-bend variant,
    // so the one place that lists shader identities stays complete.
    customProgramCacheKey() {
      return 'cloud-lit-c24';
    }
  };
}

/** The satellite deck's class, built once. Null when the flag is off. */
export const LitCloudMaterial = CLOUD_LIT.enabled ? makeLitCloudMaterial() : null;

/**
 * Mini-planet world curvature (airloom reference, user 2026-07-16): every
 * ground-bound vertex drops by d²·k where d is XZ distance from the player
 * — the world falls away into the void like a tiny globe. Visual only:
 * flight, DEM queries, traffic positions and picking all stay flat-earth.
 *
 * One shared uniforms object patches MANY materials (toy chunk materials +
 * every three-tile tile material); update once per frame via setBend().
 * Curvature strength is a live uniform so non-toy styles run with k=0
 * (flat) without re-compiling or re-patching materials.
 *
 * PROGRAM CACHE KEY REGISTRY (round-4 lesson: the patch closures stringify
 * identically, so every variant MUST carry its own key or three serves the
 * wrong cached program silently):
 *   'world-bend'             applyBend — bend only. GROUND-ANCHORED objects
 *                            outside the tile/chunk materials (cloud
 *                            shadows); no fade.
 *   'world-bend-air'         applyBendAir — AIRCRAFT bend (traffic models,
 *                            billboards, tracers): full drop near the
 *                            ground, capped for airborne targets so a
 *                            plane above the player never renders below
 *                            eye level (GLOBE.trafficBend).
 *   'world-bend-fade'        applyBendFade — bend + radial GROUND fade into
 *                            the style's void color (WORLD_EDGE.fade).
 *   'world-bend-fade-foam'   + shoreline foam dash (toy WATER material).
 *   'world-bend-fade-pulse'  + road traffic pulses on aArc (toy LAND).
 *   'world-bend-fade-beacon' + rooftop beacon blink on aBeacon (toy BUILDING).
 * A material gets exactly ONE base variant (first call wins); the foam/
 * pulse/beacon layers wrap an already-fade-patched material and re-key it.
 */

const uniforms = {
  uBendCenter: { value: { x: 0, y: 0, isVector2: true } },
  uBendK: { value: 0 },
  // Edge fade (fade variant only): start/end in meters of XZ distance from
  // the bend center. Defaults sit beyond the far plane = disabled until
  // setEdgeFade() styles them.
  uEdgeFade: { value: { x: 1e9, y: 2e9, isVector2: true } },
  // OUTPUT-space (raw sRGB) color: the fade mixes AFTER three's
  // tonemapping/colorspace/fog chunks — exactly where and how fog blends —
  // so raw hex components make terrain melt seamlessly into fog/void.
  uEdgeColor: { value: { r: 0, g: 0, b: 0 } },
  // Air variant (traffic): the player's absolute eye altitude + ground
  // elevation (setBendEye per frame) and the GLOBE.trafficBend shape
  // (aglLo, aglHi, capFrac — set once via applyBendAir's cfg).
  uEyeY: { value: 0 },
  uRefGroundY: { value: 0 },
  uAirAgl: { value: { x: 150, y: 900, isVector2: true } },
  uAirCapFrac: { value: 0.8 },
};

// Replaces three's <project_vertex>: bend in WORLD space, then continue the
// pipeline manually. Keeps instancing; drops batching (unused here).
const bendProject = (fade) => /* glsl */ `
vec4 wPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
#endif
wPos = modelMatrix * wPos;
float bendD = distance( wPos.xz, uBendCenter );
wPos.y -= bendD * bendD * uBendK;
${fade ? 'vBendDist = bendD;' : ''}
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

function patchMaterial(material, fade) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = fade ? 'fade' : 'bend';
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;${
          fade ? '\nvarying float vBendDist;' : ''
        }`
      )
      .replace('#include <project_vertex>', bendProject(fade));
    if (fade) {
      shader.uniforms.uEdgeFade = uniforms.uEdgeFade;
      shader.uniforms.uEdgeColor = uniforms.uEdgeColor;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vBendDist;\nuniform vec2 uEdgeFade;\nuniform vec3 uEdgeColor;'
        )
        .replace(
          '#include <fog_fragment>',
          '#include <fog_fragment>\n' +
            'gl_FragColor.rgb = mix( gl_FragColor.rgb, uEdgeColor, smoothstep( uEdgeFade.x, uEdgeFade.y, vBendDist ) );'
        );
    }
  };
  // Explicit per-variant cache keys: both variants' onBeforeCompile
  // closures stringify identically (shared body, captured flag), so the
  // default toString()-based key would let three serve a bend-only program
  // to a fade material. Hundreds of tiles still share one program per
  // material type per variant.
  material.customProgramCacheKey = () => (fade ? 'world-bend-fade' : 'world-bend');
  material.needsUpdate = true;
}

/** Patch a material to bend with the world (no edge fade). Idempotent. */
export function applyBend(material) {
  patchMaterial(material, false);
}

/** Patch a GROUND material to bend AND fade into the void at the rim. */
export function applyBendFade(material) {
  patchMaterial(material, true);
}

// AIRCRAFT bend (traffic models / billboards / tracers): the raw d²k drop
// pulled distant HIGH traffic below the horizon (a FL210 jet 25nm out
// dropped ~13km — "planes higher than us render below us"). Near the
// ground the full drop stays (grounded/landing traffic hugs the drawn
// terrain); airborne, the drop is capped at (y − eye) × capFrac so a
// target above the player asymptotes toward the horizon line at range —
// like real distant traffic — and can never sink below eye level.
const airProject = /* glsl */ `
vec4 wPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
#endif
wPos = modelMatrix * wPos;
float bendD = distance( wPos.xz, uBendCenter );
float dropRaw = bendD * bendD * uBendK;
float airborne = smoothstep( uAirAgl.x, uAirAgl.y, wPos.y - uRefGroundY );
float capped = min( dropRaw, max( 0.0, wPos.y - uEyeY ) * uAirCapFrac );
wPos.y -= mix( dropRaw, capped, airborne );
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch an AIRCRAFT material with the altitude-aware bend. cfg (once,
 * shared): { aglLoM, aglHiM, keepFrac } from GLOBE.trafficBend.
 */
export function applyBendAir(material, cfg) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = 'air';
  if (cfg) {
    uniforms.uAirAgl.value.x = cfg.aglLoM;
    uniforms.uAirAgl.value.y = cfg.aglHiM;
    uniforms.uAirCapFrac.value = 1 - cfg.keepFrac;
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    shader.uniforms.uEyeY = uniforms.uEyeY;
    shader.uniforms.uRefGroundY = uniforms.uRefGroundY;
    shader.uniforms.uAirAgl = uniforms.uAirAgl;
    shader.uniforms.uAirCapFrac = uniforms.uAirCapFrac;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;\nuniform float uEyeY;\nuniform float uRefGroundY;\nuniform vec2 uAirAgl;\nuniform float uAirCapFrac;'
      )
      .replace('#include <project_vertex>', airProject);
  };
  material.customProgramCacheKey = () => 'world-bend-air';
  material.needsUpdate = true;
}

/** Per-frame: bend center (rebased world XZ) + strength k = 1/(2R). */
export function setBend(cx, cz, k) {
  uniforms.uBendCenter.value.x = cx;
  uniforms.uBendCenter.value.y = cz;
  uniforms.uBendK.value = k;
}

/** Per-frame (with setBend): player eye altitude + ground elevation. */
export function setBendEye(eyeY, groundY) {
  uniforms.uEyeY.value = eyeY;
  uniforms.uRefGroundY.value = groundY;
}

// --- Shoreline foam animation (water material only) -------------------------
// The vector worker bakes an `aFoam` per-vertex attribute into the water
// group: accumulated arc-length (m) along foam ribbons, -1 sentinel on
// plain water. This layer scrolls a bright dash train along that arc —
// zero extra draws (the foam lives inside the merged water geometry).

const foamUniforms = {
  uFoamT: { value: 0 },
  uFoamLenM: { value: 180 },
};

/**
 * Wrap a (already bend-fade-patched) water material with the scrolling
 * foam dash. MUST carry its own program cache key — a foam-less material
 * sharing 'world-bend-fade' would be served the wrong program.
 */
export function applyFoamLayer(material, lenM) {
  if (!material || material.userData.__foamLayer) return;
  material.userData.__foamLayer = true;
  if (lenM != null) foamUniforms.uFoamLenM.value = lenM;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uFoamT = foamUniforms.uFoamT;
    shader.uniforms.uFoamLenM = foamUniforms.uFoamLenM;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aFoam;\nvarying float vFoam;'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoam = aFoam;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vFoam;\nuniform float uFoamT;\nuniform float uFoamLenM;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vFoam >= 0.0 ) {
  float ph = fract( vFoam / uFoamLenM - uFoamT );
  float dash = smoothstep( 0.30, 0.48, ph ) * ( 1.0 - smoothstep( 0.60, 0.82, ph ) );
  diffuseColor.rgb *= 0.55 + 0.75 * dash;
}`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-fade-foam';
  material.needsUpdate = true;
}

/** Per-frame (ToyWorldLayer): advance the foam dash train. */
export function setFoamTime(t) {
  foamUniforms.uFoamT.value = t;
}

// --- Road pulses + rooftop beacons (toy land/building materials) ------------
// Same worker-baked-attribute technique as the foam: the LAND group carries
// aArc (arc length along motorway/trunk/primary ribbons, -1 elsewhere; the
// worker flips arc direction per feature for two-way traffic), the BUILDING
// group carries aBeacon (per-beacon blink phase 0..1, -1 elsewhere). Both
// scroll/blink on shared clocks — zero extra draw calls.

const pulseUniforms = {
  uPulseT: { value: 0 }, // road dash clock, in wavelengths
  uPulseLen: { value: 420 },
  uPulseDuty: { value: 0.12 },
  uPulseBoost: { value: 1.35 },
  uBeaconT: { value: 0 }, // beacon clock, in blink cycles
  uBeaconDuty: { value: 0.3 },
  uBeaconDim: { value: 0.35 },
  uBeaconBoost: { value: 1.8 },
};

/**
 * Wrap the (already bend-fade-patched) toy LAND material with the scrolling
 * road-pulse dash. Every geometry drawn with this material MUST supply the
 * aArc attribute (a missing attribute reads 0 → the whole surface pulses).
 */
export function applyRoadPulse(material, cfg) {
  if (!material || material.userData.__roadPulse) return;
  material.userData.__roadPulse = true;
  if (cfg) {
    pulseUniforms.uPulseLen.value = cfg.lenM;
    pulseUniforms.uPulseDuty.value = cfg.duty;
    pulseUniforms.uPulseBoost.value = cfg.boost;
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uPulseT = pulseUniforms.uPulseT;
    shader.uniforms.uPulseLen = pulseUniforms.uPulseLen;
    shader.uniforms.uPulseDuty = pulseUniforms.uPulseDuty;
    shader.uniforms.uPulseBoost = pulseUniforms.uPulseBoost;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aArc;\nvarying float vArc;'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArc = aArc;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vArc;\nuniform float uPulseT;\nuniform float uPulseLen;\nuniform float uPulseDuty;\nuniform float uPulseBoost;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vArc >= 0.0 ) {
  float ph = fract( vArc / uPulseLen - uPulseT );
  float dash = smoothstep( 0.0, uPulseDuty * 0.4, ph ) * ( 1.0 - smoothstep( uPulseDuty * 0.7, uPulseDuty, ph ) );
  diffuseColor.rgb *= 1.0 + uPulseBoost * dash;
}`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-fade-pulse';
  material.needsUpdate = true;
}

/**
 * Wrap the (already bend-fade-patched) toy BUILDING material with the slow
 * rooftop-beacon blink. Every geometry drawn with it MUST supply aBeacon.
 */
export function applyBeaconBlink(material, cfg) {
  if (!material || material.userData.__beaconBlink) return;
  material.userData.__beaconBlink = true;
  if (cfg) {
    pulseUniforms.uBeaconDuty.value = cfg.duty;
    pulseUniforms.uBeaconDim.value = cfg.dim;
    pulseUniforms.uBeaconBoost.value = cfg.boost;
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBeaconT = pulseUniforms.uBeaconT;
    shader.uniforms.uBeaconDuty = pulseUniforms.uBeaconDuty;
    shader.uniforms.uBeaconDim = pulseUniforms.uBeaconDim;
    shader.uniforms.uBeaconBoost = pulseUniforms.uBeaconBoost;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aBeacon;\nvarying float vBeacon;'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBeacon = aBeacon;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vBeacon;\nuniform float uBeaconT;\nuniform float uBeaconDuty;\nuniform float uBeaconDim;\nuniform float uBeaconBoost;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vBeacon >= 0.0 ) {
  float ph = fract( uBeaconT + vBeacon );
  float on = smoothstep( 0.0, 0.12, ph ) * ( 1.0 - smoothstep( uBeaconDuty, uBeaconDuty + 0.15, ph ) );
  diffuseColor.rgb *= uBeaconDim + uBeaconBoost * on;
}`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-fade-beacon';
  material.needsUpdate = true;
}

/** Per-frame (ToyWorldLayer): advance the road-pulse + beacon clocks. */
export function setPulseTime(pulseT, beaconT) {
  pulseUniforms.uPulseT.value = pulseT;
  pulseUniforms.uBeaconT.value = beaconT;
}

/**
 * Style-change-time (NOT per frame): where the ground fade band sits and
 * the raw-sRGB color it melts into (match the style's fog/void family).
 */
export function setEdgeFade(startM, endM, hex) {
  uniforms.uEdgeFade.value.x = startM;
  uniforms.uEdgeFade.value.y = endM;
  const n = parseInt(hex.slice(1), 16);
  uniforms.uEdgeColor.value.r = ((n >> 16) & 255) / 255;
  uniforms.uEdgeColor.value.g = ((n >> 8) & 255) / 255;
  uniforms.uEdgeColor.value.b = (n & 255) / 255;
}

/**
 * The live bend state (rebased center + k) for CPU-side consumers (letters,
 * label projections). Reading the SAME uniform FlyScene writes guarantees
 * DOM overlays and discrete objects agree with the GPU exactly.
 */
export function getBend() {
  return {
    cx: uniforms.uBendCenter.value.x,
    cz: uniforms.uBendCenter.value.y,
    k: uniforms.uBendK.value,
  };
}

/** CPU-side drop for discrete GROUND objects (POI letters) at distance d. */
export function bendDrop(d, k) {
  return d * d * k;
}

/**
 * CPU-side drop for an AIRCRAFT at distance d and absolute altitude y —
 * the exact mirror of the 'world-bend-air' vertex formula, reading the
 * SAME live uniforms, so DOM label/reticle projections and harness aim
 * agree with the GPU to the pixel.
 */
export function airDrop(d, y, k = uniforms.uBendK.value) {
  const dropRaw = d * d * k;
  const agl = y - uniforms.uRefGroundY.value;
  const { x: lo, y: hi } = uniforms.uAirAgl.value;
  let t = Math.min(1, Math.max(0, (agl - lo) / (hi - lo)));
  t = t * t * (3 - 2 * t); // smoothstep
  const capped = Math.min(dropRaw, Math.max(0, y - uniforms.uEyeY.value) * uniforms.uAirCapFrac.value);
  return dropRaw * (1 - t) + capped * t;
}

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
 *
 * Round 8 (P4) regeneration: the SHARED base fade patch gained a DEPTH-HAZE
 * mix (before the rim edge-fade), so every fade-family FINAL key was bumped
 * with an '-r8' suffix (fade, foam, pulse-rwy, hill). The P3 building key
 * building key was already -r8 (its program is unique to round 8 — the base
 * haze folds in under the same key, no collision, so it was NOT
 * double-suffixed then; the FIX round later bumped it to '-r8b' for the crown
 * emissive floor). The anchor variant took the same '-r8' marker for
 * generation hygiene even though its body is unchanged. The INTERMEDIATE
 * pulse/beacon keys are overwritten by the rwy/grid wrap before any compile,
 * so they keep their round-7 names.
 *
 *   'world-bend'             applyBend — bend only. GROUND-ANCHORED objects
 *                            outside the tile/chunk materials (cloud
 *                            shadows); no fade, no haze.
 *   'world-bend-air'         applyBendAir — AIRCRAFT bend (tracer ribbons/
 *                            streaks — per-VERTEX): full drop near the
 *                            ground, capped for airborne targets so a
 *                            plane above the player never renders below
 *                            eye level (GLOBE.trafficBend). No base fade/haze.
 *   'world-bend-air-anchor'  applyBendAirAnchor — same air formula but
 *                            evaluated ONCE at the instance origin (traffic
 *                            models + far billboards). Per-vertex air-drop
 *                            SHEARED rigid objects: a distance-grown rim
 *                            billboard straddling the AGL blend band had
 *                            its bottom verts ground-glued (km drop) and
 *                            its top verts eye-capped — the "vertical
 *                            contrail" bars (round-6 user report). Still the
 *                            FINAL key for the far-LOD BILLBOARD material.
 *   'world-bend-air-anchor-nav' (round 8, P6) applyNavLights — + baked
 *                            aircraft nav lights on aEmissive (vec4: rgb ×
 *                            intensity, mode in w — 0 steady, (0,0.5]
 *                            wingtip strobe, (0.5,1] belly beacon; phases
 *                            hashed per model+light in model-loader.js).
 *                            Emissive is dimmed by the instance tint's luma
 *                            so the stale-ghost ladder fades lights for
 *                            free. Wraps the air-anchor-patched traffic
 *                            MODEL material (FINAL key for it); a missing
 *                            aEmissive (primitive geometries pre-GLB-swap)
 *                            reads 0 → dark, the safe direction.
 *   'world-bend-fade-r8'     applyBendFade — bend + radial GROUND fade into
 *                            the style's void color (WORLD_EDGE.fade) + the
 *                            round-8 depth haze (setDepthHaze), mixed BEFORE
 *                            the edge fade. Base fade for tiles + every toy
 *                            chunk material; tree/grass materials END here,
 *                            everything else is wrapped further below.
 *   'world-bend-fade-foam-r8'   + shoreline foam dash (toy WATER material).
 *   'world-bend-fade-pulse'  + road traffic pulses on aArc — INTERMEDIATE: the
 *                            LAND material is immediately re-wrapped by
 *                            applyRunwayGlow, so this key never reaches a
 *                            compile (kept only as the userData marker).
 *   'world-bend-fade-beacon' + rooftop beacon blink on aBeacon — INTERMEDIATE:
 *                            the BUILDING material is immediately re-wrapped by
 *                            applyFacadeGrid (same reason as pulse).
 *   'world-bend-fade-pulse-rwy-r8'  (round 7) + runway edge lights on aGlow —
 *                            wraps the pulse-patched LAND material (FINAL LAND
 *                            key; -r8 inherits the base-fade haze change).
 *   'world-bend-fade-beacon-grid-r8b' (round 8, P3; -r8b in the round-8 FIX
 *                            round) + STRUCTURED facade window
 *                            GRID (edge-centered columns × 3m floors ×
 *                            contiguous lit/dark floors × office runs × corner
 *                            boost × dark-glass × street AO) + emissive crown/
 *                            spire-tip dispatch (aFacade.x ≤ -1.5) + reduced
 *                            parapet glow, reading aFacade + the new aEdge
 *                            (edgeLenM, litBias). Replaces round-7
 *                            'world-bend-fade-beacon-win' (random-dot lights).
 *                            Wraps the beacon-patched BUILDING material (FINAL
 *                            BUILDING key). The fix-round '-r8b' bump adds a
 *                            crown/spire-tip emissive FLOOR (uCrownFloor via
 *                            emissivemap_fragment) so skyline crowns clear the
 *                            bloom threshold instead of riding the toon ramp
 *                            down to near-black at range.
 *   'world-bend-anchor-r8'   (round 7; -r8 in round 8, P4) applyBendAnchor —
 *                            GROUND bend + rim dissolve evaluated at the
 *                            INSTANCE ORIGIN (rigid instanced ground objects:
 *                            town glow domes; P5 landmark monuments). Per-vertex
 *                            ground bend would shear them (round-6 lesson 2).
 *                            Body UNCHANGED — it does NOT use the base fade
 *                            patch (its additive rim-dissolve stays haze-free so
 *                            the horizon town-glow isn't dimmed); '-r8' is the
 *                            fade-family generation marker only.
 *   'world-bend-fade-hill-r8'   (round 7) applyHillshade — DEM-normal hillshade
 *                            multiplier on the TILE materials, sun-direction
 *                            driven by the day cycle. Strength is a live
 *                            uniform (0 outside satellite — the same hook
 *                            patches toy's solid-tan tiles). FINAL TILE key.
 * A material gets exactly ONE base variant (first call wins); the foam/
 * pulse/beacon/window/runway layers wrap an already-patched material and
 * re-key it.
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
  // Round 8 (P4) DEPTH HAZE (aerial perspective): the GROUND (fade variant)
  // mixes toward uHazeColor across [uHaze.x, uHaze.y] of XZ distance, BEFORE
  // the rim edge fade. OUTPUT-space (raw sRGB) like uEdgeColor — the mix lands
  // in the same after-fog slot. Off (max 0) until setDepthHaze() styles it
  // (0 outside toy). endM must sit UNDER the style's fade start so the rim
  // gates hold (toy: 13km haze end < 14km fade start).
  uHaze: { value: { x: 1e9, y: 2e9, isVector2: true } },
  uHazeColor: { value: { r: 0, g: 0, b: 0 } },
  uHazeMax: { value: 0 },
  // Air variant (traffic): the player's absolute eye altitude + ground
  // elevation (setBendEye per frame) and the GLOBE.trafficBend shape
  // (aglLo, aglHi, capFrac — set once via applyBendAir's cfg).
  uEyeY: { value: 0 },
  uRefGroundY: { value: 0 },
  uAirAgl: { value: { x: 150, y: 900, isVector2: true } },
  uAirCapFrac: { value: 0.8 },
  // Round 7 altitude lift (user: "aircraft ABOVE us appear below/at the
  // horizon"): the cap fraction ramps from uAirCapFrac (near, physical) to
  // uAirCapFar (far) across uAirLiftRange — a NEGATIVE far value turns the
  // cap into an exaggeration, so distant high traffic reads visibly UP.
  uAirLiftRange: { value: { x: 3000, y: 20000, isVector2: true } },
  uAirCapFar: { value: -1.5 }, // = 1 - GLOBE.trafficBend.farLiftBoost
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
      shader.uniforms.uHaze = uniforms.uHaze;
      shader.uniforms.uHazeColor = uniforms.uHazeColor;
      shader.uniforms.uHazeMax = uniforms.uHazeMax;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vBendDist;\nuniform vec2 uEdgeFade;\nuniform vec3 uEdgeColor;\nuniform vec2 uHaze;\nuniform vec3 uHazeColor;\nuniform float uHazeMax;'
        )
        .replace(
          '#include <fog_fragment>',
          '#include <fog_fragment>\n' +
            '// round-8 depth haze (aerial perspective): recede toward the haze\n' +
            '// tone with distance BEFORE the rim fade eats the terrain\n' +
            'gl_FragColor.rgb = mix( gl_FragColor.rgb, uHazeColor, uHazeMax * smoothstep( uHaze.x, uHaze.y, vBendDist ) );\n' +
            'gl_FragColor.rgb = mix( gl_FragColor.rgb, uEdgeColor, smoothstep( uEdgeFade.x, uEdgeFade.y, vBendDist ) );'
        );
    }
  };
  // Explicit per-variant cache keys: both variants' onBeforeCompile
  // closures stringify identically (shared body, captured flag), so the
  // default toString()-based key would let three serve a bend-only program
  // to a fade material. Hundreds of tiles still share one program per
  // material type per variant.
  material.customProgramCacheKey = () => (fade ? 'world-bend-fade-r8' : 'world-bend');
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
float capF = mix( uAirCapFrac, uAirCapFar, smoothstep( uAirLiftRange.x, uAirLiftRange.y, bendD ) );
float capped = min( dropRaw, max( 0.0, wPos.y - uEyeY ) * capF );
wPos.y -= mix( dropRaw, capped, airborne );
vAirDist = bendD;
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
    if (cfg.liftNearM != null) {
      uniforms.uAirLiftRange.value.x = cfg.liftNearM;
      uniforms.uAirLiftRange.value.y = cfg.liftFarM;
      uniforms.uAirCapFar.value = 1 - cfg.farLiftBoost;
    }
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
    shader.uniforms.uAirLiftRange = uniforms.uAirLiftRange;
    shader.uniforms.uAirCapFar = uniforms.uAirCapFar;
    shader.uniforms.uEdgeFade = uniforms.uEdgeFade;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;\nuniform float uEyeY;\nuniform float uRefGroundY;\nuniform vec2 uAirAgl;\nuniform float uAirCapFrac;\nuniform vec2 uAirLiftRange;\nuniform float uAirCapFar;\nvarying float vAirDist;'
      )
      .replace('#include <project_vertex>', airProject);
    // Rim dissolve (round 6): trails PAST the ground's edge-fade band drew
    // over the void — and a trail pointing radially away foreshortens its
    // drop gradient into a floating vertical bar. Additive material: fading
    // the color to black IS transparency. Rides the same style-driven
    // uEdgeFade band as the ground, so trails and terrain agree per style.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vAirDist;\nuniform vec2 uEdgeFade;'
      )
      .replace(
        '#include <fog_fragment>',
        '#include <fog_fragment>\n' +
          'gl_FragColor.rgb *= 1.0 - smoothstep( uEdgeFade.x, uEdgeFade.y, vAirDist );'
      );
  };
  material.customProgramCacheKey = () => 'world-bend-air';
  material.needsUpdate = true;
}

// Anchor variant: the SAME air formula, but the drop is computed at the
// instance origin and applied uniformly — rigid objects (aircraft models,
// camera-facing billboards) translate down as a unit instead of shearing.
const airAnchorProject = /* glsl */ `
vec4 wPos = vec4( transformed, 1.0 );
vec4 wRef = vec4( 0.0, 0.0, 0.0, 1.0 );
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
  wRef = instanceMatrix * wRef;
#endif
wPos = modelMatrix * wPos;
wRef = modelMatrix * wRef;
float bendD = distance( wRef.xz, uBendCenter );
float dropRaw = bendD * bendD * uBendK;
float airborne = smoothstep( uAirAgl.x, uAirAgl.y, wRef.y - uRefGroundY );
float capF = mix( uAirCapFrac, uAirCapFar, smoothstep( uAirLiftRange.x, uAirLiftRange.y, bendD ) );
float capped = min( dropRaw, max( 0.0, wRef.y - uEyeY ) * capF );
wPos.y -= mix( dropRaw, capped, airborne );
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch a RIGID aircraft material (instanced models/billboards) with the
 * altitude-aware bend evaluated once per instance. cfg as applyBendAir.
 */
export function applyBendAirAnchor(material, cfg) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = 'air-anchor';
  if (cfg) {
    uniforms.uAirAgl.value.x = cfg.aglLoM;
    uniforms.uAirAgl.value.y = cfg.aglHiM;
    uniforms.uAirCapFrac.value = 1 - cfg.keepFrac;
    if (cfg.liftNearM != null) {
      uniforms.uAirLiftRange.value.x = cfg.liftNearM;
      uniforms.uAirLiftRange.value.y = cfg.liftFarM;
      uniforms.uAirCapFar.value = 1 - cfg.farLiftBoost;
    }
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
    shader.uniforms.uAirLiftRange = uniforms.uAirLiftRange;
    shader.uniforms.uAirCapFar = uniforms.uAirCapFar;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;\nuniform float uEyeY;\nuniform float uRefGroundY;\nuniform vec2 uAirAgl;\nuniform float uAirCapFrac;\nuniform vec2 uAirLiftRange;\nuniform float uAirCapFar;'
      )
      .replace('#include <project_vertex>', airAnchorProject);
  };
  material.customProgramCacheKey = () => 'world-bend-air-anchor';
  material.needsUpdate = true;
}

// --- Round 8 (P6): aircraft nav lights (traffic model material) -------------
// model-loader.js bakes aEmissive (vec4) into every merged fleet geometry:
// rgb = emissive color × intensity on nav-light octahedra (and any source-
// model emissive), (0,0,0,0) on hull verts. This layer animates them on one
// clock — zero extra draws, the lights live inside the instanced meshes.

const navUniforms = {
  uNavT: { value: 0 }, // seconds; advanced once per frame by TrafficLayer
  uStrobeHz: { value: 1.2 },
  uStrobeDuty: { value: 0.06 },
  uBeaconHz: { value: 0.9 },
};

/**
 * Wrap the (already applyBendAirAnchor-patched) traffic MODEL material with
 * the baked nav-light emissive. cfg: NAV_LIGHTS (strobeHz/strobeDuty/
 * beaconHz). Mode dispatch on aEmissive.w: ≤0 steady, ≤0.5 strobe
 * (phase = w×2), else beacon (phase = (w−0.5)×2, 35% ember between blinks).
 * The luma-of-vColor factor rides the EXISTING instance-tint stale ladder
 * (white → fog) so ghosting traffic dims its lights without any new
 * per-instance data; it is compiled out until the material actually has
 * vertex/instance colors (the primitive-geometry boot frames).
 */
export function applyNavLights(material, cfg) {
  if (!material || material.userData.__navLights) return;
  material.userData.__navLights = true;
  if (cfg) {
    navUniforms.uStrobeHz.value = cfg.strobeHz;
    navUniforms.uStrobeDuty.value = cfg.strobeDuty;
    navUniforms.uBeaconHz.value = cfg.beaconHz;
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uNavT = navUniforms.uNavT;
    shader.uniforms.uStrobeHz = navUniforms.uStrobeHz;
    shader.uniforms.uStrobeDuty = navUniforms.uStrobeDuty;
    shader.uniforms.uBeaconHz = navUniforms.uBeaconHz;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aEmissive;\nvarying vec4 vEmissive;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvEmissive = aEmissive;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec4 vEmissive;\nuniform float uNavT;\nuniform float uStrobeHz;\nuniform float uStrobeDuty;\nuniform float uBeaconHz;'
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float navOn = vEmissive.w <= 0.0 ? 1.0
  : vEmissive.w <= 0.5 ? step( fract( uNavT * uStrobeHz + vEmissive.w * 2.0 ), uStrobeDuty )
  : 0.35 + 0.65 * step( fract( uNavT * uBeaconHz + ( vEmissive.w - 0.5 ) * 2.0 ), 0.4 );
float navTint = 1.0;
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  // stale-fade rides along: the instance tint dims toward fog, so do lights
  navTint = clamp( ( vColor.r + vColor.g + vColor.b ) * 0.5, 0.0, 1.0 );
#endif
totalEmissiveRadiance += vEmissive.rgb * navOn * navTint;`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-air-anchor-nav';
  material.needsUpdate = true;
}

/** Per-frame (TrafficLayer): advance the nav-light strobe/beacon clock. */
export function setNavTime(t) {
  navUniforms.uNavT.value = t;
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
 * sharing 'world-bend-fade-r8' would be served the wrong program.
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
  material.customProgramCacheKey = () => 'world-bend-fade-foam-r8';
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

// --- Round 7 "Electric Night City" layers -----------------------------------
// Facade window lights (building) + runway edge lights (land): the same
// worker-baked-attribute technique — aFacade (vec4: arc-along-wall m,
// height m, building H, hash01) and aGlow (0..1 runway arc, -1 sentinel).
// All static config lands in uniforms at apply-time; the only animated
// inputs reuse the EXISTING pulse/beacon clocks — zero new per-frame sites.

const cityUniforms = {
  // Round 8 (P3) facade window GRID (replaces round-7 uWin* random-dot set).
  uGrid: { value: { x: 2.6, y: 3.0, isVector2: true } }, // (colPitchM, floorHM)
  uLitFloorFrac: { value: 0.72 }, // fraction of floors lit (× per-building litBias)
  uLitCellFrac: { value: 0.55 }, // fraction of office-runs lit within a lit floor
  uRunLen: { value: 3 }, // adjacent windows sharing one lit/dark decision
  uCornerBoost: { value: 0.35 }, // corner-column brightness bump
  uWinBoost: { value: 1.7 }, // lit-cell brightness
  uGroundRows: { value: 1 }, // dark floors at street level
  uWinFlickerFrac: { value: 0.015 }, // slow cell toggling on the beacon clock
  uFootAO: { value: { x: 0.45, y: 12, isVector2: true } }, // (strength, falloffM)
  uWinColorA: { value: { x: 1, y: 0.6, z: 0.35, isVector3: true } },
  uWinColorB: { value: { x: 0.6, y: 0.75, z: 1, isVector3: true } },
  uWinEdgeColor: { value: { x: 0.75, y: 0.85, z: 1, isVector3: true } },
  uWinEdgeBoost: { value: 0.5 }, // reduced parapet glow (geometric parapet exists)
  uWinEdgeStart: { value: 0.9 },
  uCrownFloor: { value: 0.7 }, // crown/spire-tip emissive floor (F5 fix)
  uRwyColor: { value: { x: 1, y: 0.93, z: 0.78, isVector3: true } },
  uRwyBoost: { value: 2.0 },
  uRwyChase: { value: 0.35 },
};

const setV3 = (u, rgb) => {
  u.value.x = rgb[0];
  u.value.y = rgb[1];
  u.value.z = rgb[2];
};

/**
 * Wrap the (already beacon-patched) toy BUILDING material with the round-8
 * STRUCTURED facade window grid (replaces round-7 applyWindowLights, which
 * lit random dots the user rejected). Reads aFacade (role-dispatched:
 * x ≥ 0 = wall EDGE-LOCAL arc; x == -1 = plain roof/detail; x ≤ -1.5 =
 * emissive crown/spire tip, boost in aFacade.y) + the new aEdge
 * (edgeLenM, litBias). A missing aEdge reads 0 → zero window columns → DARK
 * walls (the safe direction; missing-attribute-reads-0 trap avoided).
 * cfg: WINDOW_GRID constants + { colorA, colorB, edgeColor } as linear RGB.
 * The flicker term reads uBeaconT, declared by the beacon layer that always
 * patches this material first (engine order) — do NOT re-declare it here.
 */
export function applyFacadeGrid(material, cfg) {
  if (!material || material.userData.__facadeGrid) return;
  material.userData.__facadeGrid = true;
  if (cfg) {
    cityUniforms.uGrid.value.x = cfg.colPitchM;
    cityUniforms.uGrid.value.y = cfg.floorHM;
    cityUniforms.uLitFloorFrac.value = cfg.litFloorFrac;
    cityUniforms.uLitCellFrac.value = cfg.litCellFrac;
    cityUniforms.uRunLen.value = cfg.runLen;
    cityUniforms.uCornerBoost.value = cfg.cornerBoost;
    cityUniforms.uWinBoost.value = cfg.boost;
    cityUniforms.uGroundRows.value = cfg.groundRows;
    cityUniforms.uWinFlickerFrac.value = cfg.flickerFrac;
    cityUniforms.uFootAO.value.x = cfg.footAO;
    cityUniforms.uFootAO.value.y = cfg.footAOFalloffM;
    cityUniforms.uWinEdgeStart.value = cfg.edgeStartFrac;
    cityUniforms.uWinEdgeBoost.value = cfg.edgeBoost;
    if (cfg.crownFloor !== undefined) cityUniforms.uCrownFloor.value = cfg.crownFloor;
    if (cfg.colorA) setV3(cityUniforms.uWinColorA, cfg.colorA);
    if (cfg.colorB) setV3(cityUniforms.uWinColorB, cfg.colorB);
    if (cfg.edgeColor) setV3(cityUniforms.uWinEdgeColor, cfg.edgeColor);
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uGrid = cityUniforms.uGrid;
    shader.uniforms.uLitFloorFrac = cityUniforms.uLitFloorFrac;
    shader.uniforms.uLitCellFrac = cityUniforms.uLitCellFrac;
    shader.uniforms.uRunLen = cityUniforms.uRunLen;
    shader.uniforms.uCornerBoost = cityUniforms.uCornerBoost;
    shader.uniforms.uWinBoost = cityUniforms.uWinBoost;
    shader.uniforms.uGroundRows = cityUniforms.uGroundRows;
    shader.uniforms.uWinFlickerFrac = cityUniforms.uWinFlickerFrac;
    shader.uniforms.uFootAO = cityUniforms.uFootAO;
    shader.uniforms.uWinColorA = cityUniforms.uWinColorA;
    shader.uniforms.uWinColorB = cityUniforms.uWinColorB;
    shader.uniforms.uWinEdgeColor = cityUniforms.uWinEdgeColor;
    shader.uniforms.uWinEdgeBoost = cityUniforms.uWinEdgeBoost;
    shader.uniforms.uWinEdgeStart = cityUniforms.uWinEdgeStart;
    shader.uniforms.uCrownFloor = cityUniforms.uCrownFloor;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aFacade;\nattribute vec2 aEdge;\nvarying vec4 vFacade;\nvarying vec2 vEdge;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFacade = aFacade;\nvEdge = aEdge;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec4 vFacade;\nvarying vec2 vEdge;\nuniform vec2 uGrid;\nuniform float uLitFloorFrac;\nuniform float uLitCellFrac;\nuniform float uRunLen;\nuniform float uCornerBoost;\nuniform float uWinBoost;\nuniform float uGroundRows;\nuniform float uWinFlickerFrac;\nuniform vec2 uFootAO;\nuniform vec3 uWinColorA;\nuniform vec3 uWinColorB;\nuniform vec3 uWinEdgeColor;\nuniform float uWinEdgeBoost;\nuniform float uWinEdgeStart;\nuniform float uCrownFloor;\nfloat hash11( float n ) { return fract( sin( n ) * 43758.5453123 ); }'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vFacade.x <= -1.5 ) {
  // emissive tower crown / spire tip: steady neon, boost in aFacade.y
  diffuseColor.rgb *= vFacade.y;
} else if ( vFacade.x >= 0.0 ) {
  // window column grid CENTERED on this facade's edge (aEdge.x = edgeLenM)
  float nCols = floor( vEdge.x / uGrid.x );
  float pad = 0.5 * ( vEdge.x - nCols * uGrid.x );
  float u = vFacade.x - pad;
  float col = floor( u / uGrid.x );
  float row = floor( vFacade.y / uGrid.y );
  float inGrid = step( 0.0, u ) * step( col, nCols - 1.0 )
    * step( uGrid.y * uGroundRows, vFacade.y ) * step( vFacade.y, vFacade.z - 0.4 );
  // contiguous lit/dark FLOORS (density × district litBias) × office RUNS
  float floorLit = step( hash11( row * 7.13 + vFacade.w * 91.7 ), uLitFloorFrac * vEdge.y );
  float run = floor( col / uRunLen );
  float cellLit = step( hash11( run * 3.71 + row * 17.9 + vFacade.w * 57.3 ), uLitCellFrac );
  float corner = 1.0 + uCornerBoost * ( step( col, 0.5 ) + step( nCols - 1.5, col ) );
  float lit = floorLit * cellLit;
  // ≤1.5% of cells slowly toggle on the shared beacon clock (subtle life)
  float flick = step( abs( hash11( col * 2.13 + row * 5.7 + vFacade.w * 13.0 ) - fract( uBeaconT * 0.13 ) ), uWinFlickerFrac );
  lit = abs( lit - flick );
  vec2 cuv = vec2( fract( u / uGrid.x ), fract( vFacade.y / uGrid.y ) );
  float wx = smoothstep( 0.18, 0.30, cuv.x ) * ( 1.0 - smoothstep( 0.70, 0.82, cuv.x ) );
  float wy = smoothstep( 0.16, 0.28, cuv.y ) * ( 1.0 - smoothstep( 0.78, 0.90, cuv.y ) );
  float win = wx * wy * inGrid;
  vec3 winCol = mix( uWinColorA, uWinColorB, step( 0.72, fract( vFacade.w * 7.31 ) ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, winCol * uWinBoost * corner, win * lit );
  // even UNLIT windows darken 25% so the dark-glass grid reads everywhere
  diffuseColor.rgb *= 1.0 - 0.25 * win * ( 1.0 - lit );
  // street-level ambient occlusion: exponential foot darkening (per fragment)
  diffuseColor.rgb *= 1.0 - uFootAO.x * exp( -vFacade.y / uFootAO.y );
  // parapet edge glow (reduced — a geometric parapet now exists)
  diffuseColor.rgb += uWinEdgeColor * ( uWinEdgeBoost * smoothstep( uWinEdgeStart * vFacade.z, vFacade.z, vFacade.y ) );
}`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
if ( vFacade.x <= -1.5 ) {
  // round 8 fix (F5) crown emissive FLOOR: the diffuse-only multiply above
  // rides the moonlit toon ramp down to ~68/255 at range (skyline crowns
  // unreadable). True emissive adds AFTER lighting — diffuseColor here is
  // already crownColor × boost, so × uCrownFloor clears bloomThreshold 0.56.
  totalEmissiveRadiance = max( totalEmissiveRadiance, diffuseColor.rgb * uCrownFloor );
}`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-fade-beacon-grid-r8b';
  material.needsUpdate = true;
}

/**
 * Wrap the (already pulse-patched) toy LAND material with the runway edge
 * lights. Every geometry drawn with it MUST supply aGlow (-1 sentinel).
 * cfg: RUNWAY_LIGHTS constants + { color } linear RGB.
 */
export function applyRunwayGlow(material, cfg) {
  if (!material || material.userData.__runwayGlow) return;
  material.userData.__runwayGlow = true;
  if (cfg) {
    cityUniforms.uRwyBoost.value = cfg.boost;
    cityUniforms.uRwyChase.value = cfg.chase;
    if (cfg.color) setV3(cityUniforms.uRwyColor, cfg.color);
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uRwyColor = cityUniforms.uRwyColor;
    shader.uniforms.uRwyBoost = cityUniforms.uRwyBoost;
    shader.uniforms.uRwyChase = cityUniforms.uRwyChase;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlow;\nvarying float vGlow;'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vGlow;\nuniform vec3 uRwyColor;\nuniform float uRwyBoost;\nuniform float uRwyChase;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vGlow >= 0.0 ) {
  float rab = 1.0;
  if ( uRwyChase > 0.001 ) {
    float rph = fract( vGlow * 24.0 - uPulseT * uRwyChase );
    rab = 0.72 + 0.55 * smoothstep( 0.82, 1.0, rph );
  }
  diffuseColor.rgb = uRwyColor * uRwyBoost * rab;
}`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-fade-pulse-rwy-r8';
  material.needsUpdate = true;
}

// --- Round 7: satellite hillshade layer (tile materials) --------------------
// The DEM meshes already carry real per-vertex normals and the tile
// material is a MeshStandardMaterial — relief reads flat only because the
// ambient wash (hemi + HDRI env + a fixed high sun) direction-washes it.
// Rather than re-balancing Day's authored lighting, multiply the diffuse by
// a slope term against a live sun direction. transformedNormal is used
// (normalMatrix-corrected — tile local frames carry non-uniform scale).

const hillUniforms = {
  uHillDir: { value: { x: 0.5, y: 0.6, z: 0.62, isVector3: true } },
  uHillStrength: { value: 0 }, // live style gate: 0 = layer inert
  uHillAmbient: { value: 0.55 },
  uHillLift: { value: 0.15 },
};

/**
 * Wrap a (already bend-fade-patched) TILE material with the DEM hillshade.
 * cfg { ambient, lift } is apply-time; strength/direction are live
 * (setHillshade / setHillDir — style-change and day-cycle time only).
 */
export function applyHillshade(material, cfg) {
  if (!material || material.userData.__hillshade) return;
  material.userData.__hillshade = true;
  if (cfg) {
    hillUniforms.uHillAmbient.value = cfg.ambient;
    hillUniforms.uHillLift.value = cfg.lift;
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uHillDir = hillUniforms.uHillDir;
    shader.uniforms.uHillStrength = hillUniforms.uHillStrength;
    shader.uniforms.uHillAmbient = hillUniforms.uHillAmbient;
    shader.uniforms.uHillLift = hillUniforms.uHillLift;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uHillDir;\nvarying float vHill;'
      )
      .replace(
        '#include <defaultnormal_vertex>',
        '#include <defaultnormal_vertex>\nvHill = clamp( dot( normalize( transformedNormal ), normalize( ( viewMatrix * vec4( uHillDir, 0.0 ) ).xyz ) ), 0.0, 1.0 );'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vHill;\nuniform float uHillStrength;\nuniform float uHillAmbient;\nuniform float uHillLift;'
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb *= mix( 1.0, uHillAmbient + ( 1.0 + uHillLift - uHillAmbient ) * vHill, uHillStrength );'
      );
  };
  material.customProgramCacheKey = () => 'world-bend-fade-hill-r8';
  material.needsUpdate = true;
}

/** Style-change-time: hillshade strength (0 outside satellite). */
export function setHillshade(strength) {
  hillUniforms.uHillStrength.value = strength;
}

/** Day-cycle-time: sun direction (world frame, FROM ground TO sun). */
export function setHillDir(x, y, z) {
  hillUniforms.uHillDir.value.x = x;
  hillUniforms.uHillDir.value.y = y;
  hillUniforms.uHillDir.value.z = z;
}

/** Dev/harness introspection. */
export function getHillshade() {
  const d = hillUniforms.uHillDir.value;
  return { strength: hillUniforms.uHillStrength.value, dir: [d.x, d.y, d.z] };
}

// Anchored GROUND bend (round 7): the plain d²k drop + rim dissolve, both
// evaluated at the INSTANCE ORIGIN — rigid instanced ground objects (town
// glow domes) translate down as a unit and melt out with the terrain.
const anchorProject = /* glsl */ `
vec4 wPos = vec4( transformed, 1.0 );
vec4 wRef = vec4( 0.0, 0.0, 0.0, 1.0 );
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
  wRef = instanceMatrix * wRef;
#endif
wPos = modelMatrix * wPos;
wRef = modelMatrix * wRef;
float bendD = distance( wRef.xz, uBendCenter );
wPos.y -= bendD * bendD * uBendK;
vAnchorDist = bendD;
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch a RIGID instanced GROUND material (additive town-glow domes):
 * anchor-evaluated bend + rim dissolve on the shared uEdgeFade band.
 * Additive material: multiplying the color toward black IS transparency.
 */
export function applyBendAnchor(material) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = 'anchor';
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    shader.uniforms.uEdgeFade = uniforms.uEdgeFade;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;\nvarying float vAnchorDist;'
      )
      .replace('#include <project_vertex>', anchorProject);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vAnchorDist;\nuniform vec2 uEdgeFade;'
      )
      .replace(
        '#include <fog_fragment>',
        '#include <fog_fragment>\n' +
          'gl_FragColor.rgb *= 1.0 - smoothstep( uEdgeFade.x, uEdgeFade.y, vAnchorDist );'
      );
  };
  material.customProgramCacheKey = () => 'world-bend-anchor-r8';
  material.needsUpdate = true;
}

/**
 * Where the ground fade band sits and the raw-sRGB color it melts into
 * (match the style's fog/void family). Called at style-change time for the
 * static styles; in TOY, round 12's altitude horizon calls it PER FRAME
 * from FlyScene's -50 block with the smoothed altitude-scaled band (pure
 * uniform writes — cheap). getEdgeFade() reads the live values back.
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
 * Round-8 depth haze — distant ground recedes toward a cool haze tone
 * across [startM, endM] BEFORE the rim fade. Pass max 0 to disable (every
 * style but toy). endM must sit UNDER the style's fade start so the rim
 * gates hold (toy: 13km < 14km at the floor; round 12's per-frame writer
 * preserves the ratio as the band extends with altitude).
 */
export function setDepthHaze(startM, endM, hex, max) {
  uniforms.uHaze.value.x = startM;
  uniforms.uHaze.value.y = endM;
  uniforms.uHazeMax.value = max;
  const n = parseInt(hex.slice(1), 16);
  uniforms.uHazeColor.value.r = ((n >> 16) & 255) / 255;
  uniforms.uHazeColor.value.g = ((n >> 8) & 255) / 255;
  uniforms.uHazeColor.value.b = (n & 255) / 255;
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
/**
 * Round 11: per-aircraft horizon visibility, 1 → fully visible, 0 → past the
 * horizon. Reads the SAME live uniforms as airDrop (uBendK is the altitude-
 * flattened k FlyScene writes; uEyeY is the player's eye), so the fade radius
 * breathes with the player's altitude exactly like the terrain does. The
 * combined horizon D = sqrt(eye/k)·playerFrac + sqrt(alt/k)·planeMul is the
 * mini-globe analogue of the real-world "sum of both horizon distances"
 * visibility rule; planeMul mirrors trafficBend.farLiftBoost so deliberately
 * lifted high traffic never fades while visible. Smoothstep band, no hard cut.
 * cfg = TRAFFIC_HORIZON (passed in — world-bend stays constants-free).
 */
export function horizonFade(d, y, cfg) {
  if (!cfg.enabled) return 1;
  const k = uniforms.uBendK.value;
  if (k <= 1e-9) return 1;
  const D =
    Math.sqrt(Math.max(0, uniforms.uEyeY.value) / k) * cfg.playerFrac +
    Math.sqrt(Math.max(0, y) / k) * cfg.planeMul;
  const a = Math.max(cfg.minVisM, D * cfg.fadeStartFrac);
  const b = Math.max(a + 1, D * cfg.fadeEndFrac);
  let t = Math.min(1, Math.max(0, (d - a) / (b - a)));
  t = t * t * (3 - 2 * t); // smoothstep
  return 1 - t;
}

export function airDrop(d, y, k = uniforms.uBendK.value) {
  const dropRaw = d * d * k;
  const agl = y - uniforms.uRefGroundY.value;
  const { x: lo, y: hi } = uniforms.uAirAgl.value;
  let t = Math.min(1, Math.max(0, (agl - lo) / (hi - lo)));
  t = t * t * (3 - 2 * t); // smoothstep
  // Round 7 altitude lift — the exact GPU formula (cap ramps to uAirCapFar)
  const lr = uniforms.uAirLiftRange.value;
  let lt = Math.min(1, Math.max(0, (d - lr.x) / (lr.y - lr.x)));
  lt = lt * lt * (3 - 2 * lt);
  const capF =
    uniforms.uAirCapFrac.value * (1 - lt) + uniforms.uAirCapFar.value * lt;
  const capped = Math.min(dropRaw, Math.max(0, y - uniforms.uEyeY.value) * capF);
  return dropRaw * (1 - t) + capped * t;
}

/**
 * Round 12 "Neon Planet": target GROUND fade END distance for the current
 * eye/bend state — the terrain twin of horizonFade's player term. Reads the
 * SAME live uniforms (uEyeY − uRefGroundY = eye AGL, uBendK = the altitude-
 * flattened k), so the band grows exactly as altFlatten flattens the globe.
 * cfg = WORLD_EDGE.altHorizon (passed in — world-bend stays constants-free);
 * floorM = the style's static fade end (the low-altitude clamp that keeps
 * verify-neon-city's certified look byte-identical); maxM = the ceiling.
 * FlyScene damps this target and writes it via setEdgeFade — consumers must
 * read the SMOOTHED band through getEdgeFade(), never call this directly.
 */
export function groundHorizonTargetM(cfg, floorM, maxM) {
  const k = uniforms.uBendK.value;
  if (k <= 1e-9) return floorM;
  const agl = Math.max(0, uniforms.uEyeY.value - uniforms.uRefGroundY.value);
  return Math.max(floorM, Math.min(maxM, Math.sqrt(agl / k) * cfg.frac));
}

/**
 * Round 12: the LIVE ground fade band — the exact values the GPU is fading
 * with this frame (smoothed by FlyScene in toy; the static style constants
 * everywhere else). THE single source of truth for every altitude-scaled
 * consumer (sky dip, ultra ring radius, VoidFloor depth/grid, TownGlow
 * range, cloud spread, harness stats): reading the rendered uniform means
 * no consumer can drift from what's on screen. Mirrors getBend().
 */
export function getEdgeFade() {
  return {
    startM: uniforms.uEdgeFade.value.x,
    endM: uniforms.uEdgeFade.value.y,
  };
}

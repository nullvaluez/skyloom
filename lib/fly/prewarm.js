'use client';

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  HalfFloatType,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  MultiplyBlending,
  NearestFilter,
  PlaneGeometry,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  SphereGeometry,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { EffectPass, EffectAttribute, Pass } from 'postprocessing';
import {
  BEACONS,
  CONTRAIL,
  FOAM,
  GLOBE,
  HILLSHADE,
  LANDMARKS_3D,
  NAV_LIGHTS,
  NIGHT_CITY_R23,
  PARCEL_HOMES,
  PREWARM,
  ROAD_PULSE,
  ROOF_CONTENT,
  RUNWAY_LIGHTS,
  SAT_BUILDINGS,
  SAT_ROADS,
  SAT_WATER,
  SUBURB_NIGHT,
  TOY,
  WATER_MOON,
  WINDOW_GRID,
} from '@/lib/fly/fly-constants';
import { PALETTE, hexToRGB } from '@/lib/fly/toy-world/toy-palette';
import {
  applyBeaconBlink,
  applyBend,
  applyBendAir,
  applyBendAirAnchor,
  applyBendAnchor,
  applyBendAnchorMonument,
  applyBendAnchorSat,
  applyBendAnchorSatSkyline,
  applyBendFade,
  applyBendRoadSat,
  applyBendWaterSat,
  applyFacadeGrid,
  applyFoamLayer,
  applyHillshade,
  applyNavLights,
  applyRoadPulse,
  applyRunwayGlow,
} from '@/lib/fly/toy-world/world-bend';
import { getFacadeAtlas } from '@/lib/fly/toy-world/sat-building-engine';
import { nightCityOn } from '@/lib/fly/night-city';
import { settleOn, sinceRevealMs } from '@/lib/fly/settle';
import { buildPassList } from '@/components/fly/Effects';

/**
 * ROUND 21 (A GOVERNOR, §3.1/3.2) — BOOT SHADER PRE-WARM.
 *
 * Before this module the repository contained ZERO
 * `renderer.compile`/`compileAsync` calls (verified by grep across the whole
 * tree). Every material variant in the game therefore compiled ON ITS FIRST
 * DRAW — which for most of them is mid-flight, at the exact moment the thing
 * they belong to appears: the first satellite building chunk, the first tree
 * stand, the first monument, the first night window, the first tier flip. A
 * GLSL compile + link is a synchronous driver stall of tens of milliseconds.
 * That is one of the two mechanisms behind the user's "everything will flash,
 * reappear, disappear" (the other being the PerformanceMonitor flap that the
 * stall then fed).
 *
 * WHAT IS WARMED. A hidden Scene — never added to the main scene, never
 * rendered — carrying one tiny mesh per material VARIANT that ships, built by
 * calling the SAME world-bend `apply*` functions on identically-configured
 * base materials. Program identity in three is decided by
 * `customProgramCacheKey()` (which the apply* functions set) AND by the
 * material/geometry/object parameters that WebGLPrograms folds into its cache
 * key — material class, vertexColors, the map set, instancing, instanceColor,
 * flatShading, side, plus the LIGHT COUNTS, fog and scene environment. The
 * last three are why `compileAsync(warmScene, camera, mainScene)` passes the
 * live scene as `targetScene`: three then gathers lights/fog/environment from
 * the real scene while only compiling the warm scene's materials, so the cache
 * keys match what the production draw will ask for.
 *
 * RETENTION IS THE POINT. three's WebGLPrograms refcounts programs and
 * releases them when the last material holding one is disposed. If the warm
 * materials were thrown away, the warmed programs would be deleted before the
 * real ones asked for them. They are therefore kept in a module cache for the
 * whole session — a few dozen tiny materials, no meshes in any scene, zero
 * draws (which is what keeps Owens ≤ 261 / satellite ≤ 375 / toy ≤ 480
 * untouched).
 *
 * The pass list is warmed for BOTH tiers of the current style through the
 * exported `buildPassList` in Effects.jsx — the same descriptor list that
 * builds the production chain — so a tier flip finds the merged EffectPass
 * program already cached and RE-LINKS instead of compiling.
 *
 * PREWARM.enabled:false ⇒ nothing in this module ever runs.
 */

// ---------------------------------------------------------------------------
// Session retention. Never disposed on purpose (see RETENTION above).
// ---------------------------------------------------------------------------
const _keep = { scene: null, materials: [], textures: [], passes: [] };

const _state = {
  started: false,
  done: false,
  warmed: 0, // material variants compiled
  passes: 0, // merged EffectPasses compiled
  ms: 0,
  error: null,
};

/** Live state object — PrewarmRig publishes it as `runtime.prewarm`, so the
 *  BootScreen gate reads the same object it mutates (no polling plumbing). */
export function prewarmState() {
  return _state;
}

// ---------------------------------------------------------------------------
// Tiny builders. Geometry content is irrelevant to a program cache key; the
// ATTRIBUTE SET is not (color → vertexColors, uv → USE_UV, instanceColor →
// USE_INSTANCING_COLOR), and the custom a* attributes are included so the warm
// draw call has every attribute its injected GLSL declares.
// ---------------------------------------------------------------------------
const SIZES = {
  normal: 3,
  uv: 2,
  color: 3,
  aFoam: 1,
  aArc: 1,
  aGlow: 1,
  aBeacon: 1,
  aFacade: 4,
  aEdge: 2,
  aAnchor: 3,
  aBendAnchor: 2,
  aRoadArc: 1,
  aRoadCls: 1,
  aEmissive: 4,
};

function tri(attrs = []) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  for (const name of attrs) {
    const n = SIZES[name] ?? 1;
    g.setAttribute(name, new BufferAttribute(new Float32Array(3 * n), n));
  }
  g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  return g;
}

function toonRamp(bytes) {
  const t = new DataTexture(new Uint8Array(bytes), bytes.length, 1, RedFormat);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.needsUpdate = true;
  _keep.textures.push(t);
  return t;
}

/** A 1×1 RGBA texture — content-free; only its PRESENCE moves a cache key. */
function pixel(wrap = false) {
  const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
  if (wrap) t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  _keep.textures.push(t);
  return t;
}

const IDENTITY = new Matrix4();

function addMesh(scene, geometry, material, opts = {}) {
  const { instanced = false, instanceColor = false, lines = false, cast = false, receive = false } =
    opts;
  let o;
  if (lines) {
    o = new LineSegments(geometry, material);
  } else if (instanced) {
    o = new InstancedMesh(geometry, material, 1);
    o.setMatrixAt(0, IDENTITY);
    if (instanceColor) o.setColorAt(0, new Color(1, 1, 1));
  } else {
    o = new Mesh(geometry, material);
  }
  o.frustumCulled = false;
  o.castShadow = cast;
  o.receiveShadow = receive;
  scene.add(o);
  _keep.materials.push(material);
  return o;
}

/**
 * Build the warm scene. Every entry mirrors a real consumer — the comment on
 * each names it, and the material options are copied verbatim from that
 * consumer (see the R21 A enumeration in the round record).
 */
function buildWarmScene() {
  const scene = new Scene();
  const toyRamp = toonRamp([110, 190, 255]);
  const satRamp = toonRamp(LANDMARKS_3D.satStyle.ramp);
  const add = (g, m, o) => addMesh(scene, g, m, o);

  // ---- 'world-bend' (applyBend) --------------------------------------
  // CloudField shadow discs: MeshBasic + alphaMap, INSTANCED, no instanceColor.
  {
    const m = new MeshBasicMaterial({
      color: '#0b1420',
      transparent: true,
      opacity: 0.5,
      alphaMap: pixel(),
      depthWrite: false,
    });
    applyBend(m);
    const g = new CircleGeometry(1, 3);
    add(g, m, { instanced: true });
  }
  // PlayerGroundShadow: same material shape, NOT instanced.
  {
    const m = new MeshBasicMaterial({
      color: new Color('#0b1420'),
      transparent: true,
      opacity: 0,
      alphaMap: pixel(),
      depthWrite: false,
    });
    applyBend(m);
    add(new CircleGeometry(1, 3), m);
  }

  // ---- 'world-bend-fade-r8' (applyBendFade) --------------------------
  // Toy tree + grass (MeshToon, instanced + instanceColor). One program.
  {
    const m = new MeshToonMaterial({ color: 0xffffff, gradientMap: toyRamp });
    applyBendFade(m);
    add(new IcosahedronGeometry(1, 0), m, { instanced: true, instanceColor: true, cast: true });
    const m2 = new MeshToonMaterial({ color: 0xffffff, gradientMap: toyRamp });
    applyBendFade(m2);
    add(new ConeGeometry(1, 2.4, 3), m2, { instanced: true, instanceColor: true });
  }
  // SatTintLayer (MeshBasic, vertexColors, multiply blend, position+color only).
  {
    const m = new MeshBasicMaterial({
      vertexColors: true,
      blending: MultiplyBlending,
      transparent: true,
      premultipliedAlpha: true,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    applyBendFade(m);
    add(tri(['color']), m);
  }

  // ---- 'world-bend-fade-foam-r13' (toy WATER) ------------------------
  {
    const m = new MeshToonMaterial({ vertexColors: true, gradientMap: toyRamp });
    applyBendFade(m);
    applyFoamLayer(m, FOAM.lenM, {
      ...WATER_MOON,
      dir: [TOY.moonDirection[0], TOY.moonDirection[2]],
    });
    add(tri(['normal', 'color', 'aFoam']), m);
  }

  // ---- 'world-bend-fade-pulse-rwy-r8' (toy LAND) ---------------------
  {
    const m = new MeshToonMaterial({ vertexColors: true, gradientMap: toyRamp });
    applyBendFade(m);
    applyRoadPulse(m, ROAD_PULSE);
    applyRunwayGlow(m, { ...RUNWAY_LIGHTS, color: hexToRGB(PALETTE.runwayLight) });
    add(tri(['normal', 'color', 'aArc', 'aGlow']), m, { receive: true });
  }

  // ---- 'world-bend-fade-beacon-grid-r13' (toy BUILDING) --------------
  {
    const m = new MeshToonMaterial({
      vertexColors: true,
      side: DoubleSide,
      gradientMap: toyRamp,
    });
    applyBendFade(m);
    applyBeaconBlink(m, BEACONS);
    applyFacadeGrid(m, {
      ...WINDOW_GRID,
      ...(ROOF_CONTENT.enabled
        ? ROOF_CONTENT
        : { ...ROOF_CONTENT, roofGridBoost: 0, roofFloor: 0 }),
      colorA: hexToRGB(PALETTE.windowWarm),
      colorB: hexToRGB(PALETTE.windowCool),
      edgeColor: hexToRGB(PALETTE.windowEdge),
    });
    add(tri(['normal', 'color', 'aBeacon', 'aFacade', 'aEdge']), m, {
      cast: true,
      receive: true,
    });
  }

  // ---- 'world-bend-fade-hill-r19' (the TILE material, both styles) ---
  // three-tile's TileMaterial is `MeshStandardMaterial` constructed with
  // { transparent:false, side:FrontSide } and a `.map` assigned post-clone.
  {
    const m = new MeshStandardMaterial({ transparent: false, side: FrontSide });
    m.map = pixel();
    applyBendFade(m);
    applyHillshade(m, HILLSHADE);
    add(tri(['normal', 'uv']), m);
  }

  // ---- 'world-bend-anchor-r8' (applyBendAnchor) ----------------------
  // (a) SatVegLayer canopy + SatAmbientLife boats: Lambert, instanceColor.
  {
    const m = new MeshLambertMaterial({ vertexColors: false });
    applyBendAnchor(m);
    add(new SphereGeometry(1, 3, 2), m, { instanced: true, instanceColor: true });
  }
  // (b) SatParcelHomes: Lambert + vertexColors + emissiveMap (needs uv).
  {
    const m = new MeshLambertMaterial({
      vertexColors: true,
      emissive: new Color(PARCEL_HOMES.night.color),
      emissiveIntensity: 0,
      emissiveMap: pixel(),
    });
    applyBendAnchor(m);
    add(tri(['normal', 'color', 'uv']), m, { instanced: true, instanceColor: true });
  }
  // (c) SatRoadLayer beacons + SatHouseLights: additive Basic, NO instanceColor.
  {
    const m = new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendAnchor(m);
    add(new SphereGeometry(1, 3, 2), m, { instanced: true });
  }
  // (d) SatCityGlow + TownGlow domes/cores: additive Basic WITH instanceColor.
  {
    const m = new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendAnchor(m);
    add(new SphereGeometry(1, 3, 2), m, { instanced: true, instanceColor: true });
  }
  // (e) SatAmbientLife plumes: NORMAL blend + map + instanceColor.
  {
    const m = new MeshBasicMaterial({
      color: '#ffffff',
      map: pixel(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      depthTest: true,
    });
    applyBendAnchor(m);
    add(new PlaneGeometry(1, 1), m, { instanced: true, instanceColor: true });
  }
  // (f) LandmarkMonuments archetype bodies (both styles → one program).
  {
    const m = new MeshToonMaterial({
      color: LANDMARKS_3D.satStyle.color,
      gradientMap: satRamp,
      vertexColors: true,
    });
    applyBendAnchor(m);
    add(tri(['normal', 'color']), m, { instanced: true });
  }
  // (g) LandmarkMonuments halo — TOY variant carries an alphaMap, the
  //     SATELLITE variant passes alphaMap:null (which is program (c)).
  {
    const m = new MeshBasicMaterial({
      color: PALETTE.monumentHalo,
      transparent: true,
      opacity: 0.5,
      alphaMap: pixel(),
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendAnchor(m);
    add(new CircleGeometry(1, 3), m, { instanced: true });
  }

  // ---- 'world-bend-anchor-monument-r20' (the marquee mesh) -----------
  {
    const m = new MeshToonMaterial({
      vertexColors: true,
      gradientMap: satRamp,
      side: DoubleSide,
    });
    applyBendAnchorMonument(m);
    add(tri(['normal', 'color', 'aAnchor']), m);
  }

  // ---- 'world-bend-anchor-satbldg-r19' × 3 ---------------------------
  // bare / +facade map (medium) / +facade map + night emissiveMap (high).
  // Round 23 (B): the warm set follows the ARM automatically — these are the
  // same apply calls the engine makes, so an armed session warms the '-r23'
  // programs and a disarmed one warms '-r19'. That is the warm-set membership
  // proof for the two new keys: there is only one construction path.
  {
    const geoAttrs = ['normal', 'color', 'uv', 'aBendAnchor'];
    const win = nightCityOn('windows') ? NIGHT_CITY_R23.windows : null;
    const bare = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    applyBendAnchorSat(bare, win);
    add(tri(geoAttrs), bare);

    const day = PREWARM.warmAtlases ? getFacadeAtlas(false) : null;
    const night = PREWARM.warmAtlases ? getFacadeAtlas(true) : null;

    const mapped = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    mapped.map = day ?? pixel(true);
    applyBendAnchorSat(mapped, win);
    add(tri(geoAttrs), mapped);

    const lit = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    lit.map = day ?? pixel(true);
    lit.emissive = new Color(SAT_BUILDINGS.night.color);
    lit.emissiveIntensity = 0;
    lit.emissiveMap = night ?? pixel(true);
    applyBendAnchorSat(lit, win);
    add(tri(geoAttrs), lit);
  }

  // ---- 'world-bend-anchor-satskyline-r19' (NO uv on this geometry) ---
  {
    const m = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    applyBendAnchorSatSkyline(m);
    add(tri(['normal', 'color', 'aBendAnchor']), m);
  }

  // ---- 'world-bend-water-satglint-r13' -------------------------------
  {
    const m = new MeshPhongMaterial({
      color: 0x000000,
      specular: new Color(SAT_WATER.specular),
      shininess: SAT_WATER.shininess,
      normalMap: pixel(true),
      normalScale: new Vector2(SAT_WATER.normalScale, SAT_WATER.normalScale),
      transparent: true,
      opacity: SAT_WATER.opacity,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendWaterSat(m);
    add(tri(['normal', 'uv']), m);
  }

  // ---- 'world-bend-road-satnight-r19' --------------------------------
  // Round 23 (B): same rule — armed, this warms '-r23' (with aRoadSide on the
  // stand-in geometry so the warm draw binds the same attribute set the engine
  // will); disarmed it warms '-r19' with the R19 attribute list exactly.
  {
    const m = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const r23 = nightCityOn('roads') ? NIGHT_CITY_R23.roads : null;
    applyBendRoadSat(m, SAT_ROADS, SUBURB_NIGHT, r23);
    add(tri(r23 ? ['color', 'aRoadArc', 'aRoadCls', 'aRoadSide'] : ['color', 'aRoadArc', 'aRoadCls']), m);
  }

  // ---- 'world-bend-air' × 3 ------------------------------------------
  {
    const contrail = new MeshBasicMaterial({
      color: new Color(CONTRAIL.color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    });
    applyBendAir(contrail, GLOBE.trafficBend);
    add(tri([]), contrail);

    const ribbon = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    });
    applyBendAir(ribbon, GLOBE.trafficBend);
    add(tri(['color']), ribbon);

    const streak = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    applyBendAir(streak, GLOBE.trafficBend);
    add(tri(['color']), streak, { lines: true });
  }

  // ---- 'world-bend-air-anchor' (traffic billboards) ------------------
  {
    const m = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      map: pixel(),
    });
    applyBendAirAnchor(m, GLOBE.trafficBend);
    add(new PlaneGeometry(1, 1), m, { instanced: true, instanceColor: true });
  }

  // ---- 'world-bend-air-anchor-nav' (traffic models) ------------------
  // TWO permutations: primitives mount with vertexColors:false, and every
  // archetype whose GLB resolves flips vertexColors:true post-swap.
  for (const painted of [false, true]) {
    const m = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.35,
      metalness: 0.5,
      flatShading: true,
      vertexColors: painted,
    });
    applyBendAirAnchor(m, GLOBE.trafficBend);
    applyNavLights(m, NAV_LIGHTS);
    add(tri(painted ? ['normal', 'color', 'uv', 'aEmissive'] : ['normal', 'uv', 'aEmissive']), m, {
      instanced: true,
      instanceColor: true,
    });
  }

  return scene;
}

// ---------------------------------------------------------------------------
// ROUND 22 (B SETTLE) — the variants R21 left cold.
//
// Every entry here first draws AFTER the boot reveal, which is precisely the
// definition of a compile the player pays for. The R21 set was built from the
// world-bend registry, so it covers everything that rides a `world-bend-*`
// cache key and nothing that does not: the troika letter material, drei's
// cloud material, the warp burst and the crash flash all sit outside it.
// ---------------------------------------------------------------------------

/**
 * drei's <Clouds> mints its material class INSIDE the component
 * (core/Cloud.js: `class extends material { constructor(){ ...
 * this.onBeforeCompile = ... } }`), so nothing is exported to import. But it
 * also sets NO customProgramCacheKey — which means three keys the program on
 * `material.onBeforeCompile.toString()`, and the closure's SOURCE TEXT is
 * therefore the identity. Reproducing that text verbatim reproduces the key.
 *
 * If drei changes the text in a future upgrade this warm silently stops
 * seeding and starts minting one extra program: a missed optimisation, never a
 * broken frame. (Copied from @react-three/drei core/Cloud.js at the version in
 * package-lock; `opaque_fragment` is the r154+ branch, and this repo is r185.)
 */
function dreiCloudOnBeforeCompile() {
  return (shader) => {
    shader.vertexShader =
      `attribute float cloudOpacity;
               varying float vOpacity;
              ` +
      shader.vertexShader.replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
                 vOpacity = cloudOpacity;
                `
      );
    shader.fragmentShader =
      `varying float vOpacity;
              ` +
      shader.fragmentShader.replace(
        `#include <opaque_fragment>`,
        `#include <opaque_fragment>
                 gl_FragColor = vec4(outgoingLight, diffuseColor.a * vOpacity);
                `
      );
  };
}

function buildExtraScene() {
  const scene = new Scene();
  const add = (g, m, o) => addMesh(scene, g, m, o);

  // ---- drei <Clouds> ×2 ----------------------------------------------------
  // CloudField picks the material CLASS by style (`style.lit ? Lambert :
  // Basic`), passes a real `texture` (⇒ USE_MAP) and drei instances the puffs
  // with a `cloudOpacity` instanced attribute plus per-instance colours. Both
  // classes are warmed: a style flip must not compile a cloud deck.
  for (const Klass of [MeshLambertMaterial, MeshBasicMaterial]) {
    const m = new Klass();
    m.map = pixel();
    m.transparent = true;
    m.depthWrite = false;
    m.onBeforeCompile = dreiCloudOnBeforeCompile();
    const g = new PlaneGeometry(1, 1);
    g.setAttribute('cloudOpacity', new InstancedBufferAttribute(new Float32Array(1), 1));
    add(g, m, { instanced: true, instanceColor: true });
  }

  // ---- WarpBurst / CrashFlash / SpeedLines: PLAIN additive basics -----------
  // Unpatched MeshBasicMaterial has no custom key at all, so its program is
  // decided by the parameter set. Two permutations ship: mapped (the burst
  // sprite) and bare vertex-coloured (the speed-line wedges).
  {
    const m = new MeshBasicMaterial({
      color: 0xffffff,
      map: pixel(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      fog: false,
    });
    add(new PlaneGeometry(1, 1), m);
    const m2 = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      fog: false,
    });
    add(tri(['color']), m2);
  }

  // ---- PlayerPlane hull rim ------------------------------------------------
  // PlayerPlane patches the CLONED GLB materials and stamps the key
  // 'player-hull-rim'. The key is what three hashes, so a stand-in material
  // carrying the same key + the same injected GLSL seeds the same program for
  // the common (map + normalMap) GLB material shape. A hangar swap mid-session
  // is what this buys; the boot hull compiles behind the overlay anyway.
  {
    const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 });
    m.map = pixel();
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vRimNormal;\nvarying vec3 vRimView;'
        )
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvRimNormal = normalize( transformedNormal );\nvRimView = normalize( -mvPosition.xyz );'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vRimNormal;\nvarying vec3 vRimView;\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;'
        )
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\nfloat rimF = pow( 1.0 - clamp( dot( normalize( vRimNormal ), normalize( vRimView ) ), 0.0, 1.0 ), uRimPower );\ntotalEmissiveRadiance += uRimColor * rimF * uRimStrength;'
        );
    };
    m.customProgramCacheKey = () => 'player-hull-rim';
    add(tri(['normal', 'uv']), m);
  }

  return scene;
}

/**
 * The troika POI-letter material. PoiLetters is drei's <Text>, i.e.
 * troika-three-text, whose material is DERIVED at first sync() — so it cannot
 * be reproduced by hand and it does not exist until a Text has laid out. The
 * warm therefore builds a real (never-added) Text, waits for its sync, and
 * compiles the mesh it produced.
 *
 * troika-three-text is a transitive dependency (drei's), so the import is
 * dynamic and guarded: an unresolvable module is a missed warm, not a boot
 * failure. Measured in R22: PoiLetters first draws ~2 s after reveal, so this
 * compile lands in front of the player every single satellite boot today.
 */
async function warmTroikaLetters(gl, camera, scene) {
  const mod = await import('troika-three-text');
  const Text = mod?.Text;
  if (!Text) return;
  const t = new Text();
  t.text = 'AB';
  t.fontSize = 1;
  t.anchorX = 'center';
  t.anchorY = 'middle';
  t.outlineWidth = 0.06; // PoiLetters draws an outline — a second derived pass
  t.frustumCulled = false;
  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      t.sync(done);
    } catch {
      done();
    }
    setTimeout(done, 3000); // the SDF worker is not allowed to hold the warm
  });
  const holder = new Scene();
  holder.add(t);
  await compileUnder(gl, dummyRT(), () => gl.compileAsync(holder, camera, scene ?? holder));
  // RETENTION: keeping the Text keeps its derived material — and therefore its
  // program — refcounted for the session (the R21 rule this whole module is
  // built on). It is in no rendered scene, so it costs zero draws.
  _keep.troika = t;
}

/**
 * SHADOW DEPTH MATERIALS. `compileAsync` compiles a material's COLOUR program
 * only; three mints a separate MeshDepthMaterial program per casting material
 * on the first shadow pass, and caches those in WebGLShadowMap for the
 * renderer's life. Driving one real shadow pass over the warm scene (which
 * already carries castShadow meshes) is the only way to reach them, and the
 * cache it fills is exactly the one production will hit.
 */
async function warmShadowDepth(gl, camera, warmScene) {
  const sm = gl.shadowMap;
  if (!sm || typeof sm.render !== 'function') return;
  const wasEnabled = sm.enabled;
  const light = new DirectionalLight(0xffffff, 1);
  light.castShadow = true;
  light.shadow.mapSize.set(64, 64); // a warm needs the PROGRAM, not the pixels
  light.position.set(10, 20, 10);
  warmScene.add(light);
  const prevTarget = gl.getRenderTarget();
  try {
    sm.enabled = true;
    warmScene.updateMatrixWorld(true);
    light.shadow.updateMatrices?.(light);
    sm.render([light], warmScene, camera);
  } catch {
    // a driver/renderer that refuses the pass = a missed warm
  } finally {
    gl.setRenderTarget(prevTarget);
    sm.enabled = wasEnabled;
    warmScene.remove(light);
    light.shadow.map?.dispose();
    light.dispose?.();
  }
}

/**
 * SMAA looks its edge/area tables up from two base64 data URLs decoded on an
 * HTMLImageElement — an async decode + texture upload that lands on the first
 * frame an SMAA pass actually renders. `buildWarmPasses` already constructs
 * the effect (which starts the decode); this waits for it and uploads, so the
 * first real SMAA frame finds both textures resident.
 */
async function warmSmaaLuts(gl, camera, style, tier) {
  const specs = buildPassList(style, tier, { speedMount: true });
  for (const s of specs) {
    let e = null;
    try {
      e = s.raw({ camera });
    } catch {
      continue;
    }
    for (const key of ['searchTexture', 'areaTexture']) {
      const tex = e?.[key];
      const img = tex?.image;
      if (!img) continue;
      try {
        if (typeof img.decode === 'function' && !img.complete) await img.decode();
        tex.needsUpdate = true;
        gl.initTexture(tex);
        _keep.textures.push(tex);
      } catch {
        // a LUT we cannot pre-decode — the effect still builds it lazily
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Post-chain warm. Uses Effects.jsx's own buildPassList so the merged fragment
// shader text is generated from the same option values production uses.
// ---------------------------------------------------------------------------
const isConvolution = (e) =>
  (e.getAttributes() & EffectAttribute.CONVOLUTION) === EffectAttribute.CONVOLUTION;

/**
 * Compile with the SAME render-target binding production will have.
 *
 * MEASURED, and the single thing that decided whether this module was worth
 * anything: three folds `parameters.outputColorSpace` into the program cache
 * key, and that value is `renderer.outputColorSpace` ('srgb') when drawing to
 * the canvas but `ColorManagement.workingColorSpace` ('srgb-linear') whenever
 * ANY render target is bound. Everything in this game is drawn by the
 * EffectComposer into its input buffer, so production compiles under
 * 'srgb-linear'. A warm with no target bound produced keys identical in all 54
 * other fields and different in that one — 34 of 35 warm variants minted a
 * SECOND program instead of seeding the one production would ask for. Binding
 * a 1×1 target for the duration of the (synchronous) compile fixes it.
 *
 * compileAsync() runs its whole compile() pass synchronously and only then
 * returns a polling promise, so restoring the previous target before the await
 * is both safe and necessary — the frame loop must not find a stray binding.
 */
let _dummyRT = null;
function compileUnder(gl, target, fn) {
  const prev = gl.getRenderTarget();
  if (target !== undefined) gl.setRenderTarget(target);
  let out;
  try {
    out = fn();
  } finally {
    gl.setRenderTarget(prev);
  }
  return out;
}

function dummyRT() {
  if (!_dummyRT) _dummyRT = new WebGLRenderTarget(1, 1);
  return _dummyRT;
}

/**
 * Collect the INTERNAL passes an effect owns (BloomEffect's luminance +
 * mipmap-blur passes, DepthOfFieldEffect's CoC/blur/mask passes, SMAA's edge
 * and weights passes). They are separate fullscreen materials with separate
 * programs, and they are compiled lazily by the effect's own update() — which
 * a warm never calls, because calling it would need real input buffers and,
 * for the DEPTH effects, a real depth texture. Compiling their scenes directly
 * gets the programs without any of that.
 *
 * Without this, dropping to the tier where bloom is absent released bloom's
 * three internal programs and returning recompiled them — the last 3 of the
 * ladder's program churn.
 */
function collectSubPasses(effect, out = [], depth = 0) {
  if (!effect || depth > 2) return out;
  for (const key of Object.keys(effect)) {
    const v = effect[key];
    if (v instanceof Pass && !out.includes(v)) {
      out.push(v);
      collectSubPasses(v, out, depth + 1);
    }
  }
  return out;
}

function buildWarmPasses(camera, style, tier) {
  const specs = buildPassList(style, tier, { speedMount: true });
  const effects = [];
  for (const s of specs) {
    try {
      const e = s.raw({ camera });
      if (e) effects.push(e);
    } catch {
      // A descriptor we cannot construct headlessly is a MISSED warm, never a
      // broken boot.
    }
  }
  const passes = [];
  for (let i = 0; i < effects.length; i++) {
    const group = [effects[i]];
    if (!isConvolution(effects[i])) {
      let next = null;
      while ((next = effects[i + 1]) && !isConvolution(next)) {
        group.push(next);
        i++;
      }
    }
    passes.push(new EffectPass(camera, ...group));
  }
  return passes;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ROUND 22 (B SETTLE) — THE COMPILE QUEUE AND THE IDLE SLICE.
//
// R21's warm was one straight-line await chain, and BootScreen stopped WAITING
// for it at PREWARM.maxMs — but the chain kept running, and every
// `compileAsync` performs its compile SYNCHRONOUSLY before handing back a
// polling promise. So on any machine where the warm outran the cap (a cold
// HDRI is up to 4 s of `envWaitMs` before the first compile even starts), the
// remainder of the compile train landed in the first seconds of flight, one
// driver stall per await, in front of the player. That is the user's "brief
// stutter a few seconds after boot".
//
// The warm is now a QUEUE. Pre-reveal it drains as fast as it can, which is
// free — the overlay is up and there is nothing to stutter. The moment the
// reveal happens (or the boot budget expires) the drain STOPS and whatever is
// left is handed to `prewarmSliceStep`, which PrewarmRig calls at most
// SETTLE_CALM.prewarmSlice.perIdleRaf times per frame and only on frames that
// are already comfortable. A compile still costs what it costs; it just costs
// it one frame at a time, in a frame that had room.
// ---------------------------------------------------------------------------

const _pending = [];
const _slice = {
  queued: 0,
  compiledPreReveal: 0,
  compiledPostReveal: 0,
  sliceMs: 0, // worst single post-reveal unit
  running: false,
};

function enqueue(name, fn) {
  _pending.push({ name, fn });
  _slice.queued += 1;
}

function publishPrewarmStats() {
  if (typeof window === 'undefined') return;
  (window.__flyStats ??= {}).prewarm = {
    warmed: _state.warmed,
    passes: _state.passes,
    ms: _state.ms,
    error: _state.error,
    // R22 B — the slice instrument (plan §6.1).
    queued: _slice.queued,
    compiledPreReveal: _slice.compiledPreReveal,
    compiledPostReveal: _slice.compiledPostReveal,
    pending: _pending.length,
    sliceMs: _slice.sliceMs,
  };
}

async function runUnit(u) {
  const t = performance.now();
  try {
    await u.fn();
  } catch (err) {
    if (!_state.error) _state.error = `${u.name}: ${String(err?.message ?? err)}`;
  }
  const ms = performance.now() - t;
  if (sinceRevealMs() < 0) {
    _slice.compiledPreReveal += 1;
  } else {
    _slice.compiledPostReveal += 1;
    if (ms > _slice.sliceMs) _slice.sliceMs = Math.round(ms);
  }
}

/**
 * Drain the queue one unit at a time until the boot budget is spent or the
 * world has been revealed. `budgetMs === Infinity` reproduces R21 exactly (the
 * whole chain, straight through) and is what a flag-off session takes.
 */
async function drain(t0, budgetMs) {
  while (_pending.length) {
    if (budgetMs !== Infinity && (performance.now() - t0 >= budgetMs || sinceRevealMs() >= 0)) {
      return;
    }
    await runUnit(_pending.shift());
  }
}

/**
 * ONE slice. Called from PrewarmRig's frame loop. Re-entrancy is guarded (a
 * unit is async and spans frames), and the caller decides whether the frame
 * has room — this only decides how many units a permitted call may take.
 */
export async function prewarmSliceStep(max = 1) {
  if (_slice.running || !_pending.length) return _pending.length;
  _slice.running = true;
  try {
    for (let i = 0; i < max && _pending.length; i++) {
      await runUnit(_pending.shift());
    }
  } finally {
    _slice.running = false;
    publishPrewarmStats();
  }
  return _pending.length;
}

/** How much warm is still owed (0 = the session is fully compiled). */
export function prewarmPending() {
  return _pending.length;
}

/**
 * THE ENVIRONMENT RE-KEY — measured, and the single biggest thing R21's warm
 * still missed.
 *
 * R21 waits for `scene.environment` before compiling, because three folds
 * envMapMode (306 = CubeUVReflectionMapping) and envMapCubeUVHeight into the
 * program cache key of every lit material. That wait is CAPPED at
 * PREWARM.envWaitMs (4 s) so a dead HDRI cannot skip the warm — and on a cold
 * or slow HDRI the cap is exactly what fires. The warm then runs with NO
 * environment, mints the `...,false,...` permutation of every lit material,
 * and when the HDRI finally resolves the whole set compiles again under
 * `...,306,2048,...`.
 *
 * Measured at Powell OH with the HDRI held back 9 s (E CERT's recipe), the
 * post-reveal program census was +13 in EVERY run of both arms, and the 13
 * cache keys are: three PMREM/background programs (the equirect→CubeUV bake
 * itself) plus ten `physical`/`lambert`/`phong` variants differing from the
 * warmed ones in precisely those two fields.
 *
 * So the warm re-runs — ONCE — when the environment finally arrives. Every
 * program already resident LINKS instead of compiling (that is what the
 * module's retention is for), only the env-keyed permutations are new, and
 * because it goes through the QUEUE it lands one compile per healthy frame
 * instead of thirteen in a train.
 */
let _envRequeued = false;

/**
 * Compile a SLICE of a warm scene's children. A whole-scene re-key measured
 * 127 ms in one unit — which is one 127 ms frame, i.e. the very stall the
 * queue exists to avoid, just moved. Objects are re-parented into a scratch
 * Scene (an Object3D has one parent, so this is add-compile-restore), and the
 * restore runs in a `finally` so a failed compile can never lose a warm mesh.
 */
function compileSlice(gl, camera, targetScene, owner, from, count) {
  const kids = owner.children.slice(from, from + count);
  if (!kids.length) return Promise.resolve();
  const holder = new Scene();
  for (const k of kids) holder.add(k);
  return compileUnder(gl, dummyRT(), () =>
    gl.compileAsync(holder, camera, targetScene ?? holder)
  ).finally(() => {
    for (const k of kids) owner.add(k);
  });
}

const ENV_SLICE = 4; // meshes per queue unit — measured ~15 ms each

export function requeueForEnvironment({ gl, camera, scene }) {
  if (_envRequeued || !settleOn() || !_keep.scene) return false;
  _envRequeued = true;
  for (const owner of [_keep.scene, _keep.extraScene]) {
    if (!owner) continue;
    const n = owner.children.length;
    for (let i = 0; i < n; i += ENV_SLICE) {
      const from = i;
      enqueue(`env-rekey-${from}`, () => compileSlice(gl, camera, scene, owner, from, ENV_SLICE));
    }
  }
  publishPrewarmStats();
  return true;
}

/**
 * Warm every shipped material variant + both tier compositions of the post
 * chain. Resolves when the driver reports the programs ready (compileAsync
 * uses KHR_parallel_shader_compile where available). Never throws: a failed
 * warm is a missed optimisation, never a failed boot.
 */
export async function runPrewarm({ gl, camera, scene, style, tier }) {
  if (!PREWARM.enabled || _state.started) return _state;
  _state.started = true;
  const t0 = performance.now();
  // R22: every addition below — the extra variants, the shadow-depth pass, the
  // LUT decode, the alt style AND the slicing itself — is gated on the SETTLE
  // flag, so `SETTLE_CALM.enabled:false` or the fleet pin `__flySettlePin`
  // leaves this module executing the R21 warm, in the R21 order, with no
  // budget. That is what makes the flag-off tree byte-identical here.
  const r22 = settleOn();
  try {
    // (1) atlases first — the sat-building map/emissiveMap permutations below
    //     need the REAL textures for their cache keys to match production.
    //     getFacadeAtlas memoises at module scope and is deliberately never
    //     disposed, so this is also the atlas build that today happens lazily
    //     mid-flight the first time the facade/night tier arms.
    if (PREWARM.warmAtlases) {
      try {
        gl.initTexture(getFacadeAtlas(false));
        gl.initTexture(getFacadeAtlas(true));
      } catch {
        // atlas build/upload failed — the variants below fall back to a pixel
      }
    }

    // (2) the material warm set.
    const warmScene = buildWarmScene();
    _keep.scene = warmScene;
    // targetScene = the LIVE scene: lights, fog and environment come from the
    // scene the production draw will actually happen in, which is what makes
    // the compiled program's cache key match. The 1×1 binding supplies the
    // other half of that match (see compileUnder).
    await compileUnder(gl, dummyRT(), () =>
      gl.compileAsync(warmScene, camera, scene ?? warmScene)
    );
    _state.warmed = _keep.materials.length;

    // (2b) R22 — the variants R21 left cold. Queued, not awaited: the material
    // set above is the one thing that must be resident before the FIRST frame
    // the player sees (it is the world); these first draw later, so they are
    // exactly the right things to slice.
    if (r22 && PREWARM.warmExtra) {
      enqueue('extra-materials', async () => {
        const extra = buildExtraScene();
        _keep.extraScene = extra;
        await compileUnder(gl, dummyRT(), () =>
          gl.compileAsync(extra, camera, scene ?? extra)
        );
        _state.warmed = _keep.materials.length;
      });
      enqueue('troika-letters', () => warmTroikaLetters(gl, camera, scene));
      enqueue('shadow-depth', () => warmShadowDepth(gl, camera, warmScene));
    }
    if (r22 && PREWARM.warmSmaaLuts) {
      enqueue('smaa-luts', () => warmSmaaLuts(gl, camera, style, tier));
    }

    // (3) every tier composition of the post chain, for the CURRENT style.
    if (PREWARM.warmEffectsAltTier) {
      const alpha = !!gl.getContext().getContextAttributes()?.alpha;
      const size = gl.getDrawingBufferSize(new Vector2());
      // ALL THREE tiers, not just the alternate one. Measured: warming only
      // high+medium left the ladder's bottom rung 3 programs short, and
      // because a retained warm pass is what keeps a program refcounted,
      // those three were genuinely deleted on the way down to 'low' and
      // genuinely recompiled on the way back up. With all three warmed, a
      // full down-and-up ladder cycle returns gl.info.programs.length to
      // exactly its starting value with no compile anywhere in between.
      const tiers = ['high', 'medium', 'low'];
      // R22: the OTHER style's chains, off by default (PREWARM.warmAltStyle).
      // A style flip is rare and already expensive; warming both doubles the
      // boot compile train on the machines least able to afford it.
      const styles =
        r22 && PREWARM.warmAltStyle
          ? [style, style === 'toy' ? 'satellite' : 'toy']
          : [style];
      const seen = new Set();
      for (const st of styles) {
        for (const t of tiers) {
          const seenKey = `${st}/${t}`;
          if (seen.has(seenKey)) continue;
          seen.add(seenKey);
          enqueue(`passes-${seenKey}`, () => warmPassGroup(gl, camera, st, t, alpha, size));
        }
      }
    }
    // (4) DRAIN. Pre-reveal this is a straight run and free (the overlay is
    // up). Flag-off it is the R21 straight-line chain with no budget at all.
    await drain(t0, r22 ? PREWARM.maxMs : Infinity);
  } catch (err) {
    _state.error = String(err?.message ?? err);
  }
  _state.ms = Math.round(performance.now() - t0);
  _state.done = true;
  publishPrewarmStats();
  return _state;
}

/** One (style, tier) composition of the post chain — a single queue unit. */
async function warmPassGroup(gl, camera, style, tier, alpha, size) {
  const passes = buildWarmPasses(camera, style, tier);
  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i];
    // The composer's autoRenderToScreen flips the LAST pass to
    // renderToScreen, which both changes EffectMaterial.encodeOutput
    // (a define) and drops the render-target binding ('srgb' instead of
    // 'srgb-linear'). Mirror both or the tail of the chain warms into a
    // program nothing will ever ask for.
    const last = i === passes.length - 1;
    try {
      pass.initialize(gl, alpha, HalfFloatType);
      pass.setSize(size.width || 1, size.height || 1);
      pass.renderToScreen = last;
            // MEASURED: the composer hands every pass a depth texture the
            // moment ANY effect declares EffectAttribute.DEPTH — the aerial
            // perspective in satellite-high, the tilt-shift DOF in toy-high —
            // and setDepthTexture writes DEPTH_PACKING (3200) into the merged
            // material's DEFINES. It stays written for the rest of the
            // session, including after the tier drops and the depth texture is
            // deleted. Warming without it produced DEPTH_PACKING 0: a merged
            // program identical in every other respect that nothing would ever
            // ask for. Passing null keeps the uniform empty and the define
            // right, which is all a warm needs.
      pass.setDepthTexture(null);
      // pass.scene holds the fullscreen triangle carrying the merged
      // EffectMaterial; compiling THAT needs no render target and no
      // depth texture, unlike an actual pass.render().
      await compileUnder(gl, last ? null : dummyRT(), () =>
        gl.compileAsync(pass.scene, pass.camera)
      );
      for (const effect of pass.effects ?? []) {
        for (const sub of collectSubPasses(effect)) {
          if (!sub.scene || !sub.camera || !sub.fullscreenMaterial) continue;
          try {
            await compileUnder(gl, dummyRT(), () => gl.compileAsync(sub.scene, sub.camera));
          } catch {
            // an internal pass we cannot warm — skip it
          }
        }
      }
      _keep.passes.push(pass); // retained: the program stays refcounted
      _state.passes++;
    } catch {
      // one composition failed to warm — keep going
    }
  }
}

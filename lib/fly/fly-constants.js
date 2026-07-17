/**
 * Every Fly-mode tunable in one place. Units are SI (meters, seconds,
 * radians unless a name says otherwise). Lambdas are exponential-smoothing
 * rates used as: x += (target - x) * (1 - Math.exp(-lambda * dt)).
 */

// ---------------------------------------------------------------------------
// Rendering / canvas
// ---------------------------------------------------------------------------

export const CANVAS = {
  fov: 62, // base FOV in degrees; widens with speed (see CAMERA.fovBoost)
  near: 2.5,
  far: 600000, // 600 km — requires reversed depth buffer (three r184+)
  dprMax: 1.5, // DPR cap is the single biggest iGPU lever
  dprMin: 1,
  dprStep: 0.25,
};

// Performance budgets for Fly-mode quality targets (see PerformanceMonitor DPR)
export const PERF_BUDGET = {
  drawCalls: 300,
  triangles: 1_500_000,
  textureBytes: 300 * 1024 * 1024,
  gpuFrameMs: 12,
};

// ---------------------------------------------------------------------------
// Flight model (arcade kinematic)
// ---------------------------------------------------------------------------

export const FLIGHT = {
  // Max commanded rates (deg/s — converted at use site)
  maxPitchRateDeg: 45,
  maxRollRateDeg: 110,
  maxYawRateDeg: 20,
  rateLambda: 5, // input → rate easing
  bankLambda: 3, // auto-bank blend
  maxBankDeg: 70,

  // Speed presets (m/s): slow ~117kt sightseeing, cruise, boost (intercept)
  speeds: { slow: 60, cruise: 180, boost: 750 },
  accel: 40, // m/s^2 toward preset
  highSpeedTurnCutover: 400, // m/s — above this, turn rates halve

  // Vertical envelope
  floorClearance: 50, // never below terrain + this
  floorSoftZone: 150, // descent rate scales to 0 across this band above floor
  ceiling: 15000,
  ceilingSoftZone: 1000, // thrust fades above ceiling - softZone

  // Assists
  autoLevelIdleSec: 1.5,
  autoLevelMaxBankDeg: 30, // never auto-level past intentional banks
  autoLevelRateDeg: 25, // deg/s roll toward level

  // Input shaping
  mouseDeadzone: 0.025, // fraction of screen radius
  mouseExpo: 1.8,
};

// ---------------------------------------------------------------------------
// Chase camera
// ---------------------------------------------------------------------------

export const CAMERA = {
  offset: { x: 0, y: 8, z: 30 }, // behind + above, plane-local
  boostOffsetScale: 1.18, // lengthen follow distance at boost
  posLambda: 4,
  lookLambda: 9,
  lookAheadM: 50,
  bankShare: 0.42, // camera takes this fraction of plane bank
  fovBoost: 16, // fov = base + boost * (speed/boostMax)^1.5
  fovLambda: 2,
  freeLookLambda: 10,
  freeLookSnapbackSec: 0.7,
  shakeSpeedFraction: 0.8, // shake only above this fraction of boost
  shakeMaxDeg: 0.2,
};

// ---------------------------------------------------------------------------
// World / coordinates
// ---------------------------------------------------------------------------

export const WORLD = {
  rebaseDistance: 10000, // floating-origin rebase threshold (m)
  trafficDisplayScale: 1.75, // models drawn oversized; positions exact
};

// ---------------------------------------------------------------------------
// Live traffic (polling + dead reckoning)
// ---------------------------------------------------------------------------

export const TRAFFIC = {
  // 3s keeps dead-reckoning smooth while cutting upstream pressure vs 2s
  // (community aggregators 420/429 under sustained 2s load).
  pollIntervalMs: 3000,
  // 100nm ≈ 185km — 7× the model LOD radius. 200nm payloads around NYC
  // (~1000 aircraft) proved heavy enough to trip adsb.lol timeouts/limits.
  pollDistNm: 100,
  queryKeyRoundDeg: 0.05, // player pos rounding for React Query key

  // Dead-reckoning correction blending
  blendMaxErrorM: 400, // beyond this, snap instead of blend
  blendDurationSec: 1,
  altBlendDurationSec: 2,
  arcTrackThresholdDeg: 2, // Δtrack above this → arc extrapolation
  snapOpacityDipMs: 300,

  // Stale ladder (seconds since last position fix)
  staleDimSec: 15,
  staleFreezeSec: 30,
  staleRemoveSec: 60,
  // Skew samples further than this from the estimate = the multi-source
  // proxy rotated to an upstream with a different clock → re-baseline
  // (shift stored timestamps) instead of letting every track age 60s in
  // one frame and mass-delete the sky.
  clockJumpSec: 10,

  // LOD
  modelLodDistanceM: 25000, // full 3D model inside; billboard beyond
  maxLabels: 15,
  pickPoolSize: 64, // hover/inspect hit-tests cover this many nearest (labels stay 15)

  // Rendering (instanced meshes)
  maxPerArchetype: 224, // instance pool per archetype InstancedMesh
  maxBillboards: 512, // shared far-LOD billboard pool
  billboardSizeM: 90, // far-LOD sprite edge, world meters (pre display scale)
  fakeBankMaxDeg: 30, // bank inferred from turn rate, clamped
  yawLambda: 4, // render-yaw slerp toward velocity heading
  removeFadeSec: 1, // shrink-out duration past staleRemoveSec
};

// ---------------------------------------------------------------------------
// HUD overlays (labels + minimap)
// ---------------------------------------------------------------------------

export const LABELS = {
  minDistM: 350, // suppress label when practically on top of it
  occlusionMinDistM: 2500, // nearer targets skip the terrain LOS check
  occlusionMarginM: 15, // terrain must top the sightline by this to dim
  cellW: 96, // declutter grid (px)
  cellH: 48,
  offsetY: 16, // label offset below the projected point (px)
  poiHoverRadiusPx: 70, // cursor pick radius around a projected POI letter
};

export const MINIMAP = {
  sizePx: 168,
  rangeM: 60000, // radius shown (true meters)
  updateHz: 5,
  ringStepM: 20000,
};

// ---------------------------------------------------------------------------
// Warp (teleport to an inspected aircraft) + inspect modal
// ---------------------------------------------------------------------------

export const WARP = {
  behindM: 650, // arrive this far behind the target, along its track
  aboveM: 60,
  speedPadMps: 25, // arrive at target groundspeed + this
  flashMs: 900, // DOM white-flash duration masking tile stream-in
  hoverRadiusPx: 56, // pointer pick radius around a projected aircraft
  hoverStickiness: 0.55, // current hover's distance is scaled by this (hysteresis)
};

// ---------------------------------------------------------------------------
// Procedural audio (WebAudio — no asset files)
// ---------------------------------------------------------------------------

export const AUDIO = {
  masterGain: 0.32,
  windMaxGain: 0.5, // filtered-noise wind bed at full speed
  engineMaxGain: 0.22, // sawtooth+sub engine hum
  uiGain: 0.5, // lock blips / clicks / warp sweep
  updateHz: 15, // how often gains/filters chase flight speed
};

// ---------------------------------------------------------------------------
// Targeting / gameplay
// ---------------------------------------------------------------------------

export const TARGETING = {
  acquireRangeM: 10000,
  acquireConeDeg: 10,
  releaseRangeM: 12000,
  releaseConeDeg: 15,
  minHoldSec: 0.5,
  infoCardRangeM: 2000,
  infoCardReleaseM: 3000,
  infoCardSuppressSec: 30,

  // Intercept autopilot
  interceptDecelStartM: 1000,
  interceptHandoffM: 400,
  interceptOverspeedMps: 15, // arrive at targetGS + this

  // Formation slot (plane-local to target: right, up, back)
  formationSlot: { right: 80, up: 20, back: 60 },
  formationLambda: 1.8,
  formationBreakDeflection: 0.5, // stick fraction that breaks formation
  formationBreakHoldSec: 0.3,
};

// ---------------------------------------------------------------------------
// Sky / atmosphere (Phase 3)
// ---------------------------------------------------------------------------

export const SKY = {
  hdri: '/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr', // CC0, Poly Haven
  // Brightest texel of the HDRI (scripts/hdr-sun.mjs): elevation 47.9° —
  // keeps the DirectionalLight aligned with the baked-in sun
  sunDirection: [0.555, 0.742, 0.377],
  sunIntensity: 2.2,
  hemiIntensity: 0.25, // HDRI supplies most ambient; hemi lifts terrain shadows
  envIntensity: 0.85,
  fogColor: '#c6d7e8', // blends distant terrain into the HDRI horizon band
  fogDensity: 0.0000075,
  bloomIntensity: 0.7, // daylight: bloom only for tracers/very bright specks
  bloomThreshold: 0.85,
};

// "Night ops" scene mood for the CARTO dark map style — the airloom-exact
// look: a dark globe floating in a near-black navy void, neon tracers on top.
export const NIGHT = {
  background: '#070b18',
  fogColor: '#0e1630', // matches the sky dome's horizon band → seamless rim
  fogDensity: 0.0000058,
  // The CARTO tiles carry the darkness — but over-lighting them washes the
  // globe grey (1.5 read as fog) while starving them buries the street grid
  // (1.15 read as a black slab). This keeps the grid faintly alive while
  // the ground stays a dark mass against the void (airloom read).
  sunIntensity: 1.35,
  sunColor: '#c3cef0',
  hemiSky: '#4a5d8f',
  hemiGround: '#141721',
  hemiIntensity: 0.32,
  envIntensity: 0.2,
  bloomIntensity: 1.0, // tracers + white letters glow against the dark globe
  bloomThreshold: 0.62,
};

// "Toy World" scene mood — INK + ICE (FLY_GLOBE_REWORK §1.4, revised after
// user review: the synthwave cyan/magenta pass read "retro" and clashed
// with the red player jet). Near-black ink globe, ice-white street glow —
// the tracers and the plane carry all the color. Lighting stays near-full
// cool white so the toy-palette vertex colors read true (dark colors stay
// dark; the glowing values sit above the bloom threshold).
export const TOY = {
  background: '#070a14', // pre-dome fallback; the SkyDome is the real sky
  fogColor: '#131832', // sits between ground and sky-horizon for a soft rim
  fogDensity: 0.000016, // cozy bubble (confined-world feel + fewer tiles)
  sunIntensity: 1.05,
  sunColor: '#e8edff',
  hemiSky: '#3d4670',
  hemiGround: '#1a1f38',
  hemiIntensity: 0.55,
  envIntensity: 0.12,
  saturation: 0.05, // HueSaturation boost (0 = neutral)
  contrast: 0.08, // BrightnessContrast boost
  bloomIntensity: 1.05,
  bloomThreshold: 0.52, // neon road/water/tracer values clear this; ground never does
  // Diorama camera (toy only): shallow tilt-shift band around the player
  dofFocusM: 700, // world units to the sharp band
  dofRangeM: 2600, // sharp band depth; blur grows beyond
  dofBokeh: 2.6,
  grainOpacity: 0.06,
  // Player-following toon shadow — OFF in the dark-neon look (shadows are
  // invisible on a near-black ground and the shadow pass costs ~50 draws)
  shadows: false,
  shadowMapSize: 1024,
  shadowRadiusM: 800, // ortho half-extent around the player
};

// Toy World vector chunks (FLY_TOYWORLD_REWORK §4) — quadtree rings around
// the player, radii in WORLD (mercator) units (≈ true m × 1/cos(lat); at NYC
// 8000u ≈ 6km true). Finer rings replace coarser ones with no gaps/overlap.
export const TOY_WORLD = {
  // Radii trimmed for the ≤350 draw budget (globe rework): the mini-planet
  // curvature drops the far edge below the horizon anyway.
  rings: [
    { z: 14, r: 8000, detail: 'full' },
    { z: 13, r: 18000, detail: 'mid' },
    { z: 12, r: 30000, detail: 'far' },
  ],
  gridSegments: 12, // per-chunk elevation drape grid (12 → 13×13 samples)
  groundLift: 2.5, // toy ground plane rides this far above the tile mesh
  terrainExaggeration: 1.7, // toy relief drama (flight floor uses TRUE DEM)
  buildings: {
    maxPerChunk: 700,
    maxPerChunkMid: 180,
    minH: 9,
    maxH: 90,
    smallBoost: 1.6,
    maxFootprintM2: 60000, // merged city blocks above this stay flat ground
    baseSinkM: 2.5, // walls extend below ground — no hover on draped slopes
  },
  trees: { maxPerChunk: 220, areaPerTreeM2: 2400, minR: 3.5, maxR: 7.5 },
  grass: { maxPerChunk: 320, areaPerM2: 900, minR: 1.4, maxR: 3.2 },
  maxBuilds: 6, // concurrent worker builds (fetch RTT dominates, not parse)
  finalizePerFrame: 2, // chunk GPU uploads per frame (spike guard)
  drapeBudgetMs: 1.5, // ms/frame spent sampling DEM for pending chunks
  // Minimum DEM tile zoom that must answer before a chunk's drape commits —
  // coarse fallback tiles produce wrong-height slab chunks otherwise.
  demZByDetail: { full: 11, mid: 9, far: 8 },
  drapeMaxTries: 20, // ~30s of holding before accepting a coarse drape
  refreshMoveM: 600, // recompute the desired chunk set after moving this far
  refreshSec: 2, // …or at least this often
  maxChunks: 120, // hard cap; nearest win
};

// ---------------------------------------------------------------------------
// The Globe (FLY_GLOBE_REWORK): every map style is a curved mini-planet
// floating in a per-style sky. drop = d²/2R from the player outward.
// 80km reads clearly as a dome; 260km was invisible under fog.
// ---------------------------------------------------------------------------

export const GLOBE = {
  bendRadiusM: {
    satellite: 100000, // daylight imagery: slightly gentler curve
    night: 80000, // airloom-exact dark globe
    toy: 80000,
  },
  // The mini-globe is a LOW-altitude experience: at cruise altitudes the
  // full bend drops terrain so fast that a huge void band opens between
  // the rim and the sky (glaring in Day). Flatten k smoothly with player
  // altitude — full toy curvature below startAltM, halving every halfAltM
  // above it, never flatter than minKFrac of the style's k. Every CPU
  // consumer (letters, labels, clouds, harness aim) reads the live
  // uniform, so the whole world stays glued while it breathes.
  altFlatten: {
    startAltM: 2500,
    halfAltM: 3500,
    minKFrac: 0.1,
  },
  // TRAFFIC bend (user report, 2026-07-17): the raw d²k drop crushed
  // distant HIGH traffic below the horizon — a jet at FL210 25nm out
  // dropped ~13km and rendered "lower than us at 3k feet". Aircraft well
  // above the ground now cap their drop so anything above the player can
  // never sink below eye level (it hugs the horizon at range instead,
  // like real distant traffic); aircraft near the ground keep the FULL
  // drop so taxiing/landing planes stay glued to the drawn terrain.
  // aglLo→aglHi (proxy AGL vs the player's ground) blends between the two.
  // keepFrac = fraction of the height-above-eye retained at range.
  trafficBend: {
    aglLoM: 150,
    aglHiM: 900,
    keepFrac: 0.2,
  },
  // Per-style sky dome. rimOnly (satellite): transparent above the horizon —
  // the HDRI day sky carries the upper hemisphere; the dome only supplies
  // the atmosphere band at the rim and the void below it (Day's void is an
  // atmospheric slate, NOT near-black — black read as "space" at altitude).
  sky: {
    satellite: { horizon: '#c6d7e8', zenith: '#c6d7e8', void: '#33465c', rimOnly: true },
    night: { horizon: '#16224a', zenith: '#04060f', void: '#02030a', rimOnly: false },
    // toy reads PALETTE.skyHorizon / skyZenith / voidFloor (user-tuned)
  },
};

// World edge (FLY_GLOBE_REWORK §4.3, built at last): beyond the toy-chunk
// rings the coarse three-tile base tiles have too few vertices for the
// quadratic bend and facet into giant flat polygons. Two-part fix:
// (1) fade: every GROUND material (world-bend.js applyBendFade) melts into
//     the style's void/fog color across this radial band — facets vanish
//     before they can read as geometry. Interacts with TOY/NIGHT fogDensity
//     (the mood knobs): fade start should sit near the fog bubble's edge.
// (2) floor: a huge void-colored disc far below the rim with a faint
//     world-anchored cross grid that parallaxes as you fly (dark styles
//     only — Day keeps its HDRI + rim-void read). floorY is DERIVED as the
//     bend drop at fade.endM plus marginM, so terrain is already painted
//     pure void before its geometry can cross the floor (no visible seam,
//     no z-fighting) — deepens automatically if fade.endM is tuned up.
export const WORLD_EDGE = {
  fade: {
    satellite: { startM: 60000, endM: 120000 }, // subtle facet cleanup; keeps Day's haze
    night: { startM: 20000, endM: 34000 },
    toy: { startM: 14000, endM: 26000 },
  },
  floor: {
    byStyle: { satellite: false, night: true, toy: true },
    radiusM: 250000,
    cellM: 2600, // grid cell (world meters)
    lineWidthPx: 1.4, // fwidth-scaled AA line width
    gridAlpha: { night: 0.3, toy: 0.42 },
    gridColorNight: '#39456e', // toy reads PALETTE.voidGrid (user-tuned)
    gridFadeStartM: 30000, // grid lines fade out radially…
    gridFadeEndM: 110000,
    edgeFadeStartM: 130000, // …then the whole disc melts into the dome void
    edgeFadeEndM: 235000,
    marginM: 900,
  },
};

// Clean airloom 3D letters standing on the terrain (all styles) — white,
// bold, no outline/pegs/sparkles. Sizes are letter heights in meters.
// Military/hotspot letters stay the same clean white (taste rule §3.8);
// their kind reads through the hover tooltip, minimap and atlas instead.
export const LETTERS = {
  airport: { sizeM: 150, rangeM: 70000, max: 3 },
  city: { sizeM: 210, rangeM: 100000, max: 2 },
  landmark: { sizeM: 95, rangeM: 40000, max: 2 },
  military: { sizeM: 120, rangeM: 60000, max: 2 },
  hotspot: { sizeM: 85, rangeM: 35000, max: 2 },
  minDistM: 2600, // suppress a letter when practically overhead
  separationM: 4500, // two names closer than this collide — bigger kind wins
  popInSec: 0.55, // spring scale-in when a name appears/changes
};

export const CLOUDS = {
  texture: '/textures/cloud.png', // CC0 (WickedInsignia, OpenGameArt) — self-hosted
  // Cell sized so the farthest puff (~17km) dissolves BEFORE the globe rim
  // can slice it; the same 40 puffs in a smaller cell = a denser, present
  // sky (the 36km cell left most puffs sunk below the mini-planet horizon).
  cellSize: 24000, // toroidal wrap cell around the player (world units)
  driftMps: 5, // slow wind along +X
  fade: 2000, // drei near-fade: puffs turn transparent as you fly through
  // Distance dissolve (wrapper scale → drei re-reads matrixWorld per frame):
  // puffs shrink away between these radii instead of depth-clipping at the rim
  fadeStartM: 9000,
  fadeEndM: 13500,
  puffsByTier: { high: 54, medium: 30, low: 10 },
  segments: 8, // billboard segments per puff
  limit: 512, // instanced segment pool (>= max puffs * segments)
  // Terrain clearance: puff bases ride at least this far above the DRAWN
  // ground (toy = elev × exaggeration + lift) — hills can no longer punch
  // through cloud bases. Ground is sampled on toroidal wrap + round-robin
  // healing, smoothed so DEM stream-in never pops a puff.
  clearanceM: 450,
  clearanceJitterM: 300, // + hash·this, so clamped puffs don't form a flat sheet
  groundLerpLambda: 0.7, // groundY healing rate (expApproach)
  resamplePerFrame: 2, // round-robin ground re-samples per frame (54 puffs ≈ 0.45s)
  // Per-style presentation (moody dark ink wisps in the dark styles — they
  // must never compete with the tracers; Day keeps bright white cumulus).
  // enabled:false is the whole "no clouds in this style" switch.
  byStyle: {
    satellite: { enabled: true, color: '#ffffff', opacity: 0.55, altMin: 900, altMax: 3600, countScale: 1, shadows: true },
    night: { enabled: true, color: '#3c4870', opacity: 0.3, altMin: 1300, altMax: 3800, countScale: 0.6, shadows: false },
    toy: { enabled: true, color: '#333e63', opacity: 0.26, altMin: 1400, altMax: 3800, countScale: 0.5, shadows: false },
  },
  // Day-only cloud shadows (§4.3c): one instanced pool of soft dark discs
  // riding the drawn ground under each puff (+1 draw, Day only — dark
  // styles' ground is already ink).
  shadow: {
    opacity: 0.12,
    scale: 0.85, // disc radius ≈ puff size × this
    liftM: 3, // above the sampled ground (slope clipping reads as hugging)
  },
};

// Traffic tracers ("contrails"): the neon altitude-colored trails behind
// every live aircraft — the airloom signature. mode 'ribbon' = persistent
// tapered trails of each plane's actual recent path (default); 'streak' =
// the original instantaneous velocity lines. Both share the reliability
// fixes: alpha floor while the track is alive (poll starvation and the
// 300ms snap-dip can no longer wink trails out), head brightness floor
// that clears every style's bloom threshold, speed-gate hysteresis, and a
// cap that never binds in NYC airspace (~395 tracked).
export const TRACERS = {
  max: 512, // matches TRAFFIC.maxBillboards; > any realistic tracked count
  alphaFloor: 0.35, // visible while the track exists; removal window fades below
  headMinBrightness: 0.62, // × headBoost 1.5 = 0.93 > every bloom threshold (max 0.85)
  headBoost: 1.5, // heads ride above 1.0 so bloom grabs them in daylight too
  speedOnMps: 18, // hysteresis: arm above this…
  speedOffMps: 12, // …disarm below this (hoverers stop strobing)
  mode: 'ribbon', // 'ribbon' | 'streak' — one-flip A/B
  streakLenSecMax: 50, // streak mode look, unchanged (~5-12km lines)
  ribbon: {
    points: 24, // ring-buffer capacity per track (≈ 24 × 160m ≈ 3.8km trails)
    minSpacingM: 160, // record a point every this many meters of travel
    warpResetM: 2500, // fix jump > this = hard-cut that track's buffer
    widthHeadM: 24, // camera-facing width taper (wide at the plane…)
    widthTailM: 3, // …thin at the tail)
    sweepFrames: 90, // free dead-track buffers every N frames
    // Chasing a plane puts the camera INSIDE its ribbon — collapse width
    // for points near the camera so the trail never smears the screen.
    nearFadeStartM: 40,
    nearFadeEndM: 120,
  },
};

// Shoreline foam animation (toy water): a bright dash train scrolling
// along the baked foam ribbons. lenM = dash wavelength along the coast;
// speed = wavelengths per second (0.25 → one dash length every 4s).
export const FOAM = {
  lenM: 180,
  speed: 0.25,
};

// Road traffic pulses (toy, FLY_ATLAS_REWORK §4.3a): bright dash trains
// scrolling along motorway/trunk/primary arteries — data packets in the
// neon city. Same worker-baked arc technique as the foam; zero extra draws.
// Direction alternates per feature (worker flips the arc). Minor roads
// stay quiet on purpose (taste rule: quiet grid, loud arteries).
export const ROAD_PULSE = {
  lenM: 420, // dash wavelength along the artery (m)
  speed: 0.5, // wavelengths per second
  duty: 0.12, // lit fraction of each wavelength
  boost: 1.35, // diffuse multiplier at the dash head (clears bloom)
};

// Rooftop obstruction beacons (toy, §4.3b): buildings above heightFrac ×
// buildings.maxH get a tiny baked red top quad blinking slowly on the
// shared world clock. Baked into the building geometry — zero extra draws.
export const BEACONS = {
  heightFrac: 0.8, // tall-building threshold (× TOY_WORLD.buildings.maxH)
  sizeM: 1.6, // beacon quad edge (m)
  color: '#ff6b6b', // aviation-red family (hero-accent exception: skyline dots)
  rate: 0.3, // blink cycles per second
  duty: 0.3, // lit fraction of each cycle
  dim: 0.35, // brightness while off (embers, not black)
  boost: 1.8, // brightness at full on (clears bloom)
};

export const CONTRAIL = {
  minAltM: 6000, // contrails only form in the cold air above this altitude
  width: 22, // meshline lineWidth = 0.1 × width, world units (≈2.2m ribbon)
  length: 20, // ×10 = point history frames
  opacity: 0.55,
  color: '#eef4fb',
  // Camera-facing ribbons turn their full width toward the camera — with
  // the chase cam sitting basically INSIDE the player's own trail, even a
  // 2m ribbon filled a giant white wedge at altitude. Collapse the width
  // for points near the camera (zero at start, full by end).
  nearFadeStartM: 25,
  nearFadeEndM: 80,
};

// ---------------------------------------------------------------------------
// Terrain tiles (tokenless sources — no API keys anywhere)
//   imagery: Esri World Imagery (attribution required, see tile-sources.js)
//   elevation: AWS Open Data Terrarium tiles (Mapzen dataset, z0-15)
// ---------------------------------------------------------------------------

export const TILES = {
  satMaxZoom: 16, // Esri imagery goes deeper, but texture memory caps us
  demMaxZoom: 15, // Terrarium data ceiling
  lruBudgetBytes: 140 * 1024 * 1024,
  viewDistanceM: 250000, // fog/horizon cap bounds tile counts
};

// SPICY traffic pings (FLY_ATLAS_REWORK §4.4a): first sighting of military
// or epic+ rarity traffic in range → arcade toast + minimap ring + blip.
// Session-scoped dedup (a hex pings once per Fly session); scanned on the
// discrete 2s cadence, never per frame.
export const SPICY = {
  scanIntervalMs: 2000,
  maxRangeNm: 50, // don't ping about contacts half a poll-radius away
  minTier: 'epic', // non-military traffic must be at/above this rarity tier
  pulseSec: 6, // minimap attention-ring duration
};

// ---------------------------------------------------------------------------
// Unit conversions
// ---------------------------------------------------------------------------

export const KT_TO_MPS = 0.514444;
export const FPM_TO_MPS = 0.00508;
export const FT_TO_M = 0.3048;

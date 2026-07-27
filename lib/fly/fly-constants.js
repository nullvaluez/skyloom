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

// Performance budgets for Fly-mode quality targets (see PerformanceMonitor DPR).
// Round 8 (P7): raised for the stylized-premium night city. Draw accounting:
// round-7 measured 312–350 + ~50 shadow-pass draws + 9 landmark monuments + 1
// hero halo + 1 player nav-light draw ≈ ~410 worst case vs the 450 gate. The
// roof-detail geometry (P2) drives triangles 1.5M → 2.2M. Low tier holds ~350
// (shadows off ≈ −50, halo off, DOF off). Baked geometry is tier-INDEPENDENT
// (no worker detail flag); the documented fallback if the low-tier soak
// regresses is halving ROOFS.*.maxPerChunk globally, not a tier-forked worker.
export const PERF_BUDGET = {
  // R8 fix round: 450 → 470 — measured 461 (verify-roofs, Levittown, high
  // tier, shadows armed): the design's +50 shadow-pass estimate was low.
  // The soak's gpuFrameMs stays the real perf gate; this only sizes the
  // harness draw ceilings (gated at budget+10 composer slack = 480).
  drawCalls: 470, // medium/high (shadow pass + monuments + fleet lights)
  drawCallsLow: 350, // low tier: shadows off, halo off, DOF off
  triangles: 2_200_000, // roof-detail growth (P2); worker geometry tier-independent
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
  // Round 7: RMB free-look is a true orbit around the plane (full 360° yaw,
  // camera AIMS AT the plane — the old rig kept the look-ahead target, so a
  // 180° drag faced away from your own aircraft).
  freeLook: {
    yawRate: 7, // rad per screen-width of drag — one cross-screen drag ≈ 400°
    pitchRate: 3.5, // rad per screen-height
    maxPitchRad: 1.5, // upward orbit clamp (~86° — near top-down)
    minPitchRad: -0.35, // downward: enough to see the belly against the sky
    orbitAimUpFrac: 0.5, // look target = plane + offset.y * this
    blendLambda: 10, // chase↔orbit pose blend rate (1/s)
  },
  shakeSpeedFraction: 0.8, // shake only above this fraction of boost
  shakeMaxDeg: 0.2,
  // Round 6 cinema cam (C while intercept/formation is flying): wing view
  // abeam the player↔target midpoint with a slow orbital drift.
  cinema: {
    rangeK: 1.6, // camera range = pair separation × this…
    minRangeM: 120, // …never closer than this
    aboveM: 25, // camera height over the pair midpoint
    groundClearM: 40, // hard floor over terrain
    orbitRate: 0.05, // rad/s drift around the pair
    posLambda: 2.2,
    lookLambda: 5,
  },
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

  // Round 13 Phase 2 — traffic PRESENCE over dark ground. Low traffic over the
  // toy ink world / night satellite read as black cutouts (lit hulls × dim
  // moonlight ≈ 0). This over-drives the EXISTING per-instance tint channel
  // (instanceColor, no new uniform) so the hull's diffuse multiply lands above
  // black — a brightness FLOOR. Toy is always dark; satellite ramps the lift in
  // only as the sun sets (sun.frac → 0), so bright daylight imagery is untouched
  // (gain 1 at/above satDayFrac keeps the certified day look byte-identical).
  hullPresence: { toy: 1.75, satelliteNight: 1.55, satDayFrac: 0.35 },
  // Round 13 Phase 2 — far-LOD billboard sprite. The shared billboard pool drew
  // untextured 1×1 quads (colored squares at range, review gap A1#9). A
  // procedural soft-glow sprite with a faint wing/fuselage cross is generated to
  // a CanvasTexture at startup and set as the material map — SAME instanced draw,
  // now reading as a distant aircraft glint instead of a pixel block.
  billboardSprite: true,

  // Round 8.5 (H1): drawn-frame render lift (track.ryd — see
  // TOY_WORLD.airFrameFollowsDrawnGround). The ground under each airborne
  // track is re-sampled at most this often (also the retry cadence while
  // DEM hasn't streamed), and the applied lift eases toward the sampled
  // target at this per-second rate so terrain-relief changes under a
  // moving plane never pop its render altitude.
  renderLiftRefreshSec: 2,
  renderLiftLambda: 1.2,
};

// Round 8 (P6): aircraft navigation lights. Traffic models get emissive
// octahedra BAKED into the merged geometry at load (aEmissive vec4, rgb +
// mode in w — model-loader.js) and animated by the applyNavLights shader
// layer (world-bend.js, uNavT clock); the player gets the same colors as an
// additive Points strobe (PlayerPlane). Phases are hashed per model+light
// so the fleet never blinks in unison.
export const NAV_LIGHTS = {
  sizeM: 0.35, // octahedron half-extent, real meters (pre display scale)
  strobeHz: 1.2, // wingtip white strobe rate
  strobeDuty: 0.06, // strobe on-fraction (short camera-flash pop)
  beaconHz: 0.9, // belly beacon blink rate (slower, longer duty)
  port: '#ff3b30', // left wingtip, steady red
  starboard: '#2eff6a', // right wingtip, steady green
  tail: '#ffffff', // tail logo light, steady white (also the strobe color)
  beacon: '#ff2d55', // belly anti-collision beacon, blinking
};

// Round 13 Phase 2 — the HERO jet. All four review agents flagged the player
// plane as the flattest object on screen in BOTH styles. Everything here is a
// load/clone-time or PLANE-LOCAL effect: the GLB on disk is untouched, and the
// player renders near the rebased origin (bend negligible) so NONE of it needs
// a world-bend patch. Live-tunable; USER sign-off pending (FLY_ROUND13 §Phase2).
export const PLAYER = {
  // Hull material grade on the mounted CLONE (PlayerPlane): every hull mesh
  // becomes MeshPhysical (clearcoat + lower roughness so the sun/HDRI carve a
  // real specular instead of the matte GLB), PLUS a per-style FRESNEL rim added
  // as emissive — sun-white in satellite (a hot daylight edge), moon-cool in toy
  // (a cold edge that clears TOY.bloomThreshold at the silhouette). The canopy
  // keeps the round-8 glossy swap (glassier still). rimPower shapes the falloff.
  hull: {
    roughness: 0.42, // was the GLB's ~0.5–0.8 matte
    metalness: 0.32,
    clearcoat: 0.65,
    clearcoatRoughness: 0.28,
    envMapIntensity: 1.25,
    canopy: { roughness: 0.08, metalness: 0.0, envMapIntensity: 1.6, clearcoat: 1.0 },
    rimPower: 2.6,
    byStyle: {
      satellite: { rim: '#ffffff', rimStrength: 0.4 }, // hot sun-white edge
      toy: { rim: '#bcd4ff', rimStrength: 1.25 }, // cold moonlit edge, clears bloom
    },
  },
  // TRUE on-model nav/strobe lights — the ONE additive Points draw (+1). Per-
  // style emit so the colored lights clear the bloom threshold and GLOW at
  // night/toy (red/green luma is low; ×emit pushes them over; satellite daylight
  // keeps them modest). Double-flash strobes: two quick pops (gap apart) then a
  // long dark gap — the real-world airliner strobe cadence.
  navLights: {
    sizeM: 1.15, // additive point size, world m (was 0.8) — reads at chase range
    steadyEmit: { satellite: 1.5, toy: 2.6 }, // port/starboard steady brightness
    strobeEmit: { satellite: 2.4, toy: 3.6 }, // white tail/wingtip strobe peak
    beaconEmit: { satellite: 1.4, toy: 2.4 }, // belly anti-collision beacon
    strobeHz: 0.7, // full double-flash cycles per second (~1.4s period)
    strobeGap: 0.11, // cycle fraction between the two pops of a double-flash
    strobeDuty: 0.05, // each pop's on-fraction
    beaconHz: 0.85,
    beaconEmber: 0.28, // dim floor between beacon blinks (matches traffic)
  },
  // Throttle-driven afterburner: a 2-tone toon flame (hot core + orange sheath)
  // child of the plane group behind the tail, +2 draws WHEN LIT (visible=false
  // → 0 draws at cruise, so the draw-gated harness scenes — which never boost —
  // are unaffected). Throttle is read from flight.speed (the HUD's own speed
  // source, not a per-frame store subscription): OFF at cruise (180), ramping to
  // a FULL bloom-clearing flame near boost (750). Plane-local, no world-bend.
  afterburner: {
    startMps: 250, // flame begins just above cruise
    fullMps: 720, // full flame near the 750 boost preset
    lengthM: 15, // core cone length at full throttle (world m, pre model scale)
    coreRadiusM: 1.05,
    sheathRadiusM: 1.9,
    coreColor: '#cfe8ff', // hot blue-white core (clears both bloom thresholds)
    sheathColor: '#ff7a24', // orange toon sheath
    coreOpacity: 0.95,
    sheathOpacity: 0.55,
    idleFrac: 0.14, // minimum lit length fraction once forming (subtle stub)
    flickerHz: 34, // length jitter for a live flame
    flickerAmp: 0.12,
  },
  // Satellite player ground-contact shadow. The plan's first choice was to flip
  // the EXISTING toy ortho shadow rig on for satellite, but that needs every
  // streaming satellite TILE set receiveShadow=true — per-fragment shadow
  // sampling across the whole terrain in the perf-sensitive DEFAULT style (a
  // fill-rate cost the draw gate can't see, exactly what the R11 satellite
  // perf-floor guards) plus a recompile on the hot tile path. Instead: a 1-draw
  // soft contact blob under the player (the cloud-shadow disc technique), bend-
  // anchored, faded out with AGL. Player castShadow is still enabled on the
  // clone so the TOY rig — whose receiver plane already exists — finally casts
  // the hero's own shadow for free. See FLY_ROUND13 §Phase2 for the measurement.
  groundShadow: {
    blobColor: '#0a0f16',
    blobOpacity: 0.34, // peak (low AGL)
    blobRadiusM: 26, // disc radius, world m (≈ the fighter's footprint ×~1.3)
    aglFadeStartM: 900, // full blob below this
    aglFadeEndM: 2200, // gone above this (mesh hidden → 0 draws)
    minTier: 'medium', // low tier: no blob (perf floor, mirrors the toy rig)
  },
};

// ---------------------------------------------------------------------------
// Round 17 "Your Wings" — THE PLAYER HANGAR
// ---------------------------------------------------------------------------

/**
 * Per-aircraft tuning for the selectable fleet. The manifest (ids, names,
 * GLB urls, measured targetLenM/yawFixRad) lives in lib/fly/player-aircraft.js;
 * every NUMBER lives here. `resolveAircraft(id)` merges the two into one frozen
 * runtime config whose flight half is `{...FLIGHT, ...byId[id].flight}` — so
 * FlightModel.step() always finds every field it reads, and any key NOT
 * overridden below keeps the global FLIGHT value on purpose (rateLambda,
 * bankLambda, the floor/auto-level assists and `highSpeedTurnCutover` are
 * FEEL constants shared by the whole fleet; only the envelope differs).
 *
 * THE FIGHTER HAS NO ENTRY IN `byId`, DELIBERATELY. With no `fly-aircraft` key
 * saved, the player is the fighter, and resolveAircraft('fighter') therefore
 * produces exactly the round-16 FLIGHT / PLAYER.afterburner / CONTRAIL /
 * PLAYER.groundShadow values — the default is bit-identical by construction,
 * not by matching numbers by hand. scripts/verify-hangar.js gates that absence.
 *
 * `enabled: false` is the one-line rollback: the PauseMenu button disappears
 * and resolveInitialAircraft() becomes a no-op, so every player flies the
 * fighter again and nothing else in the round changes shape.
 */
export const HANGAR = {
  enabled: true,

  // Fighter-equivalent fallbacks for the fields that have no home in the
  // round-16 constants (the fighter's own values, so they ARE the defaults).
  defaults: {
    cameraOffsetScale: 1, // chase rig standoff multiplier (20 m airframe = 1×)
    afterburnerScale: 1, // afterburner cone size multiplier
  },
  audioDefaults: {
    thrumHz: 26, // 'prop' tremolo rate when a profile omits it
    thrumDepth: 0.55, // LFO swing as a fraction of AUDIO.engineMaxGain
  },

  // Stat-bar normalizers for the hangar UI (bars are value/max, clamped 0..1).
  bars: {
    maxSpeedMps: 750, // the fastest airframe in the fleet
    maxAgilityDeg: 50, // max of the pitch-rate column
    maxLenM: 70, // the longest airframe (cargo)
  },

  byId: {
    military: {
      flight: {
        speeds: { slow: 65, cruise: 200, boost: 750 },
        accel: 45,
        maxPitchRateDeg: 50,
        maxYawRateDeg: 22,
        maxBankDeg: 75,
        ceiling: 16500,
        cameraOffsetScale: 0.95,
      },
      afterburner: { enabled: true, startMps: 260, fullMps: 720, scale: 1 },
      contrail: { enabled: true, twin: false, engineSpanM: 0, backM: 10 },
      shadowRadiusM: 24,
      audio: { mode: 'jet', hzMul: 1.06 },
    },
    'warbird-jet': {
      flight: {
        speeds: { slow: 55, cruise: 160, boost: 420 },
        accel: 32,
        maxPitchRateDeg: 42,
        maxYawRateDeg: 22,
        maxBankDeg: 70,
        ceiling: 12000,
        cameraOffsetScale: 0.85,
      },
      afterburner: { enabled: true, startMps: 200, fullMps: 400, scale: 0.7 },
      contrail: { enabled: true, twin: false, engineSpanM: 0, backM: 8 },
      shadowRadiusM: 16,
      audio: { mode: 'jet', hzMul: 1.12, gainMul: 0.9 },
    },
    'warbird-prop': {
      flight: {
        speeds: { slow: 45, cruise: 115, boost: 165 },
        accel: 18,
        maxPitchRateDeg: 40,
        maxYawRateDeg: 24,
        maxBankDeg: 70,
        ceiling: 8500,
        cameraOffsetScale: 0.8,
      },
      afterburner: { enabled: false },
      contrail: { enabled: false },
      shadowRadiusM: 14,
      audio: { mode: 'prop', thrumHz: 24, hzMul: 0.85 },
    },
    prop: {
      flight: {
        speeds: { slow: 30, cruise: 60, boost: 95 },
        accel: 10,
        maxPitchRateDeg: 30,
        maxYawRateDeg: 16,
        maxBankDeg: 55,
        ceiling: 5500,
        cameraOffsetScale: 0.75,
      },
      afterburner: { enabled: false },
      contrail: { enabled: false },
      shadowRadiusM: 13,
      audio: { mode: 'prop', thrumHz: 30 },
    },
    glider: {
      flight: {
        speeds: { slow: 22, cruise: 38, boost: 58 },
        accel: 5,
        maxPitchRateDeg: 26,
        maxYawRateDeg: 13,
        maxBankDeg: 60,
        ceiling: 11000,
        cameraOffsetScale: 0.75,
      },
      afterburner: { enabled: false },
      contrail: { enabled: false },
      shadowRadiusM: 12,
      audio: { mode: 'wind' }, // engine gain forced to 0 — pure airflow
    },
    bizjet: {
      flight: {
        speeds: { slow: 55, cruise: 150, boost: 255 },
        accel: 24,
        maxPitchRateDeg: 35,
        maxYawRateDeg: 15,
        maxBankDeg: 60,
        ceiling: 14000,
        cameraOffsetScale: 1,
      },
      afterburner: { enabled: false },
      contrail: { enabled: true, twin: true, engineSpanM: 3, backM: 11 },
      shadowRadiusM: 24,
      audio: { mode: 'jet', hzMul: 1.1, gainMul: 0.85 },
    },
    airliner: {
      flight: {
        speeds: { slow: 75, cruise: 240, boost: 310 },
        accel: 14,
        maxPitchRateDeg: 20,
        maxYawRateDeg: 8,
        maxBankDeg: 35,
        ceiling: 13000,
        cameraOffsetScale: 2.4,
      },
      afterburner: { enabled: false },
      contrail: { enabled: true, twin: true, engineSpanM: 22, backM: 34 },
      shadowRadiusM: 62,
      audio: { mode: 'heavy', hzMul: 0.7, subMul: 1.3 },
    },
    cargo: {
      flight: {
        speeds: { slow: 75, cruise: 250, boost: 310 },
        accel: 12,
        maxPitchRateDeg: 18,
        maxYawRateDeg: 7,
        maxBankDeg: 30,
        ceiling: 13500,
        cameraOffsetScale: 2.8,
      },
      afterburner: { enabled: false },
      contrail: { enabled: true, twin: true, engineSpanM: 30, backM: 42 },
      shadowRadiusM: 78,
      audio: { mode: 'heavy', hzMul: 0.62, subMul: 1.4 },
    },
  },
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
  // Round 6 far-warp cinematic: warps beyond farKmThreshold get a held
  // streak→hold→reveal treatment instead of the bare 900ms flash — the
  // hold polls world readiness (toy chunk count / tile downloads) and
  // reveals when the destination has streamed in, capped so a slow network
  // can't trap the player behind the overlay.
  farKmThreshold: 100,
  far: {
    holdMinMs: 2200,
    holdMaxMs: 3500,
    revealMs: 650,
    readyChunks: 12, // toy: reveal once this many chunks are ready…
    readyFrac: 0.35, // …or this fraction of desired chunks
    readyDownloads: 3, // raster styles: reveal when tile downloads fall below
  },
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
// Inspect card (round 8.5 §B — right-docked holo panel;
//               round 15 §A3 — registry identity + real bottom sheet)
// ---------------------------------------------------------------------------

export const INSPECT = {
  // One silent auto-retry after a failed WARP/CHASE click — covers the
  // scene-remount dead window (the bus usually re-registers within a frame
  // or two; 400ms is generous without feeling like a second click).
  actionRetryMs: 400,

  // Desktop right dock. R15: 420 → 440 to carry the registry identity block
  // (manufacturer + model + owner + country) without wrapping every line.
  // verify-inspect-actions gates the docked column at 380–460px — stay inside.
  panelW: 440,

  heroH: 210, // planespotters hero photo height (px), desktop
  heroHMobile: 170, // …and in the phone bottom sheet (vertical room is scarce)
  turntableH: 150, // secondary 3D-model section height when the photo leads

  // Phone bottom sheet: cap the sheet so the world stays visible above it.
  // svh (not vh) so a collapsing mobile URL bar doesn't jump the layout.
  sheetMaxSvh: 88,
  // Touch targets for WARP/CHASE in the sheet (px). 48 = the usual floor.
  sheetActionH: 50,
};

// ---------------------------------------------------------------------------
// Pilot Logbook (round 16 §A3 — the Spotter's Passport finally gets a surface)
// ---------------------------------------------------------------------------

export const LOGBOOK = {
  // Desktop panel width cap (px). The panel is min(94%, this) × min(92%, 720px)
  // over an Atlas-style scrim that stops short of the attribution strip. Wider
  // than the Atlas card would push the LOG rows past a comfortable scan width;
  // narrower wraps the type names.
  panelW: 980,
  // LOG tab window size. The passport persists up to 1000 spots; rendering all
  // of them is a 1000-node DOM churn on a machine that is also flying. One
  // page renders, an IntersectionObserver sentinel grows the window — no
  // virtualization dependency, no scroll handler, no per-frame work.
  pageSize: 80,
  // STATS activity strip length (days, UTC buckets — the same day key logSpot
  // writes). 4 weeks reads as a habit without needing a year of history.
  activityDays: 28,
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
  // Round 13 Phase 0 — filmic tone mapping (the app shipped with NO tone map:
  // the composer forced NoToneMapping and Effects.jsx never re-added one, so
  // every color/luma gate was calibrated on the linear→sRGB image). A/B'd
  // AgX vs ACES vs None with fixed-scene captures (scripts/r13-tonemap-*.png).
  // Mode is per style so the loser is one edit away; 'None' restores the
  // pre-R13 look. VERDICT (2026-07-19): ACES for BOTH styles — see below.
  toneMapping: {
    // A/B, quantitative + EYEBALL (the pixel metrics alone mislead here):
    //   None — punchy but CLIPS satellite highlights hard (noon Sierra 11%
    //          pure-white snow, 25% >220); the pre-R13 baseline.
    //   AgX  — kills clipping numerically (0%) but VISUALLY fogs BOTH styles:
    //          satellite imagery goes milky/low-contrast, the toy ink world
    //          lifts to a washed grey-navy with dull neon. AgX is built for
    //          scene-referred HDR renders; this app's content is display-
    //          referred (LDR Esri photos + a curated ink palette), so AgX
    //          over-desaturates and lifts blacks. Rejected on the eyeball.
    //   ACES — recovers the clipped snow/cloud highlight DETAIL (clip 11%→0)
    //          WITHOUT the milkiness, keeps the blue-sky punch and mid-tone
    //          contrast (midStd 40→42); over the toy world it deepens the
    //          ink-blacks a touch and reads slightly crisper/more electric —
    //          the certified neon intent preserved (nearly identical to None).
    // Pick: ACES both. It fixes satellite's real defect (highlight clipping)
    // and leaves/enhances the certified Neon look; AgX regressed both.
    byStyle: { satellite: 'ACES', toy: 'ACES', night: 'ACES' },
  },
  // Round 13 Phase 0 — satellite color grade (satellite had NO grade; toy has
  // four passes). HueSaturation + BrightnessContrast are static; the warm/cool
  // white balance rides runtime.sun.frac (sampled ~5s in Effects.jsx, never
  // per frame — the CloudField cadence). frac: 1 = local noon, ~golden = warm
  // peak, ~0 = deep-night cool. All three effects MERGE into one EffectPass
  // (0 extra draws). Live-tunable — USER CHECKPOINT #1.
  grade: {
    saturation: 0.08, // HueSaturation lift — imagery reads a touch richer
    brightness: 0.0, // BrightnessContrast brightness (kept neutral)
    contrast: 0.05, // gentle S-curve on top of the tone map
    goldenFrac: 0.32, // sun-frac of peak warmth (golden hour)
    warm: [1.05, 1.0, 0.93], // multiply at golden hour (warm the imagery)
    neutral: [1.0, 1.0, 1.0], // multiply at local noon
    cool: [0.96, 0.99, 1.05], // multiply at deep night (cool blue)
  },
  // Round 6 (Phase G): Day style dims toward the destination's LOCAL time
  // (coarse solar elevation from UTC + lon/15 — same "exactness doesn't
  // matter" stance as the atlas tz hints). Intensity-only: the authored
  // colors/fog stay untouched; night/toy styles are unaffected.
  dayCycle: {
    minSunFrac: 0.35, // floor: local midnight keeps 35% of the sun/hemi
    refreshSec: 60,
  },
  // Round 13 Phase 1 — satellite aerial DEPTH HAZE (aerial perspective). The
  // uHaze* channel already runs in every tile shader (world-bend.js) but was
  // hard-gated to max 0 outside toy (FlyScene ~424). Distant satellite ground
  // now recedes toward the LIVE atmosphere color across [startM, endM] of XZ
  // distance BEFORE the edge fade. The COLOR is driven per-frame from
  // SKY.altAtmo (the rim triple) so haze, fog, edge-fade AND the SkyDome band
  // all share ONE tone. startM sits past the near field so hillshade relief
  // still reads there (verify-sat-depth mean-Δ gate); endM sits under the 60km
  // fade start so the round-6 rim gates hold. `color` is only the boot fallback
  // (the -50 block overrides it with the live rim color each frame).
  haze: { startM: 16000, endM: 55000, max: 0.5, color: '#c6d7e8' },
  // Round 13 Phase 1 — satellite time-of-day + altitude ATMOSPHERE: the SINGLE
  // source for the rim triple (scene fog color = tile edge-fade + haze target =
  // SkyDome band) so all move TOGETHER per the round-6 rim rule. Driven
  // per-frame in FlyScene's -50 block (uniforms only, NO React state; only the
  // altitude term is expApproach-smoothed). `tod` = time-of-day keyframes
  // [frac, rim, void] interpolated by runtime.sun.frac; the rim colors track
  // the swapped puresky HDRIs at the horizon so the rimOnly dome band meets the
  // sky with no hard seam (verify-rim). The altitude cool-shift (× dayness so
  // night stays dark) cools/thins the rim toward highAlt* as eye AGL climbs and
  // FALLS fog density base→high — together this kills the FL300 "wet mirror"
  // horizon band (scripts/edge-08-day-fl300.png). Low-AGL DAY output IS the
  // certified round-11 look (rim #c6d7e8, void #33465c, fog 0.0000075).
  altAtmo: {
    tod: [
      { frac: 0.0, rim: '#101a30', void: '#0a1120' }, // deep night
      { frac: 0.14, rim: '#4a4258', void: '#221f30' }, // twilight
      { frac: 0.3, rim: '#d8b48a', void: '#5c4a4e' }, // golden hour (warm)
      { frac: 0.5, rim: '#c6d7e8', void: '#33465c' }, // day (round-11 certified)
      { frac: 1.0, rim: '#c6d7e8', void: '#33465c' }, // noon
    ],
    highAltRim: '#a7c3e0', // thinner high-atmosphere blue (gentle — seam-safe)
    highAltVoid: '#26405a',
    aglStartM: 2500, // below this = round-11 look (clamp)
    aglFullM: 9000, // fully cooled/thinned by cruise
    fogDensityBase: 0.0000075, // = fogDensity at low AGL (round-11)
    fogDensityHigh: 0.000003, // thinned at cruise (clears the murk band)
    daynessFrac: 0.5, // cool-shift authority ramps to full by this sun.frac
    smoothSec: 2.0, // expApproach time constant on the altitude term
  },
  // Round 13 Phase 1 — satellite time-of-day HDRI sky (satellite's first real
  // night since the Night style retired in R7). The visible sky is the drei
  // <Environment> HDRI; FlyScene swaps it on DISCRETE runtime.sun.frac buckets
  // (never per frame — each swap is a PMREM re-bake). dawn vs dusk splits on
  // runtime.sun.az (< 0 = morning). TOY stays UNCONDITIONAL noon (its moonlit
  // identity is certified). Files are 1K puresky (CC0, Poly Haven) except the
  // certified 2K day sky.
  hdriCycle: {
    dayFrac: 0.5, // frac ≥ this → day (kloofendal noon)
    nightFrac: 0.06, // frac < this → night
    day: '/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
    dawn: '/hdri/qwantani_dawn_puresky_1k.hdr',
    dusk: '/hdri/qwantani_dusk_1_puresky_1k.hdr',
    night: '/hdri/qwantani_night_puresky_1k.hdr',
    // Per-bucket <Environment> intensities. env = IBL ambient (scene.
    // environmentIntensity), bg = visible-sky brightness (scene.
    // backgroundIntensity). The puresky HDRIs are bright in HDR (the moonlit
    // night sky reads as grey OVERCAST at full intensity), so dawn/dusk/night
    // dim BOTH — the ground darkens (env down) and the sky darkens (bg down)
    // so night reads as night, coherent with the dark fog rim. Day = 0.85/1.0
    // is the certified round-11 value (byte-identical day). NOTE: the
    // directional KEY light is only DIMMED by the day cycle (not re-colored) —
    // a cooler moonlit key is a Phase 2 follow-up.
    intensity: {
      day: { env: 0.85, bg: 1.0 },
      dawn: { env: 0.5, bg: 0.7 },
      dusk: { env: 0.5, bg: 0.7 },
      night: { env: 0.16, bg: 0.26 },
    },
    // Round 13 Phase 2 (P1 handoff): the directional KEY light was only DIMMED
    // by the day cycle at night, so night ground read as "dimmed daylight". Cool
    // the key COLOR per bucket at the SAME discrete cadence as the bucket swap —
    // moonlit blue at night, warm at dawn/dusk, white by day. This is a COLOR
    // move only (intensity stays on the day cycle, so verify-sun's noon/midnight
    // intensity gates are untouched). hemiSky cools alongside so shadowed faces
    // aren't lit warm-white under a blue key.
    keyColor: {
      day: '#ffffff',
      dawn: '#ffd7ad',
      dusk: '#ffc79a',
      night: '#9bb4e6', // cool moonlit blue
    },
    hemiSky: {
      day: '#cfe5ff',
      dawn: '#d9c3d6',
      dusk: '#d8bfae',
      night: '#5a6f9e', // dim cool sky fill at night
    },
  },
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
  // Round 8 fix round: lifted to the DEPTH-HAZE color — city → haze → fog →
  // rim is now one monotone family (the old #131832 sat below the haze tone,
  // so the handoff dipped dark right where the rim glow should carry it).
  // Round-6 rim rule: this, GLOBE.rim.toy and PALETTE.fog move TOGETHER.
  fogColor: '#1a2246', // sits between ground and sky-horizon for a soft rim
  // Round 8 (P4): a touch denser to seat the new depth haze. ONLY the density
  // moves — fogColor stays unified with GLOBE.rim.toy and the edge-fade color
  // (round-6 rim lesson: the rim triple must shift together IF the color does).
  fogDensity: 0.00002, // was 0.000016
  // Round 8 (P4) "moonlit" key light: a cool high moon replaces the round-7
  // neutral fill. moonDirection is a high NW moon (long NE shadows); the
  // <directionalLight> AND the shadow-follow rig read it for toy via
  // MOODS.toy.lightDir instead of SKY.sunDirection. Essentially unit length
  // already (|v| ≈ 0.9994); the rig scales it ×2500 so the tiny slack is moot.
  moonDirection: [0.42, 0.6, -0.68],
  sunIntensity: 1.25, // moonlight key (round 7 was 1.05, flat neutral fill)
  sunColor: '#c8d4ff', // cool moonlight (was #e8edff)
  hemiSky: '#3d4670',
  hemiGround: '#1a1f38',
  hemiIntensity: 0.42, // lowered (was 0.55) so the directional moon shapes read
  envIntensity: 0.12,
  saturation: 0.05, // HueSaturation boost (0 = neutral)
  contrast: 0.08, // BrightnessContrast boost
  // Round 8 (P4): eased down — the city now EMITS far more (roof crowns,
  // window grids, monuments), so a lower bloom avoids blowing out to white.
  bloomIntensity: 0.9, // was 1.05
  bloomThreshold: 0.56, // was 0.52 — neon values still clear it; ground never does
  // Diorama camera (toy only): shallow tilt-shift band around the player
  dofFocusM: 700, // world units to the sharp band
  dofRangeM: 2600, // sharp band depth; blur grows beyond
  dofBokeh: 2.6,
  grainOpacity: 0.06,
  // Round 8 (P4): the player-following toon shadow is now ON — the moonlit key
  // casts readable long shadows over the neon city (the near-black ground
  // reads them against the lit facades; a new camera surface exposed how flat
  // the shadowless look was). The castShadow gate at FlyScene already carries
  // `qualityTier !== 'low'`, so LOW auto-disables the ~50-draw shadow pass with
  // no extra code. shadowMapSize is tier-gated: 2048 high-only (P7), 1024 on
  // medium (low = shadows off, so its size is moot).
  shadows: true,
  shadowMapSize: { medium: 1024, high: 2048 },
  shadowRadiusM: 800, // ortho half-extent around the player
  // Round 8 (P4) depth haze (aerial perspective): distant ground mixes toward
  // this cool haze color across [startM, endM] in the SHARED base fade patch
  // (world-bend.js), BEFORE the rim edge-fade. endM (13km) sits UNDER the toy
  // 14km fade band so the rim gates still hold. Off (max 0) outside toy.
  haze: { startM: 4000, endM: 13000, color: '#1a2246', max: 0.45 },
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
  // Round 12 "Neon Planet": 4th ring — ultra-far real geography (water/
  // landuse/major roads, NO buildings; the worker aliases 'ultra'→'far') so
  // the altitude-extended fade band (WORLD_EDGE.altHorizon) fades over real
  // world instead of exposing the void grid. Radius is DYNAMIC:
  // max(rings[2].r, liveBandEnd × slack) — at low altitude every z10 seed
  // tile descends into ring 3 and the desired set is byte-identical to
  // round 11. ONE hysteresis switch (on/offEndM vs the SMOOTHED band end)
  // flips BOTH this ring on and the z14 'full' ring down to fullShrinkR —
  // they pay for each other in the draw budget (you can't see building
  // detail from 4km+ AGL; the freed ~130 draws fund ~40-72 ultra draws).
  // slack ≥1.1 is a CORRECTNESS knob: it keeps the toy-chunk (elev×1.7)
  // → base-tile (true DEM) relief seam inside the 100%-faded zone.
  ultraRing: {
    enabled: true,
    z: 10,
    slack: 1.1,
    onEndM: 40000, // arm when the smoothed band end exceeds this (~13k ft)
    offEndM: 34000, // …disarm below this (6km hysteresis; no flapping)
    fullShrinkR: 4000, // z14 'full' ring radius while armed (8000 disarmed)
  },
  gridSegments: 12, // per-chunk elevation drape grid (12 → 13×13 samples)
  groundLift: 2.5, // toy ground plane rides this far above the tile mesh
  terrainExaggeration: 1.7, // toy relief drama (flight floor uses TRUE DEM)
  // Round 8.5 (H1): toy draws terrain at elev×1.7+2.5 but airborne traffic
  // flies at TRUE altitude — over relief planes read up to 0.7×elev too low
  // against the drawn ground (at a 600m-elevation field: ~420m). When true,
  // FlyScene feeds the traffic engine a render-lift sampler
  // (drawnGround − trueGround under each track) and every VISUAL consumer
  // reads the lifted track.ryd instead of the true track.ry — see
  // TRAFFIC.renderLiftRefreshSec. Player flight model / HUD AGL / data
  // readouts (alt ft, geo) stay TRUE-DEM. Satellite path is byte-identical
  // (lift 0). Flip false for a one-reload A/B.
  airFrameFollowsDrawnGround: true,
  buildings: {
    maxPerChunk: 700,
    maxPerChunkMid: 180,
    // Round 8 (P1) height mapping — real spread instead of a flat [9,90] clamp
    // that squashed a 541 m supertall to 90 m and made everything one height.
    minH: 9,
    smallBoostH: 15, // only true low-rises get the boost (was h<20 × 1.6)
    smallBoost: 1.35, // gentler than 1.6 — the old value inflated whole blocks
    kneeM: 110, // above the knee, height compresses instead of hard-clamping
    kneeSlope: 0.75, // supertalls read AS supertalls (541 m WTC → ~330 m)
    maxH: 330, // hard ceiling after the soft knee
    maxFootprintM2: 60000, // merged city blocks above this stay flat ground
    baseSinkM: 2.5, // walls extend below ground — no hover on draped slopes
    // Round 8 fix round (review A): the district-inference knobs, promoted
    // from vector-tile.worker.js literals so taste checkpoint 1 (height
    // knee + inferred downtown heights) is fully live-tunable. Per chunk:
    //   districtK = clamp(count(rawH ≥ tallMinH) / tallDiv, 0, 1) × 0.6
    //             + clamp(footprintCover / coverDiv, 0, 1) × 0.4
    // Missing-height inference (rawH 0 — note the worker treats the
    // tileset's synthesized render_height 5-with-no-height-tag as missing):
    //   lo = loBase + hash × loJit   (suburb jittered houses)
    //   hi = hiBase + hash × hiJit   (downtown inferred mid-rises)
    //   h  = lo + (hi − lo) × districtK × clamp(areaM2 / areaDiv, 0, 1)
    district: {
      tallDiv: 25, // tagged-tall count that saturates the "downtown" read
      coverDiv: 0.25, // footprint-cover fraction that saturates it
      tallMinH: 40, // tagged height (m) that counts as "tall"
      areaDiv: 1200, // footprint m² that saturates the big-lot inference
      loBase: 9,
      loJit: 6,
      hiBase: 18,
      hiJit: 46,
    },
  },
  trees: { maxPerChunk: 220, areaPerTreeM2: 2400, minR: 3.5, maxR: 7.5 },
  grass: { maxPerChunk: 320, areaPerM2: 900, minR: 1.4, maxR: 3.2 },
  maxBuilds: 6, // concurrent worker builds (fetch RTT dominates, not parse)
  finalizePerFrame: 2, // chunk GPU uploads per frame (spike guard)
  drapeBudgetMs: 1.5, // ms/frame spent sampling DEM for pending chunks
  // Minimum DEM tile zoom that must answer before a chunk's drape commits —
  // coarse fallback tiles produce wrong-height slab chunks otherwise.
  // Round 12: ultra chunks (z10, 40-120km out) accept the coarse DEM the
  // three-tile quadtree actually holds at that range — requiring z8 would
  // hold them ~30s (drapeMaxTries) for tiles that never stream.
  demZByDetail: { full: 11, mid: 9, far: 8, ultra: 7 },
  drapeMaxTries: 20, // ~30s of holding before accepting a coarse drape
  // Round 6: right after a long warp, accept a coarse drape after ~4.5s
  // instead of 30 — the world appears fast and the existing heal path
  // re-drapes chunks once real DEM streams in.
  warpCoarseTries: 3,
  warpCoarseWindowSec: 20,
  refreshMoveM: 600, // recompute the desired chunk set after moving this far
  refreshSec: 2, // …or at least this often
  // Round 12: 120→160 — the climb transient (full ring not yet shrunk +
  // ultra ring filling ≈ 113 desired) must not let the nearest-win cap trim
  // exactly the ultra ring's outer tiles (they sort last by distSq).
  maxChunks: 160, // hard cap; nearest win
};

// Round 13 Phase 3 — CENTERPIECE: 3D extruded buildings in SATELLITE. The toy
// vector worker already fetches OpenFreeMap building polygons WITH heights,
// tessellates + extrudes + roofs them; satellite simply never mounted that
// layer (cities are flat photo-decals at the altitudes the user flies). A new
// worker `detail: 'sat-buildings'` mode runs ONLY the building extrusion (no
// roads/land/water/neon attrs → lean, merged, one draw per chunk) and a
// purpose-built lean streaming manager (SatBuildingEngine — NOT ToyWorldEngine,
// so window.__toyWorld is never defined in satellite: verify-round11 gate A) drapes
// them on RAW DEM (LandmarkMonuments R11 pattern, no ×1.7 toy exaggeration).
// Materials are neutral daylight concrete/tan tones (NOT toy neon) on a
// MeshLambert lit by the SCENE's single day sun + hemi + env — the proven
// LandmarkMonuments-satellite model, so buildings read as daylight stone, not
// glow. That single directional is the ONLY sun on the geometry (no ADDED
// hillshade term), so there is no "double-sun" over the already-lit imagery —
// the plan's cap-0.6 warning is honored by construction, and DoubleSide lets
// three flip back-face normals via gl_FrontFacing so every wall shades correctly
// despite the worker's inconsistent ring winding (a custom dot(normal,uHillDir)
// term can't: the geometric normal is unreliable there). Rigid geometry ⇒ a NEW
// anchor-bend variant (per-building drop from a footprint-centroid attribute;
// per-vertex bend would SHEAR each box — R6 lesson).
//
// BYTE-NOOP when enabled:false — no worker request, no engine, no draws, no
// globals (verify-sat-buildings asserts it). enabled:false is the one-line
// revert for USER CHECKPOINT #2 (prototype flight sign-off; see FLY_ROUND13).
export const SAT_BUILDINGS = {
  enabled: true, // shipped default (tier-gated high/medium); flip false = full revert
  minTier: 'medium', // low tier: no buildings (perf floor — mirrors the toy shadow rig)
  // Single z14-class ring around the player. r in WORLD (mercator) units
  // (≈ true m × 1/cos lat; at NYC 3600u ≈ 2.7km). maxChunks hard-bounds the
  // building draw count (one merged draw per non-empty tile) regardless of city
  // density — measured worst case = Manhattan 2.6k ft (FLY_ROUND13 §Phase3).
  ring: { z: 14, r: 3600 },
  maxChunks: 12, // hard nearest-win cap → ≤12 building draws over dense downtown
  maxBuilds: 4, // concurrent worker builds
  finalizePerFrame: 1, // chunk GPU uploads per frame (spike guard)
  drapeBudgetMs: 1.0, // ms/frame drape sampling (one getGroundAt per building)
  demZ: 12, // min DEM tile zoom before a building's drape commits; below it the
  // chunk holds + retries (a coarse tile draping a hilly city floats/sinks buildings)
  drapeMaxTries: 20, // ~30s holding before accepting a coarse drape
  warpCoarseTries: 3, // right after a warp, accept a coarse drape fast (destination pops)
  warpCoarseWindowSec: 20,
  refreshMoveM: 600, // recompute the desired chunk set after moving this far
  refreshSec: 2, // …or at least this often
  baseSinkM: 6, // walls extrude BELOW the anchor ground so slope/hill gaps hide
  maxPerChunk: 500, // per-tile building cap (nearest-by-area kept)
  minH: 6, // floor height (m) — daylight low-rises sit a touch lower than toy's 9
  // Roof detail (daylight realism): geometric gables/parapets/HVAC read as real
  // rooftops. Emissive crowns/spires + rooftop beacons are NEON-night only —
  // skipped here (they'd look wrong on daytime imagery + need the neon attrs).
  roofDetail: true,
  // Altitude gate (buildings are invisible from cruise — do not stream them at
  // FL300; mirrors the toy ultra-ring hysteresis). Below cullAglOnM the ring is
  // live; above cullAglOffM every chunk evicts → 0 building draws. Hysteresis so
  // a hover near the boundary never flaps the desired set.
  cullAglOnM: 2200, // stream buildings below this eye-AGL (~7,200 ft)…
  cullAglOffM: 2800, // …evict above (600m hysteresis)
  // Neutral daylight tones (hash-picked per building so blocks don't read as one
  // extruded slab). Concrete/tan/glass GRAYS only — a toy-neon tint on real Esri
  // imagery reads as a bug, not a look (the monument-satellite lesson).
  // Round 15: 6 → 10 entries (warmer brick + cooler glass ends) — still all
  // believable daylight masonry/concrete/curtain-wall.
  // ROUND 18 (A1) — MEASURED re-tune. R13 §8 flagged "wallTones reads dark/
  // charcoal against the bright imagery" and nobody ever moved the knob: a
  // downtown block read as a charcoal cut-out punched into pale Esri photo.
  // Each entry is lifted ≈ +18% in luma with a WARM tilt (×1.205 R, ×1.180 G,
  // ×1.145 B) — mean luma 137.5 → 162.8 — so masonry sits IN the imagery's
  // exposure instead of under it. The hue relationships (brick end ↔ glass
  // end) are preserved; only value and a touch of warmth moved.
  // OLD (R15) VALUES, for the record — and live, verbatim, in
  // ROOFS_SAT.legacyTone (the enabled:false revert reads them from there):
  //   '#8f8b82', '#83807a', '#98948a', '#7c7f83', '#8a867d',
  //   '#909499', '#a1968b', '#6f7276', '#9aa0a6', '#8b7d70',
  wallTones: [
    '#aca495', '#9e978c', '#b7af9e', '#959696', '#a69e8f',
    '#aeafaf', '#c2b19f', '#868787', '#babdbe', '#a79480',
  ],
  wallJitter: 0.1, // ± per-building brightness jitter on the picked tone (breaks repeats)
  // Round 15 fake AO, baked into the EXISTING wall verts (zero new geometry):
  // the bottom ring darkens (street grime / ambient occlusion at the ground
  // contact) and the top ring lifts a hair (sky bounce on the roofline). A
  // SHORT building gets the strong gradient over its whole face; a tower would
  // read as one huge vertical ramp, so the base multiplier eases toward
  // wallBaseMul[1] as height → wallBaseRefM.
  // Round 18 (A1): [0] 0.5 → 0.62. Halving a house's base tone was the other
  // half of the "dark blocks" read — a 2-story suburban house is base-heavy
  // (the ramp covers its whole face), so at 0.5 the entire house went dim.
  // 0.62 keeps a legible grime gradient without dragging the mean down.
  wallBaseMul: [0.62, 0.8], // [short building, tall building] bottom-vertex multiplier (R15: [0.5, 0.8])
  wallBaseRefM: 55, // height (m) at which the base darkening reaches the weak end
  wallTopGain: 1.06, // top-vertex lift (sky bounce along the roofline)
  // Round 15 — ROOFS THAT READ. R13 painted every roof `wall × 0.82`, so from
  // any airborne view a downtown block was one extruded slab (user: "no ROOFS
  // even"). Roofs now own their palette, hash-picked per building on a SEPARATE
  // seed from the walls and BANDED by height: houses wear shingle/terracotta/
  // tile, mid-rises tar + gravel + the odd green (garden/patina), towers dark
  // membrane or a white cap. Daylight-believable only — same no-neon rule.
  roofTones: {
    lowMaxH: 16, // ≤ this = house band (matches ROOFS.gable.maxH — the pitched ones)
    tallMinH: 45, // ≥ this = tower band
    // Spread ≈ 6× in albedo (dark tar → pale membrane) — the CONTRAST between
    // neighbours is what makes a block read as individual roofs. Deliberately
    // stops short of near-black: an 0.04-albedo roof punches a hole in bright
    // Esri imagery (the R13 "dark reads as a cutout" lesson, inverted).
    // Round 18 (A1): `low` (the house band) is UNCHANGED — shingle/terracotta
    // already read warm and bright. `mid`/`tall` take a modest ≈ +10% value
    // lift (×1.11 R, ×1.10 G, ×1.09 B; mean luma 102.6 → 113.2 and 102.5 →
    // 112.9): flat commercial/tower caps are the largest UP-FACING area an
    // airborne player sees, and at R15 values they were the darkest thing in
    // frame. Verbatim old values live in ROOFS_SAT.legacyTone.
    //   mid  (R15): '#4e4b47', '#5f5a52', '#6e6a60', '#8e897c', '#4f6153', '#7b7166'
    //   tall (R15): '#454341', '#565350', '#68645c', '#9a968b', '#736f68'
    low: ['#8c5a42', '#7a4c3a', '#a4694b', '#6d675c', '#9c9384', '#5c6552'],
    mid: ['#57534d', '#696359', '#7a7569', '#9e9787', '#586b5a', '#897c6f'],
    tall: ['#4d4a47', '#5f5b57', '#736e64', '#aba598', '#807a71'],
  },
  roofJitter: 0.14, // ± per-building brightness jitter on the picked roof tone
  parapetGain: 1.16, // the raised lip catches sun — brighter than the roof field it rings
  hvacTone: '#6f7479', // galvanized clutter; reads against tar AND against a white cap
  hvacGain: 1.15, // …plus this lift (R13 used PALETTE.roofHvac ×1.6, a blue-gray)
  // Round 15 — FACADE WINDOWS. The worker emits a `uv` attribute in FACADE
  // METERS (u = run along the wall / uPeriod, centered per wall so both corners
  // cut symmetrically; v = height above the anchor ground / vPeriod, so floors
  // line up across neighbours) and the engine builds ONE procedural CanvasTexture
  // window atlas as the shared Lambert `map`. Roof + roof-detail verts ALL carry
  // the same constant uv (0.25, 0.25): a constant uv over a triangle has zero
  // screen-space derivative → those fragments always sample mip 0, and (0.25,
  // 0.25) is the middle of a solid-WHITE pier crossing → roofs come out of the
  // texture EXACTLY unchanged at every distance. ZERO extra draws (same merged
  // mesh, same material); the cost is one extra texture fetch per building
  // fragment, which is why it is tier-gated.
  facade: {
    enabled: true,
    minTier: 'medium', // ≥ medium (the layer itself already needs medium+)
    texSize: 512, // atlas px, square + mipmapped
    cols: 8, // window columns per atlas tile → u period = cols × colPitchM
    rows: 8, // floors per atlas tile → v period = rows × floorHM
    colPitchM: 3.3, // facade meters per window column
    floorHM: 3.4, // meters per floor
    // Shared worker↔engine contract: the uv every roof/detail vert carries. MUST
    // land on a cell boundary (neutralUV × cols and × rows both integral) so it
    // sits in the middle of a pier crossing, paneInset × cell px clear of any
    // pane in BOTH atlas paintings (white by day, ambientFloor by night).
    neutralUV: 0.25,
    paneInset: 0.18, // pane inset inside its cell (frac) = pier/spandrel width
    paneDark: '#727d8a', // darkest glazing (multiplies the wall tone — never brightens)
    paneLight: '#bcc5d0', // lightest glazing (sky-reflecting pane)
    mullion: '#8e8981', // frame/divider lines drawn inside each pane
    skyGrad: 0.12, // top-of-pane sky-reflection lift (frac)
    anisotropy: 4, // matches the R11 satellite imagery perf floor
    seed: 20260724,
  },
  // Round 15 — NIGHT WINDOWS (high tier only). The SAME atlas layout, painted
  // emissive: lit panes on a near-black ground, structured as whole lit/dark
  // FLOORS × per-cell runs (the R8 window-grid lesson: a uniform grid reads
  // fake). It rides the existing material as `emissiveMap`; the layer drives
  // `emissiveIntensity` per frame off runtime.sun.frac (satellite's R13 day
  // cycle) so cities light up as the sun goes down and cost literally nothing
  // at noon (intensity 0). The roof neutral texel is the ambientFloor gray, so
  // roofs never grow windows — they just stop being pure black at midnight.
  night: {
    enabled: true,
    minTier: 'high', // strict — the second texture fetch is a top-tier flourish
    dayFrac: 0.3, // sun.frac at/above which windows are fully dark
    gamma: 1.5, // ramp shape (>1 = stays dark through dusk, then comes up)
    intensity: 1.3, // emissiveIntensity at full night
    color: '#ffd9a3', // interior-light tint (multiplies the atlas)
    litFloorFrac: 0.7, // fraction of FLOORS that are lit at all
    litCellFrac: 0.55, // within a lit floor, fraction of panes lit
    coolFrac: 0.22, // of the lit panes, this fraction is fluorescent-cool
    ambientFloor: 0.1, // atlas background (0-1) — lifts night roofs/piers off pure black
    seed: 71441, // separate seed from the daylight atlas (different lit pattern)
  },
};

// Round 13 Phase 4 — SATELLITE water glint. Dead water (rivers/harbors read as
// concrete) gets a specular-only sparkle overlay: worker-extracted water polygons
// (WORKER_PROTOCOL 11, out.satWater — sentinel-safe: a stale worker returns no
// satWater key → no water mesh, no crash) streamed on the SAME SatBuildingEngine
// z14 ring, one merged additive MeshPhong mesh per water chunk. The three.js
// waternormals.jpg (MIT, downscaled 512) ripples the surface normal; the scene
// day sun drives Blinn-Phong specular so glints track the sun; additive blending
// keeps it specular-only (near-black diffuse adds nothing over the imagery). Per-
// vertex bend (world-bend applyBendWaterSat). STRICT tier gate — high only (a
// flourish, not a base-cost). enabled:false = byte-noop (engine never builds it).
export const SAT_WATER = {
  enabled: true,
  minTier: 'high', // strict — glint streams only at the top quality tier
  normalMap: '/textures/waternormals.jpg', // three.js (MIT); downscaled to 512
  rippleM: 55, // world-meter period of one normal-map tile (swell size from altitude)
  specular: '#bcd6ff', // cool daylight sun-glint tint (specular color = glint brightness)
  shininess: 210, // tight highlights (sparkle, not a broad sheen)
  normalScale: 0.55, // ripple normal perturbation strength
  opacity: 0.9, // additive glint strength (× the specular term)
  scrollMps: 0.018, // normal-map uv scroll (uv/sec) — gentle shimmer
  liftM: 2.5, // sit just above the imagery water surface (depthWrite off anyway)
  maxWaterChunks: 12, // hard bound on water draws (mirrors SAT_BUILDINGS.maxChunks)
  // Round 18 (A1) — the SAWTOOTH FIX (R13 §5 / R18 plan §0.4). OpenFreeMap
  // 404s tiles that are nothing but open water, so over the Hudson/NY Bight
  // the glint stopped dead at a straight tile boundary and resumed at the
  // next one: a hard sawtooth edge running across the harbour. A 404 tile is
  // now recorded as an OCEAN CANDIDATE rather than plain-empty, and if at
  // least `neighborMin` of its 4 ring-neighbours reported `waterCoverage ≥
  // coverageMin` (the worker's new per-tile water-area ratio) the engine
  // synthesizes ONE full-tile quad (2 tris, tiled uv, the SAME shared glint
  // material) at the neighbours' average water Y. Two independent guards keep
  // this honest: it needs REAL neighbouring water data to fire (a desert tile
  // that 404s has no wet neighbours), and it is counted inside
  // maxWaterChunks, so it can never add a draw beyond the existing bound.
  // High tier only (it rides SAT_WATER.minTier) ⇒ zero effect on Owens
  // Valley, phones or toy. enabled:false = the R13 behaviour exactly.
  oceanFill: { enabled: true, neighborMin: 2, coverageMin: 0.6 },
};

// Round 16 (A2 "GND-W") — the SATELLITE GROUND-LIGHT NETWORK. Diagnosis: the
// worker's satellite path parsed ONLY `building` + `water`; the OMT
// `transportation`/`aeroway` layers in the SAME tiles were discarded, so every
// ground-light system (ROAD_PULSE / RUNWAY_LIGHTS / TOWN_GLOW / BEACONS) was
// toy-only and night satellite was a black void under the (hard-culled)
// building windows. A NEW worker detail `'sat-roads'` (WORKER_PROTOCOL 13)
// ribbon-extrudes the road network flat at y=0 with a per-vertex CLASS code +
// cumulative TRUE-METER arc; SatRoadEngine drapes each chunk on a bilinear RAW-
// DEM grid (no toy exaggeration) and draws it as ONE additive merged mesh per
// chunk. Every light is a FRAGMENT term on that one draw (world-bend
// `applyBendRoadSat`) — the sun drives UNIFORMS ONLY, so the draw count is
// identical at noon and midnight (what verify-sat-depth measures cannot move
// with the clock).
//
// DRAW BUDGET: ≤ maxChunks draws, and a chunk under `minFeatures` returns EMPTY
// from the worker (0 draws, no tessellation). `minFeatures` / `ring.r` /
// `maxChunks` are THE shed levers for verify-sat-depth's ≤261 at Owens Valley
// (US-395 + CA-136 + the Lone Pine grid are in that scene). enabled:false =
// byte-noop (the component never mounts: no worker, no engine, no draws).
export const SAT_ROADS = {
  enabled: true, // flip false = full revert (no mount, no worker detail request)
  minTier: 'medium', // low tier: no road network (perf floor — mirrors SAT_BUILDINGS)
  // z13 ring — deliberately NOT the z14 building ring: no tile-URL overlap (the
  // two layers stream disjoint zoom levels, so neither competes for the other's
  // fetches) and one z13 tile carries the whole local road web. r is in WORLD
  // (mercator) units ≈ true m × 1/cos lat (at Owens Valley 12000u ≈ 9.6 km).
  ring: { z: 13, r: 12000 },
  maxChunks: 16, // hard nearest-win cap → ≤16 road draws (SHED LEVER)
  maxBuilds: 2, // concurrent worker builds (roads share the layer's own worker)
  gridSegments: 16, // per-chunk bilinear drape grid → 289 getGroundAt samples
  drapeBudgetMs: 1.0, // ms/frame drape sampling
  demZ: 12, // min DEM tile zoom before a drape commits (below it: hold + retry)
  drapeMaxTries: 20,
  warpCoarseTries: 3, // right after a warp, accept a coarse drape fast
  warpCoarseWindowSec: 20,
  refreshMoveM: 900, // recompute the desired chunk set after moving this far…
  refreshSec: 2, // …or at least this often
  liftM: 5, // ribbons sit this far over the draped DEM (additive, depthWrite off)
  // Altitude gate with hysteresis — the network is a low/mid-AGL read (from
  // cruise it is sub-pixel noise). Higher than the building ring on purpose: a
  // city's light NETWORK stays legible far above the altitude its individual
  // buildings stop reading at.
  cullAglOnM: 4200,
  cullAglOffM: 5200,
  // Decimation (TRUE meters — the worker divides local mercator lengths by k):
  // OMT polylines carry far more vertices than a 6 m-wide glowing ribbon needs.
  minSegM: 20, // drop points closer than this to the last KEPT point
  maxSegM: 250, // …but subdivide longer runs, or the drape can't follow relief
  maxVertsPerChunk: 24000, // class-priority fill: motorways first, minor dropped first
  minFeatures: 0, // chunks with fewer accepted chains return EMPTY (SHED LEVER)
  // Ribbon width (true m) + the per-vertex class CODE. Code 0 is RESERVED and
  // never emitted: a missing aRoadCls attribute reads 0 on the GPU → LUT index
  // 0 → class weight 0 → black → invisible under additive blending (fail dark).
  // R16 sweep calibration (Fable): street classes widened from 13/9/6.5 —
  // at the certified 2.6k ft eyeball pose the thin ribbons vanished behind
  // building occlusion and ACES compression (measured A/B Δ 0.70/255; the
  // design intent is "glowing arteries + lit blocks", and only the blocks
  // read). Arteries were already wide enough.
  classes: {
    motorway: { w: 26, cls: 1 },
    trunk: { w: 22, cls: 2 },
    primary: { w: 18, cls: 3 },
    secondary: { w: 16, cls: 4 },
    tertiary: { w: 12, cls: 5 },
    minor: { w: 9, cls: 6 },
  },
  // Baked vertex hues: cool halide arteries, warm sodium streets, the classic
  // warm-white runway edge. (cls 1-3 = artery, 4-6 = street, 7 = runway.)
  colors: { artery: '#dfe9ff', street: '#ffb066', runway: '#ffe9c4' },
  // NIGHT terms. dayFrac/gamma are the EXACT SAT_BUILDINGS.night ramp shape, so
  // the road network and the building windows come up together at dusk.
  night: {
    dayFrac: 0.3, // sun.frac at/above which the network is fully dark
    gamma: 1.5, // >1 = holds dark through late afternoon, arrives at dusk
    // 1.15 → 2.4 (R16 sweep, Fable): at 1.15 the network was invisible at the
    // certified pose — window emissive carried the whole city. Live-tunable;
    // the night look is a user checkpoint.
    intensity: 2.4, // steady network glow at full night
    streetSpacingM: 42, // lamp-post period on cls 4-6 (exp dots, not a solid tube)
    dashLenM: 420, // headlight dash-train wavelength on cls 1-3
    dashDuty: 0.3, // fraction of the wavelength that is lit
    dashSpeed: 0.1, // wavelengths per second (traffic streaming)
    streamBoost: 2.4, // dash brightness over the steady glow (1.8 → 2.4, same pass)
  },
  // DAY: the network is otherwise invisible over daylight imagery — a faint,
  // fast glint dash on the two biggest classes is the only daytime motion.
  day: { glintIntensity: 0.35, dashLenM: 160, dashDuty: 0.05, dashSpeed: 0.15 },
  // Runway edge lights (cls 7) — the worker walks the aeroway centerline and
  // bakes paired light quads + threshold bars into the SAME arrays (0 extra
  // draws), the satellite port of the round-7 toy pushRunwayLights.
  // sizeM 1.9 → 2.6, boost 2.2 → 3.4 (R16 sweep, Fable): the paired edge
  // quads are sub-pixel sparks at approach height — they must READ as a lit
  // runway from a 700 m pattern.
  runway: { spacingM: 60, sizeM: 2.6, offsetM: 3, boost: 3.4, chase: 0 },
};

// Round 16 (A2) — SATELLITE BUILDING CULL FADE. R13 hard-evicted the building
// ring at SAT_BUILDINGS.cullAglOffM, so a climb through ~2.8 km POPPED a whole
// downtown out of existence in one frame (FLY_ROUND13.md CP#2). The ring now
// stays live to `evictAglM` while a Bayer-4 SCREEN-DOOR dither (a `discard` in
// the existing anchor-bend fragment — no new draws, no new material, no
// transparency sort) thins the buildings to nothing across
// [fadeStartAglM, fadeEndAglM]; eviction happens only AFTER they are already
// invisible. Re-arm on descent is unchanged (SAT_BUILDINGS.cullAglOnM).
// enabled:false → legacy hard evict, uniform pinned 1 = byte-identical R15.
export const SAT_BLDG_FADE = {
  enabled: true,
  fadeStartAglM: 2400, // fully solid below this eye-AGL
  fadeEndAglM: 3000, // fully dithered away by here
  evictAglM: 3200, // …and only THEN does the ring drop the chunks
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
    // Round 8.5 (H2): match satellite. Toy's 80km curve was 25% stronger —
    // low/mid-band traffic (AGL 150–900m keeps the FULL d²k drop) and
    // contrail far-tails curved down visibly harder than satellite, part of
    // the "satellite feels better with the height of planes" gap.
    toy: 100000,
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
    // Round 7 (user report: "aircraft ABOVE our altitude appear below/at the
    // horizon"): perspective compresses altitude at range — FL300 at 30nm is
    // only ~2° above the horizon even with no bend. Arcade fix: the cap
    // ramps into a LIFT with distance, so far traffic EXAGGERATES its height
    // above the player (× farLiftBoost at/past liftFarM). Near traffic
    // (formation, warp arrivals) stays physically true below liftNearM.
    // Contrails/labels/models all ride the same formula (GPU + CPU mirror).
    liftNearM: 3000, // world-m distance where the lift starts ramping in
    liftFarM: 20000, // …fully in past this
    farLiftBoost: 2.5, // far height-above-eye multiple (1 = true altitude)
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
  // ONE rim color per style (round 6): scene fog, the ground edge-fade
  // target AND the sky dome's below-horizon band all read THIS color, so
  // the bent terrain melts into the same tone the sky presents at the rim.
  // (Pre-round-6 the three diverged in night/toy — fog #0e1630 / fade
  // #02030a / dome #16224a — leaving a hard black band where ground met
  // sky. Satellite was already unified, which is why Day looked right.)
  rim: {
    satellite: '#c6d7e8', // = SKY.fogColor
    night: '#0e1630', // = NIGHT.fogColor
    toy: '#1a2246', // = TOY.fogColor (= TOY.haze.color — round-8 fix round)
  },
};

// Round 11: per-aircraft horizon fade (user: low far traffic read as BURIED
// once satellite's far-visible terrain became the default — a 2,000ft GA at
// 28nm is realistically beyond the horizon, but it was drawn ON the distant
// farmland). A plane stays visible while its world-XZ distance is inside the
// COMBINED horizon D = sqrt(eyeAlt/k)·playerFrac + sqrt(planeAlt/k)·planeMul
// (k = the live altitude-flattened bend uniform — same sqrt(alt/k) family as
// LETTERS' horizon cull, so the fade radius grows with cruise altitude for
// free). planeMul mirrors GLOBE.trafficBend.farLiftBoost: far HIGH traffic is
// deliberately lifted above the rim, so its own horizon term gets the same
// boost (FL370 at 42nm stays visible; the low GA melts out). Computed ONCE
// per aircraft CPU-side (TrafficLayer) and folded into the EXISTING fade
// channels of sprites, models, tracers and DOM labels — no new shader
// uniform, so there is no GPU/CPU mirror to keep in sync.
export const TRAFFIC_HORIZON = {
  enabled: true,
  playerFrac: 1.0, // × the player's own horizon distance
  planeMul: 2.5, // × the plane's horizon term (= trafficBend.farLiftBoost)
  fadeStartFrac: 0.95, // fade band: [D·start, D·end] of the combined horizon
  fadeEndFrac: 1.2,
  minVisM: 30000, // never fade inside this range (matches LETTERS.minVisM)
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
  // Round 12 "Neon Planet" (user, 2026-07-18): at cruise the static toy band
  // above painted REAL streamed world into the rim by 26km while the letters,
  // traffic and curvature all already scale with altitude — everything past a
  // small disc was the void grid ("toy plane over graph paper"). The band now
  // BREATHES with altitude in toy: END = max(fade.toy.endM, min(maxM,
  // sqrt(eyeAGL / liveK) · frac)) — the LETTERS/TRAFFIC_HORIZON sqrt(alt/k)
  // family, so the visible world grows exactly as altFlatten flattens the
  // globe. START tracks at fade.toy.startM + (END − fade.toy.endM) ·
  // startGrow, and the round-8 haze end rides START × (haze.endM /
  // fade.toy.startM) so "haze end < fade start" holds at every altitude.
  // Below ~7,900ft the floor clamps END to exactly fade.toy.endM — the
  // low-altitude Neon look is byte-identical (verify-neon-city's contract).
  // FlyScene damps the target (expApproach, smoothSec) and writes it into
  // the LIVE uEdgeFade uniform; getEdgeFade() (world-bend.js) is the single
  // source of truth every consumer reads (sky dip, ultra ring, VoidFloor,
  // TownGlow, clouds, harness stats) — round-11 lesson: never let three
  // consumers pin three different constants.
  altHorizon: {
    enabled: true,
    // Round 13 Phase 1: satellite flipped ON — the -50 per-frame band writer
    // now runs for satellite too, driving the SKY.altAtmo rim triple + aerial
    // haze + fog-density falloff (the toy branch of that block is unchanged and
    // byte-stable; satellite takes its own SKY-based branch). Was `satellite:
    // false // sat = round-11 certified` through R12.
    byStyle: { toy: true, satellite: true, night: false },
    frac: 1.2, // band END = sqrt(eyeAGL / liveK) × this
    startGrow: 0.6, // band START grows at this fraction of the END extension
    maxM: 110000, // ceiling: inside the floor's gridFadeEndM / disc melt
    smoothSec: 1.5, // expApproach time constant — no band pops in a dive
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
    // Round 8 fix round (dark horizon band): at typical flying altitudes the
    // line of sight passes OVER the terrain's apparent silhouette (~10km at
    // 2000ft) and the huge stretch of floor beyond it (45–235km) filled the
    // whole gap between city and sky with fog-free near-black — a hard dead
    // band that buried the rim glow. The floor now converges toward the
    // style's RIM color with the SAME exp2 falloff scene fog uses (radial
    // distance from the player), so the far floor reads as the luminous
    // horizon haze the terrain and dome already share. Multiplier on the
    // style's fogDensity; 0 restores the round-7 black-void floor.
    rimFogScale: 1.0,
    // Round 12: the grid is the low-altitude void signature — at cruise the
    // altitude-extended band covers the world with real ground and the grid
    // must not read through it. Grid alpha fades on the band's EXTENSION
    // (liveEnd − staticEnd), not an absolute distance — night's static 34km
    // band extends by 0 and stays untouched. Full grid at ≤ +extStartM of
    // extension (~below 9k ft), gone by +extEndM (~18k ft).
    gridAltFade: { extStartM: 4000, extEndM: 34000 },
  },
};

// Clean airloom 3D letters standing on the terrain (all styles) — white,
// bold, no outline/pegs/sparkles. Sizes are letter heights in meters.
// Military/hotspot letters stay the same clean white (taste rule §3.8);
// their kind reads through the hover tooltip, minimap and atlas instead.
export const LETTERS = {
  // Round 10 "area feel" (user 2026-07-18, high-altitude over Ohio): a metro
  // should POPULATE around you — its suburbs and satellite towns readable near
  // AND far — so a warped mini-planet reads as "its own little area you're
  // inside of", not one lonely CITY letter. Candidacy is now generous (higher
  // max, more range, tighter separation); the per-frame HORIZON CULL in
  // PoiLetters hides only the letters that have sunk past the rim into the
  // void. Because the world FLATTENS with altitude (GLOBE.altFlatten), fewer
  // letters sink the higher you fly → more of the area appears, for free.
  // Only CITIES (and airport REACH) get the round-10 area-feel boost. The
  // other kinds stay at their round-6/8 tuning: landmark/military/hotspot
  // range, max and minDistM feed the round-6 stability contract, and bumping
  // them churned the dense NYC landmark cluster (EMPIRE STATE sub-4s blink,
  // verify-poi). The global horizon cull + farScale below still apply to every
  // kind (they are VISUAL, not selection), so far airports/landmarks stay
  // legible without destabilizing the slot picker.
  airport: { sizeM: 165, rangeM: 110000, max: 4 },
  city: { sizeM: 250, rangeM: 150000, max: 6 },
  landmark: { sizeM: 95, rangeM: 40000, max: 2 },
  military: { sizeM: 120, rangeM: 60000, max: 2 },
  hotspot: { sizeM: 85, rangeM: 35000, max: 2 },
  minDistM: 2600, // suppress a letter when practically overhead
  // Round 8 fix round: monument-bearing landmark letters (toy) float
  // letterLiftM above their monument, so they stay readable much closer in
  // — the flat 2600m floor kept STATUE OF LIBERTY unmounted at its own
  // ~1.7km hero framing (verify-monuments). Scales minDistM for them only.
  monumentMinDistK: 0.5,
  // Per-kind declutter radius (round 10): two names closer than the LARGER of
  // their two radii collide (bigger kind wins). Only CITIES pack tight (3000)
  // so a metro's suburbs coexist; every other kind keeps the round-6 4500 so
  // dense clusters (NYC monuments) stay slot-stable — a global 3000 blinked
  // EMPIRE STATE in/out (verify-poi).
  separationM: { city: 3000, airport: 4500, military: 4500, landmark: 4500, hotspot: 4500 },
  // Shown-letter sticky-sort factor: a displayed letter competes at this ×
  // distance, so a challenger must be clearly nearer (not marginally) to steal
  // its slot. Round 10 lowered 0.8→0.68 to damp the denser field's 3-way
  // landmark boundary crossings into clean one-way handoffs (verify-poi).
  stickyK: 0.68,
  popInSec: 0.55, // spring scale-in when a name appears/changes
  // Horizon cull (round 10): a letter is only DRAWN out to the visible rim —
  // horizonD = sqrt(altM / k) is the distance where the bent ground drops to
  // eye level (k = the live, altitude-flattened bend). Past horizonD·frac the
  // letter would float in the void below the world, so it is hidden (it stays
  // in its slot + runtime.poiSlots — this is purely visual, selection is
  // untouched, so letter stability is preserved). minVisM is a floor so low
  // passes still show the nearby town set (and the flicker harness stays fair).
  horizonFrac: 1.1,
  minVisM: 30000, // always draw letters at least this far (m), regardless of alt
  // Distance up-scale (round 10): grow a letter with distance toward ~constant
  // ON-SCREEN size, so a town near the (flattened) horizon stays legible
  // instead of shrinking to a speck — "clearly see the ones in the distance".
  // Ramps in early (8km) so the mid-field metro spread you see at cruise reads
  // boldly, not just the horizon fringe.
  farScale: { startM: 8000, endM: 90000, mul: 2.4 },
  // Round 13 (P4) satellite atmosphere fade: full-contrast white letters punched
  // through the aerial haze like UI stickers. In SATELLITE (only) each letter's
  // fillOpacity is multiplied by (1 − hazeCover)·horizonRamp so far names recede
  // into the same haze veil the tiles get (SKY.haze) and dissolve softly as they
  // near the horizon cull instead of hard-cutting. Toy keeps full-opacity letters
  // (certified) — no change there, so verify-poi (toy) is untouched. horizonFadeFrac
  // = the fraction of the live cull distance where the horizon dissolve begins
  // (kept high so typical near/mid letters stay fully readable).
  satAtmoFade: { horizonFadeFrac: 0.7 },
};

export const CLOUDS = {
  texture: '/textures/cloud.png', // CC0 (WickedInsignia, OpenGameArt) — self-hosted
  // Round 13 Phase 1: a distinct softer cumulus puff for the SATELLITE deck
  // (toy keeps cloud.png — pixel-stable). CC0, Kenney Particle Pack. Same
  // single <Clouds> instancer per style, so ZERO extra draws (< the +1 budget).
  textureSat: '/textures/cloud-cumulus.png',
  // Round 13 Phase 5: a 2–3-step TOON puff for the toy deck (matches the toy
  // ramp aesthetic — hard-banded alpha edges vs cloud.png's soft gradient).
  // Self-made (CC0). Same single <Clouds> instancer, so ZERO extra draws. Night
  // keeps cloud.png (pixel-stable); satellite keeps textureSat.
  textureToy: '/textures/cloud-toon.png',
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
    // Round 11: satellite band raised 900→1500 (the old low band sank distant
    // puffs under the mini-globe rim — read as "fewer, random" once satellite
    // became the default) and stretched to 4200 for a taller cumulus deck.
    // Round 13 Phase 1: satellite deck is LIT (MeshLambert — sun/hemi/env
    // shape it) with a flatter cumulus base (boundsYFrac 0.28→0.18 reads
    // flat-based, not cotton-ball). lit:true selects the material in CloudField;
    // toy/night stay unlit MeshBasic (pixel-stable).
    satellite: { enabled: true, color: '#ffffff', opacity: 0.55, altMin: 1500, altMax: 4200, countScale: 1, shadows: true, lit: true, boundsYFrac: 0.18 },
    night: { enabled: true, color: '#3c4870', opacity: 0.3, altMin: 1300, altMax: 3800, countScale: 0.6, shadows: false },
    toy: { enabled: true, color: '#333e63', opacity: 0.26, altMin: 1400, altMax: 3800, countScale: 0.5, shadows: false },
  },
  // Round 11: deterministic cumulus CLUSTERS — N hashed centers inside the
  // toroidal cell, puffs grouped on discs around them (round-robin, so the
  // quality-tier count cut thins every cluster instead of deleting whole
  // ones). Uniform hash scatter read as a fog of specks on bright imagery;
  // grouped puffs read as weather. Same hash() family — harness-stable.
  clusters: { enabled: true, count: 6, radiusM: 3200 },
  // Round 12 (toy only): at cruise the player sits far ABOVE the 1400-3800m
  // deck, but the 24km toroidal cell + 9-13.5km dissolve kept every puff
  // inside a bubble that vanished under the extended fade band — the air at
  // altitude was empty. Spread factor f = clamp(bandEnd / fade.toy.endM,
  // 1, maxF) scales the CLUSTER CENTERS, the wrap cell AND the distance
  // dissolve together (same puff count — the instanced-segment pool is the
  // budget; fading farther without scaling the wrap cell is meaningless
  // because wrap keeps puffs within ±cell/2). Puff scale rides f^sizeExp so
  // spread puffs read from altitude instead of shrinking to specks. f = 1
  // exactly at low altitude — positions numerically identical to round 11.
  // Round 13 Phase 1: satellite gets an equivalent AGL-driven spread so at
  // cruise the deck spreads out and reads as weather you are ABOVE (toy keys
  // the live band end; satellite's band is static, so it keys eye AGL directly).
  // f = clamp(1 + (eyeAGL − satStartAglM)/satPerAglM, 1, maxF); f = 1 at/below
  // satStartAglM keeps the round-11 low-AGL deck byte-identical (verify-round11
  // clouds at 1800m stay f = 1). satSmoothSec (Round 13 live fix): the raw
  // per-frame pos.y input made post-warp altitude transients whip the whole
  // deck back and forth (cluster centers multiply by f — a swing amplifies by
  // up to ±cell/2); CloudField damps the target through expApproach with this
  // time constant, mirroring the toy path's already-damped band-end input
  // (WORLD_EDGE.altHorizon.smoothSec — same value, same feel).
  altSpread: { enabled: true, maxF: 3.2, sizeExp: 0.6, satEnabled: true, satStartAglM: 4000, satPerAglM: 4000, satSmoothSec: 1.5 },
  // Round 11: sun-driven tint for the cloud material. Round 13 Phase 1: the
  // satellite deck is now MeshLambert (lit by sun/hemi/env), so this is a
  // SUBTLE chromatic bias multiplied onto the LIT result — NOT a brightness
  // ramp (the lighting carries day/night luminance now, ending the R11
  // double-apply). frac = the day cycle's 0..1 sun factor: cool (night) → warm
  // (golden hour, below warmBand) → neutral white (day). warmBand 0.45→0.25
  // fixes the live-caught salmon deck at sun frac 0.55. NOTE: warmBand overlaps
  // R11 §4 pending sign-off — surfaced to the user by the orchestrator.
  dayTint: { bright: '#ffffff', warm: '#ffe9d2', dim: '#cdd8e8', warmBand: 0.25 },
  // Day-only cloud shadows (§4.3c): one instanced pool of soft dark discs
  // riding the drawn ground under each puff (+1 draw, Day only — dark
  // styles' ground is already ink).
  shadow: {
    opacity: 0.12,
    scale: 0.85, // disc radius ≈ puff size × this
    liftM: 3, // above the sampled ground (slope clipping reads as hugging)
    minTier: 'high', // round 11: shadows are a high-tier luxury (perf floor)
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
  // Round 8 fix (F5): additive ribbons fade toward black along the tail —
  // over satellite's bright imagery the backdrop carries them, but over the
  // toy world's near-black ink they vanished once the round-8 bloom retune
  // (0.9 @ 0.56) removed the amplifier that used to save them. Per-style
  // brightness gain multiplied into the vertex colors at WRITE time
  // (TrafficTracers) — zero per-frame allocation; live-tunable.
  styleGain: { satellite: 1.0, toy: 2.0 },
  // Toy also keeps a LONGER bright section behind the head: ribbon points in
  // the top fraction of the trail are floored at half→full head brightness
  // instead of the raw pow(t,1.4) taper. 0 disables (satellite unchanged).
  headSectionFrac: { satellite: 0, toy: 0.3 },
  // Round 16 "Living World": TIME-OF-DAY tracer gain — SATELLITE ONLY.
  // Full-strength neon ribbons over daylight photography read as a toy
  // overlay on a realistic world (the round-15 live complaint); at night the
  // same ribbons ARE the sky's traffic and should carry. nightT =
  // clamp01(1 − sun.frac / dayFrac) (the same ramp shape TrafficLayer's hull
  // presence and the sat-building night mix use), the gain lerps
  // dayGain → nightGain, and the ribbon half-width narrows by dayWidthK in
  // full daylight so a dimmed trail also gets thinner instead of turning into
  // a wide grey smear.
  //
  // TOY resolves to ×1 EXACTLY (the target is a literal 1 there, and the
  // damped scalar is not even consulted) — Neon is byte-unchanged.
  //
  // HARD RULE: this is a BRIGHTNESS multiplier and nothing else. It must
  // never enter TrafficTracers' `displayAlpha * hFade <= 0.02` skip
  // predicate — the tracer gates are COUNTS (__flyStats.tracers), so dimming
  // is free but culling would silently fail them. Dim, never cull.
  sun: {
    dayFrac: 0.3, // sun.frac at/above which it is fully "day" (nightT = 0)
    dayGain: 0.38, // satellite daylight multiplier on styleGain.satellite
    nightGain: 1.45, // …and once the sun is fully down
    dayWidthK: 0.6, // ribbon half-width multiplier at full day (1 at night)
    lerpPerSec: 0.6, // exp damping — crossing the terminator eases, never steps
  },
  mode: 'ribbon', // 'ribbon' | 'streak' — one-flip A/B
  streakLenSecMax: 50, // streak mode look, unchanged (~5-12km lines)
  ribbon: {
    points: 24, // ring-buffer capacity per track (≈ 24 × 160m ≈ 3.8km trails)
    minSpacingM: 160, // record a point every this many meters of HORIZONTAL travel
    warpResetM: 2500, // fix jump > this = hard-cut that track's buffer
    widthHeadM: 24, // camera-facing width taper (wide at the plane…)
    widthTailM: 3, // …thin at the tail)
    sweepFrames: 90, // free dead-track buffers every N frames
    // Chasing a plane puts the camera INSIDE its ribbon — collapse width
    // for points near the camera so the trail never smears the screen.
    // Round 6: end raised past minSpacingM (a segment could straddle the
    // camera with BOTH endpoints outside the old 120m window = the
    // formation "slab"), and nearK now takes the min over neighbors.
    nearFadeStartM: 60,
    nearFadeEndM: 600, // full width only beyond ~0.3nm — close trails slim down

    // Round 6: instant trails. On first sighting (and after a hard cut) the
    // full ring is synthesized backwards along the track's velocity — an
    // arcade fake (user-approved) that beats 15-20s of stub grow-in.
    backfill: true,
    // A recorded step this vertical is an altitude correction, not flight —
    // hard-cut + re-backfill instead of drawing a vertical column.
    vertCutM: 400,
  },
};

// Shoreline foam animation (toy water): a bright dash train scrolling
// along the baked foam ribbons. lenM = dash wavelength along the coast;
// speed = wavelengths per second (0.25 → one dash length every 4s).
export const FOAM = {
  lenM: 180,
  speed: 0.25,
};

// Round 13 Phase 5 (NEW — Checkpoint #3 scope, additive only): toy water
// MOONLIGHT streak. Dead-black toy water gets a moonglade — a shimmering bright
// band on the water running through the player along TOY.moonDirection's
// azimuth, brightest near the player and fading out. VALUE-ONLY (a brightness
// multiply on the existing dark ink-teal water — NO hue shift), shimmering on
// the existing foam clock. Rides applyFoamLayer (toy water material only; the
// foam key bumps foam-r8 → foam-r13). enabled:false = byte-noop.
export const WATER_MOON = {
  enabled: true,
  halfWidthM: 260, // perpendicular half-width of the moonglade band (world m)
  nearM: 400, // full brightness within this radius of the player…
  farM: 9000, // …faded out by here
  boost: 0.85, // peak brightness multiply on the water (value-only)
  shimmer: 0.006, // spatial frequency of the shimmer ripple (1/m)
};

// Road traffic pulses (toy, FLY_ATLAS_REWORK §4.3a): bright dash trains
// scrolling along motorway/trunk/primary arteries — data packets in the
// neon city. Same worker-baked arc technique as the foam; zero extra draws.
// Direction alternates per feature (worker flips the arc). Minor roads
// stay quiet on purpose (taste rule: quiet grid, loud arteries).
export const ROAD_PULSE = {
  lenM: 420, // dash wavelength along the artery (m)
  speed: 0.5, // wavelengths per second
  // Round 7 (Electric Night City): arteries read as light-strands — longer,
  // brighter dashes. Pre-round-7 values were duty 0.12 / boost 1.35.
  duty: 0.18, // lit fraction of each wavelength
  boost: 1.6, // diffuse multiplier at the dash head (clears bloom)
};

// Rooftop obstruction beacons (toy). Round 8 (decision 5): kept but SUBTLE.
// The round-7 heightFrac 0.8 threshold (× maxH 330 = 264m) left beacons
// near-extinct against the new height mapping; an ABSOLUTE 150m threshold
// restores them while smaller/slower/dimmer values calm the "blinking-dot"
// read the user disliked. Baked into the building geometry — zero draws;
// the quad rides the spire tip when a building has one (P2).
export const BEACONS = {
  minHeightM: 150, // absolute tall-building threshold (was heightFrac × maxH)
  sizeM: 1.1, // beacon quad edge (m) — smaller than the round-7 1.6
  color: '#ff6b6b', // aviation-red family (hero-accent exception: skyline dots)
  rate: 0.18, // blink cycles per second (slower)
  duty: 0.25, // lit fraction of each cycle
  dim: 0.15, // brightness while off (near-black embers)
  boost: 1.3, // brightness at full on (still clears bloom, gently)
};

// Round 8 (P2) roof detail system — worker-baked geometry into the building
// draw (zero extra draws). Per-building dispatch by (height, footprint area,
// edge count, hash); per-chunk caps throttle the triangle budget. Gables cap
// small houses, parapets give flat mid/high-rises a real lip, HVAC boxes add
// rooftop clutter, crowns/spires give the skyline emissive tops. Emissive
// crowns/spire-tips encode via the aFacade role (x ≤ -1.5) — no new attrs.
export const ROOFS = {
  parapet: { minH: 18, minAreaM2: 250, heightM: 1.1, insetFrac: 0.12, maxPerChunk: 240 },
  hvac: { minH: 18, maxH: 120, maxBoxes: 3, sizeM: [2, 5.5], hM: [1.4, 3.2], frac: 0.6, maxPerChunk: 160 },
  gable: { maxH: 16, maxAreaM2: 400, riseM: [2.2, 3.6], maxPerChunk: 320 },
  crown: { minH: 90, bandM: 3.5, insetFrac: 0.1, emit: 1.6 },
  spire: { minH: 120, hFrac: [0.08, 0.18], baseR: 1.6, emitTip: 2.2 },
  // Dark contact "skirt" per building (h ≥ 20): a footprint ×1.15 dark polygon
  // baked into the LAND group at a very LOW lift (0.15 — deliberately BELOW
  // the road liftEps stack; inverse of the runway-light lesson) so towers read
  // as grounded, not floating. aArc/aGlow sentinels pushed; capped per chunk.
  skirtMaxPerChunk: 200,
};

// Round 8 (P3) "Stylized-Premium" facade window GRIDS (replaces round-7
// WINDOWS random-dot lighting the user called "horrible"). Real window
// columns are centered per facade off the EDGE-LOCAL arc; rows are 3m
// floors. Lighting is STRUCTURED: whole contiguous lit/dark FLOORS ×
// office RUNS of adjacent windows × corner-office boost, and even UNLIT
// windows darken 25% so the dark-glass grid reads everywhere. Adds a
// per-fragment street-level AO foot-darkening. Colors live in toy-palette
// (windowWarm/windowCool/windowEdge — user-tuned). Zero extra draws.
export const WINDOW_GRID = {
  colPitchM: 2.6, // window column pitch along a facade (true m, edge-centered)
  floorHM: 3.0, // one floor (row) height (m)
  litFloorFrac: 0.72, // fraction of floors that are lit (× per-building litBias)
  litCellFrac: 0.55, // within a lit floor, fraction of office-runs lit
  runLen: 3, // adjacent windows sharing one lit/dark decision (office suite)
  cornerBoost: 0.35, // brightness bump on the two corner columns
  boost: 1.7, // lit-cell brightness multiplier (clears TOY.bloomThreshold)
  groundRows: 1, // dark floors at street level (storefronts read via roads)
  flickerFrac: 0.015, // fraction of cells slowly toggling on the beacon clock
  edgeStartFrac: 0.9, // parapet edge glow starts at this fraction of wall height
  // Round 8 fix (F5): 0.5 → 0.85 — the rim accent is what makes roof PLATES
  // read from above now that caps are mid-slate (roof-3500 user repro).
  edgeBoost: 0.85,
  footAO: 0.45, // street-level ambient-occlusion darkening at the foot
  footAOFalloffM: 12, // exponential AO falloff height (m)
  // Round 8 fix (F5): crown/spire-tip emissive floor — fraction of the
  // crown's (already boost-multiplied) color written as TRUE emissive after
  // lighting, so skyline crowns clear TOY.bloomThreshold (0.56) at range
  // instead of multiplying near-black moonlit diffuse (~26 × 2 ≈ 68 luma).
  crownFloor: 0.7,
};

// Round 13 Phase 5 (NEW — Checkpoint #3 scope, additive only): roof CONTENT.
// The 3rd recurrence of "hollow rooftops at ~1,100 ft" — from above, toy roof
// caps read dark/empty. This is a SHADER-ONLY treatment (no worker change): the
// facade-grid fragment gives UP-FACING roof caps/details (vFacade.x == -1 &&
// world-normal.y > upMin) a dim skylight LATTICE (world-XZ grid of lit panes)
// plus a crownFloor-pattern luminance FLOOR so caps clear near-black and read as
// lit-from-within panels. Value-only, INK+ICE (the lattice rides the existing
// roof diffuse tone; the floor is a fraction of it — no hue). Conservative
// defaults so verify-neon-city's white-out gate (luma>170 ≤14%) holds; the
// top-down variance gate (verify-roofs) only rises. All live-tunable with the
// user in the Checkpoint #3 session.
export const ROOF_CONTENT = {
  enabled: true,
  roofUpMin: 0.6, // world-normal.y above this = an up-facing roof surface
  roofCellM: 6.5, // skylight lattice cell period (world m)
  roofPaneEdge: 0.4, // half-cell fraction the lit pane fills (grid lines between)
  roofGridBoost: 0.5, // pane brightness bump over the roof diffuse
  roofFloor: 0.22, // emissive luminance floor (fraction of the lit roof color)
};

// Round 7: runway edge lights — small bright quads baked along aeroway
// runway lines into the LAND group (aGlow arc attribute), plus threshold
// crossbars at both ends. Zero extra draws; chase rides the pulse clock.
export const RUNWAY_LIGHTS = {
  spacingM: 60, // edge-light spacing along the runway
  sizeM: 1.9, // light quad half-size feel (edge length ≈ 2×)
  offsetM: 3, // outboard of the runway ribbon edge
  boost: 2.0, // brightness multiplier (well past bloom)
  chase: 0.35, // 0 = steady lights; >0 = slow "rabbit" chase speed factor
};

// Round 7: distant town glow-domes (toy only) — ONE instanced additive
// dome mesh at nearby POI cities, faded in past the detailed rings and
// dissolved at the rim with the shared edge-fade band. +1 draw total.
export const TOWN_GLOW = {
  // Round 12: pool doubled — at cruise the placement radius follows the
  // altitude-extended fade band (getEdgeFade().endM), so a metro area can
  // legitimately field >48 towns. Still ONE draw (instances are ~free);
  // low tier keeps the round-7 pool. Placement now sorts by distance and
  // keeps the NEAREST maxByTier[tier] (the round-7 loop took the FIRST N in
  // POI-list order — invisible at 30km, arbitrary at 90km).
  max: 96, // instance pool (mount-time mesh size; = maxByTier ceiling)
  maxByTier: { high: 96, medium: 96, low: 48 },
  radiusM: 1400, // dome ground radius
  heightFrac: 0.3, // dome height = radius × this
  fadeInStartM: 9000, // beyond the full-detail ring…
  fadeInEndM: 14000, // …fully present before the rim fade starts (toy 14km)
  maxRangeM: 30000, // placement floor; live range = max(this, band end)
  opacity: 0.35,
  refreshSec: 2, // city-set recompute cadence (never per frame)
  // Round 12: horizon towns must read as glow POOLS, not sub-pixel dots —
  // dome radius × 1 + (mul−1)·smoothstep(startM, endM, d). Inert below
  // startM (= the round-7 maxRangeM), so the low-altitude look is identical.
  // Same shape as LETTERS.farScale.
  farScale: { startM: 30000, endM: 110000, mul: 2.5 },
};

// Round 13 Phase 5 (NEW — Checkpoint #3 scope, additive only; does NOT touch any
// TOWN_GLOW value listed in R12 §7): TownGlow warm CORES. R12's cruise planet
// "has geography but no LIGHT" — the dome halos are a diffuse blue wash. Each
// town gets a SECOND, smaller additive instance at its center in a WARM off-
// white that clears TOY.bloomThreshold (0.56) so the metro core reads as a hot
// glow point under bloom (city warmth — a WARMTH move, within the INK+ICE taste
// lock; no hue jump). Rides the SAME nearest-N town set as the domes (one extra
// instanced draw, +1 total). enabled:false = the core mesh never mounts.
export const TOWN_CORES = {
  enabled: true,
  color: '#f4e6cf', // warm off-white (low-saturation; a warmth move, not a hue move)
  radiusFrac: 0.34, // core radius = dome radius × this
  heightFrac: 0.55, // core dome height = core radius × this (a taller hot bump)
  opacity: 0.6, // additive strength (× fade); clears bloom at the center
  minTier: 'medium', // low tier keeps the round-7 single-dome look (skip cores)
};

// Round 8 (P5): procedural landmark monuments (toy only) — one InstancedMesh
// per archetype (9 archetypes since the round-8.5 'church' × poolPerArchetype
// instances) plus ONE shared additive hero-halo mesh under each placed
// monument (medium/high tiers only). +10 draws total. Monument heights are REAL-WORLD meters authored in
// the POI DB (poi.hM) × scaleBoost; placement runs on the same 2s cadence +
// immediate rebase re-place as TOWN_GLOW. Landmark POI letters lift by
// hM × scaleBoost + 30 so the name floats above the monument, not inside it.
export const LANDMARKS_3D = {
  poolPerArchetype: 8, // instances per archetype InstancedMesh
  // Round 8 fix round: capped at the toy fade band's END (was 45000). The
  // anchor-bend rim dissolve MULTIPLIES rgb toward 0 — additive halos read
  // that as transparency, but the OPAQUE monument bodies past the fade band
  // rendered as pure-black silhouettes against the sky (reviewer-confirmed).
  // Round 11 note: in satellite the fade band starts at 60km, so 26000 is
  // no longer a silhouette clamp there — it's a plain range/perf knob.
  maxRangeM: 26000, // = WORLD_EDGE.fade.toy.endM — monuments dissolve WITH the terrain
  scaleBoost: 1.35, // monuments read at range without dwarfing the city
  refreshSec: 2, // placement recompute cadence (never per frame)
  haloOpacity: 0.42, // additive hero-halo strength (medium/high only; fix-round lift)
  // Round 11: monuments mount in SATELLITE too (they were toy-only — the
  // Day default had zero landmarks). Daylight restyle: no neon vertex
  // palette, one sun-lit stone tint (the scene's day sun/hemi light it).
  // Round 13 (P4) satStyle v2 — the flat Lambert #cfc8ba was nearly invisible
  // against imagery (monuments-sat-01-redeemer-gl.png). Now a two-tone STONE
  // toon ramp (MeshToon + a 3-step grey gradient) gives the day sun real
  // sculpted banding — sunlit faces read bright, shaded faces read dark — so
  // the form pops as daylight stone (NOT neon; the toy monument keeps its own
  // colored ramp). The halo also strengthens to a warm daylight rim-glow (a
  // soft white/gold, not the toy's blue) so the monument reads as "present" on
  // the ground. NOTE: this satStyle block OVERLAPS the R11 §4 pending sign-off
  // table — FLY_ROUND13_PLAN §7 explicitly sanctions tuning it here; the
  // orchestrator surfaces the overlap to the user.
  satStyle: {
    color: '#d7d0c2', // weathered stone base (lifted a touch — the ramp darkens shade)
    ramp: [120, 196, 255], // 3-step grey toon gradient: deep shade → mid → sunlit
    haloOpacity: 0.16, // up from 0.1 — a readable daylight presence glow
    haloColor: '#ffe9c8', // warm daylight rim (replaces the toy blue monumentHalo)
  },
  // Round 13 Phase 5 (NEW — Checkpoint #3 scope, additive only): toy monument
  // FLOODLIGHT. Monuments read as dark stacks over a crude halo puddle at night.
  // A bottom-up vertex-baked brightness gradient (baked into the geometry vertex
  // colors — TOY only; the satellite material has vertexColors OFF so it ignores
  // this, staying byte-identical) reads as "floodlit from the ground". Applied to
  // the STONE parts only (emissive accent tips keep their glow). Value-only, no
  // hue. enabled:false = byte-identical monument (the round-8 look).
  floodlight: {
    enabled: true,
    baseBoost: 1.35, // vertex-color multiply at the monument's base (y = 0)
    topMul: 0.82, // …fading to this at the top (y = 1) — floodlit-from-below read
  },
  // Round 13 Phase 5 (NEW): the toy hero halo is a soft radial-gradient GROUND
  // pool (a CircleGeometry disc + generated radial alpha) replacing the crude
  // flat hemisphere "puddle". Satellite keeps its hemisphere (P4). Value/size only.
  toyHalo: {
    radiusFrac: 1.6, // pool radius = monument base radius (sy·0.55) × this
    opacity: 0.5, // additive (the soft gradient tapers it — reads dimmer than the disc)
  },
};

// Round 13 Phase 5 (NEW — Checkpoint #3 scope, additive only): toy MOON disc +
// richer stars on the SkyDome (bespoke ShaderMaterial, outside the cache-key
// registry). The moon sits on TOY.moonDirection; stars gain per-star size +
// brightness variation (the old field was uniform pinpricks). Cool white (ICE
// family — value only). enabled via the SkyDome `moon` prop (toy only).
export const MOON = {
  color: '#dfe6ff', // cool moonlight white (ICE family)
  angularR: 0.052, // moon disc angular radius (dome-direction units)
  glowR: 0.16, // soft halo radius around the disc
  brightness: 0.62, // additive disc brightness (clears bloom gently)
  glowStrength: 0.18, // soft halo additive strength
};

export const CONTRAIL = {
  minAltM: 6000, // contrails only form in the cold air above this altitude
  width: 22, // meshline lineWidth = 0.1 × width, world units (≈2.2m ribbon)
  length: 20, // ×10 = point history frames
  opacity: 0.55,
  color: '#eef4fb',
  // Round 13 Phase 2 — altitude-scaled presence (user's stated satellite joy:
  // "contrails always look sharp"). Just above minAltM the ribbon is thin/faint
  // (thin cold air); by fullAltM (cruise) it is wide + sharp. width & opacity
  // lerp *Lo→*Hi across [minAltM, fullAltM]; the FADE_BAND still owns the
  // on/off ramp at minAltM. opacity is clamped ≤1 by the material.
  altScale: {
    fullAltM: 11000,
    widthLo: 0.55,
    widthHi: 1.4,
    opacityLo: 0.65,
    opacityHi: 1.35, // × base 0.55 ⇒ ~0.74 at cruise
  },
  // Twin per-engine ribbons: the fighter has twin exhausts, so emit TWO ribbons
  // offset ±engineSpanM/2 perpendicular to the heading (doubles the player's
  // ribbon draws 1→2 at most). twin:false = the round-6 single centerline ribbon.
  twin: true,
  engineSpanM: 3.4, // lateral separation between the two emitters (world m)
  // Round 17: how far behind the aircraft's own position the ribbon is emitted
  // (world m, absolute frame). Was a bare literal in Contrail.jsx; the hangar's
  // 70 m cargo needs ~42 m or its trail starts inside the fuselage. This value
  // IS the fighter's, so the default path is unchanged.
  backM: 12,
  // Camera-facing ribbons turn their full width toward the camera — with
  // the chase cam sitting basically INSIDE the player's own trail, even a
  // 2m ribbon filled a giant white wedge at altitude. Collapse the width
  // for points near the camera (zero at start, full by end). Round 6: the
  // chase cam trails ~100m back, so the window must clear the whole
  // camera-to-plane gap — the old 25/80 left the last two segments at
  // ~0.5m width 35m from the lens = the FL300 "white spear".
  nearFadeStartM: 60,
  nearFadeEndM: 180,
};

// ---------------------------------------------------------------------------
// Terrain tiles (tokenless sources — no API keys anywhere)
//   imagery: Esri World Imagery (attribution required, see tile-sources.js)
//   elevation: AWS Open Data Terrarium tiles (Mapzen dataset, z0-15)
// ---------------------------------------------------------------------------

// Round 7: airport interaction — buzz-the-tower / touch-and-go detection
// (lib/fly/airport-buzz.js, fed at 1Hz from the Contracts interval). AGL is
// judged against the airport's sampled elevation; the flight model's hard
// floor is 50m, so touch-and-go is a dip-below + prompt climb, not
// wheels-on. Arcade generosity over realism — tune freely.
export const AIRPORT_BUZZ = {
  radiusM: 2500, // detection radius around the airport POI (true m)
  buzzAglM: 140, // below this (sustained 2 ticks, fast) = buzzed the tower
  minSpeedMps: 70, // no credit for hovering onto the field
  touchAglM: 75, // dip below this arms a touch-and-go…
  climbDeltaM: 40, // …climb this much above the dip floor…
  climbWindowSec: 8, // …within this window = touch-and-go
  cooldownSec: 120, // per-airport per-type quiet period
};

// Round 7: satellite depth pass — DEM-normal hillshade multiplied over the
// Esri imagery (fragment-side; the tile material's real lighting stays
// authored), sun-direction driven by the day cycle. strength 0..1 is the
// master knob; ambient = brightness of fully shaded slopes; lift = extra
// pop on sun-facing slopes. anisotropy fixes low-pass texture smearing.
export const HILLSHADE = {
  strength: 0.55,
  // Round 11: hillshade is a live uniform, so it can degrade with the
  // quality tier for free (low tier trades relief pop for fill rate).
  strengthByTier: { high: 0.55, medium: 0.55, low: 0.35 },
  ambient: 0.55,
  lift: 0.15,
  // Round 13 (P4) hillshade v2 — two cheap DEM-shading terms folded into the
  // SAME tile fragment patch and enveloped by the SAME uHillStrength master
  // (so verify-sat-depth's strength-0 A/B toggle captures ALL of it, and toy
  // tiles — uHillStrength 0 — stay byte-identical): (1) slope-driven ambient
  // occlusion, valley/canyon walls deepen with the normal's tilt from world-up
  // (1 − aoStrength·slope); (2) a slope saturation nudge so rocky relief gains
  // a touch of chroma. Both tier-gated (low tier gets less/none).
  aoByTier: { high: 0.34, medium: 0.28, low: 0.14 },
  satByTier: { high: 0.22, medium: 0.18, low: 0.0 },
  // Round 13 (P4) low-AGL procedural micro-detail — breaks the "photo taped to
  // a table" read of z16 imagery mush (scripts/satdepth-04-valley-low.png).
  // A high-frequency value-noise LUMA grain (content-agnostic — a tiling grass
  // texture on real imagery reads fake past its own footprint, the A4 lesson),
  // faded IN below inAglM and OUT by outAglM (the SKY.altAtmo eyeAgl pattern —
  // driven per-frame from FlyScene's -50 block via setMicroDetail). Satellite-
  // only (style-gated to 0 → toy pixel-stable). scaleM = noise cell period in
  // world meters; amp = ± luma fraction at full strength; tier-gated (low off).
  micro: {
    strengthByTier: { high: 1.0, medium: 0.85, low: 0.0 },
    scaleM: 5.5,
    amp: 0.1,
    inAglM: 1500,
    outAglM: 2500,
  },
  minElRad: 0.15, // graze floor (night/dawn) — relief stays readable
  maxElRad: 0.9, // noon cap — a zenith sun would flatten every slope
  // Round 11: 8 → 4 — satellite is the DEFAULT view now and was never
  // perf-certified; aniso is pure sampler bandwidth (after DPR, the biggest
  // iGPU tile lever, and this camera lives at the grazing angles where it
  // costs the most). The tier map applies to NEW tile textures only, so a
  // mid-flight degrade never forces a re-upload hitch — the field converges
  // as tiles stream.
  anisotropy: 4,
  anisotropyByTier: { high: 4, medium: 4, low: 2 },
};

export const TILES = {
  // Round 11: 17 → 16 — z17 quadrupled low-AGL texture churn and satellite
  // is the default now; revert-knob, evaluate live (round 7 raised it).
  satMaxZoom: 16,
  demMaxZoom: 15, // Terrarium data ceiling
  lruBudgetBytes: 140 * 1024 * 1024,
  viewDistanceM: 250000, // fog/horizon cap bounds tile counts
  // Round 6: three-tile's default loader concurrency (5) throttled the
  // z2→z14 LOD descent after long warps — the dominant cost of the 10-25s
  // cross-continent stream-in. Browser still caps per-host connections.
  maxThreads: 10,
};

// SPICY traffic pings (FLY_ATLAS_REWORK §4.4a): first sighting of military
// or epic+ rarity traffic in range → arcade toast + minimap ring + blip.
// Session-scoped dedup (a hex pings once per Fly session); scanned on the
// discrete 2s cadence, never per frame.
export const SPICY = {
  scanIntervalMs: 2000,
  maxRangeNm: 50, // don't ping about contacts half a poll-radius away
  // Round 6: raised epic → legendary. Rarity bonuses let ordinary GA
  // (C172s!) clear the epic gate, flooding the stack — military contacts
  // always ping regardless of this tier. Live-tune to taste.
  minTier: 'legendary', // non-military traffic must be at/above this tier
  // Trivial GA types that carry MILITARY hex codes (Civil Air Patrol
  // Cessnas etc.) — these do NOT get the military auto-ping; they must
  // clear minTier like civilians. This was the "SPICY Cessna 172" flood.
  gaTypes: ['C172', 'C152', 'C182', 'C206', 'C210', 'P28A', 'PA28', 'SR20', 'SR22', 'DA40', 'DA42', 'BE36', 'C177', 'C72R'],
  pulseSec: 6, // minimap attention-ring duration
};

// ---------------------------------------------------------------------------
// Round 17 "Your Wings" — LIVING-WORLD CONTRACTS
// ---------------------------------------------------------------------------
//
// R16 built real weather, a real sun and 1,900+ tagged POIs; none of it fed
// gameplay. These are the thresholds for the nine contracts that read them.
//
// TWO TIERS ON PURPOSE. `offer` decides whether a contract may be HANDED to
// the player (rotated in); `progress` decides whether it TICKS. Offer is the
// looser of the two so a storm contract arrives as the front rolls in and
// survives a lull mid-shower instead of appearing and instantly rotating out.
//
// Weather and night contracts are SATELLITE-ONLY by construction: toy never
// fetches weather (use-fly-weather bails on style) and has no live
// `runtime.sun` at all — FlyScene's day cycle returns early in toy, so the
// value is undefined at boot and STALE after a satellite→toy switch. A night
// objective judged on a stale sun would be a lie, so `contractEligible`
// refuses both classes outside satellite rather than guessing.
export const CONTRACTS_LIVING = {
  // Consecutive 1 Hz ticks an ACTIVE weather/night contract may spend
  // ineligible before it silently rotates out (no stamp, no points). The
  // weather moved on; the objective should too.
  staleSwapSec: 30,

  // "Is there enough weather/darkness to OFFER this?"
  offer: {
    precipT: 0.15, // wx.precipT — any real precipitation
    fogT: 0.2, // wx.fogT — visibility is starting to close in
    windMps: 10, // |wind| — breezy
    overcastT: 0.4, // wx.overcastT — a deck is forming
  },

  // "Does the objective actually tick right now?"
  progress: {
    precipT: 0.35, // storm-chaser: in the weather, not near it
    fogT: 0.45, // ifr-legs: genuinely IMC
    windMps: 15, // wind-rider: a real blow
    windAglM: 200, // …and actually aloft (no taxiway credit)
    overcastT: 0.6, // above-weather: there IS a deck to be above
    overcastAltM: 6096, // FL200 in meters
  },

  // Sun fraction at/below which the world counts as night. Mirrors
  // SKY_LIVE.nightSky.starZeroFrac — the frac at which the satellite dome
  // starts showing stars, i.e. the first moment it LOOKS like night. Kept as
  // its own number so the gameplay definition can be tuned without moving the
  // sky (and vice versa).
  nightFrac: 0.16,

  fogStepM: 1000, // ifr-legs counts progress per kilometre flown in fog
  overflyRangeM: 2500, // overfly-kind (hotspot) pass radius — = the landmark one

  // The daily set: N picks from the MECHANICAL templates only, seeded on the
  // UTC day number, so every player in the world gets the same two objectives
  // and both are completable in any weather, anywhere.
  daily: {
    count: 2,
    mult: 2, // a daily pays double
  },

  saveDebounceMs: 800, // trailing debounce on the localStorage snapshot
};

// Round 9 (R9-1): the boot loading screen. Fly-only pivot — app/page.js
// mounts FlyMode directly and this overlay covers the canvas until the world
// is actually ready. Progress is REAL (no fake timers): three weighted gates
// polled from runtime signals. window.__flyBoot = { phase, pct } is the
// harness contract (pct hits 100 exactly at reveal and stays).
export const BOOT = {
  pollMs: 150, // gate poll cadence (DOM overlay, never per-frame React)
  weights: { world: 0.6, models: 0.25, frames: 0.15 },
  // Gate (a), toy: every ring-0 ("full" detail) chunk finalized AND the
  // drape queue empty, held this long (a refresh can requeue chunks).
  worldHoldMs: 1000,
  // Gate (a), satellite: the tile layer exposes no per-tile "ready" event,
  // so we use the download-queue heuristic — engine.downloading === 0 held
  // worldHoldMs after at least one in-flight download was observed. A fully
  // browser-cached session may never show downloading > 0, so after
  // satGraceMs with the engine live + frames rendering we accept the drain.
  satGraceMs: 4000,
  minFrames: 2, // gate (c): rendered frames post-Suspense (shader warm)
  geoTimeoutMs: 2500, // spawn: geolocation quick-timeout before fallbacks
  lastPosSaveMs: 10000, // persist 'fly-last-pos' cadence (plus pagehide)
  maxBootMs: 45000, // absolute ceiling — a dead tile CDN can't trap the boot
  revealMs: 900, // streak+fade overlay dissolve
};

// Round 16 "Living World" — REAL weather at the player's position (satellite
// only; toy never fetches and never reads this block). `/api/weather` proxies
// two keyless sources (open-meteo → aviationweather METAR) and
// lib/fly/weather-model.js turns the payload into the numbers below.
//
// THE INVARIANT: with no data — or `window.__flyWeatherOverride = 'baseline'`,
// which scripts/_boot.js pins for the whole harness fleet — every multiplier
// here is the EXACT identity, so the deck, the atmosphere and the drift are
// bit-for-bit the R15 look. `enabled: false` is the one-line whole-feature
// revert (the hook stops fetching, runtime.weather is never created, and every
// consumer takes its no-weather branch).
export const WEATHER = {
  enabled: true,
  cellDeg: 0.25, // position → weather cell (query key AND upstream coords)
  // 'baseline' = a total upstream miss shows NO weather (honest: the round's
  // premise is real weather). 'procedural' switches on the designed seeded
  // fallback in weather-model.js — a USER decision, not an agent's.
  fallback: 'baseline',
  // Cover % → deck state (weather-model classifyCover: <12/<35/<60/<88/≥88;
  // no data → 'baseline'). presence = fraction of puffs kept (per-puff by a
  // stable hashed rank, so thinning is deterministic and harness-stable),
  // size/opacity multiply the certified puff scale + material opacity, and
  // overcast drives the grey lid / fog / bloom / sun-dimming authority.
  coverage: {
    feather: 0.12, // presence cut softness — puffs dissolve, never pop
    baseline: { presence: 1, size: 1, opacity: 1, overcast: 0 },
    clear: { presence: 0.05, size: 0.9, opacity: 0.9, overcast: 0 },
    few: { presence: 0.3, size: 0.95, opacity: 1, overcast: 0 },
    scattered: { presence: 0.65, size: 1, opacity: 1, overcast: 0 },
    broken: { presence: 1, size: 1.15, opacity: 1.1, overcast: 0.45 },
    overcast: { presence: 1, size: 1.35, opacity: 1.25, overcast: 1 },
  },
  // The overcast LOOK. cloudGrey/tintK ride CloudField's existing ~10s tint
  // cadence (lerp the lit-deck tint toward grey by overcastT·tintK); rimGrey/
  // voidGrey are how far applyWeatherAtmo desaturates the rim triple toward
  // its own luma, and lumaK darkens that grey a touch (a real overcast lid is
  // dimmer than the blue sky it replaced). All four are pure live-tune knobs.
  overcast: {
    cloudGrey: '#aab4c4',
    tintK: 0.7,
    rimGrey: 0.55,
    voidGrey: 0.35,
    rimLumaK: 0.82,
    voidLumaK: 0.9,
  },
  // Visibility → fog. refM is "as good as it gets" (a METAR '10+' is a
  // reporting ceiling, not a measurement — weather-model ignores those);
  // below it the scene fog density is multiplied up to maxMul and HARD-capped
  // at densityCap so a 200m-vis report can never white the world out.
  vis: { refM: 15000, minM: 800, maxMul: 8, densityCap: 5.2e-5, hazeAdd: 0.28 },
  // Wind. baseMps MUST equal CLOUDS.driftMps: the cloud integrator accumulates
  // only the DEVIATION from it, so a baseline session reproduces today's
  // `driftMps * t` exactly (see CloudField).
  wind: { baseMps: 5, maxMps: 22 },
  // Precipitation (PrecipLayer — one instanced quad, GPU-only animation).
  // countByTier low:0 means the layer never mounts on the low tier at all.
  precip: {
    minT: 0.35, // any reported precip is at least this heavy (reads as rain)
    mmFull: 2.5, // mm in the report interval that counts as full intensity
    snowTempC: 1, // tie-break: precip below this is snow whatever it claims
    countByTier: { high: 900, medium: 420, low: 0 },
    radiusM: 150, // camera-following cylinder
    heightM: 90,
    showAbove: 0.02, // precipT below this = parked (0 draws)
    fadeOutAglM: 3500, // you fly out of the top of the weather…
    fadeSpanM: 900, // …over this band
    rain: { fallMps: 11, lenM: 3.2, widthM: 0.12, opacity: 0.5, color: '#d7e6f7', leanK: 0.09, sway: 0 },
    snow: { fallMps: 1.6, lenM: 0.32, widthM: 0.32, opacity: 0.8, color: '#ffffff', leanK: 0.35, sway: 1.5 },
  },
  // Damping (expApproach time constants, seconds). Weather must ARRIVE, never
  // cut: the deck thickens over ~8s, ambience over ~5s, wind veers over ~12s
  // (an undamped wind change teleports the deck — the R13 satSmooth lesson),
  // and precipitation starts/stops in ~2s. tint/target/cell are the discrete
  // cadences: tintMs is CloudField's existing 10s sun-tint interval (changing
  // it changes certified behaviour), targetMs recomputes targets (and picks up
  // __flyWeatherOverride), cellMs re-keys the query from runtime.geo.
  smooth: {
    deckSec: 8,
    ambienceSec: 5,
    windSec: 12,
    precipSec: 2,
    tintMs: 10000,
    targetMs: 1000,
    cellMs: 15000,
  },
  // Upstream cadence: weather moves in tens of minutes, not seconds.
  poll: { refetchMs: 600000, staleMs: 300000 },
};

// Round 16 (A4 "GND-C") — SATELLITE DISTANT CITY GLOW. The road network is a
// LOCAL read (z13 ring, ~9km, culled by 5.2km AGL); past it a night satellite
// city still fell off a cliff into black. This is TownGlow's satellite sibling:
// ONE additive hemisphere + ONE warm core at every POI city inside the band
// (2 instanced draws TOTAL, both ALWAYS issued so the draw count never moves
// with the clock — the sun drives per-instance COLOR only, and black on an
// additive material is invisible). Three deliberate differences from TOWN_GLOW:
//   • ground = RAW DEM elevation, no TOY_WORLD.terrainExaggeration/groundLift
//     (the R11 monuments lesson — satellite ground is raw);
//   • a SODIUM palette (real cities glow warm-orange from sodium/LED street
//     lighting) instead of the toy's cool PALETTE.townGlow;
//   • night-gated: instance colors are multiplied by the γ ramp below, which is
//     the EXACT SAT_BUILDINGS.night / SAT_ROADS.night ramp shape, so the domes,
//     the road web and the building windows all come up together at dusk.
// Placement runs on the same 2s cadence + immediate rebase re-place as TownGlow.
// enabled:false = the component never mounts (0 draws, no globals).
export const SAT_CITY_GLOW = {
  enabled: true,
  // Instance pool per quality tier (the mesh is sized to the ceiling once at
  // mount; instances themselves are ~free — this only caps the placement scan).
  maxByTier: { high: 96, medium: 96, low: 48 },
  radiusM: 1600, // dome ground radius (a metro halo, slightly wider than toy's)
  heightFrac: 0.28, // dome height = radius × this (flatter than toy: real haze)
  coreRadiusFrac: 0.34, // warm core radius = dome radius × this
  coreHeightFrac: 0.55, // core height = core radius × this (a hot bump)
  color: '#ffb066', // sodium halo (= SAT_ROADS.colors.street — one night palette)
  coreColor: '#ffd9a3', // hotter core (clears bloom without going white)
  opacity: 0.3, // dome additive strength (× fade × night ramp)
  coreOpacity: 0.55, // core additive strength (× fade × night ramp)
  dayFrac: 0.3, // sun.frac at/above which the glow is fully dark (= SAT_ROADS.night)
  gamma: 1.5, // >1 holds it dark through late afternoon, arrives at dusk
  fadeInStartM: 8000, // inside this the local road/building detail IS the city…
  fadeInEndM: 14000, // …fully present past here
  maxRangeM: 90000, // placement range (the satellite rim band ends at 120km)
  // Horizon cities must read as glow POOLS, not sub-pixel dots (the R12
  // TOWN_GLOW.farScale move, same shape).
  farScale: { startM: 30000, endM: 110000, mul: 2.5 },
  refreshSec: 2, // city-set recompute cadence (never per frame)
};

// Round 16 (A4) — SATELLITE AIRPORT BEACONS. An airport rotating beacon is the
// single most recognizable night-aviation light there is, and it costs ONE
// instanced draw for the whole pool. Hosted by SatRoadLayer (it already runs the
// 2s POI-placement cadence and dies with the same style gate). Placement is
// RANGE-only — never sun-gated — so the draw count is identical at noon and
// midnight; the sun only scales the flash envelope. count = 0 (no airport in
// range) parks the draw.
//
// The real thing alternates WHITE and GREEN (civil land airport). That is one
// `material.opacity` write per frame (the flash envelope) plus a `material.color`
// write only on the discrete half-period FLIP (~0.6 Hz) — no matrix churn, no
// re-placement, no per-frame React.
export const SAT_AIRPORT_BEACONS = {
  enabled: true,
  minTier: 'high', // strict — a top-tier flourish (mirrors SAT_WATER's stance)
  pool: 12, // instance pool = hard cap on placed beacons (nearest win)
  rangeM: 25000, // placement radius around the player
  sizeM: 14, // beacon glow radius at close range…
  // …scaled up with distance so a 25km-away field is still a legible point
  // rather than a sub-pixel speck (the TOWN_GLOW.farScale idiom). [A4 addition]
  farScale: { startM: 6000, endM: 25000, mul: 5 },
  liftM: 25, // sit above the field so hangars/terrain never bury it [A4 addition]
  white: '#fff6e0', // the white flash (warm-white, like a real beacon lens)
  green: '#7dffb0', // the green flash (civil land airport)
  periodSec: 3.2, // one full white→green cycle
  flashFrac: 0.14, // lit fraction of each half-period (a FLASH, not a pulse) [A4 addition]
  dayFrac: 0.3, // sun.frac at/above which beacons are dark (= SAT_ROADS.night)
  gamma: 1.5, // same γ ramp shape as the roads/windows/city glow [A4 addition]
};

// Round 16 (A5 "WX-B") — THE LIVING SKY. Everything here is new behaviour that
// switches ON as the sun goes down; every default is chosen so a DAYLIGHT or
// TOY frame is bit-for-bit the R15 image (the night terms multiply by a weight
// that is exactly 0 in daylight, and the toy dome never leaves its defaults).
// Companion module: lib/fly/sun-model.js.
export const SKY_LIVE = {
  // The real sun (sun-model.js). `frac` = sin(elevation) / sin(elRefDeg), so
  // "full daylight" arrives at a realistic sun height instead of only at the
  // zenith. 50° is a touch under NYC's midsummer noon (70°) and comfortably
  // above its winter noon (26°): summer noon pins at 1 everywhere temperate,
  // winter noon reads ~0.55 ("bright but low"), which is the truth. LOWER it
  // and winter days brighten; RAISE it and the world lives in perpetual
  // golden hour. Live-tune candidate #1.
  sun: { elRefDeg: 50 },
  // Satellite night sky. The SkyDome star/moon terms have existed since R13
  // but were force-zeroed in satellite; they now ride `nightT`, an INVERSE
  // smoothstep of sun.frac (see sun-model.nightWeight). Stars begin to appear
  // as frac falls under starZeroFrac and are full by starFullFrac.
  nightSky: {
    starZeroFrac: 0.16, // above this frac: no stars at all (exact 0)
    starFullFrac: 0.05, // at/below this frac: full night sky
    moonElRad: 0.6, // fixed, gentle moon elevation (~34°)
    moonBrightness: 0.5, // dimmer than TOY's 0.62 — satellite has a real HDRI
    moonGlowStrength: 0.14, // …and a softer halo than toy's 0.18
    moonAngularR: 0.035, // smaller disc than toy's 0.052 (photographic scale)
    moonGlowR: 0.12,
    moonColor: '#dfe6ff', // = MOON.color (cool ICE white), kept independent
  },
  // Bloom breathes with the clock in SATELLITE. By day the grade is the
  // certified daylight one (SKY.bloomIntensity/Threshold); as the sun sets the
  // threshold drops and the intensity rises so city lights, runway lights and
  // tracers actually glow. EQUAL to the SKY constants at frac ≥ dayFrac, so
  // every sun-pinned daylight gate is byte-stable.
  bloomNight: { dayFrac: 0.35, intensity: 1.0, threshold: 0.62 },
  // HDRI cross-fade (components/fly/SatEnvironment.jsx). R13 swapped the sky
  // by REMOUNTING drei's <Environment> on a bucket crossing — a hard cut with
  // a one-frame gap. SatEnvironment keeps one PMREM generator, prefetches the
  // neighbour HDR before the crossing, assigns the new cubemap in the same
  // frame it is baked, and masks the chroma cut with a short background dip.
  hdriFade: {
    preloadFracMargin: 0.04, // start fetching the neighbour this close to it
    rampSec: 1.5, // exp-damp time constant on env/bg intensity
    dipSec: 0.6, // background dip-and-recover across a swap
    dipDepth: 0.45, // how far down the dip goes (0 = no dip)
    // Intensity is CONTINUOUS in sun.frac now (R13's four hard steps made the
    // sky flicker brightness at every crossing). Piecewise-linear through
    // three anchors whose VALUES are exactly SKY.hdriCycle.intensity's — so
    // noon still resolves to 0.85/1.0 and midnight to 0.16/0.26, unchanged.
    anchors: { day: 0.75, dawnDusk: 0.28, night: 0.03 },
    // R16 sweep (Fable): linear-space highlight caps applied ONCE per .hdr at
    // load, PER ROLE. texelCap ships OFF (0): the day/dawn/dusk suns are the
    // IBL's warm KEY LIGHT — capping them at 12 cooled the certified noon
    // cloud tint to #c9ced8 and failed verify-round11 (measured); their bloom
    // behavior has been certified since R13. nightTexelCap stays ON and LOW:
    // the qwantani "night" purseky carries a bright twilight band (linear
    // ~2-4) on one azimuth — facing it, night rendered luma 225/255 (facing
    // away: the certified dark). Flattening it makes night read as night from
    // every heading. 0 = cap off. Live-tunable; user checkpoint = night feel.
    texelCap: 0,
    nightTexelCap: 0.35,
  },
  // The overcast lid (SkyDome). A real overcast sky is a dim grey CEILING, not
  // a blue sky with clouds in front of it: at overcastT 1 the dome goes opaque
  // above the horizon and paints the (already grey-mixed) rim tone, darkened
  // toward the zenith by zenithK. At overcastT 0 every term is an exact no-op.
  overcastLid: { zenithK: 0.82, alphaFeather: 0.06 },
  // How far weather dims the light. All four multiply a STASHED base (never
  // compound) and are exactly 1.0 at baseline/clear.
  weatherDim: {
    sun: 0.45, // directional key × (1 − this·overcastT)
    env: 0.4, // HDRI ambient × (1 − this·overcastT)
    bg: 0.35, // visible sky × (1 − this·overcastT)
    bgFog: 0.3, // visible sky × (1 − this·fogT) — murk swallows the sky too
  },
};

// ---------------------------------------------------------------------------
// Round 17 — Photo mode
// ---------------------------------------------------------------------------

/**
 * PHOTO MODE (round 17). `P` parks the camera in a free orbit around your
 * aircraft while the plane KEEPS FLYING (the stick is neutralized, so the
 * instructor auto-levels it — this is not a pause). The HUD hides, the
 * shutter reads the fully-graded frame straight off the GL canvas, and the
 * data attribution is baked into the exported PNG.
 *
 * Camera feel deliberately mirrors the RMB free-look orbit (CAMERA.freeLook)
 * — the same drag rates, the same pitch clamps — but the pose is PERSISTENT:
 * releasing the mouse must not snap the framing you just composed back to the
 * chase pose.
 */
export const PHOTO = {
  // Orbit distance (true metres, scaled to world units by the mercator k on
  // the horizontal axes exactly as the chase rig does).
  minDistM: 25,
  maxDistM: 600,
  startDistM: 55, // opening framing — a shade wider than the chase offset
  zoomRate: 0.0016, // distance fraction per wheel pixel (deltaY)
  zoomLambda: 12, // distance damping (1/s)
  posLambda: 6, // orbit-offset damping (1/s) — snappier than chase (4)
  lookLambda: 9, // aim damping (1/s) — matches CAMERA.lookLambda
  aimUpFrac: 0.35, // look target = plane + CAMERA.offset.y * this
  startPitchRad: 0.12, // opening elevation (slightly above the wing line)
  // Drag rates. Kept separate from CAMERA.freeLook so composing a shot can be
  // tuned slower than a combat glance without touching the chase rig.
  yawRate: 6,
  pitchRate: 3,
  maxPitchRad: 1.45,
  minPitchRad: -1.2, // photo mode may go BELOW the plane (chase can't)
  groundClearM: 6, // hard floor over terrain (a belly shot must not go under it)
  fov: 42, // slightly longer lens than CANVAS.fov — flatters the subject

  // Capture. The composer owns rendering (Effects.jsx renders at priority 1
  // with auto-render off) and the canvas has NO preserveDrawingBuffer, so the
  // read must happen in a useFrame subscriber at a HIGHER priority, in the
  // same task, before the frame is composited away.
  capturePriority: 100,

  // Baked-in attribution (the Esri terms follow the exported pixels).
  watermark: {
    padPx: 18, // inset from the bottom-left corner
    fontPx: 15, // scaled by min(1, width / 1600)
    minFontPx: 11,
    lineGapPx: 4,
    scrimAlpha: 0.42, // rounded dark plate behind the text
    scrimPadPx: 8,
    color: 'rgba(238, 245, 255, 0.92)',
    brand: 'SKYLOOM',
    brandColor: 'rgba(207, 238, 248, 0.55)',
  },
};

// ---------------------------------------------------------------------------
// Round 17 — Mobile UI (zones, targets, per-device layout)
// ---------------------------------------------------------------------------

/**
 * MOBILE_UI — the single description of WHERE the flying HUD's overlays live,
 * per device class, plus the touch-ergonomics numbers the round introduced.
 *
 * WHY IT EXISTS. Before round 17 the HUD was fifteen sibling overlays, each
 * hard-coding its own corner (`absolute bottom-10 left-4 z-10` and friends)
 * and, if it had a phone story at all, its own `max-sm:` re-position. Nothing
 * could see anything else, so nothing could be guaranteed disjoint: on a phone
 * the InfoCard sat exactly on top of the joystick and ate the steering touch.
 * The offsets now live HERE, `components/fly/LayoutRoot.jsx` renders them as
 * named zone containers, and the overlays render as zone CONTENT.
 *
 * DESKTOP IS BYTE-IDENTICAL BY CONSTRUCTION, and that is the whole design of
 * the `desktop` strings below: every one was transcribed VERBATIM off the
 * component that hard-codes it today (file + line noted per zone). A zone is a
 * pure re-parenting — the same offsets, on a container instead of on the leaf.
 * If you are tempted to "clean up" a desktop value here, don't: the harness
 * suite and the user's daily driver are both calibrated on these pixels.
 *
 * VARIANT COMPOSITION. `phonePort` / `phoneLand` are ADDITIVE — they are
 * appended after `desktop`, never substituted for it, so a phone rule only has
 * to override the properties it actually changes. They use the `phone-port:` /
 * `phone-land:` custom variants declared in app/globals.css, which key off the
 * `data-device` / `data-orient` attributes the Fly root stamps. Components that
 * already carry `max-sm:` classes KEEP them: `max-sm:` is a width rule and
 * still fires on a narrow desktop window, where `phone:` deliberately does not.
 *
 * STACKING. Zone containers carry the SAME `z-*` their content carries today.
 * Every migrated zone member sits at z-10, none of them overlap on desktop
 * (top-centre strip, top-right toasts, left contracts, bottom-left card,
 * bottom-right dial, bottom-left credit), so re-parenting cannot change what
 * paints over what — among equal z-indices DOM order decides, and there is
 * nothing to decide between.
 */
export const MOBILE_UI = {
  /**
   * Named zones. Each is `{ desktop, phonePort, phoneLand, style? }`:
   *   desktop   position/stacking classes, verbatim from today's component
   *   phonePort additive overrides for a phone held upright
   *   phoneLand additive overrides for a phone held sideways
   *   style     inline positioning that cannot be expressed as a utility
   *             (the `max(env(safe-area-inset-*), Npx)` control anchors)
   *
   * Sizing, flex layout and transforms stay on the COMPONENT — a zone owns
   * where a thing is, never what it looks like.
   */
  zones: {
    // SpotToast.jsx:271 — `pointer-events-none absolute right-4 top-16 z-10`.
    // Phone portrait: a 390 px screen cannot hold a right-anchored row of
    // label + callsign + type + tier chip, so the stack goes wide and the card
    // itself wraps to two lines (that is card markup, not a zone).
    //
    // `right-[7.5rem]`, NOT `inset-x-2`, and verify-mobile-layout is why: a
    // full-width stack ran straight through the top-right minimap dial (which
    // sits at 278–382 px on a 390 px screen) and covered a tap target. The
    // stack now stops 8 px short of the dial's left edge, which is the whole
    // point of putting these numbers where two components can see them.
    toasts: {
      desktop: 'absolute right-4 top-16 z-10',
      // 8rem (128 px), arrived at by measuring rather than guessing. The
      // portrait centre column stacks THREE things above the toasts — stats
      // strip (6–58), nearest-POI line (76–92), chase chip (104–120) — and
      // each earlier attempt collided with the next one down: 3.4rem hit the
      // strip, 3.9rem hit the POI line. 128 px clears all three, and the two
      // toast cards then occupy roughly 128–222.
      phonePort:
        'phone-port:left-2 phone-port:right-[7.5rem] phone-port:top-[calc(env(safe-area-inset-top)+8rem)]',
      // Landscape has width but almost no height: centre a bounded stack in
      // the middle column instead of hugging the right edge. 5.8 rem is not
      // arbitrary — that column already stacks three things above it (stats
      // strip -> 44 px, nearest-POI line -> 66 px, chase chip -> 86 px), and
      // the toasts sit under the last of them. 2.6 rem overlapped the strip
      // and 3.6 rem overlapped the POI line; both were found by measuring.
      phoneLand:
        'phone-land:left-1/2 phone-land:right-auto phone-land:top-[calc(env(safe-area-inset-top)+5.8rem)] phone-land:-translate-x-1/2 phone-land:items-center',
    },

    // Contracts.jsx:456 — `pointer-events-none absolute left-4 top-24 z-10`
    // plus the R16 phone offsets.
    //
    // The portrait TOP moved 8.25rem → 10.5rem, and that is a deliberate
    // change to an R16 value: the phone toast band now occupies roughly
    // 54–150 px, and 8.25rem put the panel's first row at 132 px, inside it.
    // Contracts is permanent and toasts are transient, so the permanent thing
    // yields — 36 px lower, still above the fold, and provably clear of both
    // the toast stack and the minimap dial (bottom 156 px).
    //
    // The component's own `max-sm:` rule KEEPS 8.25rem on purpose. `max-sm:`
    // means "narrow desktop window", where there is no touch HUD and the
    // toasts stay in their desktop corner, so there is nothing to yield to.
    // Both rules match on a portrait phone and the phone one wins on
    // SPECIFICITY, not source order: the `phone-port:` variant compiles to
    // class + two attribute selectors (0,3,0) against `max-sm:`'s bare class
    // inside a media query (0,1,0). That is what "compose with, never replace"
    // buys — one surface can hold two different correct answers.
    contracts: {
      desktop: 'absolute left-4 top-24 z-10',
      phonePort: 'phone-port:left-2 phone-port:top-[calc(env(safe-area-inset-top)+15rem)]',
      // Landscape: the panel becomes a tap-to-expand chip (see Contracts.jsx),
      // tucked under the strip on the left where nothing else lives.
      phoneLand: 'phone-land:left-[max(env(safe-area-inset-left),0.5rem)] phone-land:top-[2.9rem]',
    },

    // Minimap.jsx:151 — `pointer-events-none absolute bottom-10 right-4 z-10`
    // plus the R7 phone offsets.
    //
    // The portrait TOP moved 3.25rem → 3.9rem, matching the toast band, and
    // that also fixes a small pre-existing bug: at 3.25rem the dial's top-left
    // corner clipped the stats strip by 22x6 px (strip 90–300 x 6–58, dial
    // 278–382 x 52–156 — measured, not estimated). The component's `max-sm:`
    // rule keeps 3.25rem for narrow desktop windows, where the strip is a
    // different size and there is no overlap to fix; `phone-port:` wins on a
    // phone by specificity.
    minimap: {
      desktop: 'absolute bottom-10 right-4 z-10',
      phonePort:
        'phone-port:bottom-auto phone-port:right-2 phone-port:top-[calc(env(safe-area-inset-top)+8rem)]',
      phoneLand:
        'phone-land:bottom-auto phone-land:right-[max(env(safe-area-inset-right),0.5rem)] phone-land:top-[2.6rem]',
    },

    // InfoCard.jsx:115 — `pointer-events-auto absolute bottom-10 left-4 z-10`.
    // The phone bottom offset is the load-bearing one — see
    // `infoChip.dockBottomRem` for how it is derived and from what.
    'info-dock': {
      desktop: 'absolute bottom-10 left-4 z-10',
      phonePort:
        'phone-port:inset-x-2 phone-port:bottom-[calc(env(safe-area-inset-bottom)+24.5rem)]',
      // Landscape: centred in the gap BETWEEN the stick (left, ~18–146 px)
      // and the action cluster (right, from ~760 px). The width is bounded so
      // the chip can never grow into either — an unbounded centred chip that
      // happens to hold a long callsign reaches both.
      // 2.5rem, not 0.5: at 0.5rem the chip's bottom edge landed on the Esri
      // attribution bar (measured 360–382 px on a 390 px-tall viewport), and
      // that credit has to stay readable in every UI state.
      phoneLand:
        'phone-land:left-1/2 phone-land:right-auto phone-land:w-[min(46vw,340px)] phone-land:bottom-[calc(env(safe-area-inset-bottom)+2.5rem)] phone-land:-translate-x-1/2',
    },

    // TouchControls.jsx:244 — the thumbstick anchor, transcribed exactly.
    // Touch-only, so there is no desktop geometry to preserve; `style` is the
    // authority because `max(env(...), 18px)` has no utility spelling.
    'controls-left': {
      desktop: 'absolute z-20',
      phonePort: '',
      phoneLand: '',
      style: {
        left: 'max(env(safe-area-inset-left), 18px)',
        bottom: 'calc(env(safe-area-inset-bottom) + 3.25rem)',
      },
    },

    // TouchControls.jsx:255 — the action cluster + throttle rail anchor.
    'controls-right': {
      desktop: 'absolute z-20',
      phonePort: '',
      phoneLand: '',
      style: {
        right: 'max(env(safe-area-inset-right), 16px)',
        bottom: 'calc(env(safe-area-inset-bottom) + 3.25rem)',
      },
    },

    // A full-bleed PASSTHROUGH, deliberately: AttributionBar's own
    // `.bottom-2.left-2` class pair is a FROZEN contract (verify-fly-style
    // selects the Esri credit by it), so the bar keeps its offsets and the
    // zone only has to not move the containing block. `inset-0` makes the
    // zone's box identical to the fly root's, so the bar lands on the same
    // pixels it always has.
    attribution: {
      desktop: 'absolute inset-0 z-10',
      phonePort: '',
      phoneLand: '',
    },

    // FlyMode.jsx — the desktop quick-exit X (`absolute right-4 top-4 z-10`).
    // Never rendered on touch (the Pause button's menu carries Exit).
    exit: {
      desktop: 'absolute right-4 top-4 z-10',
      phonePort: '',
      phoneLand: '',
    },
  },

  /**
   * The touch action cluster, IN ORDER. `photo` is an entry like any other —
   * round 17's photo mode plugs into the cluster instead of bolting a second
   * button rail onto the screen. Persistent entries are always shown;
   * `contextual: true` entries only mount when a contact is locked, so the
   * cluster stays four wide at rest on a 390 px screen.
   * (Owned by TouchControls — this array is the ORDER contract between the
   * layout half of the round and the input half.)
   */
  cluster: [
    { id: 'look', label: 'Free look', testid: 'touch-look' },
    { id: 'atlas', label: 'Open Atlas', testid: 'touch-atlas' },
    { id: 'logbook', label: 'Open logbook', testid: 'touch-logbook' },
    { id: 'photo', label: 'Photo mode', testid: 'touch-photo' },
    { id: 'pause', label: 'Pause', testid: 'touch-pause' },
    { id: 'inspect', label: 'Inspect contact', testid: 'touch-inspect', contextual: true },
    { id: 'intercept', label: 'Intercept', testid: 'touch-intercept', contextual: true },
    { id: 'cinema', label: 'Cinema cam', testid: 'touch-cinema', contextual: true },
  ],

  /**
   * Minimum interactive size on touch, in CSS px. 44 is the number both
   * platform HIGs land on and the number verify-mobile-layout gates every
   * visible pointer-events-auto control against (allow-list: the attribution
   * links and the photo-credit link, which are text, not controls).
   */
  minTargetPx: 44,

  /**
   * Toast stack LAYOUT. The stack DISCIPLINE (queueing, eviction, dwell) stays
   * in SpotToast.jsx and is byte-preserved — `maxStack` here is a documented
   * MIRROR of its MAX_STACK, used by the layout math and the harness so they
   * cannot silently disagree with the component. Change MAX_STACK and change
   * this in the same commit.
   */
  toast: {
    maxStack: 2, // MIRROR of SpotToast.MAX_STACK
    gapRem: 0.5, // desktop `gap-2`, restated for the phone card math
    // Phone cards are full-bleed within the zone's `inset-x-2`; landscape
    // bounds them so a 844 px-wide phone does not get a 6 cm-wide banner.
    landWidth: 'min(92vw, 430px)',
    // Two-line phone card: line 1 = label + callsign, line 2 = type + tier.
    // A single line of that content measures ~430 px and overflowed a 375 px
    // screen by ~55 px, which is the "things even overflow" the user saw.
    phoneTwoLine: true,
  },

  /**
   * The phone InfoCard is a CHIP, not a card: a 320 px-wide, 200 px-tall photo
   * card cannot coexist with a joystick, a throttle rail and a HUD strip on a
   * 390x844 screen. The chip shows callsign + distance + type and opens the
   * existing full inspect sheet on tap.
   */
  infoChip: {
    heightRem: 3, // 48 px — comfortably over minTargetPx
    closeRem: 2.75, // 44 px dismiss target
    // DERIVED, and derived from the RIGHT thing, which took two tries.
    //
    // First attempt used the thumbstick: 8rem tall (h-32), anchored at
    // `env(bottom) + 3.25rem`, so its top edge is 11.25rem up — dock at
    // 11.75rem and the chip clears it. The gate agreed. The SCREENSHOT did
    // not: the chip is full-width in portrait, and the taller stack it
    // actually has to clear is the RIGHT cluster, not the left stick.
    //
    // Right cluster, bottom-up: anchor 3.25rem + throttle rail (3 segments,
    // ~7.4rem) + gap-3 (0.75rem) + action row (h-12 = 3rem) = 14.4rem, so its
    // top edge sits ~14.4rem above the bottom. 15.5rem docks the chip's BOTTOM
    // about 1rem above that — measured 596 px vs a cluster top of 613 px on a
    // 390x844 screen.
    //
    // A5 LANDED (integration recompute, Fable): the portrait column is now
    // anchor 3.25 + rail 8.25 (min-h-11 detents) + gap 0.75 + BOOST pad 4.25 +
    // gap 0.75 + persistent row 3 = 20.25rem, and the CONTEXTUAL row (2.75rem
    // + gap) tops out at ~23.5rem whenever a lock exists — which is exactly
    // when the chip shows, so the worst case IS the common case. 24.5rem docks
    // the chip's bottom ~1rem above that; verify-mobile-layout's zone-overlap
    // gate measured the 15.5 value colliding with all five persistent buttons.
    dockBottomRem: 24.5,
  },

  /**
   * BootScreen particle budget. The boot screen mounts BEFORE the canvas, on
   * the frame where a phone is also compiling shaders and streaming tiles —
   * 70 independently-animated star divs and 9 streaks is a measurable cost
   * exactly when there is none to spare. Desktop keeps 70/9 (the values are in
   * BootScreen.jsx); phones take these.
   */
  boot: { phoneStars: 28, phoneStreaks: 5 },

  /**
   * LabelCanvas redraw rate on phones. The overlay canvas redraws per rAF;
   * at 30 Hz the labels still track smoothly while giving the GL frame back
   * half of the 2D compositing cost.
   */
  label: { phoneHz: 30 },

  /**
   * Atlas pick tolerance on touch. A fingertip is ~9 mm; the desktop pick
   * radius assumes a 1 px cursor hotspot, which is why POI cards were
   * essentially untappable.
   */
  atlas: { touchPickRadiusPx: 22 },

  // -------------------------------------------------------------------------
  // A5: input & interaction (round 17). Appended block — nothing above this
  // line was edited. Every value here is touch-gated at its read site, so a
  // desktop frame never sees any of it.
  // -------------------------------------------------------------------------

  /**
   * POI TAP tooltip (LabelCanvas). Desktop reveals a POI's name by HOVERING
   * near its 3D letter; touch has no hover at all, so the same tooltip is
   * driven by a tap and then has to persist on its own for a readable dwell.
   *   radiusPx  fat-finger pick radius around a projected letter. Deliberately
   *             SMALLER than the desktop `LABELS.poiHoverRadiusPx` (70): a
   *             hover ring follows the cursor continuously and can afford to
   *             be generous, while a tap is a one-shot commitment and a 70 px
   *             grab would steal taps meant for the world.
   *   dwellMs   how long the tapped tooltip stays up. A second tap on the same
   *             letter dismisses it early.
   */
  poiTap: { radiusPx: 48, dwellMs: 4000 },

  /**
   * Touch cluster geometry, in px. `buttonPx` is the persistent LOOK / ATLAS /
   * LOGBOOK / PHOTO / PAUSE circle (48 — comfortably over `minTargetPx` 44 and
   * the size the round-7 cluster already used); `contextualPx` is the
   * INSPECT / INTERCEPT / CINEMA row that only mounts on a lock, held at the
   * 44 px floor so three of them plus the five persistent buttons still fit
   * the 390 px portrait width; `boostPx` is the momentary BOOST pad under the
   * throttle rail, matched to the rail's own 68 px width.
   */
  clusterSize: { buttonPx: 48, contextualPx: 44, boostPx: 68 },
};

// ---------------------------------------------------------------------------
// Unit conversions
// ---------------------------------------------------------------------------

export const KT_TO_MPS = 0.514444;
export const FPM_TO_MPS = 0.00508;
export const FT_TO_M = 0.3048;

// ===========================================================================
// ROUND 18 "Alive & Dangerous" — pre-seeded blocks (Fable scaffolding commit).
// Each block is OWNED by exactly one R18 charter agent, named in its header;
// agents edit ONLY the interior of blocks they own (disjoint ranges = clean
// merges). Every block lands `enabled: false` and every read site must treat
// that as a byte-noop — flipping the flag back off after the round must
// restore pre-R18 pixels/behavior exactly. Values below are the plan's
// defaults; the owning agent measures, tunes, and documents deltas inline.
// ===========================================================================

/**
 * A1 BLOCKSMITH — satellite-only roof dispatch (replaces the three-way
 * gable/parapet/HVAC dispatch in buildSatBuildings; the shared toy `ROOFS`
 * block above is FROZEN — toy output stays byte-identical). Bands are
 * height-ordered, first match wins on form; clutter is additive and capped.
 * All new worker helpers call pushV with EXACTLY 4 args (NEUTRAL_UV — the
 * window-free roof contract).
 */
export const ROOFS_SAT = {
  // ONE-LINE REVERT. This flag gates EVERY R18 change on the satellite
  // building path — roof dispatch, the volume-stratified selection, the
  // house-height inference AND the tone re-tune (via `legacyTone` below).
  // false ⇒ buildSatBuildings runs the R15 code exactly, so the flag really
  // is a byte-noop revert and not a partial one.
  enabled: true,
  // Ring simplification tolerance (TILE units) used to decide a footprint's
  // TRUE corner count. Promoted from the R15 literal `simplifyRing(outer, 2)`
  // so the small-band form split has a tunable — a gable ridge only makes
  // sense on a genuine 4-corner ring.
  simplifyTolTile: 2,
  // Small band: houses/low commercial. gable|hip|shed split by hash for
  // rings that simplify to 4 corners; 3/5/6-corner rings take an inset-peak
  // pyramid; >6 stay flat but earn a chimney.
  small: {
    maxH: 16,
    maxAreaM2: 600, // widened from ROOFS.gable.maxAreaM2 400
    gableFrac: 0.4, // hash < .40 → gable
    hipFrac: 0.72, // .40–.72 → hip (insetFrac ~0.42), else shed
    pyramidInsetFrac: 0.55,
    hipInsetFrac: 0.42,
    riseM: [2.2, 3.6], // shared with ROOFS.gable.riseM semantics
    chimneyFrac: 0.5, // gable/hip roofs that also get a chimney
    // Brick stack near the ridge. halfM = the AABB half-extent (so a 0.7 m
    // flue), riseM = how far it pokes ABOVE the ridge line.
    chimney: { halfM: 0.35, riseM: [0.9, 1.6], tone: '#7d5548' },
  },
  // Mid band 16–45 m: parapet default + ONE clutter pick.
  mid: {
    parapetMinAreaM2: 150, // eased from ROOFS.parapet.minAreaM2 250
    mansardFrac: 0.2, // simp-4 rings under mansardMaxH only
    mansardMaxH: 24,
    mansardInsetFrac: 0.25,
    penthouseFrac: 0.35, // hash < .35 → penthouse
    tankFrac: 0.6, // .35–.60 → water tank (needs area ≥ tankMinAreaM2)
    tankMinAreaM2: 300,
    tankRM: [1.6, 2.4],
    tankHM: [3.0, 4.5],
    tankTone: '#5a4a3c', // dark timber (the NYC rooftop-tank read)
    // Stair/lift head-house: a centered box at this fraction of the SHORT
    // footprint span. Pale mechanical gray so it reads against dark tar AND
    // against a white membrane cap.
    penthouse: { spanFrac: [0.18, 0.3], hM: [3, 4.5], tone: '#9aa0a4' },
  },
  // Tall band 45–120 m: parapet + penthouse/HVAC + antenna farms.
  tall: {
    antennaFrac: 0.25,
    antennaCount: [2, 4],
    // Galvanized 4-sided tapered masts (NO emissive tip — this is daylight
    // geometry; an emissive vert here would also need the neon attrs the
    // satellite path deliberately does not carry).
    antenna: { hM: [4, 9], baseRM: [0.5, 0.9], tone: '#8d9297' },
  },
  // Supertall ≥120 m: crown band or spire mast (geometry-only, photo-
  // plausible, NO emissive — night windows can't leak onto NEUTRAL_UV).
  super: {
    minH: 120,
    crownFrac: 0.55,
    crownGain: 1.22,
    // Two stacked setback steps ABOVE the roofline (an inset band BELOW it
    // would be buried inside the solid wall box and invisible — the toy
    // crown only reads because it is emissive).
    crownStepM: [5, 3.5],
    crownStepInset: [0.14, 0.32],
    // Mast + PAINTED (not glowing) white tip. hFrac is of building height.
    spire: { hFrac: [0.1, 0.2], baseRM: 1.8, tone: '#8d9297', tipTone: '#d8d8d4' },
  },
  // Per-chunk caps (counted per building). Sized so <5% of extruded
  // buildings exhaust a cap (verify-roof-variety gates the flat-only share).
  // MEASURED re-size: the plan's 380/260/200/200 were authored against the
  // PRE-coverage-fix world, where a Manhattan chunk actually carried ~18
  // buildings. With classifyRingsSat landing the real footprints, a dense
  // chunk carries the full maxPerChunk 500 and those caps left 21% of
  // Manhattan flat (measured). The form caps now MATCH maxPerChunk so the
  // "always-something" guarantee can hold on the densest tile in the world;
  // the two clutter caps stay below it on purpose — clutter is the expensive,
  // optional layer, and thinning it on a 500-building chunk is invisible.
  caps: { smallForm: 500, parapet: 500, clutter: 320, chimney: 320 },
  // Volume-stratified selection replacing sort-by-area + slice: keep the
  // top anchorCount by areaM2*h (skyline anchors), then fill maxPerChunk by
  // sampling the remainder over a HASH-SHUFFLED order (MVT feature order is
  // often spatially clustered — raw-array stride would keep one corner of
  // the tile; Math.imul-hash the ids first).
  select: { anchorCount: 180 },
  // Untagged-house height inference band: footprints under maxAreaM2 read
  // as 1–2-story houses, not the 13–17 m mid-rises the √area curve gave.
  // NOTE the inferred height deliberately bypasses SAT_BUILDINGS.minH (6) —
  // clamping to it would compress this band to [6, 8] and undo half the fix.
  houseInfer: { maxAreaM2: 220, hM: [5, 8] },
  // The R15 tone values, VERBATIM. Duplicated on purpose: `enabled:false`
  // has to restore pre-R18 pixels EXACTLY, and a revert that depends on a
  // human retyping numbers out of a comment is not a revert. Frozen
  // historical data (the R7 "documented dead values" precedent) — never
  // edit these; tune the live ones in SAT_BUILDINGS.
  legacyTone: {
    wallTones: [
      '#8f8b82', '#83807a', '#98948a', '#7c7f83', '#8a867d',
      '#909499', '#a1968b', '#6f7276', '#9aa0a6', '#8b7d70',
    ],
    wallBaseMul: [0.5, 0.8],
    roofMid: ['#4e4b47', '#5f5a52', '#6e6a60', '#8e897c', '#4f6153', '#7b7166'],
    roofTall: ['#454341', '#565350', '#68645c', '#9a968b', '#736f68'],
  },
};

/**
 * A2 SKYLINE — distant block-mass ring (worker detail 'sat-skyline', z13,
 * lean fork of buildSatBuildings: mapped h ≥ minH OR area ≥ minAreaM2, no
 * roof detail, no uv; colors pre-hazed toward hazeColor). Near-field hole =
 * Bayer-dither discard inside hole.radiusM (feather hole.featherM) so the
 * mass only shows beyond the detail bubble; as SAT_BLDG_FADE dithers the
 * detail ring out (2400→3000 m AGL) the hole eases to 0 — the city BECOMES
 * mass instead of vanishing. EMPTY CHUNKS ISSUE NO MESH (Owens ≤261 holds
 * by construction). Bend variant 'world-bend-anchor-satskyline-r18'.
 */
export const SAT_SKYLINE = {
  enabled: false,
  ring: { z: 13, r: 14000 },
  maxChunksByTier: { low: 0, medium: 6, high: 10 },
  minH: 35,
  minAreaM2: 2500,
  simplifyTol: 6,
  maxPerChunk: 300,
  hazeMix: 0.35,
  hazeColor: '#b8c0c8',
  hole: { radiusM: 4000, featherM: 900 },
  fade: { startM: 7500, endM: 9000, evictM: 9500 }, // own AGL cull (city to ~30k ft)
};

/**
 * A3 GROUNDSKEEPER — satellite vegetation. Worker detail 'sat-veg' (z14)
 * ports the toy scatter recipe over park/landcover polys → satVeg
 * Float32Array [x, z, r, kind]; ONE pooled global InstancedMesh canopy
 * (squashed low-poly blob, MeshLambert, desaturated palette — no toy green,
 * no additive). mesh.visible = false whenever placed count is 0 (a
 * zero-count InstancedMesh still issues a draw — Owens must stay flat).
 */
export const SAT_VEG = {
  enabled: false,
  maxPerChunk: 400,
  poolByTier: { low: 0, medium: 1500, high: 3000 },
  palette: ['#3f5233', '#4a5c38', '#55603f', '#5b6844'],
  lumaJitter: 0.12,
  altFade: { onM: 1800, offM: 2400 }, // instance-color fade, matches building read band
  placeCadenceSec: 2, // SatCityGlow idiom
};

/**
 * A3 GROUNDSKEEPER — ambient movers (high tier only; phones never see
 * these by static gate). Anchored to worker-emitted real-data points
 * (satPts.water / satPts.ind). +1 draw each, day-visible motion.
 */
export const SAT_AMBIENT = {
  enabled: false,
  boats: { minTier: 'high', max: 48, speedMps: 1.5, hullM: [2, 8] },
  plumes: { minTier: 'high', max: 12, quadsPerStack: 3, riseSec: 7 },
};

/**
 * A4 SHOWTIME — screen shake, implemented INSIDE chase-camera.update after
 * the quaternion slerp (3 incommensurate sines × (speedShake + trauma²)).
 * Wires the two dead CAMERA.shakeSpeedFraction/shakeMaxDeg semantics: the
 * speed term is zero below speedFrac × boost — probes at cruise see
 * literally no motion (verify-chase-cam safe by construction). Trauma is a
 * module accumulator in lib/fly/juice.js (addTrauma), decaying to 0.
 */
export const SHAKE = {
  enabled: false,
  speedFrac: 0.8,
  maxDeg: 0.2,
  traumaMaxDeg: 1.4,
  traumaDecayPerSec: 1.4,
  noiseHz: 11,
  sources: { nearMiss: 0.35, buzz: 0.25, boostEngage: 0.15, crash: 1.0 },
};

/**
 * A4 SHOWTIME — near-miss bonus off real ADS-B traffic: closest-approach
 * inflection on runtime.traffic.items .distM below distM with closing speed
 * above closingMps. Hex-keyed cooldown + global rate cap; prev-dist Map is
 * bounded to tracks inside trackRangeM.
 */
export const NEARMISS = {
  enabled: false,
  distM: 120,
  closingMps: 80,
  cooldownSec: 20,
  maxPerMin: 6,
  basePts: 50,
  trackRangeM: 2000,
};

/**
 * A4 SHOWTIME — combo chain. Scoring events (near-miss, buzz, touch-go,
 * contract complete, rare+ spot) refresh the window; points bank AT EVENT
 * TIME × (1 + multStep·(combo−1)) capped at multCap; expiry or crash → 0.
 * Store writes on transitions only.
 */
export const COMBO = { enabled: false, windowSec: 8, max: 8, multStep: 0.25, multCap: 3 };

/**
 * A4 SHOWTIME — session score + per-run stats. A run ends at crash
 * (RunSummary overlay, auto-dismiss) and is inspectable from the pause
 * menu. Session-only — nothing persists (economy is a future round).
 */
export const SESSION = { enabled: false, summaryAutoDismissSec: 6 };

/**
 * A4 SHOWTIME — procedural music director (lib/fly/music-director.js), own
 * nodes on the SAME AudioContext via audio.bus(). Four layers: AGL air bed,
 * speed-keyed pentatonic pulse, proximity tension swell, night pad
 * (satellite runtime.sun.frac < 0.3). D-dorian, root walk by crossfade,
 * driven at updateHz (never per frame), setTargetAtTime everywhere.
 * enabled:false ⇒ ZERO nodes created.
 */
export const MUSIC = { enabled: false, gain: 0.16, updateHz: 2, rootWalkSec: 60 };

/**
 * A5 GRAVITY — boost as a meter: drains while boosting, regenerates
 * otherwise; empty coerces cmd.boost false until the meter refills past
 * rearmFrac. Autopilot speedOverride is EXEMPT (intercepts unaffected —
 * verify-fly-formation/inspect-actions hold). runtime.boost = {frac, armed}.
 */
export const BOOST_METER = { enabled: false, capacitySec: 6, regenSec: 12, rearmFrac: 0.25 };

/**
 * A5 GRAVITY — crash stakes (default ON at round close via enabled:true;
 * the persisted PauseMenu "Forgiving flight" toggle gates the same reads
 * per-user and restores R17 behavior byte-for-byte). Terrain crash iff
 * floor contact with sink > terrain.sinkMps OR (speed > diveSpeedMps AND
 * pitch < −diveDeg) — gentle contact keeps the R6 slide. Building crash
 * (satellite only) via sat-building-engine collision columns at
 * ≥ building.minSpeedMps. armDelaySec after mount AND every warpEpoch bump:
 * no harness warp, boot probe, or pinScene pose can ever crash — the
 * fleet-safety invariant verify-crash pins.
 */
export const CRASH = {
  enabled: false,
  armDelaySec: 5,
  terrain: { sinkMps: 30, diveSpeedMps: 200, diveDeg: 18 },
  building: { minSpeedMps: 45 },
  sequence: { tumbleSec: 1.2, totalSec: 1.8 },
  respawn: { backM: 2000, aglM: 400 },
};

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
    // R19 SANCTIONED (plan §1 decision 2 — spend the high-tier headroom):
    // 0.12 → 0.28. At 0.12 the discs were below the noise floor of Esri
    // imagery: the field study never saw a cloud shadow on the ground in
    // fifteen minutes of flight. Cost is unchanged (one material.opacity —
    // same pool, same +1 draw). minTier STAYS 'high': medium/low are
    // byte-frozen this round (decision 2), and this value is only ever read
    // when wantShadows is true, which is high-tier + style.shadows only.
    opacity: 0.28,
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
    // Round 18 live fix (Fable, user-reported at CMH dusk): the night ramp
    // keys off EFFECTIVE light, not solar elevation alone — under heavy
    // overcast the whole scene darkens (SKY_LIVE.weatherDim + the lid) while
    // tracers stayed pinned at dayGain 0.38, and additive ribbons calibrated
    // to bloom against SUNLIT ground read as nothing against a dim tan dome
    // ("ALL trails are gone"). overcastNightK scales sun.frac down by up to
    // this fraction at full overcast before the nightT inverse-lerp, so a
    // fully-overcast noon behaves like late dusk (~0.74 gain) and a clear
    // noon is BYTE-IDENTICAL (overcastT 0 ⇒ identity — which is also why
    // every weather-baseline harness gate is untouched). 0 = R16 behavior.
    overcastNightK: 0.65,
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
    // Round 18 (A2) — the "blank clay prism" fix, VALUE ONLY (satellite taste
    // lock: no toy tint on Esri imagery). Two halves:
    //  (1) a `variant:'sat'` GEOMETRY set (landmarks-3d.js) adds setback
    //      ledges / cornice steps / a chamfered tower shaft / buttress hints /
    //      a drum step — silhouette, which is what actually reads at range.
    //      The TOY geometry is untouched (verify-monuments guards its pixels).
    //  (2) those sat parts carry value-only GREY vertex colours (zero hue) and
    //      the satellite MeshToon flips vertexColors:true, so the flat stone
    //      tint above gains contact-darkening at the base, sky bounce at the
    //      top and light-catching cornices. Every number multiplies the tone —
    //      1.0 everywhere would be the R13 look byte-for-byte.
    value: {
      baseMul: 0.84, // vertex multiplier at the monument's base (y = 0)
      topMul: 1.06, // …at its top (y = 1): ground grime → sky bounce
      // Role tone = the toy palette hex's LUMA ÷ monumentBody's, clamped here.
      // One number carries every part's role across both styles: a monumentTrim
      // cornice lands at roleMax, a monumentDark plinth at roleMin, a body face
      // at 1 — value only, the neon hue discarded entirely.
      roleMin: 0.8,
      roleMax: 1.16,
      accentTone: 1.18, // tips/crowns — the toy EMIT ×3.2 would blow out on imagery
    },
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
  // Round 19 (B, decision 2 — SANCTIONED by-tier restructure): high goes
  // 4 → 8, medium/low BYTE-IDENTICAL (4 / 2). This camera lives at grazing
  // angles, which is exactly where aniso buys the most; R11 dropped it to 4
  // as a blanket perf floor when satellite became the default and was never
  // re-certified per tier. `anisotropy` (the un-tiered fallback) stays 4 so
  // nothing that misses the tier map changes behaviour.
  anisotropy: 4,
  anisotropyByTier: { high: 8, medium: 4, low: 2 },
};

export const TILES = {
  // Round 11: 17 → 16 — z17 quadrupled low-AGL texture churn and satellite
  // is the default now; revert-knob, evaluate live (round 7 raised it).
  // Round 19 (B, decision 2 — SANCTIONED by-tier restructure): z17 comes BACK
  // on the high tier only. R11's objection was churn, not budget: the LRU
  // (lruBudgetBytes, unchanged 140 MB) is what bounds resident texture memory,
  // and the quadtree descends to z17 only where screen-space error demands it
  // (low AGL), so the extra level is paid exactly where the field study found
  // the "magnified blur" (P5) and nowhere else. `satMaxZoom` stays as the
  // by-tier fallback so any un-tiered reader keeps the R11 value.
  // Consumed in lib/fly/tile-sources.js; verify-aerial gates boot ≤ +20% and
  // texture bytes ≤ 300 MB, with an LODThreshold clamp as the named fallback.
  satMaxZoom: 16,
  satMaxZoomByTier: { high: 17, medium: 16, low: 16 },
  // Round 19 (B) — THE z17 DRAW CLAMP, and the reason z17 is affordable.
  // MEASURED: turning z17 on alone took the verify-sat-depth Owens pose from
  // 255 to 270 draws against a gate of 261 that is explicitly not
  // re-baselineable (plan §2). One extra level quadruples the tiles in the
  // near ring, and those are real draws.
  //
  // three-tile subdivides a tile when `distance / tileSize` (×0.8 in frustum)
  // is <= LODThreshold, so LOWERING the threshold makes every level subdivide
  // CLOSER IN. That is exactly the trade the field study asked for: z17 texels
  // directly under and ahead of the aeroplane (P5 "magnified blur"), paid for
  // by a tighter mid-field ring that was over-tessellated for its screen size
  // anyway. It is the plan's named fallback ("clamp the z17 descent via
  // LODThreshold rather than ship the regression") applied to draws.
  // MEASURED at the verify-sat-depth Owens pose (draws, high tier):
  //   z16 + threshold 1  (R18 baseline) ....... 255
  //   z17 + threshold 1  (naive)  ............. 270   ← breaks the 261 gate
  //   z17 + threshold 0.86 (shipped) .......... 209   ← sharper AND cheaper
  // The last row is not a compromise: the A/B screenshots
  // (scripts/r19-b-lod-baseline-r18.png vs r19-b-lod-cand-086.png) show MORE
  // ground and ridge detail than the R18 baseline. z17 buys texel resolution
  // where the eye is; the tighter threshold sheds mid-field GEOMETRY that was
  // subdivided far below its screen footprint and was costing draws for
  // silhouette nobody could resolve.
  // High only; medium/low keep three-tile's default 1 byte-identical.
  lodThresholdByTier: { high: 0.86, medium: 1, low: 1 },
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
  // R19 SANCTIONED (plan §1 decision 4 — the USER decided): 'baseline' →
  // 'procedural'. The generator is deterministic (0.25° cell + 3 h UTC
  // bucket) and fires ONLY when both upstreams miss, so a session is never
  // skyless. The whole harness fleet stays deterministic because _boot.js
  // pins window.__flyWeatherOverride = 'baseline', which short-circuits
  // inside computeTargets BEFORE this fallback is ever consulted.
  fallback: 'procedural',
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
  // R19 SANCTIONED (plan §1 decision 4 / R18 §6 checkpoint #17): zenithK
  // 0.82 → 0.66. The lid v2 rework needs a real top-to-bottom value spread;
  // 0.82 was an 18% drop across the whole sky, which is why an overcast dusk
  // read as one flat tan field. The remaining shaping is OVERCAST_V2's
  // (horizonKeep / zenithRamp / duskChroma). Still an exact no-op at
  // overcastT 0 — this value only ever reaches the shader through the
  // `uOvercast` mix.
  overcastLid: { zenithK: 0.66, alphaFeather: 0.06 },
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
  enabled: true, // flip false = byte-noop revert (the layer never mounts)
  // RING ZOOM — 14, NOT the plan's 13. A1 measured the live tileset: at z13 the
  // OMT `building` layer is pre-merged, so 13/2412/3078 (all of Manhattan) is
  // ONE 9.9M m² blob that the shared mega-block guard correctly discards — a
  // z13 ring emits NOTHING, anywhere. z14 4824/6157 (same ground) ships 1469
  // buildings, 1066 of which pass this block's filter. `r` is the OUTER clamp
  // in WORLD (mercator) units; in practice maxChunksByTier binds first (see
  // the group arithmetic below).
  ring: { z: 14, r: 14000 },
  // GROUPING — the reach fix. One z14 tile is 2446 world units across, so a
  // 10-DRAW ring of single tiles reaches only sqrt(10/π)·2446 ≈ 4.4 km: barely
  // past the 3.6 km detail ring, i.e. the "city ends at the bubble" bug with a
  // longer bubble. A chunk here is therefore a groupN×groupN BLOCK of z14
  // tiles MERGED into one geometry — same draw budget, groupN× the linear
  // reach: at 2 the 10 high-tier chunks cover 40 tiles ⇒ sqrt(40/π)·2446 ≈
  // 8.7 km (≈6.6 km true ground at NYC latitude), 3.2× the detail bubble.
  // Raising it to 3 reaches ≈13 km but costs 90 tile fetches per ring fill —
  // measure the tri/fetch budget before moving it.
  groupN: 2,
  maxChunksByTier: { low: 0, medium: 6, high: 10 }, // GROUPS = draws (one merged mesh each)
  // Selection filter (read by the worker's buildSatSkyline). MEASURED on the
  // densest tile on earth, 14/4824/6157 Manhattan Midtown: 1469 buildings
  // parsed, 1066 pass `h ≥ minH || area ≥ minAreaM2`, and the maxPerChunk 300
  // volume-sort cap yields 33,825 verts / 16,725 tris (≈56 tris per block).
  // Worst-case NYC ring (40 tiles, ~4 of them Manhattan-dense) measures well
  // under the 250k-tri budget — see FLY_ROUND18.md. maxPerChunk is PER SOURCE
  // z14 TILE, so a group's cap is maxPerChunk × groupN².
  minH: 35,
  // THE AREA-ONLY ESCAPE HATCH IS OFF (any value the mega-block guard already
  // rejects disables it; this one says so out loud). The worker's rule is
  // `rawH >= minH || areaM2 >= minAreaM2`, and for the second half it INVENTS a
  // height — 12 + √area·0.6, clamped 18–60. MEASURED over 3×3 z14 blocks, that
  // clamp saturates: every single area-only pick at 2500 m² and above comes out
  // at exactly 60 m, a 20-storey tower.
  //     buildings parsed / by height ≥35 / by area (all invented at 60 m)
  //     Manhattan 7493 / 5004 / 208    Chicago Loop 932 / 631 / 68
  //     Denver    2339 /  530 / 229    Boise         99 /  24 / 26
  //     Naperville  44 /    1 /  20    Owens Valley   7 /   0 /  3
  // So the hatch grows a fake downtown over every suburban big-box strip and
  // three 60 m towers over an empty desert, while a dense core (where
  // maxPerChunk binds long before) loses ~4% of its blocks by dropping it.
  // A distant skyline is made of things that are actually tall.
  minAreaM2: 1e9,
  simplifyTol: 6, // ≈1 screen px at 8 km — corners past this are aliasing noise
  maxPerChunk: 300,
  hazeMix: 0.35,
  hazeColor: '#b8c0c8',
  // NEAR-FIELD HOLE — the mass draws only BEYOND the detail bubble (Bayer
  // dither on the block's ANCHOR distance, feathered over featherM), so the
  // two rings never double-draw the same downtown and never z-fight. radiusM
  // sits comfortably outside SAT_BUILDINGS.ring.r (3600).
  hole: { radiusM: 4000, featherM: 900 },
  // …and it EASES TO 0 across SAT_BLDG_FADE's own dissolve band (2400→3000 m
  // eye-AGL): as the detail ring screen-doors away the hole closes underneath
  // it, so the city BECOMES block mass instead of vanishing. The band is read
  // live from SAT_BLDG_FADE (single source of truth — never mirrored here).
  fade: { startM: 7500, endM: 9000, evictM: 9500, rearmM: 9200 }, // own AGL cull (city to ~30k ft)
  // --- streaming (the SAT_BUILDINGS skeleton, minus water/facade/night) -----
  maxBuilds: 8, // concurrent worker tile builds (I/O bound — its OWN worker instance)
  finalizePerFrame: 1, // merged-group GPU uploads per frame (spike guard)
  // Frustum-cull margin. The d²k drop happens in the SHADER, so three's
  // bounding sphere is the UNBENT one; at the ring's outer edge the drop is
  // 14000²·k ≈ 980 m, which could false-cull a group at the screen edge (the
  // near ring never hits this — 2.4 km out the drop is 29 m). Inflate rather
  // than disable culling: off-screen groups must still cost nothing.
  cullMarginM: 1200,
  drapeGridN: 12, // (n+1)² DEM samples per GROUP → bilinear per-block drape
  drapeBudgetMs: 0.8, // ms/frame spent filling those grids
  demZ: 10, // coarse DEM is fine at range (the near ring demands 12)
  drapeMaxTries: 12,
  warpCoarseTries: 2, // right after a warp, accept a coarse drape fast
  warpCoarseWindowSec: 20,
  refreshMoveM: 1200, // recompute the desired group set after moving this far…
  refreshSec: 3, // …or at least this often (groups are 4.9 km wide — slow is fine)
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
  enabled: true, // flip false = full revert (no mount, no worker, no draws)
  // Own z14 ring at the building ring's radius: trees are the carpet those
  // buildings stand on, so the two bubbles should arrive and leave together.
  // r is in WORLD (mercator) units ≈ true m × 1/cos lat (at NYC 3600u ≈ 2.7km).
  ring: { z: 14, r: 3600 },
  // The 3×3 block around the player at high tier (guaranteed coverage ≥ one
  // tile span in EVERY direction even with the player on a tile corner, which
  // is what distFade below is sized against). SHED LEVER.
  maxChunksByTier: { low: 0, medium: 6, high: 9 },
  maxBuilds: 2, // concurrent worker builds (veg shares the layer's own worker)
  refreshMoveM: 600, // recompute the desired chunk set after moving this far…
  refreshSec: 2, // …or at least this often
  // Per-chunk bilinear ground grid. The plan sketched 3×3; 4 segments (25
  // samples, ≈460 m spacing at z14) is the DELIBERATE deviation — a 3×3 grid
  // interpolates a 1.8 km tile from 930 m spacing, and on Alpine/Sierra slopes
  // that buries or floats a 5 m canopy outright. 25 amortized getGroundAt per
  // chunk is still an order of magnitude under the building engine's
  // one-per-building drape.
  gridSegments: 4,
  sampleBudgetMs: 0.8, // ms/frame spent sampling DEM for pending chunks
  // MEASURED, and the reason this engine does NOT copy the road/building hold:
  // at Owens Valley the outer ring never reaches demZ at all, and holding for
  // it left 3 of 9 chunks treeless 26 s after arrival — at cruise a player
  // crosses a z14 tile in ~18 s, so the carpet would permanently lag behind.
  // A canopy only needs to stand on the RIGHT HILL, not on the right storey.
  // So: hold ONLY while the DEM is genuinely absent (a null sample would park
  // trees at sea level — the one unacceptable artifact), commit on the first
  // full pass otherwise, and RE-GRID in place, without evicting or refetching,
  // the moment a finer DEM tile answers under the chunk.
  demZ: 12, // …below this the grid is 'coarse' — good enough to show, worth healing
  missMaxTries: 8, // ~12s of holding for a chunk with NO dem coverage at all
  missRetrySec: 1.5,
  healPerRefresh: 2, // coarse chunks re-gridded per desired-set pass
  // Altitude gate with hysteresis. cullAglOnM sits BELOW altFade.offM on
  // purpose: by the time the ring evicts, every canopy has already scaled to
  // zero, so eviction acts on invisible geometry (the SAT_BLDG_FADE lesson).
  cullAglOnM: 2000,
  cullAglOffM: 2600,
  maxPerChunk: 400, // = the worker's frozen per-tile cap (A1) — mirrored here
  poolByTier: { low: 0, medium: 1500, high: 3000 },
  // Per-chunk placement cap = floor(pool / maxChunks) is computed by the layer,
  // NOT stored: maxChunks × cap ≤ pool is what makes the pool cut impossible,
  // and a pool cut is a hard radius that pops as the player moves. Chunks over
  // the cap are decimated by a STABLE index stride (never a distance sort), so
  // a tree never blinks because the player drove past it.
  palette: ['#3f5233', '#4a5c38', '#55603f', '#5b6844'],
  lumaJitter: 0.12,
  radiusMul: 1.6, // canopy radius trim (worker radii come from TOY_WORLD.trees)
  crownFrac: 0.62, // broadleaf: instance scale (r, r·this, r) — a squashed blob
  crownLiftFrac: 0.5, // …centred this × r above ground, so the base tucks under
  // Conifers (worker kind 1, the `wood` landcover mix): taller + narrower + a
  // touch darker. Same ONE geometry — kind only moves scale and tint, because
  // a second geometry would be a second draw.
  conifer: { widthFrac: 0.7, heightFrac: 1.15, liftFrac: 0.95, tint: 0.86 },
  // Ring-edge ramp (scale, not color): a chunk streaming in or evicting at the
  // ring edge must be a non-event. endM is inside the guaranteed-coverage
  // radius above, so canopies always die of THIS and never of a missing chunk.
  distFade: { startM: 1800, endM: 2400 },
  // Altitude fade. SCALE-to-zero, not color-to-ground-blend: the canopy
  // material is OPAQUE Lambert, and fading an opaque instance by darkening its
  // color paints black trees, not absent ones. Scale is also free — it folds
  // into the matrix the cadence pass already writes (zero per-frame work).
  altFade: { onM: 1800, offM: 2400 },
  placeCadenceSec: 2, // SatCityGlow idiom — never per frame
};

/**
 * A3 GROUNDSKEEPER — ambient movers (high tier only; phones never see
 * these by static gate). Anchored to worker-emitted real-data points
 * (satPts.water / satPts.ind). +1 draw each, day-visible motion.
 */
export const SAT_AMBIENT = {
  enabled: true, // flip false = full revert (no meshes, no placement, no draws)
  boats: {
    minTier: 'high',
    max: 48,
    speedMps: 1.5,
    hullM: [2, 8], // beam × length of the hull box (a cabin box rides on top)
    // The LEASH is the on-water proof. The worker samples every anchor
    // STRICTLY inside a water polygon with a 60-unit clearance box, so a
    // CLOSED path of radius < 60 around that anchor cannot beach. Boats trace
    // that path at speedMps (period = 2πr/v ≈ 142 s) instead of integrating a
    // free heading — a drifting integrator would leave the clearance in a
    // minute and read as a beached bug.
    wanderM: 34,
    liftM: 0.6, // hull centre above the sampled water surface
    sizeJitter: 0.35, // ±this fraction of hull size, hashed per anchor
    colors: ['#eceff1', '#cfd5da', '#9aa3ab', '#d9d3c4'],
    rangeM: 3000, // cull anchors past this (a boat at 3 km is 2 px)
  },
  plumes: {
    minTier: 'high',
    max: 12,
    quadsPerStack: 3,
    riseSec: 7,
    // MEASURED across three passes. 16 → 46 over 160 m read as a dust storm at
    // 260 m AGL; 7 → 20 over 120 m disappeared. A column has to stay narrow
    // relative to its HEIGHT (three 50 m puffs over a 150 m rise overlap into
    // one blob) while still subtending something at the 1–3 km an industrial
    // site is normally seen from. This is the middle, and it is the knob to
    // turn first if the user wants stacks louder or quieter.
    baseRM: 9, // puff radius at the stack…
    topRM: 26, // …and at the top of the rise (it billows out)
    riseM: 140,
    liftM: 8, // stack base above the sampled ground
    color: '#f4f8fb', // at the stack mouth…
    disperseColor: '#b9c4cd', // …lerped to this by the top of the rise
    opacity: 0.62, // material opacity (normal blending — see SatAmbientLife)
    edgeK: 5, // scale envelope steepness: a puff grows out of nothing at the
    // mouth and collapses back into it at the top, over 1/edgeK of the cycle
    // each. The ENVELOPE IS SCALE because an InstancedMesh has no per-instance
    // alpha and dimming a normal-blended puff paints grey, not absence.
    rangeM: 3000,
  },
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
  enabled: true,
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
  enabled: true,
  distM: 120,
  closingMps: 80,
  cooldownSec: 20,
  maxPerMin: 6,
  basePts: 50,
  trackRangeM: 2000,
  toastMs: 4200, // dwell in SpotToast's deferred queue (contract-toast pacing)
  accent: '#fbbf24', // amber — distinct from spot/spicy red and contract green
};

/**
 * A4 SHOWTIME — combo chain. Scoring events (near-miss, buzz, touch-go,
 * contract complete, rare+ spot) refresh the window; points bank AT EVENT
 * TIME × (1 + multStep·(combo−1)) capped at multCap; expiry or crash → 0.
 * Store writes on transitions only.
 */
export const COMBO = { enabled: true, windowSec: 8, max: 8, multStep: 0.25, multCap: 3 };

/**
 * A4 SHOWTIME — session score + per-run stats. A run ends at crash
 * (RunSummary overlay, auto-dismiss) and is inspectable from the pause
 * menu. Session-only — nothing persists (economy is a future round).
 */
export const SESSION = {
  enabled: true,
  summaryAutoDismissSec: 6,
  // Base points per scoring event BEFORE the combo multiplier. The near-miss
  // keeps its own knob in NEARMISS.basePts (it is the headline event and gets
  // tuned against the detector, not against this table). Values are sized so
  // a contract still out-scores a lucky fly-by chain.
  pts: { buzz: 60, touchGo: 140, contract: 200, spot: 90 },
  // Minimum rarity score a spot must reach to feed the chain — RARITY_TIERS
  // .rare.min. Anything below is the ambient sky, not an arcade moment.
  spotMinRarity: 50,
};

/**
 * A4 SHOWTIME — procedural music director (lib/fly/music-director.js), own
 * nodes on the SAME AudioContext via audio.bus(). Four layers: AGL air bed,
 * speed-keyed pentatonic pulse, proximity tension swell, night pad
 * (satellite runtime.sun.frac < 0.3). D-dorian, root walk by crossfade,
 * driven at updateHz (never per frame), setTargetAtTime everywhere.
 * enabled:false ⇒ ZERO nodes created.
 */
export const MUSIC = {
  enabled: true,
  gain: 0.16, // understated on purpose — this sits UNDER the wind/engine bed
  updateHz: 2,
  rootWalkSec: 60,
  fadeSec: 1.6, // setTargetAtTime time-constant for every layer gain
  glideSec: 6, // root-walk pitch blend — long enough to never read as a cut
  // D dorian, walking D → F → C → G. Octave 2 so the bed sits under the
  // engine fundamental (45–130 Hz) instead of fighting it.
  roots: [73.42, 87.31, 65.41, 98.0],
  bed: { gain: 0.55, aglRefM: 3000, cutoff: [220, 900] },
  pulse: {
    gain: 0.3,
    rateBySpeed: { slow: 0, cruise: 0.7, boost: 2.2 }, // notes/sec
    steps: [0, 3, 5, 7], // D F G A — minor pentatonic inside dorian
    octave: 4, // two octaves over the bed root
    noteSec: 0.18,
  },
  tension: { gain: 0.42, nearDistM: 400, lowAglM: 150, fastMps: 300 },
  night: { gain: 0.36, sunFrac: 0.3 }, // opens as runtime.sun.frac falls below
};

/**
 * A5 GRAVITY — boost as a meter: drains while boosting, regenerates
 * otherwise; empty coerces cmd.boost false until the meter refills past
 * rearmFrac. Autopilot speedOverride is EXEMPT (intercepts unaffected —
 * verify-fly-formation/inspect-actions hold). runtime.boost = {frac, armed}.
 *
 * SCOPE (deliberate, R18): the meter governs the HELD boost — `cmd.boost`,
 * i.e. Shift on desktop and the BOOST pad on touch. The `3` SPEED PRESET is
 * NOT metered. Two reasons, in order:
 *   1. It is what the charter says ("while cmd.boost effective"), and the
 *      model coercion it specifies (`boostBlocked` ⇒ treat cmd.boost as
 *      false) falls back to `F.speeds[cmd.speedPreset]` — which IS cruise
 *      for a Shift-holder. "Speed drops to cruise while the HUD legend still
 *      reads BOOST" is exactly that fallback (FlyHUD prints BOOST off
 *      `cmd.boost`, which is the raw input and is never coerced).
 *   2. Harness safety by construction: verify-edge-fx presses `3` and gates
 *      "boost crossed >= 3 rebases" over a 40 s run — 3 rebases at 10 km is
 *      ~40 s of sustained 750 m/s, i.e. the gate has NO slack. Metering the
 *      preset would have forced a re-baseline, and none is sanctioned this
 *      round.
 * If a later round wants EVERY boost metered, it is one predicate in
 * FlyScene's meter block plus a MEASURED verify-edge-fx re-baseline.
 *
 * Held-while-empty behavior: the meter regenerates even while the button is
 * still down, so holding forever settles into a rearmFrac duty cycle
 * (1.5 s of boost per 3 s of regen at these numbers). That sputter IS the
 * feedback — releasing is strictly better than holding.
 */
export const BOOST_METER = {
  enabled: true,
  capacitySec: 6, // seconds of held boost from full
  regenSec: 12, // seconds from empty to full while not boosting
  rearmFrac: 0.25, // hysteresis: empty stays blocked until the meter refills here
};

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
  enabled: true,
  // THE FLEET-SAFETY INVARIANT. Nothing can crash inside this many seconds of
  // (a) FlyScene mount, (b) any warpEpoch bump, (c) a respawn. Every harness
  // pose in scripts/ arrives by warpToGeo/warpTo or a pinScene built on one,
  // so the whole browser fleet is immune by construction. verify-crash gate 1
  // SOURCE-asserts this is >= 5 before it ever opens a browser — treat it as
  // a floor, not a knob.
  armDelaySec: 5,
  terrain: {
    // Sink is the COMMANDED rate at contact (sin(pitch) * speed), not the
    // realized one — the flight model's soft floor scales the realized rate
    // toward zero as you enter the band, so a detector reading it could
    // never fire. See flight-model.js's floorContact comment.
    sinkMps: 30,
    diveSpeedMps: 200,
    diveDeg: 18,
  },
  building: {
    minSpeedMps: 45, // below this, threading the towers is the playground
    queryRadiusM: 120, // search radius handed to satBuildings.queryColumns
  },
  sequence: {
    tumbleSec: 1.2, // ballistic spin/plunge before the cut
    totalSec: 1.8, // stick stays neutralized until here (flash covers the cut)
    spinDegPerSec: 200, // yaw rate at t=0, decaying linearly to 0 at tumbleSec
    pitchDeg: -60, // nose falls toward this
    speedBleedFrac: 0.4, // ...and 40% of the speed goes with it
    flashMs: 900, // CrashFlash overlay lifetime (WarpFlash.flashMs sibling)
  },
  respawn: { backM: 2000, aglM: 400 },
};

// =========================================================================
// ROUND 19 "Honest World" — pre-seeded blocks (Fable scaffolding commit).
// Each block is OWNED by exactly one R19 charter agent, named in its header;
// agents edit ONLY the interior of blocks they own (disjoint ranges = clean
// merges), never append past the end of this file, never reorder blocks.
// Every block lands `enabled: false` and every read site must treat that as
// a byte-noop — `enabled: false` on the FINISHED feature must restore
// pre-R19 pixels/behavior exactly (it is the feature's one-flag rollback).
// Values are the plan's defaults; the owning agent tunes its interiors and
// documents every move in its report. FLY_ROUND19_PLAN.md §4 is the contract.
// =========================================================================

/**
 * A HOMESTEAD — typology-aware height inference for UNTAGGED footprints past
 * ROOFS_SAT.houseInfer.maxAreaM2 (220). Replaces the bare sqrt-area mid-rise
 * curve ONLY inside suburban-context chunks (guard below); downtown-context
 * chunks keep the legacy curve VERBATIM — wrong typology is worse than
 * empty, and the conservative direction is DOWN. Inferred-suburban walls
 * emit NEUTRAL_UV (window-free): a school at night goes dark instead of
 * blazing with the office facade atlas (the field study's P1).
 */
export const ROOF_TYPOLOGY = {
  enabled: true,
  // Suburban-context guard: a chunk qualifies iff BOTH hold. Any tagged
  // building >= tallM present, or dense footprint cover, reads as downtown
  // → legacy curve, untouched.
  //
  // MEASURED on the live z14 tileset (see FLY_ROUND19.md / A's report): the
  // guard is evaluated per SOURCE TILE over the post-filter footprint set
  // (hide_3d and the 60,000 m² mega-block guard already applied). Cover is
  // sum(areaM2) / tileArea in the SAME mercator units, so it is ratio-safe
  // at every latitude. Downtown chunks fail on the tagged-tall clause long
  // before cover matters — cover is the second lock for generalised cores
  // that ship footprints with no heights at all.
  context: { maxTallTagged: 2, tallM: 40, maxFootprintCover: 0.12 },
  // Bands are checked in order; first match wins. aspectMin is the bbox
  // long/short ratio that promotes a mid-size footprint to 'strip'.
  //
  // `roofBand` selects the ROOF PALETTE (SAT_BUILDINGS.roofTones) instead of
  // letting the height band pick it. Without this every typology building —
  // now 6-14 m — would drop under roofTones.lowMaxH (16) and wear the HOUSE
  // palette, i.e. terracotta/brick-red big-box stores and warehouses. The
  // palettes themselves are R15/R18 checkpointed values and are NOT touched;
  // only which one a typology-inferred building reads from.
  //
  // `warehouse` is the ONE deviation from the plan's sketch: hM [10,16] →
  // [10,14]. The plan's own verify-suburbia contract is "zero untagged
  // buildings > 14 m in suburban-context chunks", and a [10,16] band breaks
  // it by construction. 14 m is still an honest distribution centre (46 ft)
  // and the charter's stated direction is DOWN. With every band ceiling at
  // or below 14 and hash < 1, the gate now holds BY CONSTRUCTION rather than
  // by luck of the hash draw.
  bands: [
    { maxAreaM2: 600, hM: [6, 9], form: 'house', roofBand: 'low' },
    { maxAreaM2: 2500, aspectMin: 3, hM: [6, 8], form: 'strip', roofBand: 'mid' },
    { maxAreaM2: 2500, hM: [7, 12], form: 'school', roofBand: 'mid' },
    { maxAreaM2: 10000, hM: [8, 14], form: 'bigbox', roofBand: 'mid' },
    { maxAreaM2: Infinity, hM: [10, 14], form: 'warehouse', roofBand: 'mid' },
  ],
  neutralWalls: true, // inferred-suburban walls carry NEUTRAL_UV (no windows)
};

/**
 * A HOMESTEAD — SAT_SKYLINE area-hatch v2 (the SAFE re-arm of the disabled
 * minAreaM2 1e9). The R18 candidate invented 18–60 m heights and SATURATED
 * (fake downtowns over big-box strips — measured, killed). v2 hard-caps
 * invented height far below skyline territory: Powell reads as low mass at
 * 8 km, never a fake city. Owens empty-issuance is untouched.
 */
export const SAT_FAR_SUBURB = {
  enabled: true,
  minAreaM2: 900, // area-only candidates at/above this footprint...
  hM: [10, 22], // ...get an invented height in this band (hash-jittered)
  // Absolute ceiling, and an ADMISSION rule rather than only a clamp: the
  // hatch takes nothing above this from either source, so a mapped 30 m
  // building is left to the detail ring. That makes "never a fake downtown"
  // a measurable invariant instead of a hope — no skyline block may land in
  // (hardCapM, SAT_SKYLINE.minH) = (25, 35). verify-suburbia gates it off the
  // rendered geometry.
  hardCapM: 25,
  areaMaxPerChunk: 120, // per-skyline-chunk cap (holds the tris ledger ~90k)
  // THE OWENS LOCK (A HOMESTEAD, R19). The R18 note in SAT_SKYLINE.minAreaM2
  // measured the old hatch putting THREE 60 m towers over an empty desert —
  // and the height cap above does not fix that half of the defect: three
  // 10-22 m blocks over Owens Valley still make the skyline chunk NON-EMPTY,
  // which breaks verify-skyline's "EMPTY SCENE ISSUES NO MESH (Owens skyline
  // ready === 0)" gate and spends Owens draws the §5 ledger does not have.
  //
  // A suburb is not "a few big footprints", it is MANY of them. So the hatch
  // only arms on a tile that has at least this many candidates — DENSITY, not
  // size, is what separates Powell from a desert. Below the threshold the tile
  // contributes ZERO hatch blocks, so an empty scene stays empty by
  // construction rather than by winning a draw-count race.
  //
  // MEASURED candidates per z14 tile over a live 3x3 (footprint >= minAreaM2,
  // mapped height < hardCapM):
  //     Owens Valley   [0,0,1,0,0,1,1,0,1]   max 1
  //     Powell OH      [1,2,1,2,1,1,0,1,1]   max 2
  //     Dublin OH      [0,0,2,7,12,10,4,3,4] max 12
  //     Columbus OH    [4,5,2,4,16,6,2,10,6] max 16
  //     Chicago Loop   [13,15,27,22,46,33,5,5,9] max 46
  // 5 sits in a clean gap: 5x Owens' busiest tile and 2.5x Powell's, while
  // still arming over a REAL suburb (Dublin) and every city core.
  minCountPerTile: 5,
};

/**
 * A HOMESTEAD — high-tier-only building-ring widen (P2: coverage ~zero
 * outside downtowns). Medium/low keep the R18 ring byte-identical (user
 * decision 2). +4 draws / ~+0.3 M tris worst case, ledger §5.
 */
export const SAT_COVERAGE = {
  enabled: true,
  // HIGH TIER ONLY. Medium/low resolve to `null` in SatBuildingLayer, which
  // makes SatBuildingEngine fall back to SAT_BUILDINGS.ring.r / .maxChunks —
  // i.e. medium/low are byte-identical to R18 (user decision 2), and
  // enabled:false does the same for high.
  high: { ringM: 4400, maxChunks: 16 }, // R18 base: 3600 / 12
};

/**
 * B DEEPFIELD — depth-based aerial perspective: a post Effect MERGED into
 * the existing satellite EffectPass (0 extra draws; the composer gains its
 * depth buffer here). Mixes toward the live _atmoRim triple from startM with
 * a height falloff (valleys fill first). The 16 km tile uHaze band stays the
 * all-tier base — this AUGMENTS it, high tier + satellite only. Runtime
 * strength is multiplied by window.__flyAerialOverride (fleet-pinned 0 in
 * _boot.js; verify-aerial is the ONE un-pinner).
 */
export const AERIAL_PERSPECTIVE = {
  enabled: true, // R19 B: ON (high tier + satellite; fleet-pinned 0 in _boot.js)
  minTier: 'high',
  startM: 800, // the near field UNDER this is untouched (sat-depth contract)
  endM: 14000, // full mix by here (the tile band takes over at 16 km)
  heightFalloffM: 1200, // e-fold height of the fog integral
  maxMix: 0.55, // never fully swallows the mid-band
  /**
   * The IN-SHADER content haze (sat-building + sat-skyline fragments), which
   * exists so extruded content is not an un-atmosphered cut-out against the
   * hazed ground it stands on (field study P1/P6).
   *
   * SHIPS BUILT-BUT-OFF — the catcher-disc precedent — because at the ONLY
   * tier R19 lets it run it is REDUNDANT: the depth post pass above reads the
   * same depth buffer these meshes write, so it already hazes buildings and
   * the ground beneath them by the SAME distance law. Enabling both
   * double-hazes the mid band.
   *
   * The term is real, 0-gated and key-bumped (registry: satbldg -r16→-r19,
   * satskyline -r18→-r19) because it is the RIGHT fix for medium/low, where
   * no post pass runs and content genuinely is a cut-out today — it costs 0
   * draws and 0 tris. Turning it on there is a one-flag change, but it would
   * move medium/low pixels, which R19 decision 2 freezes byte-identical to
   * R18. Fable/R20 call: see the report + FLY_ROUND19.md §5b.
   */
  content: {
    enabled: false,
    minTier: 'high',
    startM: 800, // mirrors the post pass so the two agree if ever co-run
    endM: 14000,
    max: 0.55,
  },
};

/**
 * B DEEPFIELD — satellite content shadows (high only): sun-follow
 * directional on a small ortho frustum; casters/receivers = sat building
 * chunk meshes + veg canopy instancer ONLY (tiles never receive; the player
 * keeps its R13 contact disc). Gated at runtime by
 * window.__flySatShadowOverride (fleet-pinned 0). The ground-catcher disc
 * ships BUILT-BUT-OFF (Fable ruling: Owens ≤261 worst-case headroom — §5).
 */
export const SAT_SHADOWS = {
  enabled: true, // R19 B: ON (high tier + satellite; fleet-pinned 0 in _boot.js)
  minTier: 'high',
  orthoRadiusM: 1500,
  mapSize: 2048,
  bias: -0.0004,
  normalBias: 2,
  // Distance the light is pulled back along the sun vector, and the ortho
  // far plane that must cover it. distM sits at 2× the frustum radius so a
  // 250 m tower is never behind the near plane; farM covers distM + the
  // deepest content column with room to spare.
  distM: 3000,
  farM: 8000,
  // Sun-elevation floor for the SHADOW rig only (the hillshade keeps its own
  // HILLSHADE.minElRad). At el→0 the light goes parallel to the ground and
  // shadow length → ∞, which both smears the 1500 m frustum into uselessness
  // and maximises acne. 0.15 rad ≈ 8.6°, the same floor the hillshade uses.
  minElRad: 0.15,
  // ShadowMaterial disc under the player (+1 draw when opted in). OFF by
  // Fable ruling; user checkpoint row decides opt-in.
  catcher: { enabled: false, radiusM: 900, opacity: 0.35 },
};

/**
 * B DEEPFIELD — Esri capture-date quilt masking: altitude-keyed
 * desaturation + luma flattening in the tile fragment (the setMicroDetail
 * uniform idiom), 0-gated to IEEE identity at rest, high tier only. Fades IN
 * with eye AGL — the quilt is a cruise artifact; low AGL keeps full imagery
 * color (and the hillshade/micro contracts).
 */
export const SAT_QUILT = {
  enabled: true, // R19 B: ON (high tier + satellite; rides __flyAerialOverride)
  minTier: 'high',
  desatMax: 0.35,
  lumaFlatten: 0.25,
  inAglM: 4000, // starts blending in here...
  outAglM: 9000, // ...full strength by here
};

/**
 * D GOLDENHOUR — elevation-keyed sky buckets + the SkyDome golden-hour
 * lobe. Today hdriCycle picks "night" at sun el ≈ +1.7° (nightFrac 0.06 on
 * frac = sin(el)/sin 50°) — dusk does not exist (field study P9). Re-keys
 * bucket selection on solar ELEVATION; the legacy frac path runs VERBATIM
 * when disabled. Pinned-noon harnesses are unaffected either way (el high ⇒
 * day in both systems).
 */
export const SKY_DUSK = {
  enabled: true,
  // THE ELEVATION IS NOT runtime.sun.el. computeSun CLAMPS `el` into the
  // hillshade band [HILLSHADE.minElRad, maxElRad] = [8.6°, 51.6°] and takes
  // asin(max(0, sinEl)) — it can never be low, let alone negative. The
  // unclamped truth is `runtime.sun.sinEl`, so every consumer of these
  // thresholds derives elevation as asin(sinEl) (SatEnvironment.trueElDeg).
  elNightDeg: -8, // civil twilight: below this = night bucket
  elDayDeg: 10, // above this = day; between = the dawn/dusk window
  // Legacy for reference (frac = sin(el)/sin 50°, clamped): dayFrac 0.5 =
  // el 22.5°, nightFrac 0.06 = el 2.6°. So R18 called a +2.6° sun NIGHT —
  // 8:40 pm July Ohio, ten minutes before real sunset, rendered a starfield.
  blendSteps: 8, // stepped HDRI cross-bakes across the window (dip-masked)
  // THE STARFIELD IS THE OTHER HALF OF P9. sun-model.nightWeight keys on
  // `frac`, and frac is clamp01(sinEl/…) — so it hits 0 the instant the sun
  // touches the horizon and the star field snaps to FULL while the sky is
  // still bright twilight. That is literally what the field study photographed
  // at 8:40 pm. Re-keyed on elevation with the same inverse-smoothstep shape:
  // exactly 0 at and above elStarZeroDeg, full by nautical twilight. A deep
  // night pose (el ≈ −25°) still resolves to exactly 1, which is what keeps
  // verify-sat-night's contract intact.
  elStarZeroDeg: -4, // at/above this: no stars at all (exact 0)
  elStarFullDeg: -12, // at/below this: full star field (nautical twilight)
  // Equirect scratch target the cross-blend bakes into (width; height = w/2).
  // 1024 matches the three 1K dawn/dusk/night files; the 2K day file is only
  // resampled while a blend is actually running (s strictly inside 0..1) and
  // the pure endpoints bypass the blend entirely on the raw source texture.
  blendSize: 1024,
  // Dip depth scale for an INTRA-PAIR blend step. A 1/8 step is a small
  // change; masking it with the full 0.45 bucket-cut dip would be more
  // visible than the step itself. A pair CHANGE still dips at full depth.
  blendDipK: 0.25,
  glow: {
    // SkyDome horizon lobe around the sun azimuth — active ONLY for el in
    // [elMinDeg, elMaxDeg], exactly 0 outside (IEEE-identity discipline).
    elMinDeg: -8,
    elMaxDeg: 12,
    strength: 0.85,
    radius: 0.35, // angular falloff of the lobe
    bandK: 4.5, // vertical decay rate away from the horizon (e-fold ≈ 12.7°)
    color: '#d8b48a', // the altAtmo golden keyframe family
  },
};

/**
 * D GOLDENHOUR — high cirrus deck: a SECOND drei <Clouds> instancer in
 * CloudField (+1 draw), satellite-only, high tier only. Texture is
 * procedural (scripts/gen-cirrus.mjs, self-made, FLY_ASSETS-registered).
 * Toy sky is certified — untouched.
 */
export const SKY_CIRRUS = {
  enabled: true,
  minTier: 'high',
  altM: [7000, 11000],
  count: 10,
  opacity: 0.28,
  texture: '/textures/cloud-cirrus.png', // self-made, scripts/gen-cirrus.mjs
  // Wisps are WIDE and THIN — that shape is the whole read of a cirrus deck.
  sizeM: [5200, 9000], // bounds X/Z span per wisp
  boundsYFrac: 0.05, // vertical thickness as a fraction of the span
  cellSizeM: 46000, // toroidal re-tile cell (wider than the cumulus cell)
  segments: 3, // drei Cloud segments per wisp (cheap: they are flat sheets)
  driftMps: 11, // cirrus rides the jet stream — faster than the cumulus deck
  fadeM: [22000, 40000], // distance dissolve band
  color: '#eef4ff', // cool white; the sun tint multiplies onto it
};

/**
 * D GOLDENHOUR — overcast lid v2 (R18 §5b#3 / checkpoint #17): the lid
 * keeps a vertical gradient + a residual warm horizon band instead of
 * degenerating to a featureless tan dome at dusk. Exact no-op at
 * overcastT 0.
 */
export const OVERCAST_V2 = {
  enabled: true,
  // The R18 lid was `mix(up, mix(uOverH, uOverZ, yy), uOvercast)` where
  // FlyScene feeds uOverH = the grey-mixed rim and uOverZ = that × 0.82. At
  // dusk the rim is already a desaturated tan, 0.82 is a barely-visible ramp
  // and the lid is fully opaque — hence one featureless tan dome (R18 §5b#3).
  // Three terms fix it, all inside the existing `uOvercast` mix, so every one
  // of them is an EXACT no-op at overcastT 0 whatever its value.
  //
  // horizonKeep: the lid's OPACITY is reduced near the rim, so the dome's own
  //   horizon→zenith gradient (uZenith is the authored per-style color, NOT
  //   grey-mixed) still reads through at the bottom. 0 = the R18 flat lid.
  horizonKeep: 0.35,
  // zenithRamp: a real multiplicative vertical ramp on the lid — a ceiling is
  //   dimmest overhead. This is the term the featureless-tan tripwire gates.
  zenithRamp: 0.6,
  // duskChroma: fraction of the golden-hour lobe admitted THROUGH the lid.
  //   Stars/moon are hidden by a lid (× (1 − uOvercast)); a sunset is not —
  //   an overcast dusk keeps a warm band low on the sun's azimuth. 0 here
  //   reproduces the stars/moon behaviour (glow fully occluded).
  duskChroma: 0.25,
};

/**
 * C GROUNDTRUTH — per-landuse veg scatter + pool raise (consumes A's frozen
 * worker emissions). areaPerTreeM2 per class: residential gets a real canopy
 * carpet, farmland sparse hedgerows. houseAvoidM is enforced WORKER-side by
 * A (scatter samples reject near building footprints); C asserts it.
 * Medium tier keeps the R18 pool byte-identical (decision 2).
 */
export const SAT_GROUND_LIFE = {
  enabled: true, // R19 C: ON (flag-off restores R18 byte-for-byte — proven)
  // MEASURED, and the reason residential is far denser than the scaffolded
  // 3500: the worker's per-tile cap (SAT_VEG.maxPerChunk 400, frozen, not
  // C's) is spent in EMISSION ORDER, and the R18 park/wood/grass passes run
  // first — at Powell they alone stream 1,911 rows across 8 chunks, so the
  // appended residential pass only ever sees the leftovers. At 3500 m²/stand
  // residential streamed 209 rows and PLACED 115 canopies; the suburb the
  // whole feature exists for was still nearly bare. Density is the only lever
  // C owns here, and it is also the honest one: 1 stand per ~1300 m² is a
  // 36 m grid, which is what a leafy Ohio subdivision actually looks like from
  // 600 m (these are STANDS, not individual trees — the R18 semantics).
  // Farmland stays sparse on purpose: hedgerows and field corners, not an
  // orchard. Orchard is genuinely dense — that is what an orchard is.
  areaPerTreeM2: { residential: 800, farmland: 8000, orchard: 1800 },
  houseAvoidM: 14,
  poolHigh: 5000, // R18: 3000. High tier only — same ONE instanced draw.
  // VEG HAZE (C, zero-shader). Trees were the last content in the frame with
  // NO atmosphere at all: the tiles under them recede through uHaze/uEdgeColor
  // and B's depth pass hazes buildings, so a 2 km canopy read as a crisp
  // cut-out pasted onto a receding ground. The fix costs no GLSL and no cache
  // key — the placement cadence already writes an instance COLOUR, so it lerps
  // that colour toward the live rim tone (world-bend's uEdgeColor, i.e. the
  // exact triple the tiles fade toward) by distance. Per-instance, resolved on
  // the existing 2 s pass, zero per-frame cost.
  //   max 0 ⇒ the lerp is skipped outright (IEEE identity, R18 colours).
  // Band sits INSIDE distFade [1800, 2400] so a canopy is already atmospheric
  // by the time it starts scaling away.
  haze: { startM: 700, endM: 2400, max: 0.5 },
};

/**
 * C GROUNDTRUTH — landcover albedo tint: ONE pooled merged mesh (+1 draw),
 * MultiplyBlending at low alpha, draped on the veg chunk grid, reusing the
 * EXISTING world-bend-fade-r8 base variant (no GLSL change, no key move).
 * visible=false below minPolys — that is the Owens shed lever (§5).
 */
export const SAT_TINT = {
  enabled: true, // R19 C: ON (flag-off = no worker emission, no mesh, no draw)
  alpha: 0.1,
  minPolys: 12, // below this the pooled mesh stays invisible (0 draws)
  palette: {
    wood: '#2e4d2f',
    grass: '#57683b',
    farmland: '#8a844f',
    // `park` IS DROPPED, DELIBERATELY (A HOMESTEAD's measured warning, C's
    // call). The OMT `park` layer is ADMINISTRATIVE, not landcover: Owens
    // Valley ships 29.87 km² of park:national_scenic_area over a 3×3, which is
    // Mojave desert, and Ohio's township parks routinely enclose parking lots
    // and ball diamonds. The worker's 40%-of-tile cap kills the region-scale
    // polygons but not their EDGE tiles, and a green wash over desert is
    // exactly the "rendering bug" read this whole feature exists to avoid.
    // A null hex makes the worker skip the layer at source (`!hex` ⇒ continue),
    // so this costs nothing to stream and nothing to draw. Park VEGETATION is
    // unaffected — the canopy scatter still reads class 1.
    park: null,
  },
  // The pooled mesh is sized ONCE at mount (a BufferGeometry cannot grow) and
  // refilled on the veg placement cadence. Measured worst case (Manhattan 3×3,
  // 60 polys/tile × 9): ~4.5 k verts / 13 k indices. 4× headroom, ~0.6 MB.
  maxVerts: 20000,
  maxIndex: 60000,
  liftM: 1.4, // over the draped tile (depthWrite off + polygonOffset as well)
  // Multiply blending has no alpha channel of its own (result = src × dst), so
  // the α-lerp is baked into the vertex colour on the CPU: mult = 1 + α(c − 1).
  // That also means `alpha` is live-tunable WITHOUT a re-stream — the merge
  // pass re-derives every multiplier from the worker's raw `col` each cadence.
};

/**
 * C GROUNDTRUTH — suburban night: warm house-light sprites on A's housePts
 * (+1 draw, parked at count 0 and by day) + a streetlight envelope for road
 * classes 5–6. Envelope terms only — the R16-swept SAT_ROADS.night.intensity
 * is NOT retuned (pending checkpoint). dayFrac/gamma follow the
 * SAT_CITY_GLOW night-ramp family shape.
 */
export const SUBURB_NIGHT = {
  enabled: true, // R19 C: ON (flag-off = no mesh, no uniforms, R18 exactly)
  houseLights: {
    litFrac: 0.5, // fraction of anchors lit (hash-stable per anchor)
    // MEASURED, and the reason this is not the scaffolded 600: one light per
    // anchor put 82 lights over a 2.6 km disc — FOUR PER SQUARE KILOMETRE, so
    // the visible near-field wedge contained about one, and an A/B of the
    // whole feature moved the night crop by 0.008 luma. The anchors are as
    // dense as the worker's frozen per-tile cap allows (see areaPerTreeM2), so
    // the density has to come from the consumer: each lit anchor emits a
    // hash-stable CLUSTER, which is also what a subdivision looks like from
    // 600 m — houses come in streets, not in a Poisson field.
    // Sized from the REAL number, not from taste: American suburbia runs
    // ~600 dwellings/km², and at 1 a.m. roughly a third show a light, so an
    // honest field over the 2.6 km placement disc is a few thousand points.
    // 16 per lit anchor × ~225 anchors in range ≈ 3.6 k lights ≈ 170/km².
    // Measured stages on the way here, all on the same pinned Powell pose:
    //   1 per anchor  →   82 lights ≈ 4/km²  → ~1 in the visible wedge, A/B
    //                     moved the crop by 0.008 luma (i.e. nothing);
    //   5 per anchor  →  665 lights ≈ 32/km² → ~20 in frame, 940 lit pixels;
    //   16 per anchor → the field below.
    // It is still ONE draw either way — instances are the cheap axis, and
    // this is exactly the axis the pain was on.
    perAnchor: 16,
    // Cluster radius. 16 points in a 110 m circle is one per ~2,400 m², a 49 m
    // lot pitch — a subdivision, not a clump.
    spreadM: 110,
    pool: 4000,
    // MEASURED, and much smaller than it looks like it should be: at 320 m AGL
    // a 7 m sphere is ~40 px of RESOLVED, faceted geometry — the first pass
    // over a real subdivision photographed a field of glowing white boulders.
    // A porch light is a POINT; the job of the radius is only to keep it above
    // a pixel or two, and farScale does the rest with range.
    sizeM: 1.3,
    // …and grown with distance so a 2 km light stays a legible point instead
    // of a sub-pixel speck that CRAWLS as the camera moves (the TOWN_GLOW /
    // SAT_AIRPORT_BEACONS farScale idiom, and the same reason).
    farScale: { startM: 350, endM: 2600, mul: 3.2 },
    color: '#ffd9a0',
    dayFrac: 0.3,
    gamma: 1.5,
    // Additive strength at full night (× the γ ramp). 0.85 clipped to pure
    // white and dragged the bloom with it; a porch light seen from a
    // thousand feet is warm and modest, and the colour has to survive.
    opacity: 0.38,
    // MEASURED, and the reason this is not a porch-light-realistic 3 m: the
    // anchor's ground comes from SatVegEngine's per-chunk bilinear grid, which
    // is 4 segments over a z14 tile = ~460 m spacing (SAT_VEG.gridSegments,
    // frozen, not C's). Against the terrain mesh that is actually RENDERED
    // that interpolation runs several metres low over any relief at all, and a
    // 3 m lift left the whole pool depth-culled: an A/B with depthTest forced
    // off lifted the night crop's lit mass 4.5x. The canopies never showed the
    // bug because they are 5-13 m spheres. 14 m clears the interpolation
    // without ever reading as floating — at the altitude night suburbia is
    // seen from, 14 m is a third of a pixel. Terrain that genuinely stands in
    // front (a ridge between you and the houses) still occludes, which is
    // correct.
    liftM: 14,
    rangeM: 2600, // placement radius (≈ the veg ring's guaranteed coverage)
    // THE ANCHOR SPLIT (A HOMESTEAD's measured finding, and the reason this is
    // not simply "housePts"): OpenFreeMap's z14 `building` layer GENERALISES
    // individual houses away outside dense cores. Powell OH streams 15
    // footprints across 12 chunks, not one of them under 600 m² — housePts
    // there is literally 0 (measured, both by A and again by C's own probe).
    // So the primary source is used where it exists (Manhattan 387, Columbus
    // 19) and residential-landcover scatter points carry the suburbs.
    //
    // Those points are PARCEL points, not footprints — they are the same
    // deterministic samples the canopy stands on, with the worker's building
    // avoidance already applied. Two consequences, both handled here:
    //   * an unoffset light would sit INSIDE its own canopy blob (opaque
    //     Lambert, additive light behind it) — hence vegOffsetM, a hash-stable
    //     planar step that stays well inside the parcel;
    //   * the read is "a lit suburban parcel", which is what a porch light is
    //     from 600 m. Honest about what the data can support.
    vegOffsetM: 18,
  },
  // STREETLIGHT ENVELOPE (cls 5–6). The Powell dark-roads diagnosis: the road
  // fragment ends in `diffuseColor.rgb *= rw * gain`, where rw is the class
  // WEIGHT = ribbon width / widest ribbon. A suburb is tertiary (12 m) and
  // minor (9 m) against a 26 m motorway, so every lamp in Powell is rendered
  // at 0.46 / 0.35 of the gain the R16 sweep was calibrated on downtown
  // arteries — the network is there, it is just multiplied into the floor.
  // These two terms ADD to the weight for exactly those classes and nothing
  // else; SAT_ROADS.night.intensity (R16-swept, a pending user checkpoint) is
  // NOT touched. Both 0 ⇒ rwEff === rw ⇒ IEEE identity.
  // Sized so cls 5/6 land at ~0.70 effective weight — PARITY WITH PRIMARY per
  // pixel, not above the arteries. rw does double duty in the R16 design: it
  // is the per-pixel brightness AND it correlates with the ribbon's pixel
  // COUNT, so a 9 m street was being dimmed twice for being narrow. Lifting
  // the per-pixel term to parity leaves the width to do the differentiating —
  // a minor road is still a third of a motorway's lit AREA.
  streetGain: { c5: 0.24, c6: 0.34 },
  // DAYLIGHT ROAD READ. By day the network carries only a fast glint dash on
  // cls 1–2 (SAT_ROADS.day), so a suburb's roads are invisible over imagery
  // that is itself washed out — the field study's "no seams anywhere" note.
  // This is a pale STEADY term on cls 1–4: concrete catching the sun, not
  // paint. The material is additive, so it can only ever ADD light — there is
  // no way for this to darken a daylight frame. 0 ⇒ IEEE identity.
  daySeam: 0.14,
};

/**
 * E SLIPSTREAM — speed feel: ONE screen-space Effect (streaks + ground-rush
 * + boost heat-haze) merged into the existing EffectPass (0 draws), plus a
 * boost-engage FOV punch in chase-camera. Intensity is smoothstep from
 * onFrac ⇒ EXACTLY 0 at probe cruise speedFrac 0.24 (the SHAKE probe-safety
 * construction — no fleet pin needed).
 */
export const SPEED_FEEL = {
  enabled: true,
  onFrac: 0.55, // speedFrac where streaks begin (cruise 0.24 ⇒ literal zero)
  maxStrength: 0.6, // streak intensity at full boost
  groundRush: { aglBandM: 120, boost: 1.6 }, // extra gain in the low band
  heatHaze: { strength: 0.25 }, // boost-only UV wobble
  fovPunch: { deg: 4, decaySec: 0.5 }, // transient on boost ENGAGE
  // Radial smear = the honest speed cue: it drags the ACTUAL frame content
  // outward from the focus of expansion, so it reads on a white overcast and a
  // night city alike (an additive overlay reads on neither — R18's steam-plume
  // lesson). maxUv is the outermost tap offset in UV at full strength; taps is
  // the sample count (cost is taps+1 texture reads, and ONLY above onFrac).
  // `taps` is DOCUMENTATION, not a live knob: a GLSL ES 1.0 loop bound has to
  // be a compile-time constant, so the shader's `i <= 4` IS the number, and
  // moving this alone changes nothing.
  smear: { maxUv: 0.022, taps: 4 },
  // Wind streaks: `lines` wedges around the screen centre, each carrying a
  // dash that scrolls outward. `gain` is how far a streak pushes the pixel
  // toward bright-desaturated — kept modest because this lands BEFORE the tone
  // map, where >1 values roll off filmically instead of clipping.
  streaks: { lines: 44, gain: 0.34, scrollHz: 1.15 },
  // Where the effect starts in screen radius: nothing at the crosshair (that
  // is the one part of the frame the player is reading), full past r1.
  radius: { r0: 0.16, r1: 0.72 },
};

/**
 * E SLIPSTREAM — cinema-camera far-target fix (P11): clamp the orbit range
 * and refuse engagement on absurd separations (fall back to chase + toast).
 */
export const CINEMA_FIX = {
  enabled: true,
  // The PREFERRED standoff. It is a preference and not a hard cap because a
  // hard 900 m cap breaks the rig's only real job: at the 2,400 m separation
  // verify-chase-cam's (frozen) precondition allows, a 900 m abeam camera puts
  // each aircraft 53° off axis — outside the 47° half-FOV — and the frozen
  // "both aircraft on-screen" gate would fail. `frameSafety` below is what
  // reconciles the two: the clamp never pulls in closer than the range that
  // still frames the pair, so the shot gets TIGHTER (2,400 m sep measured
  // 3,840 m standoff before, ~1,430 m now) while framing stays guaranteed.
  maxRangeM: 900, // rangeM = clamp(sep * rangeK, minRangeM, max(this, framing))
  minRangeM: 120, // hard floor (matches CAMERA.cinema.minRangeM)
  // Fraction of the live half-FOV the pair is allowed to occupy. 0.85 leaves a
  // visible margin of sky outside the two aircraft instead of pinning them to
  // the frame edge. Computed from the LIVE camera fov/aspect, so it stays
  // correct on a phone's aspect and while any FOV kick is animating.
  frameSafety: 0.85,
  engageMaxM: 8000, // beyond this, C falls back to chase (a 21 nm pair is sky)
};

/**
 * E SLIPSTREAM — altitude-keyed POI label budget (P11): above aglOnM keep
 * the top-N letters by kind rank/distance; below, today's behavior
 * byte-identical (verify-poi's letters-continuously-present contract).
 */
export const LABEL_DECLUTTER = {
  enabled: true,
  aglOnM: 3000,
  topN: 6,
};

/**
 * E SLIPSTREAM — post-warp altitude trim (P12: warps bleed 2300 → ~650 m in
 * ~15 s). For holdSec after a warpEpoch bump, the nose is servoed toward the
 * pitch that HOLDS the arrival altitude unless the player pitches (input
 * cancels instantly). The verify-feel OUTCOME gate is the contract: warp to
 * 2300 m at cruise, hands-off 30 s ⇒ altitude within ±toleranceM.
 *
 * MEASURED DIAGNOSIS (R19 E, two control experiments on the W1 tree — the
 * plan's "nothing holds altitude" is true but is not the trigger):
 *  * HANDS-OFF, the model already holds PERFECTLY: warp to 2,300 m, 31 s, Δ
 *    altitude 0.0 m (pitch stays exactly 0, vy = sin(0)·speed = 0). So the
 *    bleed is not drift, and a vy servo aimed at a model that does not drift
 *    would have shipped as a no-op.
 *  * THE TRIGGER IS A STALE STICK. Mouse-steer is ABSOLUTE (input-controller
 *    read(): `pitch += _shape(-mouse.y)`, cursor offset from viewport centre).
 *    A warp arrives level with the stick neutralized — but the cursor is still
 *    parked wherever the player clicked (an Atlas destination card / GO sits
 *    well below centre), and the FIRST pointer move re-arms a large, SUSTAINED
 *    nose-down command. Measured: cursor at 0.67 screen-height ⇒ cmd.pitch
 *    −0.471 forever, pitch pinned at the −80° clamp, 2,300 m → 443 m in 16 s
 *    (≈650 m at t=12 s — the field study's number, reproduced).
 * Hence `cancelPitch`: the trim yields to a DELIBERATE deflection but not to a
 * parked cursor. It is set ABOVE the −0.471 the measurement produced, which is
 * the whole reason the fix works; a player who genuinely wants to descend in
 * the first 10 s pushes past it (or waits it out).
 *
 * It servos PITCH, not vy: at −80° of commanded nose-down, holding vy alone
 * would fly the aircraft level with its nose in the dirt and the chase camera
 * staring at the ground. Trajectory and attitude have to agree.
 */
export const WARP_TRIM = {
  enabled: true,
  holdSec: 10,
  toleranceM: 60,
  cancelPitch: 0.55, // |cmd.pitch| at/above this = the player is flying, hands off
  releaseSec: 1.5, // the stick fades back in over the tail of the window
  lambda: 1.6, // 1/s — how hard the instructor pulls the nose back to level
  // Altitude error → hold pitch: sin(pitch) = clamp(errM * this / speed).
  // Small on purpose; this trims, it does not zoom-climb.
  errGain: 0.35,
  maxHoldPitchDeg: 12,
};

/**
 * F REWIND — the Neon winding fix (R18 §5b#1, THE headline): dispatch
 * classifyRingsSat (winding-agnostic, the proven R18 satellite pattern) at
 * the three frozen toy call sites (polygonPass land/water, toy buildings,
 * toy scatter). Function BODIES untouched; enabled:false = byte-identical
 * toy output (the one-flag revert). The caps below contain the ~100×
 * polygon influx: tris ≤ 2.0 M measured at NYC cruise, toy draws ≤ 480.
 */
export const NEON_COVER = {
  enabled: true,
  // Every cap below is keyed by the REQUESTED ring ('ultra' is captured before
  // the worker aliases it to 'far' — a z10 ultra tile is 16× the ground area
  // of a z12 far tile and must not share its thresholds).
  //
  // The thresholds are per-RING because "too small to draw" is a function of
  // viewing distance, and the ring IS the distance band: the z14 'full' ring
  // reaches 8 km, 'mid' 18 km, 'far' 30 km, 'ultra' past 80 km. A 120 m² pond
  // is honest detail underfoot and a sub-pixel draw call at 20 km. Measured:
  // the mid+far rings alone were issuing 77 water draws at Powell for water
  // nobody can resolve.
  maxFeaturesPerLayer: { full: 400, mid: 200, far: 120, ultra: 100 },
  minAreaM2: { full: 120, mid: 4000, far: 25000, ultra: 60000 },
  // Building pick mirrors ROOFS_SAT.select. anchorCount = the top-by-volume
  // skyline keep; the rest of maxPerChunk is filled by striding a hash-shuffled
  // remainder. NOTE maxPerChunk is a POLYGON cap under this flag — multipolygon
  // features explode per polygon in the worker (which is what makes the
  // footprint test per-building). It overrides TOY_WORLD.buildings.maxPerChunk
  // (700, a per-FEATURE cap that never bound while the winding bug starved the
  // pipeline); TOY_WORLD's own values are untouched and rule when flag is off.
  select: { volumeStratified: true, anchorCount: 180 },
  maxPerChunk: 500,
  // Set dressing was starved by the SAME bug (park/landcover classified to
  // nothing, so ~no trees anywhere). Restored, it hits TOY_WORLD's 220/320
  // ceilings in every green chunk — measured 944k tris of trees at NYC alone.
  // These clamp it; minInstances refuses to spend a whole draw call on a
  // handful of blobs.
  // treeRangeM/grassRangeM are ENGINE-side (ToyWorldEngine._gateScatter): the
  // instancers set frustumCulled=false, so without a distance gate a chunk of
  // trees 8 km behind the player draws forever. Visibility only — geometry
  // stays built, so returning pops nothing.
  scatter: {
    treeMaxPerChunk: 90,
    grassMaxPerChunk: 140,
    minInstances: 24,
    treeRangeM: 5000,
    grassRangeM: 2500,
  },
};

/**
 * ============================ ROUND 20 BLOCKS =============================
 * R20 "Icons & Sprawl" scaffolding (Fable-seeded, ALL enabled:false).
 * Each block is OWNED by exactly one R20 agent; other agents must not edit
 * inside a block they do not own. Flipping `enabled` to false must restore
 * byte-identical R19 output for that block's owner system (the one-flag
 * revert contract, per the R18/R19 idiom).
 */

/**
 * R20 A SPRAWL-SAT — port the R19 toy multipolygon fix to SATELLITE.
 * buildSatBuildings/buildSatSkyline currently test maxFootprintM2 against the
 * SUM of a feature's polygons and share ONE drape anchor per feature
 * (vector-tile.worker.js:1198-1201, 1482-1491, 2311). Behind this flag,
 * multipolygon features explode per-polygon (the worker:3171-3188 toy pattern)
 * with per-polygon centroid drape anchors. MUST NOT reference NEON_COVER
 * anywhere satellite-side (verify-neon-cover gate 4a).
 */
export const SAT_POLY_COVER = {
  enabled: true,
  minAreaM2: 120, // per-polygon floor, detail ring
  maxFootprintM2: 60000, // per-POLYGON (was per-feature sum)
  maxPerChunk: 500, // POLYGON cap; overrides SAT_BUILDINGS.maxPerChunk (feature cap) under the flag
  // Per-polygon admission for the far-mass ring (buildSatSkyline).
  //   minAreaM2      mirrors SAT_FAR_SUBURB.minAreaM2 by value; it gates the
  //                  AREA-based hatch pick only — the tall pick stays
  //                  area-free, or a 200 m tower on a 400 m² plate (which is
  //                  what a distant skyline is made of) would be deleted.
  //   maxPerChunk    POLYGON cap, replacing SAT_SKYLINE.maxPerChunk's feature cap.
  //   minCountPerTile  THE OWENS LOCK, RE-MEASURED FOR POLYGONS. R19's
  //                  SAT_FAR_SUBURB.minCountPerTile 5 was calibrated on
  //                  feature-summed candidates (Owens max 1 / Powell 2 /
  //                  Dublin 12 / Chicago 46). Per polygon the same 3x3s
  //                  measure Owens 15 (both harness poses — Lone Pine is a
  //                  REAL town, the desert was never empty, the winding-broken
  //                  reader just could not see it), Powell 113, Dublin 118,
  //                  Columbus and Chicago at the 120 hatch cap. 40 is 2.7x
  //                  Owens' busiest tile and 2.8x under Powell's — the same
  //                  clean measured gap the R19 value sat in, and it keeps
  //                  verify-skyline's "EMPTY SCENE ISSUES NO MESH" and
  //                  verify-suburbia (E) true BY CONSTRUCTION rather than by a
  //                  draw-count race. SAT_FAR_SUBURB is untouched and still
  //                  rules with this flag off.
  skyline: { minAreaM2: 900, maxPerChunk: 300, minCountPerTile: 40 },
  // perPolyDrape:false is an A/B ISOLATION CONTROL, not a shipped mode — it
  // keeps the new per-polygon coverage while restoring the legacy
  // one-anchor-per-FEATURE drape, so a reviewer can attribute a visual change
  // to coverage or to drape without rebuilding. Ship true.
  perPolyDrape: true,
};

/**
 * R20 A SPRAWL-TOY-MID — the toy z13 mid ring drops every building under 30 m
 * (worker:3142/:3233), so suburbs vanish past 8 km even in Neon. Behind this
 * flag the mid-ring floor drops with a raised (tris-capped) chunk budget.
 */
export const TOY_MID_SUBURB = {
  enabled: true,
  // R20 SANCTIONED RE-BASELINE: maxPerChunkMid 240 -> 180 (Fable ruling; the
  // floor is the feature, the cap is cost). minH 12 is UNCHANGED and shipped.
  //
  // The ruling's ladder had a step 2 (minH 12 -> 14) if 180 still breached the
  // 2.2M soak budget. It did breach - and step 2 was measured and REJECTED,
  // because the acceptance metric turned out to be unable to see it. Two things
  // were measured, in this order:
  //
  // 1. THE SOAK'S maxTriangles CANNOT RESOLVE THIS LEVER. It is the max of a
  //    15-min time series that depends on the flown route, live ADS-B load and
  //    tile arrival order. Same configuration, two runs: 2 633 649 and
  //    2 349 013 - a spread of 0.284M, LARGER than the entire feature delta of
  //    0.267M. Ratcheting a product value against that is R19 lesson 3 ("a gate
  //    that differences breathing scene totals is a coin"): minH 14's own probe
  //    soak came back at 2.581M, WORSE than minH 12's 2.345M, which is noise,
  //    not a regression.
  // 2. SO THE LEVER WAS MEASURED WHERE IT IS DETERMINISTIC - the worker's own
  //    buildTile('mid') output, a pure function of tile bytes plus these
  //    constants. Building triangles summed over five fixed z13 mid tiles
  //    (Powell / Columbus / Dublin / Manhattan / Naperville):
  //
  //      minH 30, cap 180  (flag OFF = R19)   10 558      baseline
  //      minH 14, cap 180                     35 944      +25 386
  //      minH 12, cap 180  <-- SHIPPED        37 826      +27 268
  //      minH 12, cap 240  (as A shipped)     43 083      +32 525
  //
  //    The cap 240->180 removes 5 257 tris = 16% of the feature's cost for ZERO
  //    feature loss (it only bites in the densest chunks). minH 12->14 removes
  //    1 882 = 5.8% and costs real suburb - the 12-14 m band is thin. Fitting
  //    under 2.2M by floor alone would need minH around 20 m, which is a
  //    six-storey building: no suburb would survive it, and the round's whole
  //    point is that suburbs are visible past 8 km.
  //
  // SHIPPED: the 16%-for-free half of the ruling. The residual soak-budget
  // question is escalated in scripts/r20-close-sweep.md §4 - it is a budget
  // metric problem, not a value this agent can tune away.
  minH: 12, // mid-ring admission floor (legacy hard 30 rules when flag off)
  maxPerChunkMid: 180, // legacy 180 rules when flag off
};

/**
 * R20 B PARCEL-HOMES — procedural suburban buildings where OpenFreeMap ships
 * no footprints. Day+night, satellite medium+high tiers, ONE InstancedMesh
 * (+1 draw active, 0 mounted at low tier, 0 drawn when nothing places).
 *
 * TWO SCAFFOLD ASSUMPTIONS DIED ON CONTACT WITH THE DATA, and the block is
 * shaped by what replaced them (all numbers: scripts/r20-b-parcels.js, live
 * 3x3 z14 blocks, with A SPRAWL's per-polygon fix already merged):
 *
 *  1. "Consume the satVeg cls-4 residential scatter." Those rows are the
 *     LEFTOVERS of a canopy budget, so Craigieburn VIC — 22.72 km² of Melbourne
 *     suburbia — yields ZERO of them while Powell's 1.64 km² yields 657. The
 *     worker emits a dedicated `satParcel` sample instead, on its own RNG
 *     stream (see `anchors` below and the pass in vector-tile.worker.js).
 *  2. "Owens Valley has no landuse=residential, so the lock holds by
 *     construction." It has 2.23 km² of it — Lone Pine is a real town, the same
 *     finding A SPRAWL made about its building layer. The lock holds anyway,
 *     and it was measured on BOTH legs rather than assumed on either:
 *       · at the frozen Owens gate pose (36.6, -118.1) the town is outside
 *         `rangeM`, so 0 anchors, 0 homes, draws 178 <= 261;
 *       · flying straight over Lone Pine (36.6061, -118.0632, 700 m) there are
 *         69 anchors and the anti-duplication term suppresses ALL 69 — the ring
 *         reads 888 real buildings per km² of residential landuse against the
 *         620 threshold — for draws 220 -> 220 and triangles 299,482 -> 299,482
 *         across the ON/OFF flip. Bit-identical, not merely under a ceiling.
 *     Both legs are gated (verify-parcel-homes (F)); the second is what keeps
 *     the first from passing for the vacuous reason.
 *
 * And the thing that did NOT move: this layer places only inside
 * `landuse=residential`. Deep-rural Union County OH, Ashley OH and Hazard KY
 * measure 0.00 km² of it, so they get nothing — those are farms and a main
 * street, and their 9 / 68 / 189 real footprints ARE the houses.
 */
export const PARCEL_HOMES = {
  enabled: true,
  // --- ANCHORS (worker, out.satParcel) --------------------------------------
  // MEASURED, and the reason this is NOT the cls-4 canopy scatter the scaffold
  // assumed. Live 3x3 z14, post-A-SPRAWL (scripts/r20-b-parcels.js):
  //   scene            res landuse   cls-4 anchors   per km² res   scatter-capped
  //   Craigieburn AU     22.72 km²         0             0.0          9/9 tiles
  //   Melton AU          22.85 km²       600            26.3          9/9
  //   Piaseczno PL       20.43 km²       183             9.0          9/9
  //   Hamilton NZ        21.68 km²       192             8.9          6/9
  //   Blagnac FR         17.89 km²       257            14.4          7/9
  //   Dublin OH          11.16 km²       506            45.4          8/9
  //   Powell OH           1.64 km²       657           401.3          4/9
  // cls-4 rows are SAT_VEG.maxPerChunk's leftovers (400/tile, emission order,
  // residential LAST), so the anchor supply is an artifact of how much park and
  // woodland a tile happens to map — 45x denser at Powell than at Dublin, and
  // literally ZERO over 22.7 km² of Melbourne suburbia. Homes get their own
  // area-based sample on their own RNG stream instead; the veg rows are
  // bit-identical either way (worker: separate mulberry32, see the pass).
  anchors: {
    // 1 anchor per 25,000 m² of residential landuse = 40/km². With perAnchor
    // 12 that is 480 homes/km² at full band — just under the ~600 dwellings/km²
    // American suburbia actually runs (the SUBURB_NIGHT figure), because this
    // layer's job is to fill a deficit, never to out-build the real data.
    areaPerM2: 25000,
    maxPerChunk: 200, // per z14 tile (a fully-residential tile is ~140 at 40°N)
  },
  // --- CLUSTER SHAPE --------------------------------------------------------
  // Homes are laid on a hash-rotated LOCAL GRID, not on SatHouseLights' radial
  // ring. A porch light is a point and a ring of them reads as a scattered
  // parcel; a dozen HOUSES on a ring reads as a rosette, and the single
  // strongest suburban cue from 600 m is that every house on a street shares
  // one yaw. So a cluster is `cols` wide on a `lotM` pitch, rows `rowM` apart
  // (a street pitch), the whole block rotated by one per-anchor hash angle and
  // every house yawed to face it.
  perAnchor: 12,
  cols: 4,
  lotM: 34,
  rowM: 56,
  jitter: 0.22, // ± fraction of the lot/row pitch
  hM: [5, 9], // ridge height band — entirely OUT of (25,35) (verify-suburbia G)
  footprintM: [9.5, 15], // long side; the short side is 0.62-0.86 of it
  // --- ANTI-DUPLICATION (two terms, and it takes both) ----------------------
  // A SPRAWL's per-polygon fix made the REAL data dense in exactly the places
  // this layer was scaffolded for, so the layer has to yield to it. Both terms
  // read the sat-building engine's OWN collision-column index (one cylinder per
  // extruded building — the R18 `queryColumns` production API, already bucket-
  // hashed), so "already built" means the same population the player can crash
  // into, not a telemetry proxy.
  //
  // (1) REGIONAL — real buildings per km² of RESIDENTIAL LANDUSE across the
  //     streamed ring. This is the term that decides whether a TOWN is mapped,
  //     and it is the one that had to be added after the first build: measured,
  //     the local term ALONE could not tell Powell from Melton (68 vs 69
  //     buildings/km² at the anchors), because the worker's occupancy mask puts
  //     every anchor in unbuilt ground BY DESIGN. Regionally they are 6x apart:
  //       Powell 1014/km²res · Blagnac 1078 · Melton 167
  //     The residential area is read back from the anchor count (anchors x
  //     anchors.areaPerM2), so it needs no second worker channel.
  // (2) LOCAL — 1 - localReal/targetPerKm2 in a `windowM` box around each
  //     anchor. This is the within-suburb term: it fills the unmapped BLOCK
  //     inside a half-mapped subdivision and stays off the mapped ones.
  // The two multiply. Regional alone would carpet a mapped block inside an
  // unmapped town; local alone measured 439 procedural homes into Powell,
  // which A had already finished.
  //
  // SETTLE HOLD: both terms rise monotonically as the building ring streams
  // (buildings only ever arrive), so a half-streamed ring reads as "unmapped"
  // and would place a field of homes that then vanished. The pass therefore
  // HOLDS its previous placement until three-quarters of the building ring has
  // RESOLVED, with a move escape so a long flight can never freeze it (see the
  // hold in SatParcelHomes for why "zero work in flight" is the wrong test).
  // A warp shows real footprints first and homes a beat later, which is the
  // correct order of trust.
  antiDup: {
    targetPerKm2: 650, // local window
    windowM: 300,
    regionalPerKm2Res: 620, // regional, per km² of residential landuse
  },
  avoidM: 16, // client-side: never inside a streamed footprint's own radius
  // --- BUDGET ---------------------------------------------------------------
  // ONE pooled InstancedMesh (+1 draw active, 0 when nothing places). 32 tris
  // per house, so a full high-tier pool is ~166 k tris — under a tenth of the
  // 2.2 M soak ceiling, and it is the SAME +1 draw whether a scene places 40
  // homes or 5,000 (the SatVegLayer invariant).
  poolByTier: { low: 0, medium: 2400, high: 5000 },
  rangeM: 2400, // placement radius (inside the veg ring's guaranteed coverage)
  // Distance thinning. Without it a 2.4 km disc at 480/km² is 8,700 homes and
  // the pool would cut a hard circle that pops as the player moves. Beyond
  // farM the kept share ramps to `farKeep` while `farScale` grows each house,
  // so the field stays continuous instead of thinning visibly.
  thin: { nearM: 700, farM: 2400, farKeep: 0.34 },
  farScale: { startM: 900, endM: 2400, mul: 1.35 },
  // Altitude fade (SCALE, not colour — the material is opaque). offM sits well
  // under SAT_VEG.cullAglOffM 2600 so the ring eviction acts on geometry that
  // has already scaled to nothing (the SAT_BLDG_FADE lesson).
  altFade: { onM: 1800, offM: 2400 },
  // DECLARED, and ENFORCED by `poolByTier.low: 0` above rather than by a
  // separate tier test — a pool of 0 returns null before the mesh exists, so a
  // low-tier boot has no geometry, no material and no draw. Stated here because
  // every sibling satellite layer names its floor, and a reader comparing them
  // should not have to infer this one's from an array entry.
  minTier: 'medium',
  // --- LOOK -----------------------------------------------------------------
  // Roof-led palette: the roof is most of what a house presents from the air,
  // so the per-instance tone is the ROOF's and the baked vertex colours carry
  // the wall/roof/trim RELATIONSHIP as multipliers on top of it (three
  // multiplies vColor by instanceColor). One instanceColor per house couples
  // wall tint to roof tint — deliberate, and the price of +1 draw.
  //
  // These are SAT_BUILDINGS.roofTones.low VERBATIM: the same shingle/terracotta
  // family a real small-band footprint wears, so a procedural house and the
  // real one two lots over are the same species. Copied rather than imported
  // because that block is not this block's to depend on — but the values being
  // identical is the point, and a reviewer should keep them that way.
  // MEASURED CORRECTION: the first pass baked absolute tones (roof 0.40 x a
  // 0.28-luma grey) and rendered a field of near-black slabs over Melton.
  palette: ['#8c5a42', '#7a4c3a', '#a4694b', '#6d675c', '#9c9384', '#5c6552'],
  lumaJitter: 0.12,
  // NIGHT — window glow only, never a lit box. An `emissiveMap` puts the light
  // exactly on the wall texels and leaves roofs black; the intensity rides the
  // EXACT SUBURB_NIGHT.houseLights γ ramp so the windows, the porch lights and
  // the streetlights arrive together at dusk instead of in three waves. 0 by
  // day ⇒ the emissive term is multiplied out (IEEE identity, no night pixels
  // in any daylight gate).
  // (Which windows are lit is baked into the atlas, not drawn per house — a
  // per-instance lit set would need a second instance attribute and therefore
  // a shader injection, and this layer is committed to the shared bend variant.)
  night: { color: '#ffc98a', intensity: 0.78 },
};

/**
 * R20 C ICONS — marquee monument GLB overlay. Real downloaded models for the
 * marquee landmark set, mounted OUTSIDE the frozen `landmark-*` probe space
 * (verify-monuments gate 8 caps /^landmark-/ meshes at 10) as ONE batched
 * mesh named `monument-marquee`. Procedural archetypes stay byte-identical
 * and instant-render as the fallback; a placed marquee model parks its
 * procedural instance at scale 0. Colors are baked to COLOR_0 offline
 * (textures render flat white through bakeMeshGeometry — the R15 trap).
 * NO _isModel/_painted flags (harness foreground-hide enrollment).
 * Bend: applyBendAnchor under a NEW cache key 'world-bend-anchor-monument-r20'.
 * Letter contract: model top must land at groundY + heightM * LANDMARKS_3D
 * .scaleBoost so letterLiftM stays true.
 */
export const MONUMENT_MODELS = {
  enabled: true,
  maxPlaced: 12, // marquee instances on screen (merged into ONE mesh = 1 draw)
  rangeM: 26000, // = LANDMARKS_3D.maxRangeM — a marquee monument and its
  // procedural twin must share ONE range, or the fallback pops in at the seam
  refreshSec: 2, // placement recompute cadence (mirrors LANDMARKS_3D.refreshSec)
  groundReplaceM: 1.5, // re-bake when a stream-in moves a monument's ground this far
  targetTopM: null, // per-model targetHeightM lives in lib/fly/monument-models.js
  // SATELLITE grade (FLY_ROUND20_PLAN §5.5 — sanctioned taste evolution by
  // explicit user ask). Real albedo, muted: HUE is kept exactly, only the
  // chroma that would fight Esri imagery is removed. The R18 value-only lock
  // still governs every PROCEDURAL archetype (landmarks-3d satPart) — untouched.
  satAlbedo: {
    saturationCap: 0.4, // HSV S ceiling; above it the vertex pulls toward its own luma
    valueLock: false, // true = the R18 grey behaviour (kept as a one-flag revert)
    valueMul: 1.0, // global exposure of the graded albedo
    baseMul: 0.84, // vertical term at y = 0 (contact grime) — R18's numbers
    topMul: 1.06, // …at y = 1 (sky bounce)
    accentMul: 0.9, // accent bands take their colour FLAT here (no ×3.2 blowout)
    // Round 20 (C2) — THE STONE KEY. A satellite monument is MeshToon, which
    // takes no environment map, so the night key light lands on it undiluted.
    // The procedural archetypes survive that because their material colour IS
    // the warm weathered stone (LANDMARKS_3D.satStyle.color); a marquee model
    // carries real albedo instead, and the Taj's source marble is measurably
    // COOL white — cool albedo × cool key = the blue Taj. So the ACHROMATIC part
    // of a marquee albedo is re-keyed onto that same stone HUE at its own luma
    // (value untouched), fading out as the vertex gains real colour so
    // verdigris/iron/copper keep theirs. Measured at Agra, deep night,
    // blue-minus-red on the monument's pixels: 33.5 with the key off, 25.0 with
    // it on, against 18.4 for the PROCEDURAL dome at the same pose — a
    // deep-night satellite monument really is moonlit, so the target was never
    // zero (the full ladder is in monument-loader). stoneKey 0 restores the
    // pre-C2 grade exactly.
    stoneKey: 1, // strength on a fully achromatic vertex
    stoneKeySatRef: 0.5, // HSV S at which the key has faded to nothing
  },
  // TOY grade: palette-quantised REAL accents. realMix 0 == the pure INK+ICE
  // monument palette; 1 == real albedo at palette value. The flood ramp and the
  // accent EMIT are the landmarks-3d numbers verbatim — a GLB gets no free
  // floodlight, so the night read has to be baked into COLOR_0 exactly the way
  // part() bakes it for the procedural archetypes.
  toy: {
    accentEmit: 3.2, // clears TOY.bloomThreshold 0.56 after the toon ramp
    floodBaseBoost: 1.35,
    floodTopMul: 0.82,
    realMix: 0.58, // how much of the model's own hue/chroma survives
    darkCut: 0.08, // source linear luma below this quantises onto monumentDark
    trimCut: 0.4, // …above this onto monumentTrim; between, monumentBody
  },
};

/* ============================== ROUND 21 ==============================
 * "STEADY STATE" — fixes for the two R20 live symptoms (whole-screen
 * flashing; patchy world) + the prerender/pre-warm system.
 * FLY_ROUND21_PLAN.md is the contract. Four blocks, one per agent, ALL
 * enabled:false at scaffold time — flag-off MUST stay byte-identical to
 * R20 behavior per block (the one-flag revert contract). Owners tune
 * freely INSIDE their own block; nobody edits a block they don't own. */

/**
 * R21 A GOVERNOR — custom perf governor replacing the drei
 * <PerformanceMonitor> (no latch: default flipflops=Infinity, and on a
 * 60 Hz display fps 60 sits ON its upper bound so onIncline fires at
 * steady state — the R20 flap; FlyCanvas' own comment: "the hitch IS the
 * flap"). ONE ladder, DPR rungs above tier rungs; a rung descended again
 * within latchWindowSec of having been ascended through latches its
 * ceiling for the session. Honors the fleet pin __flyGovPin === 'hold'
 * (boot DPR/tier frozen — harness determinism). enabled:false renders
 * today's <PerformanceMonitor> JSX byte-identically.
 */
export const PERF_GOVERNOR = {
  enabled: true,
  emaTauSec: 1.0, // frame-dt EMA time constant
  refreshSnap: [60, 90, 120, 144], // estimated display Hz snaps to these
  refreshFrames: 90, // post-grace frames sampled for the p95 refresh estimate
  // A frame longer than this is a STALL (tab blur, GC, a synchronous
  // finalize), not a hardware verdict: the sample is dropped and both dwell
  // timers reset. Sustained slowness presents as many mediocre frames.
  outlierDtSec: 0.5,
  downFrac: 0.85, // step down when EMA fps < downFrac * targetFps…
  downHoldSec: 1.5, // …sustained this long
  upFrac: 0.97, // step up when EMA fps > upFrac * targetFps…
  upHoldSecDpr: 8, // …sustained (DPR rung)
  upHoldSecTier: 30, // …sustained (tier rung)
  cooldownSecDpr: 5, // min gap between DPR steps
  cooldownSecTier: 20, // min gap between tier steps
  latchWindowSec: 120, // re-descent within this of an ascent latches the ceiling
  bootGraceSec: 5, // no sampling until __flyBoot 100% + this
  warpGraceSec: 3, // sampling suppressed after a warp / style flip
};

/**
 * R21 A — Effects/composer stability: memo(Effects) + pass list useMemo'd
 * on discrete inputs only; vendored FlyEffectComposer (postprocessing
 * 6.39.2 fork) that (i) disposes wrapper-constructed EffectPasses on
 * teardown (the library removePass never disposes — the R20 leak),
 * (ii) keys setSize on viewport.dpr and sizes from
 * gl.getDrawingBufferSize() (a DPR step today resizes the drawing buffer
 * but NOT the composer buffers — the stretched-frame glitch), (iii) diffs
 * the resolved pass list. enabled:false renders the library
 * EffectComposer exactly as today.
 */
export const FX_STABILITY = { enabled: true };

/**
 * R21 A — boot pre-warm. Today the repo contains ZERO
 * renderer.compileAsync calls; every material variant compiles on first
 * draw, mid-flight. Warm set = the world-bend registry FINAL variants
 * (+ sat-building bare/facade/night) + both Effects tier compositions,
 * compiled via gl.compileAsync during boot and RETAINED for the session
 * (three's WebGLPrograms refcounts — retention is what makes later
 * identical materials LINK instead of compile). Facade/night atlases
 * boot-built on idle (today: lazily mid-flight on first tier arm).
 *
 * R22: block OWNERSHIP transfers to B SETTLE (warm-set extension +
 * idle-rAF slicing of any post-reveal compile tail — see SETTLE_CALM
 * .prewarmSlice). Other agents do not edit this block this round.
 */
export const PREWARM = {
  enabled: true,
  maxMs: 3000, // hard boot-gate timeout; on expiry the warm continues async
  // Wait for scene.environment before compiling: three folds the scene
  // environment (envMapMode + envMapCubeUVHeight) into the program cache key
  // of every MeshStandardMaterial, so warming ahead of the HDRI mints
  // second programs for the terrain tiles and the whole traffic fleet
  // instead of seeding theirs. Capped — a failed HDRI must not skip the warm.
  envWaitMs: 4000,
  // Also warm the post chain. ALL THREE tiers, not just the alternate one:
  // a retained warm pass is what keeps its program refcounted, and warming
  // only high+medium left the ladder's bottom rung releasing (and then
  // recompiling) three programs on every low↔medium crossing.
  warmEffectsAltTier: true,
  warmAtlases: true, // boot-build getFacadeAtlas(false/true) + initTexture
};

/**
 * R21 B STREAMKEEPER — streaming-correctness fixes in the five engines.
 * bendMargin: bounding spheres grow by the world-bend vertical drop
 * ((ringAliveR + chunkHalfDiag)^2 * MAX_BEND_K * pad) so the frustum
 * culler stops dropping on-screen chunks (toy z10 ultra ring: the shader
 * moves verts ~89% of the sphere radius). retry: empty-reason TTLs
 * ('no-data' re-asks after noDataTtlSec; 'zero' = deterministic, never;
 * reason undefined = legacy sticky) + capped, jittered backoff for errors
 * (today: infinite 2 s hammer). healCap: per-key heal-evict attempts
 * (today: permanently-coarse sat-building chunks evict+rebuild 2/2s
 * FOREVER; toy has the same shape uncapped). parkVeg: AGL cull-off parks
 * veg chunks instead of chunks.clear() (the parcel-homes race replayed
 * every climb). waterInPlace: setWaterEnabled(true) backfills water onto
 * existing chunks instead of evicting the whole city ring.
 */
export const STREAM_KEEPER = {
  enabled: true,
  bendMargin: { enabled: true, pad: 1.15 },
  retry: {
    enabled: true,
    noDataTtlSec: 600, // 404/204 re-ask cadence (jittered)
    errorBaseSec: 2, // backoff = errorBaseSec * 2^attempts, capped…
    errorCapSec: 60,
    maxAttempts: 6, // …then demoted to the no-data TTL class
    fetchTimeoutMs: 15000, // AbortController on the worker fetch
    jitter: 0.2,
  },
  healCap: 3, // heal-evict attempts per chunk key (coarse included)
  parkVeg: true,
  waterInPlace: true,
  // evictM is 10000, not the charter's 10500: verify-skyline pins the AGL cull
  // with a FROZEN probe at 10,200 m ("skyline evicts past its own AGL cull" —
  // ready === 0 && ringOn === false), and 10500 would have moved a frozen
  // assertion. 9200 → 10000 is still 3.3× the R18 band, and BOTH ends stay
  // above SAT_SKYLINE.fade.endM (9000) so every re-stream happens while the
  // ring is fully faded out.
  skylineHysteresis: { evictM: 10000, rearmM: 9200, visReevalM: 150, visReevalSec: 1 },
  stagedRingShift: { stepM: 1000 }, // toy ultra full-ring shrink, per refresh
  lookahead: {
    leadSec: 2.5, // velocity-led ring centre: v̂ × speed × this…
    maxLeadFrac: 0.35, // …clamped to this fraction of the ring radius
    tauSec: 0.6, // velocity EMA time constant
    teleportM: 5000, // a single-frame move past this is a warp, not motion
    warpHoldSec: 3, // …and the lead is suppressed for this long after one
  },
  finalizeBudgetMs: 3, // per-frame budget for unbudgeted finalize loops
  waterBackfillBuilds: 2, // concurrent in-place water re-requests (S4)
};

/**
 * R21 C SURFACE — surface-layer calm. parcel: both-rings settle gate
 * (regK is a ratio of the building ring / veg ring which stream
 * INDEPENDENTLY — at boot bs.chunks===0 counted as settled and homes
 * carpeted mapped towns, vanishing 2 s later), EMA + deadband + 2-pass
 * delete confirm, bounded provisional grow-in. monument: per-name baked
 * placement state with rank/range hysteresis + min rebuild gap (today a
 * 1.5 m groundY bucket edge under DEM refinement re-merges the whole
 * 12-monument batch, each merge epoch-bumping all 9 archetype pools);
 * MonumentModels useFrame priority -1 so the suppression epoch is
 * consumed the SAME frame (kills the 1-frame marquee+archetype double
 * draw). uploads: addUpdateRange ranged uploads + cadence phase stagger
 * across the four pooled layers + static-skip. depthOffsetFix: author
 * polygonOffsetUnits sign-flipped under reversedDepthBuffer (three flips
 * only the FACTOR — authored (-2,-2) reaches GL as (+2,-2), slope- and
 * view-dependent tint dropout). duskCalm: intra-pair HDRI dips 0, env
 * refs seeded from the scene on satellite re-entry (no first-frame snap).
 */
export const SURFACE_CALM = {
  enabled: true,
  parcel: {
    minSettledFrac: 0.85, // building ring: (ready+empty)/chunks, chunks > 0
    vegSettledFrac: 0.75, // veg ring must also agree
    maxHoldSec: 8, // unsettled hold before provisional placement…
    growScale: 0.55, // …at this scale; confirmed to 1.0 when settled
    // regK IS FILTERED BY A ROLLING MINIMUM OVER DISTANCE, NOT BY AN EMA, and
    // the reason is measured. The plan asked for an EMA; at Lone Pine the
    // building ring heal-evicts (R21 P6, B's charter) and `queryColumns`
    // cycles 987 → 693 → 357 → 696 columns every couple of seconds, so the raw
    // regK flaps 0 ↔ 0.48 forever. An EMA of a flapping signal converges to
    // its MEAN — measured 0.20, i.e. 55 procedural homes standing over a town
    // Lone Pine already has, which breaks a frozen gate leg. But the quantity
    // is MONOTONE by construction: real buildings only ever arrive, so a LOWER
    // regK is always the better-informed reading and a higher one is only ever
    // lost evidence. The minimum is therefore the honest filter — and it is
    // scoped to a DISTANCE window (two buckets of relocateM) so that flying
    // into genuinely unmapped land still recovers, within one to two buckets
    // of travel, without any single eviction spike ever lifting it.
    relocateM: 1200, // rolling-min bucket length (half PARCEL_HOMES.rangeM)
    // THE COLLISION-INDEX TRUST GATE. regK divides by queryColumns, and a ring
    // that reports "resolved" can still be SMALL at boot — a few finished
    // chunks are (ready+empty)/chunks === 1 — so the index reads ~0 over a
    // mapped town and regK computes as if it were Melton. Real columns per
    // parcel anchor, measured on every certified scene: Powell 14.8 · Lone
    // Pine 14.3 · Blagnac 14.2 · Plain City 5.1 · Melton 2.6 (the least-mapped
    // suburb in the set still carries 1,170 columns inside the disc). 0.5 sits
    // 5x below the worst real scene, so it can only ever catch an index that
    // has not been built. Applied to the FIRST measurement at a locality only,
    // as a HOLD bounded by maxHoldSec — never as a suppression.
    minColsPerAnchor: 0.5,
    regKDeadband: 0.15, // |ΔregK| below this: no re-place (kills the ±1-house shimmer)
    confirmPasses: 2, // consecutive settled passes before carpet DELETION
  },
  monument: {
    minRebuildSec: 5, // min gap between marquee re-merges (style flip exempt)
    groundDeltaM: 1.5, // |Δ| vs the monument's OWN baked groundY (not a bucket)
    exitRangeMul: 1.06, // placed monument leaves at rangeM * this
    rankHysteresis: 2, // incumbent survives until rank > maxPlaced + this
  },
  // ranges: ranged (addUpdateRange) instead of whole-buffer uploads.
  // stagger: one-time phase nudge applied AFTER each layer's first pass, in
  //   units of the shared 2 s cadence, indexed by frame-loop priority order
  //   (canopy -45, tint -44, house lights -43, parcel homes -42). The first
  //   pass of every layer stays immediate, so nothing appears later than it
  //   does today; only the steady-state phases separate.
  // staticSkipM: below this movement, a pass whose consumed engine stats and
  //   altitude fade are unchanged writes NOTHING (no matrices, no needsUpdate).
  uploads: { ranges: true, stagger: [0, 0.25, 0.5, 0.75], staticSkipM: 10 },
  depthOffsetFix: true,
  // intraPairDip: dip scale for a blend step WITHIN one HDRI pair (0 = none).
  // seedFromScene: the damped env/bg intensity refs start from what is
  //   actually on the scene at (re)mount instead of null, which snapped the
  //   first frame straight onto the target. seedSnapDelta bounds that: a seed
  //   further than this from the first frame's target belongs to another
  //   style entirely (toy leaves the three defaults of 1.0 behind), and
  //   ramping across it would trade one wrong frame for three wrong seconds —
  //   so a far seed still snaps, exactly as R20 did.
  duskCalm: { intraPairDip: 0, seedFromScene: true, seedSnapDelta: 0.25 },
};

/**
 * R21 D PIPELINE — worker-side coverage determinism + the shared tile
 * cache. REASON-CODE CONTRACT (consumed by B's engines): empty results
 * become { empty:true, v:WORKER_PROTOCOL, reason } with reason
 * 'no-data' (upstream 404/204) | 'zero' (tile parsed, nothing admitted:
 * caps, locks, no matching layers — deterministic). Typed fetch errors
 * throw Error('http-<code>'). B treats reason === undefined as legacy
 * (today's sticky behavior) so B-with-flag-on works before D merges.
 * hatchRamp replaces the R20 all-or-nothing skyline lock
 * (minCountPerTile 40: a 39-candidate tile rendered NOTHING, its
 * 41-candidate neighbor everything): keepN = 0 at n<=lockLo,
 * round(n*(n-lockLo)/(rampHi-lockLo)) between, n at n>=rampHi — Owens'
 * busiest tile measures 15 <= lockLo 24, so Owens stays empty BY
 * CONSTRUCTION. skylineShuffle ports the buildSatBuildings R20
 * selection (top-N by volume + FNV-1a hash order fill) to
 * buildSatSkyline, whose caps bind post-per-poly-explosion and are
 * today consumed in spatially-clustered raw MVT order (one corner of a
 * tile renders). diagMetaDefaultOff: the vegMeta telemetry (a full
 * SECOND parse + classifyRingsSat over every building feature per
 * sat-veg tile) becomes opt-in via api.setDiag(true) — production
 * default OFF. cache: Cache API inside the workers (same-origin
 * `caches` is shared across all five), PERSISTENT across sessions (user
 * decision 2026-08-06), versioned name, 404-markers TTL'd, every op
 * try/catch — cache failure degrades to plain fetch.
 */
export const TILE_PIPELINE = {
  enabled: true,
  emptyReasons: true,
  hatchRamp: { lockLo: 24, rampHi: 64 },
  // anchorCount: top-N by volume always survive (the real towers).
  // skipDegenerate: a hash-ordered fill draws uniformly from a population that
  // is mostly TINY at a dense core, and a tiny ring simplifies below 3 points
  // and renders nothing — measured, unfiltered, on the Manhattan 3x3: 300
  // polygons selected per capped tile, ~193 renderable, far skyline 2,207 →
  // 1,787 blocks. Testing renderability before spending a cap slot restores it.
  skylineShuffle: { anchorCount: 60, skipDegenerate: true },
  diagMetaDefaultOff: true,
  maxConcurrentFetches: 6, // per-worker fetch semaphore
  // AbortController budget for ONE tile request. The R20 fetch was naked: a
  // stalled connection held its engine's in-flight slot until the browser gave
  // up (minutes), which is a permanent hole in the world with no error to
  // retry on. 12 s is ~8x the measured p95 tile latency on a cold cache, so it
  // only ever fires on a genuinely dead request. A timeout surfaces as the
  // typed `Error('http-timeout')`, i.e. RETRYABLE — never as an empty tile.
  fetchTimeoutMs: 12000,
  cache: { enabled: true, name: 'fly-tiles-v1', maxEntries: 4000, noDataTtlSec: 600 },
};

// ============================================================================
// ROUND 22 "TERRAIN & IMMERSION" — seven pre-seeded blocks, all enabled:false
// at scaffolding (W0). Owners: A TERRA (TERRA_SHARP / TERRA_PIPE /
// TERRA_CACHE), B SETTLE (ARRIVAL_GATE / SETTLE_CALM — B also owns PREWARM
// this round), C CLUTTER (CLUTTER), D DEPTH (DEPTH_PASS). Flag-off must be
// byte-identical behavior; every value here is a STARTING point the owner
// tunes by measurement. Plan: FLY_ROUND22_PLAN (the approved plan doc).
// ============================================================================

/**
 * R22 A TERRA — ground sharpness. All levers high-tier / satellite unless
 * stated.
 *
 * RUNTIME CONTRACT (A publishes, B consumes — the R21 reason-code idiom:
 * consumers treat `undefined` as legacy so B-with-flag-on works before A
 * merges): `runtime.terraStats = { camTileZ, targetZ, downloading, sharp }`
 * published at ~2 Hz. camTileZ = engine.getGroundAt(camera lon/lat).tileZ —
 * the zoom of the RESIDENT leaf under the camera. targetZ = the zoom the LOD
 * math wants at the current AGL (derived from the live threshold curve).
 * sharp = camTileZ >= min(targetZ - 1, sharpZCap) && downloading settled.
 *
 * lodCurve: altitude-keyed LIVE LODThreshold via the existing
 * terrain-engine setLodThreshold (a scalar today; the curve interpolates by
 * AGL). R19 measured flat-1.0 = 270 draws at Owens (breaks 261) — the curve
 * spends threshold only at low AGL where the ring is small. Sanctioned value
 * moves: satMaxZoomByTier.high 17→18, demMaxZoom 15→16 (probe-gated), both
 * behind this flag (plan §5.5); texture-bytes gate moves 300→450 MB with it
 * (plan §5.2). demErrorTable: the vendored setDemErrorTable() targets
 * (z13 45 / z14 18 / z15 5 / z16 2 m), each step tris-measured at P-LEWIS
 * (<= +15%).
 */
export const TERRA_SHARP = {
  enabled: false,
  maxZoomHigh: 18, // consumed at engine mount; falls back to TILES.satMaxZoomByTier when off
  demMaxZoom: 16, // only if the in-round probe shows real Esri Terrain3D z16 LERC at the test poses
  lodCurve: [
    // [aglM, threshold] — interpolated, clamped at the ends. Toy style never
    // reads this (lodThresholdFor returns 1 for toy — frozen).
    [600, 1.0],
    [3000, 0.86],
    [9000, 0.78],
  ],
  demErrorTable: { 13: 45, 14: 18, 15: 5, 16: 2 }, // vendored martini targets, meters
  statsHz: 2, // runtime.terraStats publish cadence
};

/**
 * R22 A TERRA — vendored-pipeline patches (lib/fly/vendor/three-tile/ —
 * see its VENDOR.md patch ledger; every patch sits behind one of these
 * switches and OFF = verbatim upstream behavior) + the warp descent seed.
 *
 * parallelFetch: per-tile imagery+DEM Promise.all (upstream fetches them
 * SERIALLY — 2 RTTs/tile). lodBailFix: upstream _update stops evaluating the
 * WHOLE subtree once downloadingThreads+4 >= maxThreads (6 in flight = tree
 * stalls); the fix skips SUBDIVIDING but keeps recursing. maxThreads: the
 * measured burst value replacing TILES.maxThreads 10 while a warp descent is
 * hot. warp: engine.notifyWarp(lon,lat) — pre-seeded optional-call in
 * FlyScene warpToGeo — prefetches the destination tile pyramid through
 * TERRA_CACHE (bounded, cache hits skip network) and opens a maxThreads
 * burst window. No quadtree surgery.
 */
export const TERRA_PIPE = {
  enabled: false,
  parallelFetch: true,
  lodBailFix: true,
  maxThreads: 16, // burst value; steady-state stays TILES.maxThreads
  warp: { enabled: true, prefetchTiles: 48, burstSec: 8 },
};

/**
 * R22 A TERRA — persistent raster cache for Esri imagery + DEM (the R21
 * TILE_PIPELINE cache covers ONLY OpenFreeMap vector pbf; imagery/DEM are
 * fetched cold on every warp today). Mechanism: app-owned dataType loaders
 * registered through the vendored LoaderFactory
 * (registerMaterialLoader/registerGeometryLoader — the designed seam; NOT a
 * Service Worker, NOT a fetch shim: imagery rides ImageLoader/
 * HTMLImageElement which never touches window.fetch). NEW
 * lib/fly/raster-cache.js: fetch() + Cache API + createImageBitmap →
 * Texture for imagery; arraybuffer → the vendored plugin's LERC decode for
 * DEM. Every op try/catch — cache failure degrades to plain fetch (the R21
 * idiom). Registration idempotent (HMR-safe).
 */
export const TERRA_CACHE = {
  enabled: false,
  name: 'fly-raster-v1', // versioned: bump to invalidate
  maxEntries: 9000, // imagery+DEM combined, insertion-order trim
  errorTtlSec: 600, // failed fetches are NOT cached as content; marker TTL only
};

/**
 * R22 B SETTLE — content-aware boot/warp reveals ("hold until sharp" — user
 * decision 2026-08-07). Satellite far-warp readiness becomes:
 * terraStats.sharp (see TERRA_SHARP contract; undefined = legacy
 * downloading<3 path) AND — only when AGL is inside their mount bands —
 * building/road ring ready-fractions and the parcel trust gate resolved.
 * WARP.far.holdMaxMs 3500→6500 is pre-sanctioned (plan §5.1) and consumed
 * ONLY with this flag on; holdMin 2200 stays; the time cap ALWAYS wins over
 * the content gate (a slow network can never trap the player — the R6
 * charter). localHold: local warps (<100 km, today a 900 ms flash with no
 * poll) get a bounded hold ONLY when the tileZ deficit under the camera
 * exceeds localHoldDeficit. BootScreen's satellite world gate gains the same
 * terms (BOOT.maxBootMs does NOT move — frozen).
 */
export const ARRIVAL_GATE = {
  enabled: false,
  sharpZCap: 15, // reveal never waits for deeper than this at cruise
  ringTerms: { buildingReadyFrac: 0.6, roadReadyFrac: 0.5 }, // consulted only inside their AGL bands
  holdMaxMs: 6500, // consumed sanction §5.1 when enabled
  localHold: { maxMs: 1500, localHoldDeficit: 2 },
};

/**
 * R22 B SETTLE — nothing pops, nothing stutters. births: every streaming
 * layer arrives with a birth transition — instanced layers (veg via C's
 * contract, parcel, house lights, clutter) use SCALE ramps (zero shader
 * change, zero cache keys); chunked meshes reuse the Bayer screen-door
 * machinery (sat-buildings via the existing SAT_BLDG_FADE path birth-keyed;
 * roads/tint via 0-gated terms behind NEW -r22 cache keys — plan §5.6 budget
 * <= 3 keys, each joining the PREWARM warm set in the same change). parcel:
 * the growK 0.55→1.0 discrete step becomes a continuous ease; deletes fade
 * before removal; PLACEMENT logic (two-ring settle + trust gate +
 * rolling-MIN regK) is FROZEN — R21 anti-carpet machinery. prewarmSlice: any
 * warm-set variant not compiled by reveal re-queues at <= 1 compileAsync per
 * idle rAF (the post-reveal stutter killer); warm-set extension (troika
 * letters, drei Clouds, PrecipLayer, player hull, WarpBurst, shadow depth
 * variants, SMAA luts) lands in prewarm.js under B's ownership.
 * groundElevVis: FlyScene publishes runtime.groundElevVis (pre-seeded alias
 * of flight.groundElev); B slew-limits it (m/s, snap on warpEpoch) and
 * re-points VISUAL consumers only — the flight model and crash floor keep
 * reading the RAW value (safety never reads a damped signal). ladderFix:
 * buildLadder gains sub-native render-scale rungs before any tier step
 * (CANVAS.dprMin 1→0.75 consumed with this flag — plan §5.8; on a
 * devicePixelRatio-1 display today the ladder degenerates to tier steps
 * ONLY). arrivalCalm: weather wx blend + the 5 s HDRI bucket re-pick get a
 * post-reveal grace + hysteresis so the sky stops morphing right after
 * arrival.
 */
export const SETTLE_CALM = {
  enabled: false,
  births: { rampSec: 0.6, bayerSec: 0.5 },
  parcel: { growEaseSec: 0.6, deleteFadeSec: 0.5 },
  prewarmSlice: { perIdleRaf: 1 },
  groundElevVis: { slewMps: 80 },
  ladderFix: { dprMin: 0.75 },
  arrivalCalm: { graceSec: 6, hdriHysteresis: 0.15 },
};

/**
 * R22 C CLUTTER — ground life. WORKER OUTPUT CONTRACT (protocol 18; C codes
 * both sides; all outputs ABSENT unless CLUTTER.enabled — flag-off worker
 * byte-identical except the v:18 stamp). 'sat-roads' additionally emits:
 *
 *   out.satRoadPaths = { pts: Float32Array [x,z,...] TILE-LOCAL, concatenated
 *                        polylines; offsets: Uint32Array (nPaths+1, in POINT
 *                        units); cls: Uint8Array (nPaths, sat-road class code
 *                        3..6); junctions: Float32Array [x,z,...];
 *                        streetKmPerKm2: number }
 *   out.satParking   = Float32Array, stride 4 [x, z, dx, dz] — TILE-LOCAL
 *                      anchor point + the UNIT direction of the aisle/curb it
 *                      belongs to, so a parked car has a heading without the
 *                      main thread re-walking a polyline.
 *
 * TWO MEASURED DEVIATIONS FROM THE W0 SCAFFOLD TEXT, both forced by what
 * OpenFreeMap actually ships (scripts/r22-c-tileprobe.mjs, live planet build
 * 20260802):
 *
 *  (1) satParking rides 'sat-roads', NOT 'sat-buildings'. THE PLANET SHIPS NO
 *      PARKING POLYGONS AT EITHER RING ZOOM. `landuse` has no parking class at
 *      z13 or z14; the only parking feature is the z14 `poi` layer's
 *      class=parking POINT, which is extentless, orientationless, and — the
 *      disqualifier — DENSER AT LONE PINE (50) THAN AT LEWIS CENTER (4), i.e.
 *      it runs backwards to the density signal the Owens lock depends on. What
 *      the planet DOES ship everywhere is `transportation` class=service: the
 *      parking AISLES and DRIVEWAYS themselves (Powell 412 chains / 9 z13
 *      tiles, Lewis Center 312, Dublin 653). Anchors are sampled off those
 *      plus residential cls-6 curbs. Sourcing them in buildSatRoads keeps the
 *      whole feature on ONE z13 stream; putting them on 'sat-buildings' would
 *      have made every z14 building tile do parking work for a consumer that
 *      cannot read it (SatBuildingEngine forwards no unknown key, and C does
 *      not own that engine).
 *  (2) clsDensityFloor (a bare 0.15, unitless) becomes minStreetKmPerKm2 with
 *      units and a measured table. It is ONE floor for all three pools,
 *      applied IN THE WORKER, so an Owens tile emits neither key at all —
 *      "0 instances AND +0 draws BY CONSTRUCTION" is then the R18 empty-chunk
 *      idiom rather than a client-side filter. Measured km of cls-4..6
 *      centerline per TRUE km², per z13 tile over the 3x3 ring
 *      (scripts/r22-c-density.mjs):
 *
 *        Owens valley floor   0.119 ring · worst tile 0.30
 *        OWENS GATE POSE      0.550 ring · worst tile 1.50   <- must stay 0
 *        Union County OH      1.039 ring · worst tile 1.57   (deep rural)
 *        ----------------------------- floor 2.0 -----------------------------
 *        P-LEWIS              4.754 ring · sparsest tile 2.54
 *        Melton AU            4.151 ring · suburb tiles 3.01-10.55
 *        Powell OH            6.043 · Craigieburn 7.153 · Dublin OH 7.993
 *        Blagnac 9.061 · Manhattan 10.403
 *
 *      2 km of street per km² is a ~1 km block spacing: the honest rural /
 *      suburban line, with 33% clearance under the Owens gate pose's worst
 *      tile and 27% over P-LEWIS's sparsest.
 *
 * trees2: ONE merged trunk+crown BufferGeometry (<= 96 tris) in the SAME
 * single instanced draw — the fly-constants R18 objection rejected a second
 * GEOMETRY (= second draw), not merged geometry. cars.parked: pooled
 * InstancedMesh, anchors two-term anti-dupped against the R18
 * collision-column index (SatParcelHomes is the reference pattern).
 * cars.moving: movers advance as position = f(clock*speed + hash(pathId)) —
 * DETERMINISTIC, so the fleet pin __flyClutterPin freezes the clock and a
 * pinned pose is bit-stable for the flicker gates. poles: derived
 * client-side at the road shader's streetSpacingM 42 phase (the lamp term is
 * `exp(-min(f,1-f)^2 * k)` on `fract(arc / uStreetSpacing)`, so the pools sit
 * at arc = n*42 measured from each chain's own start) — a pole lands ON a
 * shader lamp, never between two. All clutter ships castShadow:false — D
 * flips casters under DEPTH_PASS with measured gpuFrameMs (cross-charter
 * seam, D owns it). Budgets (plan §5.9): parked <= +1 draw / <= 48k tris;
 * moving <= +1 / <= 12k; poles <= +1 / <= 20k; trees2 same 1 draw / pool
 * <= 320k tris (SAT_GROUND_LIFE.poolHigh 5000 x 58 tris = 290k).
 */
export const CLUTTER = {
  enabled: false,
  // --- the clutter engine's OWN z13 ring ------------------------------------
  // Its own stream, not SatRoadEngine's: that engine discards the worker
  // result at finalize and C does not own it (§2). Same z13 tile URLs, so the
  // R21 persistent Cache API tile layer serves the second ask (the cache is
  // per-ORIGIN, not per-worker), and the clutter worker additionally runs in
  // `clutterOnly` mode — the ribbon tessellation is skipped entirely, only the
  // two new keys come back.
  ring: { z: 13, r: 3600 },
  maxChunks: 6, // nearest-win; worst-case guaranteed coverage 2446 m >= every rangeM
  maxBuilds: 2,
  // 16 segments is NOT a taste choice: it is SAT_ROADS.gridSegments, and the
  // bilinear formula is the same one, so a car's ground height and the road
  // ribbon's ground height are computed from the identical 289-sample grid.
  // Any coarser and cars would float above / sink below the road they park on.
  gridSegments: 16,
  sampleBudgetMs: 0.8,
  demZ: 12,
  missMaxTries: 8,
  missRetrySec: 1.5,
  refreshMoveM: 600,
  refreshSec: 2,
  placeCadenceSec: 2, // static pools re-place on the ground-stack cadence
  // AGL gate with hysteresis, ABOVE the tallest pool's own fade so the ring
  // only ever evicts geometry that has already scaled to nothing.
  cullAglOnM: 1500,
  cullAglOffM: 1900,
  // THE OWENS LOCK (see the header table). Applied in the worker.
  minStreetKmPerKm2: 2.0,
  // Per-tile worker caps. maxChunks x maxParkingPerChunk (5,400) is well over
  // the parked pool, so the pool binds and not the stream — but the caps stop
  // a Blagnac tile from serialising 30k anchors nobody can draw.
  worker: { maxParkingPerChunk: 2400, parkingSpacingM: 16, maxPathsPerChunk: 900 },
  trees2: {
    enabled: true,
    maxTrisPerInstance: 96, // budget; the built geometry measures 58
    // MEASURED at P-LEWIS, 120 m AGL, first armed run: the scaffold's 1.62
    // heightMul put the crown's underside (0.36 of total height) BELOW the
    // trunk's top (0.42 of it), so every trunk was inside its own crown and the
    // canopy read as a field of polyhedra hovering ~2 m over the grass — the
    // exact "not immersive" note this round exists to answer. The frame is now
    // authored so the trunk is visible for its bottom 36%.
    trunkFrac: 0.4, // trunk top, as a fraction of total tree height
    // 0.06 → 0.085: at 0.06 a stand's trunk was 0.6 m across under a 10 m
    // crown, i.e. 2 px at the 120 m checkpoint pose and gone at anything
    // steeper. These are STANDS (the R18 semantics), not single trees, so a
    // stouter stem is also the more honest read.
    trunkRadiusFrac: 0.085, // …and its radius, as a fraction of CROWN radius
    heightMul: 2.2, // total tree height = crown radius x this (broadleaf)
    coniferHeightMul: 3.2, // conifers: taller + narrower off the SAME geometry
    coniferWidthFrac: 0.58,
  },
  cars: {
    // rangeM/fade are in WORLD (mercator) units, the PARCEL_HOMES convention.
    parked: {
      enabled: true,
      pool: 1500,
      maxAglM: 1400,
      rangeM: 1500,
      fillFrac: 0.55, // hash-stable fraction of anchors that get a car
      avoidM: 3, // …plus the collision-column radius (anti-dup term 2)
      lenM: [4.1, 5.2], // true metres; width/height derived
      farScale: { startM: 500, endM: 1500, mul: 1.5 },
      altFade: { onM: 900, offM: 1400 },
    },
    moving: {
      enabled: true,
      pool: 300,
      maxAglM: 1200,
      rangeM: 2200,
      speedMps: [8, 17],
      tierMin: 'high',
      perKm: 2.2, // movers per km of admitted centerline (before the pool cap)
      farScale: { startM: 700, endM: 2200, mul: 1.8 },
      altFade: { onM: 800, offM: 1200 },
    },
  },
  poles: {
    enabled: true,
    pool: 900,
    maxAglM: 900,
    rangeM: 900,
    spacingM: 42, // MUST equal SAT_ROADS.night.streetSpacingM — asserted at mount
    heightM: 8.5,
    offsetM: 2.5, // …outboard of the ribbon edge
    juncSuppressM: 16, // no lamp inside this radius of a junction point
    altFade: { onM: 600, offM: 900 },
  },
  // ONE night ramp and ONE material for all three pools. dayFrac/gamma are the
  // EXACT SAT_ROADS.night / SUBURB_NIGHT.houseLights curve, so headlights, lamp
  // heads, the road network and the porch lights all arrive at the same dusk.
  // Sharing the material is not thrift, it is R22's S-defect discipline: every
  // extra material is another program to compile, and a program that compiles
  // after reveal IS the stutter this round exists to kill. Per-part brightness
  // is baked into the emissive atlas instead (headlight > lamp head > tail).
  night: { dayFrac: 0.3, gamma: 1.5, intensity: 2.8 },
};

/**
 * R22 D DEPTH — light lands on the world. Ships BUILT-BUT-OFF pending the
 * user checkpoint (plan §9.3) — certified in BOTH states at W3. catcher:
 * flips SAT_SHADOWS.catcher.enabled (pre-sanctioned one-line move) WITH the
 * AGL + caster-presence gate the catcher's own header demands — mounts only
 * when casters are inside the ortho frustum and AGL < maxAglM, so Owens pays
 * +0 BY CONSTRUCTION. nearReceive: near-ring LEAF terrain tiles
 * receiveShadow inside SAT_SHADOWS.orthoRadiusM — judged by gpuFrameMs A/B
 * (the R13 rejection was FILL-RATE, invisible to draw gates) + acne review
 * at ridge poses; parcel homes join the receive set; roads stay out
 * (additive depthWrite:false cannot receive). n8ao: high tier only,
 * half-res, its OWN EffectPass appended in Effects.jsx buildPassList
 * (convolution — cannot merge into the existing pass; buildPassList is the
 * single source so it auto-joins the PREWARM warm set); MUST be validated
 * against reversedDepthBuffer (the R19 trap — AerialPerspective's detection
 * is the reference). aerialNear: AERIAL_PERSPECTIVE.startM 800 → nearStartM
 * with a small nearMaxMix (the 0-800 m band has ZERO distance attenuation
 * today); the medium/low content-haze flip is the separate pre-sanctioned
 * §5.4 move. Budgets: n8ao <= +3 draws, <= +1.5 ms Owens / <= +2.5 ms
 * Manhattan gpuFrameMs; nearReceive <= +1.0 ms or it ships off.
 */
export const DEPTH_PASS = {
  enabled: false,
  catcher: { enabled: true, maxAglM: 2200 },
  nearReceive: { enabled: true },
  n8ao: { enabled: true, halfRes: true, aoRadius: 24, intensity: 2.2, distanceFalloff: 1.0 },
  aerialNear: { enabled: true, nearStartM: 420, nearMaxMix: 0.1 },
};

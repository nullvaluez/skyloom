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
// Inspect card (round 8.5 §B — right-docked holo panel)
// ---------------------------------------------------------------------------

export const INSPECT = {
  // One silent auto-retry after a failed WARP/CHASE click — covers the
  // scene-remount dead window (the bus usually re-registers within a frame
  // or two; 400ms is generous without feeling like a second click).
  actionRetryMs: 400,
  panelW: 420, // right-docked panel width (px)
  heroH: 210, // planespotters hero photo height (px)
  turntableH: 150, // secondary 3D-model section height when the photo leads
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
  // Round 6 (Phase G): Day style dims toward the destination's LOCAL time
  // (coarse solar elevation from UTC + lon/15 — same "exactness doesn't
  // matter" stance as the atlas tz hints). Intensity-only: the authored
  // colors/fog stay untouched; night/toy styles are unaffected.
  dayCycle: {
    minSunFrac: 0.35, // floor: local midnight keeps 35% of the sun/hemi
    refreshSec: 60,
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
    byStyle: { toy: true, satellite: false, night: false }, // sat = round-11 certified
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
    // Round 11: satellite band raised 900→1500 (the old low band sank distant
    // puffs under the mini-globe rim — read as "fewer, random" once satellite
    // became the default) and stretched to 4200 for a taller cumulus deck.
    satellite: { enabled: true, color: '#ffffff', opacity: 0.55, altMin: 1500, altMax: 4200, countScale: 1, shadows: true },
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
  altSpread: { enabled: true, maxF: 3.2, sizeExp: 0.6 },
  // Round 11: sun-driven tint for the UNLIT cloud material (satellite only —
  // clouds are MeshBasicMaterial, so the day-cycle sun never touched them).
  // frac = the day cycle's 0..1 sun factor: dim (pre-dawn) → warm (golden
  // hour, below warmBand) → bright (day). Applied ~10s cadence, not per frame.
  dayTint: { bright: '#ffffff', warm: '#ffd7ae', dim: '#a9b6c6', warmBand: 0.45 },
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
  // palette, one sun-lit Lambert stone/steel tint (the scene's day sun/hemi
  // light it); the additive halo drops to a whisper (0 disables its draw).
  satStyle: {
    color: '#cfc8ba', // weathered stone under daylight imagery
    haloOpacity: 0.1,
  },
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

// ---------------------------------------------------------------------------
// Unit conversions
// ---------------------------------------------------------------------------

export const KT_TO_MPS = 0.514444;
export const FPM_TO_MPS = 0.00508;
export const FT_TO_M = 0.3048;

// Observation lounge: the shared contract every lounge workstream reads.
//
// ROOM-LOCAL FRAME (metres, true scale): origin = the room floor directly
// under the seated eye; +X = the observer's right, +Y = up, -Z = the room's
// facing (toward the observed runway). The lounge group carries
// rotation.y = site.heading and scale (k, 1, k), so room-local metres land in
// scene units without any other conversion (TRUE_SCALE renders them square).
//
// Sections below are owned by one workstream each (see FLY_OBSERVATION_LOUNGE.md).
// Edit only your own section; the shared numbers at the top are the contract.

/** Shared room envelope. The airport set must leave this volume empty. */
export const LOUNGE_ROOM = Object.freeze({
  eye: Object.freeze([0, 1.18, 0]), // seated eye, room-local
  // Main curtain wall: canted outward (top further out), mullions on a pitch.
  glass: Object.freeze({
    baseZ: -1.2, // glass line at the sill (close enough to see the stands below)
    baseY: 0.12, // sill height above the floor
    topY: 4.6, // head height
    cantDeg: 14, // outward lean of the glazing plane
    halfWidth: 11.2, // the front wall spans x = ±halfWidth
    mullionPitch: 2.24,
    mullionHalf: 0.035, // half the visible mullion face, metres
  }),
  // Side glazing returns from the front corners back into the room.
  side: Object.freeze({ x: 11.2, z0: -1.2, z1: 4.2 }),
  // A glazed roof strip continues the canted wall back over the seats, so
  // overhead traffic and contrails stay in view (y = glass.topY).
  roofGlass: Object.freeze({ z1: 2.6 }),
  // Everything the room owns, including its floor slab and roof.
  envelope: Object.freeze({ minX: -12.6, maxX: 12.6, minY: -0.8, maxY: 5.8, minZ: -3.4, maxZ: 14.6 }),
  // Head limits for the seated observer (radians).
  look: Object.freeze({ yawMin: -2.45, yawMax: 2.45, pitchMin: -1.05, pitchMax: 1.15, defaultPitch: -0.07 }),
});

/** Where the lounge stands at an airport (lib/fly/lounge-site.js). */
export const LOUNGE_SITE = Object.freeze({
  // Generic airports: distance from the runway edge to the room's glass line,
  // and the floor height above the apron, by runway width class.
  generic: Object.freeze([
    { minWidth: 44, edgeM: 330, floorM: 24 },
    { minWidth: 28, edgeM: 230, floorM: 16 },
    { minWidth: 0, edgeM: 120, floorM: 9 },
  ]),
  alongFrac: 0.46, // along the observed runway
  // Authored sites face a chosen runway from the real terminal side.
  // lat/lon: room origin; runway: catalog/authored runway id to face.
  flagship: Object.freeze({
    KCMH: { runway: 'KCMH', along: 1453, cross: -470, floorM: 22 },
    KJFK: { runway: 'KJFK:04L-22R', along: 2380, cross: -640, floorM: 26 },
    LOWI: { runway: 'LOWI:08-26', along: 1400, cross: 300, floorM: 18 },
    YSSY: { runway: 'YSSY:16R-34L', along: 700, cross: 520, floorM: 24 },
  }),
});

/** Per-workstream budgets (draws are steady-state, High tier, while observing). */
export const LOUNGE_BUDGETS = Object.freeze({
  room: { draws: 14, triangles: 160000, textureMiB: 24 },
  airfield: { draws: 40, triangles: 650000, textureMiB: 40 },
  fleet: { draws: 30, triangles: 900000 },
  sky: { draws: 3 },
  total: { draws: 375, triangles: 2200000 }, // the existing High ceilings
});

// --- ROOM (lounge interior, glass, interior light) --------------------------
export const ROOM_LOOK = {};

// --- VIEW (seat camera, binoculars, picking, HUD) ---------------------------
// Read by lib/fly/airport-watch-runtime.js, lib/fly/airport-watch-camera.mjs,
// lib/fly/airport-watch-board.mjs and components/fly/hud/lounge/*. Angles are
// radians in the RENDERED frame (what the observer perceives; with TRUE_SCALE
// on that is the true-proportioned frame), distances are true metres.
export const VIEW = Object.freeze({
  baseFovDeg: 58, // naked-eye vertical field of view
  optics: Object.freeze({
    minMag: 1,
    maxMag: 25,
    steps: Object.freeze([7, 12, 20]), // binocular presets; FOV = baseFovDeg / mag
    defaultMag: 7,
    // The twin-lens mask rises with magnification: absent below maskFromMag,
    // fully up at maskFullMag, so wheel zoom and the B key share one model.
    maskFromMag: 1.3,
    maskFullMag: 2.2,
    binocularAt: 1.5, // target magnification at or above which the binoculars are "up"
    zoomRate: 7, // exponential ease of log(magnification) toward its target, 1/s
    wheelPerPx: 0.0016, // log-magnification per wheel delta pixel
    // While slewing to a new target the field is held at least this many
    // times wider than the aiming error (zoom out, swing, zoom back in).
    slewFovRatio: 2.4,
  }),
  head: Object.freeze({
    lookOmega: 17, // free-look spring, critically damped (rad/s): weight without lag
    followOmega: 5.2, // naked-eye follow of a selected aircraft
    lockOmega: 9.5, // binocular lock-on
    rateFilterSec: 0.22, // low-pass on the target's angular rate (follow feed-forward)
    keyRateRad: 0.95, // arrow-key look speed at 1x, rad/s (scaled by the field of view)
    momentumSec: 0.14, // glide added on drag release (velocity x this)
    lostAfterSec: 1.5, // a followed contact hidden by the walls this long releases the follow
  }),
  sway: Object.freeze({
    fovFrac: 0.009, // hand sway amplitude as a fraction of the field of view
    lockedFrac: 0.35, // share kept while the binoculars hold a lock (stabilised)
  }),
  pick: Object.freeze({
    basePx: 26, // pick radius at 1x ...
    magExp: 0.55, // ... grows as mag^magExp ...
    maxPx: 120, // ... up to this, plus the aircraft's projected half-span
    clickMovePx: 6, // a press that moves less than this ...
    clickMs: 350, // ... and releases sooner than this is a click, not a look-drag
    doubleMs: 330,
    doublePx: 14,
    hoverStick: 0.75, // hysteresis: the hovered contact holds until clearly beaten
  }),
  markers: Object.freeze({
    nearM: 3500, // brackets at full strength inside this range ...
    farM: 45000, // ... fading to minAlpha out here
    minAlpha: 0.22,
    maxAlpha: 0.9,
    minHalfPx: 6, // smallest bracket half-size
    labelArrivalM: 22000, // arrivals inside this range carry a phase label
    labelDepartureM: 16000,
    maxPhaseLabels: 3,
  }),
  acquire: Object.freeze({ maxOffAxisDeg: 32 }), // binocular auto-acquire cone
  board: Object.freeze({
    cacheMs: 400, // board() answers from cache this long (two consumers poll it)
    holdSec: 4, // a row keeps its category until a new one persists this long
    keepSec: 8, // a row that stops qualifying lingers this long (no flicker)
    arrival: Object.freeze({
      rangeM: 40000, // to the threshold
      alignDeg: 24, // ground track vs the landing direction
      lateralM: 700, // corridor half-width at the threshold ...
      lateralFrac: 0.07, // ... widening with distance
      glideDeg: 7, // no steeper than this above the threshold (filters overflights)
      approachRangeM: 30000, // unaligned descending traffic closing on the field
    }),
    departure: Object.freeze({ rangeM: 30000, aglCapM: 4500, minClimbMs: 1.2, minRadialMs: 15 }),
    groundRangeM: 6000,
    overhead: Object.freeze({ minAltM: 6000, rangeM: 80000 }),
    localRangeM: 25000,
    maxRows: 24,
  }),
});

// --- FLEET (live aircraft presentation while observing) ---------------------
export const FLEET_VIEW = {};

// --- SKY (contrails and high traffic seen from the ground) ------------------
export const SKY_VIEW = {};

// --- AIRFIELD (terminal, stands, apron, airfield lighting, ground support) --
// AIRFIELD.ground — the AIRFIELD GROUND workstream (components/fly/observation/
// AirfieldGround.jsx, lib/fly/airfield/*): real OSM airport data, pavement,
// grass, markings and the airfield lighting system for the observed airport.
const AIRFIELD_GROUND = Object.freeze({
  enabled: true,
  // OSM tiles requested around the observed airport's runways (true metres).
  dataPadM: 3000,
  // One height field drives every ground layer: a regular grid in local
  // metres, rebuilt from the drawn terrain tiles' triangles and uploaded as an
  // R32F texture that the vertex shaders read (lib/fly/airfield/airfield-height.js).
  // Every mesh is cut along the field's facets, so the layers are exactly the
  // field plus these lifts and centimetres keep them apart. maxNodes also
  // bounds the triangle count: a big airport (KJFK) gets a 20 m step.
  grid: { stepM: 16, maxNodes: 150000, padM: 60 },
  lift: { grass: 0.02, pavement: 0.05, runway: 0.07, paint: 0.09 },
  // The airport set's apron rectangle (airportLayout, AIRFIELD.structures) is
  // paved with concrete. Its markings should drape on this ground's surface:
  // runtime.airfieldGround.surfaceY(x, z, 'pavement') (+ its decal lift).
  setApron: { enabled: true },
  terrain: {
    firstBudgetMs: 4, // per frame until the first build lands (the layers wait on it)
    budgetMs: 1.5, // per frame for a rebuild after the terrain refined
    pollMs: 500, // vertex-buffer edit check of the tiles in use
    eps: 0.02, // the envelope's clearance over every terrain vertex (m)
    uploadHz: 4,
  },
  taxiway: {
    // Width by airport class (code E/F, C/D, small), fillet radius factor.
    widthM: [23, 18, 10.5],
    filletK: 1.4,
    // Hold short of a runway: distance from the runway centreline (FAA/ICAO).
    holdM: { faa: [76, 61, 38], icao: [90, 75, 45] },
  },
  runway: {
    // Paved shoulders each side, by runway width class (>=44 m, >=29 m, else).
    shoulderM: [7.5, 3.5, 0],
    // Approach lighting by class: big runways ALSF-2, medium MALSR.
    bigLengthM: 2400,
    mediumLengthM: 1500,
  },
  // Taxiway paint is built within this distance of the lounge.
  paint: { maxDistM: 3500 },
  grass: {
    maxCells: 50000, // grid cells kept for grass, nearest first (two triangles each)
    buildingClearM: 4,
    roadClearM: 3,
    // Grass within this reach of a runway/taxiway edge regardless of
    // WorldCover "built-up" (its 10 m pixels mix the pavement in); farther out
    // only where WorldCover sees vegetation or bare ground.
    airsideM: 160,
  },
  lights: {
    capacity: 6144,
    // Sun elevation (degrees) over which the system fades from day to night.
    onDeg: 8,
    fullDeg: -2,
    dayFloor: 0.0, // steady lights by day
    flasherDayFloor: 0.25, // sequenced flashers and PAPI stay visible by day
    gain: 1.0,
  },
});
export const AIRFIELD = {
  // AIRFIELD STRUCTURES (lib/fly/airport-set/*): the terminal pier, jet
  // bridges, stand markings, ground support, masts, tower, hangars, windsocks
  // and signs around the lounge. Metres unless named otherwise.
  structures: Object.freeze({
    enabled: true,
    gateFloorM: 5.0, // departure (gate) level above the apron; bridges dock from here
    eaveM: 3.2, // airside roof overhang beyond the curtain wall
    bridge: Object.freeze({
      rotundaX: 7.0, // rotunda offset from the stand centreline toward the aircraft's left (+X)
      rotundaXWide: 9.5,
      rotundaX2: 22.5, // wide stands: the door-2 bridge
      rotundaBeyondRoadM: 3.6, // rotunda centre beyond the head-of-stand road
      rotundaR: 2.3,
      overlapM: 1.3, // telescoping overlap between extended tunnel sections
      sectionW: Object.freeze([2.5, 2.75, 3.0]),
      sectionH: Object.freeze([2.55, 2.75, 2.95]),
      cabDepth: 3.0, cabWidth: 3.7, cabHeight: 2.8,
      bumperM: 0.12,
      columnFromCabM: 5.2, // drive column distance back from the cab centre
    }),
    mastHeightM: Object.freeze({ big: 30, mid: 25, small: 18 }),
    mastClearOfLoungeM: 60,
    tower: Object.freeze({
      genericHeightM: Object.freeze({ big: 62, mid: 44, small: 26 }),
      genericOffsetM: Object.freeze({ big: 120, mid: 85, small: 55 }), // beyond the left pier end
    }),
    hangars: Object.freeze({ big: Object.freeze([78, 64, 25]), mid: Object.freeze([58, 46, 19]), small: Object.freeze([34, 28, 10]) }), // w, d, h
    windsock: Object.freeze({ crossM: 78, alongFromThresholdM: 320 }),
    signs: Object.freeze({ holdCrossM: 84, alongM: Object.freeze([-430, 390, -920, 880]) }),
    gse: Object.freeze({ speedMps: Object.freeze([6.0, 6.6]) }),
    decalLiftM: 0.12, // markings above the sampled ground (plus a polygon offset)
    // Night: emissive gains in scene-linear radiance (the composer's units).
    // floodPool multiplies the ground under a lamp by (1 + floodPool * pool);
    // floodFill is the faint additive floor under it. A ground layer that
    // lights itself from runtime.airportSet.plan (masts, roofFloods) can set
    // both to 0.
    night: Object.freeze({ interior: 1.15, signs: 1.6, floodPool: 5.5, floodFill: 0.035, floodLight: 1.0 }),
  }),
  ground: AIRFIELD_GROUND,
};

// --- SOUND (room tone and distant aircraft) ---------------------------------
// Read by lib/fly/airport-audio.js. Gains are linear on the effects bus.
export const SOUNDSCAPE = Object.freeze({
  updateHz: 10, // parameter updates (the hook ticks faster; the soundscape throttles)
  room: Object.freeze({
    hvacGain: 0.05, // low ventilation bed (brown noise, lowpassed)
    hvacHz: 210,
    humHz: 118, // a faint air-handler tone under the bed
    humGain: 0.006,
    murmurGain: 0.016, // distant voices: band-limited noise with a slow random swell
    murmurHz: 620,
  }),
  chime: Object.freeze({ firstSec: 22, minSec: 95, maxSec: 210, gain: 0.075, reverbSec: 1.8 }),
  aircraft: Object.freeze({
    voices: 5, // simultaneous outside voices (the loudest contacts)
    rangeM: 20000, // contacts beyond this are never voiced
    refM: 350, // distance at which a source plays at its phase level
    maxGain: 0.34,
    speedOfSound: 343, // m/s — you see the takeoff before you hear it
    historySec: 75, // retarded-time history kept per contact
    sampleHz: 5,
    doppler: true,
    // Source level by flight phase (lib/fly/flight-phase.js PHASE values).
    phaseLevel: Object.freeze({
      runway: 1, 'climb-out': 0.9, departure: 0.62, final: 0.55, approach: 0.42, taxi: 0.2,
      parked: 0.05, climb: 0.36, descent: 0.26, level: 0.28, cruise: 0.22,
    }),
  }),
  glass: Object.freeze({ cutoffHz: 1350, q: 0.55, level: 0.82 }), // the lounge glazing
  musicDuck: 0.12, // music bus level while observing (1 = untouched)
});

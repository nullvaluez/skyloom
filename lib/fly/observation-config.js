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
export const VIEW = {};

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
  // Layers sit a few centimetres apart above it.
  grid: { stepM: 16, maxNodes: 300000, padM: 60 },
  lift: { grass: 0.1, pavement: 0.13, runway: 0.16, paint: 0.19 },
  terrain: {
    firstBudgetMs: 4, // per frame until the first build lands (the layers wait on it)
    budgetMs: 1.5, // per frame for a rebuild after the terrain refined
    pollMs: 500, // vertex-buffer edit check of the tiles in use
    eps: 0.02, // the envelope's clearance over every terrain vertex (m)
    uploadHz: 4,
  },
  // Geometry is subdivided so the per-vertex bend and height field stay exact.
  maxEdgeM: 12,
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
  grass: {
    maxCells: 140000, // grid cells kept for grass (two triangles each)
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
export const AIRFIELD = { ground: AIRFIELD_GROUND };

// --- SOUND (room tone and distant aircraft) ---------------------------------
export const SOUNDSCAPE = {};

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
// lib/fly/detailed-traffic.js, lib/fly/aircraft-lights.js, lib/fly/fleet-smoke.js,
// components/fly/observation/ParkedFleet.jsx.
export const FLEET_VIEW = {
  // Every contact inside this range of the observer is a real 3D model (no
  // glints); past it the far billboards carry on as in flight.
  modelRangeM: 60000,
  // Parked aircraft on the layout stands (static scenery, never a contact).
  parkedScenery: true,
  parked: {
    // A real grounded contact within this radius of a stand hides its parked
    // stand-in (metres, scaled by the stand class).
    occupiedRadiusM: 28,
    // Share of stands left empty (deterministic per airport).
    emptyShare: 0.18,
  },
  // Aircraft lights (GlowPoints): radiance in buffer units before exposure.
  lights: {
    capacity: 3200,
    nav: 7,
    beacon: 14,
    strobe: 70,
    landing: 260,
    taxi: 60,
    turnoff: 45,
    dayFloor: 0.18, // nav/beacon brightness kept in daylight (fraction of night)
    billboardRangeM: 120000, // beacons/strobes on far glints at night
  },
  smoke: { capacity: 320, lifeSec: 6.5, puffs: 9 },
};

// --- SKY (contrails and high traffic seen from the ground) ------------------
// components/fly/TrafficContrails.jsx, lib/fly/aircraft-wake.js.
export const SKY_VIEW = {
  // While observing, every jet inside this range that is forming a trail
  // keeps one (tier caps below).
  rangeM: 120000,
  maxTrails: { high: 96, medium: 56, low: 28 },
  // Persistence (s): each ~2,000 ft band gets its own humidity for the hour,
  // so one layer keeps trails for five minutes and another for two.
  lifeSec: [120, 300],
  pointSec: 2.4, // history spacing (coarse: the trail is kilometres long)
  points: 128, // per trail ring (bounded memory: ~5.1 min at 2.4 s)
  freshM: 14, // fresh plume width beyond the engine span
  formSec: 0.3, // the trail condenses this far behind the engines
  vortexM: 150, // growth through the vortex phase...
  vortexSec: 40, // ...with this time constant
  spreadMps: 2.0, // then the persistent trail spreads
  minPx: 1.3, // never thinner than this on screen (energy-conserving)
  density: 0.82, // fresh optical density
  cloudFloor: 0.2, // overlay cloud gate floor: a hint survives behind cloud
  sinkMps: 0.35, // slow subsidence of old trails
  // Upper winds blow harder than the surface report: drift = surface wind
  // times windK, capped.
  windK: 1.8,
  windMaxMps: 25,
  backfillSec: 100, // trail laid behind a jet first seen already cruising
};

// --- AIRFIELD (terminal, stands, apron, airfield lighting, ground support) --
export const AIRFIELD = {};

// --- SOUND (room tone and distant aircraft) ---------------------------------
export const SOUNDSCAPE = {};

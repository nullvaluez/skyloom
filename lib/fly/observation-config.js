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
    night: Object.freeze({ interior: 1.15, signs: 1.6, floodPool: 0.55, floodLight: 1.0 }),
  }),
};

// --- SOUND (room tone and distant aircraft) ---------------------------------
export const SOUNDSCAPE = {};

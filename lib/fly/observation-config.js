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
  // runway: catalog/authored runway id to face; along/cross: metres from its
  // first end along the centreline, and off it (+ = right of that direction).
  // Each is checked with scripts/review-lounge-sightlines.cjs: approaches and
  // touchdown zones in view, and the set's pier and apron on real apron, not
  // on a runway or taxiway. YSSY sits at the 16R end of the international
  // side: at along 700 the terminal's 49 m north block hid every 16R arrival.
  flagship: Object.freeze({
    KCMH: { runway: 'KCMH', along: 1453, cross: -470, floorM: 22 },
    KJFK: { runway: 'KJFK:04L-22R', along: 2380, cross: -640, floorM: 26 },
    LOWI: { runway: 'LOWI:08-26', along: 1400, cross: 300, floorM: 18 },
    YSSY: { runway: 'YSSY:16R-34L', along: 100, cross: 580, floorM: 24 },
  }),
});

/** Per-workstream budgets (draws are steady-state, High tier, while observing). */
/**
 * Choosing a seat at an airport without an authored one (lib/fly/lounge-seat.js):
 * candidate seats along each long runway, scored on the OSM airfield raster.
 */
export const SEAT = Object.freeze({
  cellM: 8, // raster cell, true metres
  maxCells: 6000000, // larger airfields keep the generic seat
  sampleM: 20, // footprint sample spacing
  runwayHalfM: 30, // an OSM runway centreline without a polygon
  taxiwayHalfM: 13, // an OSM taxiway centreline (23 m pavement + margin)
  shoulderM: 8, // around the registered runway rectangles
  minLengthFrac: 0.6, // faceable runways: this share of the longest, or longer
  alongFrac: [0.12, 0.88], // along a faceable runway, searched...
  alongStepM: 100,
  edgeM: [120, 1100], // ... and runway edge to glass line, searched
  edgeStepM: 40,
  preferEdgeM: [250, 750], // close enough to see, far enough for stands and a taxilane
  approachM: [1500, 3000, 5000], // approach points checked for sightlines (3-degree path)
  sightM: 3500, // sightlines march this far (the airfield data's reach)
  sightTop: 60, // only the best footprints get sightline checks
  gateCap: 8, // real gates at the stands count up to this many
  midFloorM: 16, // the mid set (airport-layout.js SET_SIZE.mid) a wide runway may also take
  minScore: -40, // below this the generic seat stays
  goodScore: 100, // a full-size seat this good is taken; below it the mid set may win
  loadTimeoutMs: 25000, // the airfield data the reveal waits for (the transfer starts at once); later keeps the generic seat
  weights: Object.freeze({
    standsApron: 100, apron: 40, pierBuilding: 30, gate: 6,
    standsTaxiway: 220, pierTaxiway: 160, apronTaxiway: 70, standsBuilding: 120,
    edge: 0.06, along: 30, blockedFaced: 10, blockedOther: 3, midSet: 15,
  }),
});

export const LOUNGE_BUDGETS = Object.freeze({
  room: { draws: 14, triangles: 160000, textureMiB: 24 },
  airfield: { draws: 40, triangles: 650000, textureMiB: 40 },
  fleet: { draws: 30, triangles: 900000 },
  sky: { draws: 3 },
  total: { draws: 375, triangles: 2200000 }, // the existing High ceilings
  // LOUNGE_PIER (Gate to Gate W4): satellite building chunks while observing,
  // and the parked fleet once the pier puts stands on both sides.
  city: { maxChunks: 9 },
  parked: { draws: 8, triangles: 170000 },
});

// --- LOUNGE, FURTHER (Gate to Gate W4: pier room, walking, vantage seats) ----
// Numbers only; the flags (LOUNGE_PIER / LOUNGE_WALK / LOUNGE_BRIDGE, read
// through lib/fly/ops-flags.js) decide whether anything reads them. The room
// variant ('classic' today, 'pier' behind LOUNGE_PIER) rides on site.variant.

/** The pier room (LOUNGE_PIER): the back wall between the FIDS boards becomes glass. */
export const LOUNGE_PIER_ROOM = Object.freeze({
  // Vertical, on the back wall's inner face: a canted pane would put its head
  // outside the envelope (maxZ 14.6). Four bays on the front's mullion pitch.
  backGlass: Object.freeze({ z: 14.2, halfWidth: 4.48, baseY: 0.12, topY: 4.48, mullionPitch: 2.24, finDepth: 0.2 }),
  // The bar leaves the back wall for the right wall (in place of the art wall).
  // counterX places the whole bar (room-build.js pierBar): at 8.45 the back
  // bar's wall plane lands on the right wall's inner face (x 11.2), so the
  // backlit onyx (x 11.17..11.19) stands in front of the plaster instead of
  // 70 mm inside it (8.55 put that plane at 11.3).
  bar: Object.freeze({ wall: 'right', z0: 4.7, z1: 9.5, counterX: 8.45, counterDepth: 0.65, top: 1.08 }),
  communalTableX: 4.4,
  // The private upper observation room is reached by the same walking controller.
  // The lower deck remains at its original height; no ground-level rear view is lost.
  upper: Object.freeze({
    floorY: 4.6, roofY: 7.85, slabM: 0.16, guardM: 1.08,
    plate: Object.freeze({ x0: -11.2, x1: 11.2, z0: 8.0, z1: 14.2 }),
    stair: Object.freeze({ x0: -10.95, x1: -9.05, z0: 3.6, z1: 11.16, rise: 4.6, steps: 28 }),
    well: Object.freeze({ x0: -11.2, x1: -8.8, z0: 3.2, z1: 11.16 }),
    bottomLanding: Object.freeze({ x0: -10.95, x1: -9.05, z0: 2.2, z1: 3.6 }),
    topLanding: Object.freeze({ x0: -10.95, x1: -8.5, z0: 11.16, z1: 12.66 }),
    glazing: Object.freeze({ y0: 4.74, y1: 7.69, frontZ: 8.0, frontX0: -8.8, frontX1: 11.2, backZ: 14.2, halfWidth: 11.2, finDepth: 0.16, pitch: 2.24 }),
    probeEye: Object.freeze([0, 6.1, 10.7]),
  }),
  envelope: Object.freeze({ ...LOUNGE_ROOM.envelope, maxY: 8.05 }),
  // The interior reflection probe is captured from here, not the live eye,
  // so the glass stays right while the observer walks.
  probeEye: Object.freeze([0, 1.5, 6.6]),
});

// A seat's eye: the chair's floor centre plus its seated head offset turned
// with the chair, R(rot)·(0, 1.18, -0.08) (rotation about +Y, the room-build
// frame() convention).
const seatEye = (x, z, rot, floorY = 0) => Object.freeze([x - 0.08 * Math.sin(rot), floorY + LOUNGE_ROOM.eye[1], z - 0.08 * Math.cos(rot)]);
const SEATED_LOOK = Object.freeze({ yawSpan: LOUNGE_ROOM.look.yawMax, pitchMin: LOUNGE_ROOM.look.pitchMin, pitchMax: LOUNGE_ROOM.look.pitchMax, defaultPitch: LOUNGE_ROOM.look.defaultPitch });
const look = (centre) => Object.freeze({ centre, ...SEATED_LOOK });

/**
 * Vantage seats (LOUNGE_WALK): chairs the observer can sit in, per room variant.
 *   id, label, faces ('runway' | 'back')
 *   chair     { x, z, rot } — the chair's floor centre and turn (room-local)
 *   eye       [x, y, z]     — the seated eye, chair + R(rot)·(0, 1.18, -0.08)
 *   approach  [x, z]        — where a glide stands before sitting (free floor)
 *   look      { centre, yawSpan, pitchMin, pitchMax, defaultPitch } — seated
 *             head limits: yaw stays within centre ± yawSpan (room-relative)
 * The classic window seat IS today's seat: its eye and look are LOUNGE_ROOM's.
 * The classic corner seats are the end chairs of the window row (room-plan.js
 * WINDOW_SEATS x = ±8.96), each looking out through its corner.
 */
const WINDOW_SEAT = Object.freeze({
  id: 'window', label: 'Window seat', faces: 'runway',
  chair: Object.freeze({ x: 0, z: 0.08, rot: 0 }),
  eye: LOUNGE_ROOM.eye,
  approach: Object.freeze([-0.8, 0.5]),
  look: look(0),
});
const corner = (side, x, z, rot, approach) => Object.freeze({
  id: `corner-${side}`, label: side === 'left' ? 'Left corner' : 'Right corner', faces: 'runway',
  chair: Object.freeze({ x, z, rot }),
  eye: seatEye(x, z, rot),
  approach: Object.freeze(approach),
  look: look(side === 'left' ? 0.55 : -0.55),
});
export const VANTAGE = Object.freeze({
  classic: Object.freeze([
    WINDOW_SEAT,
    corner('left', -8.96, 0.08, 0.1, [-8.0, 0.5]),
    corner('right', 8.96, 0.08, -0.1, [8.0, 0.5]),
  ]),
  pier: Object.freeze([
    WINDOW_SEAT,
    Object.freeze({
      id: 'back', label: 'Back window', faces: 'back',
      chair: Object.freeze({ x: 0, z: 12.92, rot: Math.PI }),
      eye: seatEye(0, 12.92, Math.PI),
      approach: Object.freeze([0.85, 12.55]),
      look: look(Math.PI),
    }),
    corner('left', -9.7, 0.55, 0.62, [-8.7, 1.1]),
    corner('right', 9.7, 0.55, -0.62, [8.7, 1.1]),
    Object.freeze({
      id: 'upper-front', label: 'Upper runway room', faces: 'runway', floorId: 'upper', floorY: 4.6,
      chair: Object.freeze({ x: -2.24, z: 9.05, rot: 0, floorY: 4.6 }),
      eye: seatEye(-2.24, 9.05, 0, 4.6), approach: Object.freeze([-3.1, 9.5]), look: look(0),
    }),
    Object.freeze({
      id: 'upper-back', label: 'Upper rear room', faces: 'back', floorId: 'upper', floorY: 4.6,
      chair: Object.freeze({ x: 2.24, z: 12.92, rot: Math.PI, floorY: 4.6 }),
      eye: seatEye(2.24, 12.92, Math.PI, 4.6), approach: Object.freeze([3.1, 12.4]), look: look(Math.PI),
    }),
    // The reading nook at the upper room's west end (room-build.js upperNook):
    // turned slightly toward the room's centre, the floor lamp at its left
    // shoulder, its cup on the side table at its right hand.
    Object.freeze({
      id: 'upper-nook', label: 'Upper reading nook', faces: 'runway', floorId: 'upper', floorY: 4.6,
      chair: Object.freeze({ x: -6.5, z: 9.05, rot: -0.12, floorY: 4.6 }),
      eye: seatEye(-6.5, 9.05, -0.12, 4.6), approach: Object.freeze([-5.65, 9.7]), look: look(-0.12),
    }),
    // A rear-facing chair at the upper room's east end, beside the coffee
    // station (room-build.js upperEastSeat).
    Object.freeze({
      id: 'upper-east', label: 'Upper rear corner', faces: 'back', floorId: 'upper', floorY: 4.6,
      chair: Object.freeze({ x: 6.72, z: 12.92, rot: Math.PI, floorY: 4.6 }),
      eye: seatEye(6.72, 12.92, Math.PI, 4.6), approach: Object.freeze([7.58, 12.4]), look: look(Math.PI),
    }),
  ]),
});

/** Walking (LOUNGE_WALK): comfort first — modest speeds, no FOV change, no bob under reduced motion. */
export const WALK = Object.freeze({
  eyeStandM: 1.65, // standing eye height
  radiusM: 0.25, // body radius: blockers are inflated by this, so the eye is a point in the grid
  cellM: 0.1, // collision grid cell
  speedMps: 1.4, // walk
  runMps: 2.4, // Shift
  accelSec: 0.22, // velocity eases to the keys over this
  // Camera-only head bob: vertical dip at each footfall, sway once per stride.
  bob: Object.freeze({ ampM: 0.012, runAmpM: 0.02, strideM: 0.72, swayM: 0.005 }),
  standing: Object.freeze({ pitchMin: -1.2, pitchMax: 1.2 }), // standing yaw is a full circle
  sit: Object.freeze({ promptM: 1.4, promptYawDeg: 70, standSec: 0.35, sitSec: 0.55 }),
  glide: Object.freeze({ maxMps: 3.2, maxSec: 3.0, reducedSec: 0.3 }), // seat glides; a veil cut under reduced motion
  gateGlideSec: 2.6, // LOUNGE_BRIDGE: the glide out to the gate shot
  footstepGain: 0.03, // room bus
});

/** The pier set (LOUNGE_PIER): stands on both sides of a thin pier. */
export const PIER_SET = Object.freeze({
  backFacadeGapM: 0.45, // back facade under the back glass
  backMovers: Object.freeze({ big: 4, mid: 3, small: 2 }), // ground support on the back apron
  parkedHeroWithinM: 110, // parked aircraft beyond this draw the mid LOD
});

/**
 * The pier seat chooser's back hemisphere (LOUNGE_PIER; lib/fly/lounge-seat.js).
 * A separate object: SEAT and its weights are untouched.
 */
export const SEAT_BACK = Object.freeze({
  standsApron: 60, apron: 20, gate: 4, standsTaxiway: 160, standsBuilding: 90,
  target: 9, targetCap: 12, blocked: 2, skyline: 18,
  hemisphereDeg: 75, // the back glass's useful half-angle
  rangeM: 8000, // back targets (second runway, apron) within this
  skylineDeg: 50, skylineKm: Object.freeze([5, 35]), // the city-skyline proxy
});

// --- ROOM (lounge interior, glass, interior light) --------------------------
export const ROOM_LOOK = Object.freeze({
  // Eased lounge exposure bias (stops, on top of the session exposure):
  // the interior reads while the view outside stays bright. AgX rolls the
  // outside off gracefully; judged on the owner's machine.
  exposure: Object.freeze({ day: 0.55, golden: 0.4, night: 0.12, easeSec: 1.2 }),
  // Binoculars focus at infinity: as the twin-lens mask rises (VIEW.optics,
  // airportWatch.optics.amount) the room dissolves between these amounts
  // (early: by the time the field narrows the frames are gone) and is hidden
  // above the second. The FOV pair is the fallback when a runtime has no
  // optics: below the first the room hides, above the second it shows.
  optics: Object.freeze({ fadeFrom: 0.05, fadeTo: 0.45 }),
  binocularHideFov: 24,
  binocularShowFov: 28,
  // N8AO while seated: radius in world units, intensity (the flight values
  // are sized for terrain; a 4.6 m room needs a sub-metre radius).
  ao: Object.freeze({ radius: 0.55, intensity: 2.2 }),
  // Interior reflection probe (night reflections in the glass): face size,
  // the mip level the glass samples (softness), minimum ms between captures.
  probeSize: 192,
  probeLod: 1.6,
  probeMinMs: 1500,
  // The room shows once its programs are compiled (parallel compile); this
  // is the backstop if that never resolves (ms after mount).
  prewarmTimeoutMs: 6000,
});

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
    groundM: 1800, // a parked ground contact past this range draws no idle bracket (still pickable)
    parkedMps: 3, // ... "parked" = slower than this
    gapPx: 4, // idle brackets closer than this to one already drawn are skipped
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
    // Apron floodlights on the parked airframes at night: colour, strength.
    flood: [1, 0.87, 0.7, 0.45],
  },
  // Aircraft lights (GlowPoints): radiance in buffer units before exposure.
  lights: {
    capacity: 3200,
    nav: 12,
    beacon: 22,
    strobe: 110,
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
  // paved with concrete. The set drapes its markings on engine.getGroundAt,
  // which answers this ground's surface wherever it draws (the ground
  // provider, AirfieldGroundSet.groundAt); the set must re-sample when
  // runtime.airfieldGround.version changes, as the terrain under it refines.
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
  // Taxiway paint is built within this distance of the lounge (a 15 cm line is
  // under a pixel beyond it, even through the binoculars).
  paint: { maxDistM: 2800 },
  // Mesh triangles for the four layers (lights extra, ~2 per light). The
  // grid step grows x1.25 until the layers fit (EGLL: 16 m -> 20 m).
  budget: { triangles: 260000 },
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
    // Most lights one airport gets (2 triangles each; KJFK builds ~10.4k).
    // Past it the farthest taxiway edge/centre lights are shed first.
    capacity: 12288,
    // Sun elevation (degrees) over which the system fades from day to night.
    onDeg: 8,
    fullDeg: -2,
    dayFloor: 0.0, // steady lights by day
    flasherDayFloor: 0.25, // sequenced flashers and PAPI stay visible by day
    gain: 1.5,
    // Sprite size against the fixture (glare reads bigger than the lens) and
    // the minimum on-screen size, both as multipliers of each light's own.
    sizeK: 1.8,
    minPxK: 1.35,
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

// --- SECOND LEVEL: FEEL (the LIFE lane; FLY_LOUNGE_SECOND_LEVEL.md) -----------
/**
 * The pier room's feel: surface-aware footsteps, the stair's cadence, the
 * upstairs ambience and the inspectable décor. Pier variant only (the walk
 * runtime and the soundscape gate every reader on it), so the classic room
 * walks, sounds and reads exactly as before. Shared positions live in
 * lib/fly/lounge/upper-dressing.mjs, never here.
 */
export const LOUNGE_FEEL = Object.freeze({
  // Footstep timbres (lib/fly/airport-audio.js cue('step', { surface })).
  // Levels are multiples of WALK.footstepGain on the room bus; stone is the
  // classic scuff, unchanged. Oak knocks low and warm (a damped body tone in
  // the 180-260 Hz band), a rug is a muffled pad, a tread is oak over a hollow
  // riser (a second, brighter resonance).
  steps: Object.freeze({
    oak: Object.freeze({ knockHz: Object.freeze([190, 240]), knockLevel: 0.75, knockSec: 0.085, scuffHz: 1500, scuffLevel: 0.5 }),
    rug: Object.freeze({ lowpassHz: 380, level: 0.5 }),
    tread: Object.freeze({ knockHz: Object.freeze([225, 270]), knockLevel: 0.7, knockSec: 0.07, hollowHz: 360, hollowQ: 3.5, hollowLevel: 0.55, scuffHz: 2300, scuffLevel: 0.55 }),
  }),
  // The stair (lounge-walk-runtime.js): one footfall per tread pair, measured
  // along the horizontal (two 0.27 m goings), instead of the 0.72 m flat
  // stride; and a camera-only stepped lift riding the continuous ramp (the
  // eye climbs in eased steps, low at each footfall), peak `liftM`, faded in
  // and out over the first and last tread pair, zero under reduced motion.
  stair: Object.freeze({ strideM: 0.54, liftM: 0.012, riseFrac: 0.38 }),
  // Upstairs ambience (airport-audio.js): the room bus crossfades with the
  // eye's height between the two floors (smoothly over the stair): quieter
  // murmur (-6 dB), softer ventilation, and the outside a little more present
  // through three glazed walls. The PA chime is unchanged.
  ambience: Object.freeze({ lowerEyeM: 2.2, upperEyeM: 5.6, murmurK: 0.5, hvacK: 0.7, glassLevelK: 1.15, glassCutoffK: 1.22, timeSec: 0.8 }),
  // Inspectable décor (upper-dressing.mjs INSPECTABLES): offered while nearly
  // still and facing it.
  inspect: Object.freeze({ stillMps: 0.3, facingDeg: 25 }),
});

/*
 * LOUNGE MOBILE (2026-10-29; FLY_LOUNGE_MOBILE.md) — two pre-seeded tunable
 * blocks, one per stream, so the two streams never edit the same lines (the
 * R18 pre-seeded-block idiom). Desktop reads neither.
 *   MOBILE_TOUCH — the TOUCH stream: gestures on the look surface (drag look,
 *                  pinch zoom, tap / double-tap), the walk stick, the portrait
 *                  camera, motion look and haptics.
 *   MOBILE_GLASS — the GLASS stream: the portrait binocular view, the phone
 *                  HUD (header, dock, sheets) and its layout constants.
 * The flag itself is LOUNGE_MOBILE (lib/fly/fly-constants.js), read only
 * through lib/fly/lounge-mobile.js.
 */

// ---- MOBILE_TOUCH (owner: the TOUCH stream; edit inside this block only) ----
export const MOBILE_TOUCH = Object.freeze({});
// ---- end MOBILE_TOUCH ----

/*
 * Spacer: the two stream blocks stay several lines apart so a three-way merge
 * never sees adjacent hunks from both streams.
 */

// ---- MOBILE_GLASS (owner: the GLASS stream; edit inside this block only) ----
export const MOBILE_GLASS = Object.freeze({});
// ---- end MOBILE_GLASS ----

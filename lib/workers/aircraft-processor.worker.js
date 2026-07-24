/**
 * Aircraft Processor Web Worker
 * Handles heavy processing off the main thread:
 * - Aircraft classification
 * - Filtering
 * - Spatial indexing with RBush
 */

import { expose, transfer } from 'comlink';
import RBush from 'rbush';

// Import classification functions (these need to be duplicated or bundled)
// For now, we'll inline the essential logic

// Database flags for aircraft
const DB_FLAGS = {
  MILITARY: 1,
  INTERESTING: 2,
  PIA: 4,
  LADD: 8,
};

// Emergency squawk codes
const EMERGENCY_SQUAWKS = ['7500', '7600', '7700'];

// Aircraft colors
const AIRCRAFT_COLORS = {
  commercial: '#4ade80',
  cargo: '#fbbf24',
  military: '#f87171',
  private: '#a78bfa',
  helicopter: '#22d3ee',
  government: '#f472b6',
  special: '#fb923c',
  unknown: '#9ca3af',
  selected: '#60a5fa',
  emergency: '#ff0000',
};

/**
 * Check if aircraft is in emergency
 */
function isEmergency(aircraft) {
  if (!aircraft) return false;
  if (aircraft.emergency && aircraft.emergency !== 'none') return true;
  if (aircraft.squawk && EMERGENCY_SQUAWKS.includes(aircraft.squawk)) return true;
  return false;
}

/**
 * Check if aircraft is military
 */
function isMilitary(aircraft) {
  if (!aircraft) return false;
  if (aircraft.dbFlags && (aircraft.dbFlags & DB_FLAGS.MILITARY)) return true;
  
  const militaryPrefixes = ['RCH', 'EVAC', 'DUKE', 'KING', 'REACH', 'NAVY', 'USAF', 'SAM', 'PAT', 'CNV', 'SPAR', 'FORGE'];
  if (aircraft.flight) {
    const callsign = aircraft.flight.trim().toUpperCase();
    if (militaryPrefixes.some(prefix => callsign.startsWith(prefix))) return true;
  }
  return false;
}

/**
 * Check if aircraft is a helicopter
 */
function isHelicopter(aircraft) {
  if (!aircraft) return false;
  if (aircraft.category === 'A7') return true;

  // R15 "Ground Truth": EXACT designator only. The old substring list matched
  // 'R22' inside 'SR22' and turned every Cirrus into a helicopter; ICAO codes
  // are <= 4 chars so a 3-char pattern can always swallow a longer type.
  const typeCode = aircraft.t?.toUpperCase() || '';
  return typeCode ? EXACT_TYPE_CLASS[typeCode] === 'helicopter' : false;
}

/**
 * Check if aircraft is cargo
 */
function isCargo(aircraft) {
  if (!aircraft) return false;
  
  const cargoAirlines = ['FDX', 'UPS', 'GTI', 'ABX', 'DHL', 'CLX'];
  if (aircraft.flight) {
    const callsign = aircraft.flight.trim().toUpperCase();
    if (cargoAirlines.some(prefix => callsign.startsWith(prefix))) return true;
  }
  
  if (aircraft.t) {
    const typeCode = aircraft.t.toUpperCase();
    if (typeCode.endsWith('F')) return true;
  }
  return false;
}

/**
 * Check if aircraft is private/general aviation
 */
function isPrivate(aircraft) {
  if (!aircraft) return false;
  if (aircraft.category === 'A1') return true;
  if (aircraft.r && aircraft.r.startsWith('N') && (!aircraft.flight || aircraft.flight.trim() === aircraft.r)) {
    return true;
  }
  return false;
}

/**
 * Check if aircraft is on ground
 */
function isOnGround(aircraft) {
  if (!aircraft) return false;
  if (aircraft.alt_baro === 'ground' || aircraft.alt_baro <= 0) return true;
  if (aircraft.gs !== undefined && aircraft.gs < 30) return true;
  return false;
}

/**
 * Classify aircraft type
 */
function classifyAircraft(aircraft) {
  if (!aircraft) return 'unknown';
  if (isEmergency(aircraft)) return 'emergency';
  if (isMilitary(aircraft)) return 'military';
  if (isHelicopter(aircraft)) return 'helicopter';
  if (isCargo(aircraft)) return 'cargo';
  if (isPrivate(aircraft)) return 'private';
  
  // Check for commercial
  if (['A2', 'A3', 'A4', 'A5'].includes(aircraft.category)) return 'commercial';
  if (aircraft.flight && /^[A-Z]{3}\d+/.test(aircraft.flight.trim())) return 'commercial';
  
  return 'unknown';
}

// R14 "AirVenture": exact type CODE -> traffic archetype for the 170 warbird/
// classic types. INLINED synced copy of WARBIRD_ARCHETYPE in lib/warbirds.js —
// the worker runs standalone and cannot import that module, so this copy is the
// established inline pattern. scripts/verify-warbirds.mjs source-parses both and
// hard-fails if they ever diverge. Regenerate together; do not hand-edit one.
const WARBIRD_ARCHETYPE = {
  // WW2 Fighters
  P51:   'warbird-prop',
  CORS:  'warbird-prop',
  SPIT:  'warbird-prop',
  HURI:  'warbird-prop',
  P38:   'warbird-prop',
  P40:   'warbird-prop',
  P47:   'warbird-prop',
  P39:   'warbird-prop',
  P63:   'warbird-prop',
  ME09:  'warbird-prop',
  FW90:  'warbird-prop',
  ZERO:  'warbird-prop',
  HCAT:  'warbird-prop',
  BCAT:  'warbird-prop',
  TCAT:  'warbird-prop',
  YAK3:  'warbird-prop',
  YAK9:  'warbird-prop',
  I16:   'warbird-prop',
  FFLY:  'warbird-prop',
  FURY:  'warbird-prop',
  // WW2 Bombers
  MOSQ:  'warbird-prop',
  TBM:   'warbird-prop',
  SBD:   'warbird-prop',
  B17:   'warbird-heavy',
  B24:   'warbird-heavy',
  B29:   'warbird-heavy',
  LANC:  'warbird-heavy',
  B25:   'classic-transport',
  A20:   'classic-transport',
  // WW2 Patrol / Flying Boats
  CAT:   'classic-transport',
  U16:   'classic-transport',
  // WW2 / Vintage Trainers
  T6:    'warbird-prop',
  T28:   'warbird-prop',
  ST75:  'warbird-prop',
  T34P:  'warbird-prop',
  YK52:  'warbird-prop',
  CJ6:   'warbird-prop',
  F260:  'warbird-prop',
  FA62:  'warbird-prop',
  PT22:  'warbird-prop',
  N320:  'warbird-prop',
  FW44:  'warbird-prop',
  BU81:  'warbird-prop',
  N3N:   'warbird-prop',
  T50:   'prop',
  // Korea / Vietnam Era
  A1:    'warbird-prop',
  V1:    'warbird-prop',
  V10:   'warbird-prop',
  B26:   'classic-transport',
  S2P:   'classic-transport',
  MG21:  'warbird-jet',
  F86:   'warbird-jet',
  A4:    'warbird-jet',
  A37:   'warbird-jet',
  // Early Jets
  MG15:  'warbird-jet',
  MG17:  'warbird-jet',
  MG19:  'warbird-jet',
  F104:  'warbird-jet',
  VAMP:  'warbird-jet',
  VNOM:  'warbird-jet',
  HUNT:  'warbird-jet',
  ME62:  'warbird-jet',
  // Jet Trainers
  T33:   'warbird-jet',
  GNAT:  'warbird-jet',
  L39:   'warbird-jet',
  L29:   'warbird-jet',
  FOUG:  'warbird-jet',
  JPRO:  'warbird-jet',
  STRK:  'warbird-jet',
  M339:  'warbird-jet',
  M326:  'warbird-jet',
  T37:   'warbird-jet',
  T2:    'warbird-jet',
  TS11:  'warbird-jet',
  G2GL:  'warbird-jet',
  L159:  'warbird-jet',
  // Military Transports
  C97:   'warbird-heavy',
  C119:  'warbird-heavy',
  C123:  'warbird-heavy',
  C82:   'warbird-heavy',
  DHC4:  'classic-transport',
  // Warbird Helicopters
  HUCO:  'helicopter',
  H500:  'helicopter',
  S58P:  'helicopter',
  S55P:  'helicopter',
  B47G:  'helicopter',
  // Liaison / Observation
  O1:    'prop',
  L5:    'prop',
  BROU:  'prop',
  F156:  'prop',
  // Classic Airliners
  DC3:   'classic-transport',
  DC4:   'warbird-heavy',
  DC6:   'warbird-heavy',
  DC7:   'warbird-heavy',
  DC2:   'classic-transport',
  CONI:  'warbird-heavy',
  L10:   'prop',
  L12:   'prop',
  L18:   'classic-transport',
  M404:  'classic-transport',
  CVLP:  'classic-transport',
  CVLT:  'classic-transport',
  // Classic Transports
  TRIM:  'classic-transport',
  JU52:  'classic-transport',
  C46:   'classic-transport',
  BE18:  'prop',
  // Golden-Age Biplanes
  BE17:  'prop',
  BU33:  'prop',
  WACF:  'prop',
  FA24:  'prop',
  S108:  'prop',
  G2T1:  'prop',
  DH82:  'prop',
  BU31:  'prop',
  // Classic General Aviation
  J3:    'prop',
  PA18:  'prop',
  CH7A:  'prop',
  AR11:  'prop',
  C120:  'prop',
  C140:  'prop',
  C170:  'prop',
  C195:  'prop',
  ERCO:  'prop',
  GC1:   'prop',
  NAVI:  'prop',
  DHC3:  'prop',
  PA22:  'prop',
  C175:  'prop',
  C180:  'prop',
  C185:  'prop',
  PA25:  'prop',
  L11E:  'prop',
  DHC1:  'prop',
  AN2:   'prop',
  // Aerobatic
  PTS1:  'prop',
  PTS2:  'prop',
  E300:  'prop',
  E200:  'prop',
  EDGE:  'prop',
  SU26:  'prop',
  SU29:  'prop',
  SU31:  'prop',
  CP10:  'prop',
  CP23:  'prop',
  EAGL:  'prop',
  // Homebuilt / Experimental
  RV3:   'prop',
  RV4:   'prop',
  RV6:   'prop',
  RV7:   'prop',
  RV8:   'prop',
  RV9:   'prop',
  RV12:  'prop',
  RV14:  'prop',
  LGEZ:  'prop',
  VEZE:  'prop',
  COZY:  'prop',
  SONX:  'prop',
  VELO:  'prop',
  LNC2:  'prop',
  LEG2:  'prop',
  LNCE:  'prop',
  CH70:  'prop',
  CH75:  'prop',
  BD5:   'prop',
  GLAS:  'prop',
  // Seaplanes / Amphibians
  G44:   'prop',
  G73:   'prop',
  RC3:   'prop',
  LA4:   'prop',
  G21:   'prop',
};

// R15 "Ground Truth": exact MODERN type CODE -> class. INLINED synced copy of
// EXACT_TYPE_CLASS in lib/aircraft-type-tables.js — the worker runs standalone
// and cannot import that module, same constraint as WARBIRD_ARCHETYPE above.
// scripts/verify-classify.mjs source-parses both and hard-fails on divergence.
// Consulted after the warbird table and BEFORE every substring list: ICAO
// designators are <= 4 chars, so any 2-3 char pattern in a substring list can
// swallow an unrelated longer code (SR22/R22, C172/C17). Keys here are disjoint
// from WARBIRD_ARCHETYPE by construction (gate-enforced).
const EXACT_TYPE_CLASS = {
  // Helicopters (63)
  R22: 'helicopter', R44: 'helicopter', R66: 'helicopter', B06: 'helicopter', B105: 'helicopter',
  B212: 'helicopter', B407: 'helicopter', B412: 'helicopter', B429: 'helicopter', B430: 'helicopter',
  B505: 'helicopter', BK17: 'helicopter', S61: 'helicopter', S64: 'helicopter', S70: 'helicopter',
  S76: 'helicopter', S92: 'helicopter', H60: 'helicopter', H47: 'helicopter', H53: 'helicopter',
  H64: 'helicopter', UH1: 'helicopter', A109: 'helicopter', A119: 'helicopter', A139: 'helicopter',
  A149: 'helicopter', A169: 'helicopter', A189: 'helicopter', AW09: 'helicopter', AS50: 'helicopter',
  AS55: 'helicopter', AS65: 'helicopter', AS32: 'helicopter', EC20: 'helicopter', EC25: 'helicopter',
  EC30: 'helicopter', EC35: 'helicopter', EC45: 'helicopter', EC55: 'helicopter', EC75: 'helicopter',
  EXPL: 'helicopter', MD52: 'helicopter', MD60: 'helicopter', GAZL: 'helicopter', PUMA: 'helicopter',
  LYNX: 'helicopter', WASP: 'helicopter', KMAX: 'helicopter', NH90: 'helicopter', H125: 'helicopter',
  H130: 'helicopter', H135: 'helicopter', H145: 'helicopter', H155: 'helicopter', H160: 'helicopter',
  H175: 'helicopter', H215: 'helicopter', H225: 'helicopter', AW39: 'helicopter', AW69: 'helicopter',
  MD50: 'helicopter', EC65: 'helicopter', AS33: 'helicopter',
  // GA piston singles/twins + light turboprops (85)
  C150: 'prop', C152: 'prop', C162: 'prop', C172: 'prop', C177: 'prop',
  C72R: 'prop',
  C182: 'prop', C188: 'prop', C206: 'prop', C207: 'prop', C208: 'prop',
  C210: 'prop', C303: 'prop', C310: 'prop', C337: 'prop', C340: 'prop',
  C402: 'prop', C404: 'prop', C414: 'prop', C421: 'prop', C425: 'prop',
  C441: 'prop', PA23: 'prop', PA24: 'prop', PA28: 'prop', PA30: 'prop',
  PA31: 'prop', PA32: 'prop', PA34: 'prop', PA38: 'prop', PA44: 'prop',
  PA46: 'prop', P28A: 'prop', P28B: 'prop', P28R: 'prop', P28T: 'prop',
  P32R: 'prop', P32T: 'prop', P46T: 'prop', BE33: 'prop', BE35: 'prop',
  BE36: 'prop', BE55: 'prop', BE58: 'prop', BE60: 'prop', BE76: 'prop',
  BE9L: 'prop', BE10: 'prop', BE20: 'prop', BE30: 'prop', BE99: 'prop',
  B350: 'prop', DA20: 'prop', DA40: 'prop', DA42: 'prop', DA50: 'prop',
  DA62: 'prop', DV20: 'prop', SR20: 'prop', SR22: 'prop', S22T: 'prop',
  M20P: 'prop', M20T: 'prop', M7: 'prop', TB10: 'prop', TB20: 'prop',
  TB21: 'prop', TBM7: 'prop', TBM8: 'prop', TBM9: 'prop', PC6: 'prop',
  PC7: 'prop', PC9: 'prop', PC12: 'prop', PC21: 'prop', P180: 'prop',
  AA1: 'prop', AA5: 'prop', DR40: 'prop', RV10: 'prop', COL4: 'prop',
  BN2: 'prop', BN2T: 'prop', DHC2: 'prop', DHC6: 'prop',
  // Business jets (66)
  C500: 'jet', C501: 'jet', C510: 'jet', C525: 'jet', C550: 'jet',
  C551: 'jet', C560: 'jet', C56X: 'jet', C650: 'jet', C680: 'jet',
  C68A: 'jet', C700: 'jet', C750: 'jet', C25A: 'jet', C25B: 'jet',
  C25C: 'jet', C25M: 'jet', CL30: 'jet', CL35: 'jet', CL60: 'jet',
  GLF4: 'jet', GLF5: 'jet', GLF6: 'jet', GLEX: 'jet', GL5T: 'jet',
  GL6T: 'jet', GL7T: 'jet', G150: 'jet', G280: 'jet', GALX: 'jet',
  ASTR: 'jet', E50P: 'jet', E55P: 'jet', E545: 'jet', E550: 'jet',
  E35L: 'jet', LJ24: 'jet', LJ25: 'jet', LJ31: 'jet', LJ35: 'jet',
  LJ40: 'jet', LJ45: 'jet', LJ55: 'jet', LJ60: 'jet', LJ70: 'jet',
  LJ75: 'jet', FA10: 'jet', FA20: 'jet', FA50: 'jet', FA7X: 'jet',
  FA8X: 'jet', F900: 'jet', F2TH: 'jet', H25A: 'jet', H25B: 'jet',
  H25C: 'jet', HA4T: 'jet', PRM1: 'jet', HDJT: 'jet', SF50: 'jet',
  EA50: 'jet', BE40: 'jet', PC24: 'jet', WW24: 'jet', G550: 'jet',
  G650: 'jet',
  // Military (54)
  F15: 'military', F16: 'military', F18: 'military', FA18: 'military', EA18: 'military',
  EF18: 'military', F22: 'military', F35: 'military', F14: 'military', F4: 'military',
  F5: 'military', F117: 'military', A10: 'military', A6: 'military', A7: 'military',
  B1: 'military', B1B: 'military', B2: 'military', B52: 'military', C5: 'military',
  C5M: 'military', C17: 'military', C130: 'military', C30J: 'military', C12: 'military',
  C32: 'military', C37: 'military', C38: 'military', C40: 'military', VC25: 'military',
  RC12: 'military', K35R: 'military', C2: 'military', E2: 'military', E3: 'military',
  E3TF: 'military', E6: 'military', E8: 'military', P3: 'military', P8: 'military',
  U2: 'military', SR71: 'military', T38: 'military', T45: 'military', V22: 'military',
  CV22: 'military', MQ9: 'military', RQ4: 'military', EUFI: 'military', RFAL: 'military',
  TORN: 'military', KC10: 'military', KC46: 'military', TORD: 'military', T1: 'military',
};

/**
 * Get aircraft icon type
 */
function getAircraftIconType(aircraft) {
  if (!aircraft) return 'unknown';

  const category = aircraft.category;
  if (category === 'A7') return 'helicopter';
  if (category === 'B1' || category === 'B4') return 'glider';
  if (category === 'B6') return 'drone';

  const typeCode = aircraft.t?.toUpperCase() || '';
  // R14 "AirVenture": exact warbird/classic code wins outright — return its
  // mapped archetype (drives the 4 new traffic models + the legendary-tier
  // SPICY ping). Checked before the substring lists below so e.g. B29 resolves
  // to warbird-heavy, not caught by any modern substring rule.
  if (typeCode && WARBIRD_ARCHETYPE[typeCode] !== undefined) return WARBIRD_ARCHETYPE[typeCode];
  // R15 "Ground Truth": exact modern code wins next. The heli + military
  // substring lists that used to sit here are GONE — every code they held was
  // 2-3 chars ('R22', 'C17', 'H60'…) and ICAO designators are <= 4, so each one
  // could swallow a longer unrelated type. They live in EXACT_TYPE_CLASS now.
  // The 4-char lists below are exact by construction (no doc8643 code contains
  // another) and stay as the curated fallback tail.
  if (typeCode && EXACT_TYPE_CLASS[typeCode] !== undefined) return EXACT_TYPE_CLASS[typeCode];
  if (typeCode) {
    // Freighters first — a cargo variant must never fall into the airliner
    // families below (B74F/B77F/B748 all start with a family prefix).
    const cargoTypes = ['B74F', 'B77F', 'B748', 'MD11'];
    if (cargoTypes.some(c => typeCode.startsWith(c))) return 'cargo';

    // R15 "Ground Truth": airliner FAMILIES, prefix-matched. The old lists held
    // whole codes ('B777', 'A320') matched with .includes(), and since no
    // doc8643 code contains another, the codes the feed actually sends —
    // B738 / B77W / B77L / B78X / A20N / A35K — matched NOTHING and fell
    // through to the ADS-B category, resolving to 'unknown' whenever the feed
    // omitted it. Three-char prefixes are trap-prone in general (that is this
    // whole round); these are proven to capture zero codes outside the airliner
    // space, warbird and exact tables included — verify-classify g3. Open-ended
    // families get a prefix; closed sets stay whole codes. Regional turboprops
    // (AT4x/AT7x/DH8x/SF34) are deliberately NOT here — they keep their
    // category-driven behaviour rather than being handed a jet-liner model.
    const airlinerFamilies = [
      'A19N', 'A20N', 'A21N', 'A220', 'A30', 'A31', 'A32', 'A33', 'A34', 'A35',
      'A38', 'A3ST', 'BCS1', 'BCS3',
      'B37M', 'B38M', 'B39M', 'B3XM', 'B712', 'B717', 'B73', 'B74', 'B75',
      'B76', 'B77', 'B78',
      'E170', 'E175', 'E190', 'E195', 'E290', 'E295', 'E75L', 'E75S',
      'CRJ', 'MD8', 'MD9', 'RJ1H', 'RJ70', 'RJ85', 'BA46', 'F100',
      'DC10', 'L101', 'IL96', 'IL86',
    ];
    if (airlinerFamilies.some(a => typeCode.startsWith(a))) return 'airliner';
    // (R15: the old bizjet + prop tails were 100% subsumed by EXACT_TYPE_CLASS.)
  }
  
  // Default based on category
  if (category === 'A5' || category === 'A4' || category === 'A3') return 'airliner';
  if (category === 'A2') return 'jet';
  if (category === 'A1') return 'prop';
  
  if (isMilitary(aircraft)) return 'military';
  if (isHelicopter(aircraft)) return 'helicopter';
  
  return 'unknown';
}

/**
 * Get aircraft color
 */
function getAircraftColor(aircraft) {
  const type = classifyAircraft(aircraft);
  return AIRCRAFT_COLORS[type] || AIRCRAFT_COLORS.unknown;
}

/**
 * Get data source
 */
function getDataSource(aircraft) {
  if (!aircraft) return 'unknown';
  if (aircraft.mlat && aircraft.mlat.length > 0) return 'mlat';
  if (aircraft.tisb && aircraft.tisb.length > 0) return 'tisb';
  return 'adsb';
}

// Spatial index instance
const spatialIndex = new RBush();

// ---------------------------------------------------------------------------
// Fly mode (Phase 4): project aircraft into the terrain engine's world frame
// and pack one transferable Float32Array per poll. The frame replicates
// three-tile's EPSG:3857 TileMap after its -90° X rotation:
//   worldX = R·lon·rad   worldY = altitude (true m)   worldZ = -R·ln(tan(π/4+lat/2))
// (verified against engine.geoToWorld at runtime in dev). Positions are
// emitted RELATIVE to a fixed per-session origin (the spawn point) so they
// survive the float32 transfer at full precision; velocities are TRUE m/s.
// ---------------------------------------------------------------------------

const EARTH_R = 6378137;
const DEG2RAD = Math.PI / 180;
const KT_TO_MPS = 0.514444;
const FPM_TO_MPS = 0.00508;
const FT_TO_M = 0.3048;

// Archetype order is the TrafficLayer contract — append only. Indices 0-8 are
// the base fleet; R14 "AirVenture" appends the four warbird/classic archetypes
// at indices 9-12 (must stay in lock-step with TRAFFIC_MODELS,
// buildArchetypeGeometries and the TrafficLayer draw loop).
const FLY_ARCHETYPES = [
  'airliner',
  'jet',
  'prop',
  'helicopter',
  'military',
  'cargo',
  'glider',
  'drone',
  'unknown',
  'warbird-prop',      // 9  (R14)
  'warbird-jet',       // 10 (R14)
  'warbird-heavy',     // 11 (R14)
  'classic-transport', // 12 (R14)
];
const FLY_ARCHETYPE_INDEX = new Map(FLY_ARCHETYPES.map((t, i) => [t, i]));

// Row layout of the packed Float32Array. lib/fly/traffic-engine.js mirrors
// this contract — change both together. Fix TIME travels as fixAge (seconds
// before serverNow): epoch values don't survive float32 (±128s ulp at 1.7e9),
// small ages do — the engine reconstructs tFix = serverNow - fixAge in f64.
const FLY_STRIDE = 9; // [x, y(altM), z, vE, vUp, vN, fixAge, archetypeIdx, flags]
const FLAG_GROUNDED = 1;
const FLAG_EMERGENCY = 2;

const flyState = {
  originX: 0,
  originZ: 0,
  hasOrigin: false,
  metaSig: new Map(), // hex -> signature already sent to the main thread
};

function mercX(lon) {
  return EARTH_R * lon * DEG2RAD;
}

function mercZ(lat) {
  return -EARTH_R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG2RAD) / 2));
}

/**
 * Worker API exposed via Comlink
 */
const processor = {
  /**
   * Process raw aircraft data - classify and prepare for rendering
   * Skips reclassification for already-processed aircraft (differential processing)
   */
  processAircraft(rawAircraft) {
    if (!rawAircraft || !Array.isArray(rawAircraft)) {
      return [];
    }
    
    return rawAircraft.map(ac => {
      // Skip if already processed (has classification data)
      // This provides significant performance improvement on subsequent polls
      if (ac._classification && ac._iconType && ac._color) {
        // Only update dynamic fields
        return {
          ...ac,
          _onGround: isOnGround(ac),
          _emergency: isEmergency(ac),
        };
      }
      
      // Full processing for new aircraft
      return {
        ...ac,
        _classification: classifyAircraft(ac),
        _iconType: getAircraftIconType(ac),
        _color: getAircraftColor(ac),
        _dataSource: getDataSource(ac),
        _onGround: isOnGround(ac),
        _emergency: isEmergency(ac),
      };
    });
  },

  /**
   * Filter aircraft based on filter settings
   */
  filterAircraft(aircraft, filters) {
    if (!aircraft || !filters) return aircraft;

    return aircraft.filter(ac => {
      // Type filter
      const type = ac._classification || classifyAircraft(ac);
      if (!filters.types[type] && type !== 'emergency') {
        return false;
      }

      // Altitude filter
      if (filters.altitude?.enabled) {
        const altitude = ac.alt_baro || ac.alt_geom || 0;
        if (altitude === 'ground') {
          if (filters.altitude.min > 0) return false;
        } else if (altitude < filters.altitude.min || altitude > filters.altitude.max) {
          return false;
        }
      }

      // Speed filter
      if (filters.speed?.enabled) {
        const speed = ac.gs || 0;
        if (speed < filters.speed.min || speed > filters.speed.max) {
          return false;
        }
      }

      // Status filter (airborne/ground)
      const onGround = ac._onGround || isOnGround(ac);
      if (onGround && !filters.status?.onGround) return false;
      if (!onGround && !filters.status?.airborne) return false;

      // Data source filter
      const dataSource = ac._dataSource || getDataSource(ac);
      if (filters.dataSource && !filters.dataSource[dataSource]) {
        return false;
      }

      // Search filter
      if (filters.search?.query) {
        const query = filters.search.query.toLowerCase().trim();
        const field = filters.search.field;
        let matches = false;

        if (field === 'all' || field === 'callsign') {
          if (ac.flight && ac.flight.toLowerCase().includes(query)) matches = true;
        }
        if (field === 'all' || field === 'registration') {
          if (ac.r && ac.r.toLowerCase().includes(query)) matches = true;
        }
        if (field === 'all' || field === 'type') {
          if (ac.t && ac.t.toLowerCase().includes(query)) matches = true;
        }

        if (!matches) return false;
      }

      return true;
    });
  },

  /**
   * Update the spatial index with aircraft positions
   */
  updateSpatialIndex(aircraft) {
    spatialIndex.clear();
    
    const items = aircraft
      .filter(ac => ac.lat && ac.lon)
      .map(ac => ({
        minX: ac.lon,
        minY: ac.lat,
        maxX: ac.lon,
        maxY: ac.lat,
        aircraft: ac,
      }));
    
    spatialIndex.load(items);
    return items.length;
  },

  /**
   * Query aircraft within bounds
   */
  queryBounds(bounds) {
    const results = spatialIndex.search({
      minX: bounds.west,
      minY: bounds.south,
      maxX: bounds.east,
      maxY: bounds.north,
    });
    
    return results.map(item => item.aircraft);
  },

  /**
   * Find aircraft near a point
   */
  queryNearPoint(lon, lat, radiusDegrees = 0.01) {
    const results = spatialIndex.search({
      minX: lon - radiusDegrees,
      minY: lat - radiusDegrees,
      maxX: lon + radiusDegrees,
      maxY: lat + radiusDegrees,
    });
    
    return results.map(item => item.aircraft);
  },

  /**
   * Fly mode: fix the per-session projection origin (the spawn point).
   * Packed positions are relative to it so float32 keeps ~mm precision.
   */
  setFlyAnchor(originLon, originLat) {
    flyState.originX = mercX(originLon);
    flyState.originZ = mercZ(originLat);
    flyState.hasOrigin = true;
    flyState.metaSig.clear();
  },

  /**
   * Fly mode: classify + project one poll payload.
   * @param rawAircraft payload `ac` array
   * @param serverNow payload `now` — server epoch SECONDS (float)
   * @returns transferable { buffer, count, hexes, meta, serverNow }
   *   buffer: Float32Array rows of FLY_STRIDE (origin-relative world pos,
   *           true-m/s velocity, tFix epoch sec, archetype index, flags)
   *   meta:   {hex, flight, r, t, squawk, iconType, color, category} for
   *           hexes that are new or whose identity fields changed
   */
  processForFly(rawAircraft, serverNowRaw) {
    // adsb.lol /v2 sends `now` in epoch MILLISECONDS (seen/seen_pos are
    // seconds); normalize defensively in case the proxy ever changes.
    const serverNow = serverNowRaw > 1e11 ? serverNowRaw / 1000 : serverNowRaw;
    const src = Array.isArray(rawAircraft) ? rawAircraft : [];
    const rows = new Float32Array(src.length * FLY_STRIDE);
    const hexes = [];
    const meta = [];
    let n = 0;

    for (const ac of src) {
      if (!ac?.hex || typeof ac.lat !== 'number' || typeof ac.lon !== 'number') continue;

      const iconType = ac._iconType || getAircraftIconType(ac);
      const color = ac._color || getAircraftColor(ac);
      const grounded = ac.alt_baro === 'ground';
      const emergency = isEmergency(ac);

      // Geometric altitude preferred; both fields are FEET. 'ground' → 0,
      // the traffic engine substitutes terrain elevation.
      const altFt =
        typeof ac.alt_geom === 'number'
          ? ac.alt_geom
          : typeof ac.alt_baro === 'number'
            ? ac.alt_baro
            : 0;
      const altM = grounded ? 0 : Math.max(0, altFt * FT_TO_M);

      const trackRad = (typeof ac.track === 'number' ? ac.track : 0) * DEG2RAD;
      const spd = (typeof ac.gs === 'number' ? ac.gs : 0) * KT_TO_MPS;
      const vN = spd * Math.cos(trackRad);
      const vE = spd * Math.sin(trackRad);
      const vUp = grounded ? 0 : (typeof ac.baro_rate === 'number' ? ac.baro_rate : 0) * FPM_TO_MPS;

      const fixAge = typeof ac.seen_pos === 'number' ? ac.seen_pos : (ac.seen ?? 0);

      const o = n * FLY_STRIDE;
      rows[o] = mercX(ac.lon) - flyState.originX;
      rows[o + 1] = altM;
      rows[o + 2] = mercZ(ac.lat) - flyState.originZ;
      rows[o + 3] = vE;
      rows[o + 4] = vUp;
      rows[o + 5] = vN;
      rows[o + 6] = fixAge;
      rows[o + 7] = FLY_ARCHETYPE_INDEX.get(iconType) ?? FLY_ARCHETYPE_INDEX.get('unknown');
      rows[o + 8] = (grounded ? FLAG_GROUNDED : 0) | (emergency ? FLAG_EMERGENCY : 0);
      hexes.push(ac.hex);
      n += 1;

      const sig = `${ac.flight ?? ''}|${ac.r ?? ''}|${ac.t ?? ''}|${ac.squawk ?? ''}|${iconType}|${color}`;
      if (flyState.metaSig.get(ac.hex) !== sig) {
        flyState.metaSig.set(ac.hex, sig);
        meta.push({
          hex: ac.hex,
          flight: ac.flight?.trim() || null,
          r: ac.r || null,
          t: ac.t || null,
          squawk: ac.squawk || null,
          category: ac.category || null,
          iconType,
          color,
        });
      }
    }

    const out = rows.slice(0, n * FLY_STRIDE);
    return transfer({ buffer: out.buffer, count: n, hexes, meta, serverNow }, [out.buffer]);
  },

  /**
   * Combined process, filter, and index operation
   */
  processAndFilter(rawAircraft, filters) {
    const processed = this.processAircraft(rawAircraft);
    const filtered = this.filterAircraft(processed, filters);
    const indexedCount = this.updateSpatialIndex(processed);
    
    return {
      processed,
      filtered,
      indexedCount,
      totalCount: rawAircraft.length,
      filteredCount: filtered.length,
    };
  },
};

// Expose the API via Comlink
expose(processor);

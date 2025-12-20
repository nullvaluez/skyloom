/**
 * Aircraft Silhouette Library - Filled Shapes (ADSBExchange Style)
 * Each silhouette is a solid filled shape optimized for recognition at small sizes
 * All paths are closed polygons that render as filled shapes, not strokes
 */

// Filled aircraft silhouettes with distinctive shapes
export const AIRCRAFT_SILHOUETTES = {
  // === NARROW-BODY JETS (A320, 737 family) ===
  
  'a320-family': {
    viewBox: '0 0 48 48',
    paths: [{
      d: `M24 6 L25.5 6 L25.5 14 L44 19 L44 21 L25.5 18.5 L25.5 30 L29 32.5 L29 34 L24 32.5 L19 34 L19 32.5 L22.5 30 L22.5 18.5 L4 21 L4 19 L22.5 14 L22.5 6 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  'b737-family': {
    viewBox: '0 0 48 48',
    paths: [{
      d: `M24 7 L25.5 7 L25.5 15 L43 20 L43 22 L25.5 19 L25.5 31 L29 33 L29 34.5 L24 33 L19 34.5 L19 33 L22.5 31 L22.5 19 L5 22 L5 20 L22.5 15 L22.5 7 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  // === WIDE-BODY JETS (A330, 777, 787 family) ===
  
  'a330-family': {
    viewBox: '0 0 48 48',
    paths: [{
      d: `M24 4 L26 4 L26 13 L45 18 L45 20.5 L26 17.5 L26 31 L30 33.5 L30 35 L24 33 L18 35 L18 33.5 L22 31 L22 17.5 L3 20.5 L3 18 L22 13 L22 4 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  'b767-family': {
    viewBox: '0 0 48 48',
    paths: [{
      d: `M24 5 L26 5 L26 13.5 L45 18.5 L45 21 L26 18 L26 31.5 L30 34 L30 35.5 L24 33.5 L18 35.5 L18 34 L22 31.5 L22 18 L3 21 L3 18.5 L22 13.5 L22 5 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  'b777': {
    viewBox: '0 0 48 48',
    paths: [{
      d: `M24 3 L26.5 3 L26.5 12 L46 17 L46 19.5 L26.5 16.5 L26.5 30.5 L31 33 L31 35 L24 32.5 L17 35 L17 33 L21.5 30.5 L21.5 16.5 L2 19.5 L2 17 L21.5 12 L21.5 3 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  // === SUPER JUMBO (A380, 747) ===
  
  'a380': {
    viewBox: '0 0 48 48',
    paths: [{
      // Main body with distinctive wide fuselage
      d: `M22 3 L26 3 L26 11 L46 16 L46 18.5 L26 15.5 L26 29 L31 31.5 L31 33.5 L24 31 L17 33.5 L17 31.5 L22 29 L22 15.5 L2 18.5 L2 16 L22 11 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  'b747': {
    viewBox: '0 0 48 48',
    paths: [{
      // Iconic 747 shape with upper deck hump
      d: `M22 5 L22 3 L26 3 L26 5 L27 5 L27 10 L22 10 L22 5 M24 10 L26.5 10 L26.5 12 L46 17 L46 19.5 L26.5 16.5 L26.5 30 L31 32.5 L31 34.5 L24 32 L17 34.5 L17 32.5 L21.5 30 L21.5 16.5 L2 19.5 L2 17 L21.5 12 L21.5 10 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  // === REGIONAL JETS ===
  
  'embraer-ejet': {
    viewBox: '0 0 48 48',
    paths: [{
      d: `M24 8 L25.5 8 L25.5 16 L42 21 L42 23 L25.5 20 L25.5 29 L28 31 L28 32.5 L24 31 L20 32.5 L20 31 L22.5 29 L22.5 20 L6 23 L6 21 L22.5 16 L22.5 8 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  'crj-family': {
    viewBox: '0 0 48 48',
    paths: [{
      d: `M24 9 L25 9 L25 17 L41 22 L41 23.5 L25 20.5 L25 29.5 L27.5 31 L27.5 32.5 L24 31.5 L20.5 32.5 L20.5 31 L23 29.5 L23 20.5 L7 23.5 L7 22 L23 17 L23 9 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  // === BUSINESS JETS ===
  
  'citation': {
    viewBox: '0 0 48 48',
    paths: [{
      d: `M24 10 L25 10 L25 18 L40 22 L40 23.5 L25 21 L25 28 L27 29.5 L27 31 L24 30 L21 31 L21 29.5 L23 28 L23 21 L8 23.5 L8 22 L23 18 L23 10 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  'gulfstream': {
    viewBox: '0 0 48 48',
    paths: [{
      d: `M24 9 L25.5 9 L25.5 17 L41 21.5 L41 23.5 L25.5 21 L25.5 29 L28 30.5 L28 32 L24 30.5 L20 32 L20 30.5 L22.5 29 L22.5 21 L7 23.5 L7 21.5 L22.5 17 L22.5 9 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  // === TURBOPROPS ===
  
  'atr': {
    viewBox: '0 0 48 48',
    paths: [{
      // High-wing turboprop
      d: `M24 11 L25 11 L25 12 L44 14 L44 16 L25 14.5 L25 28 L27.5 29.5 L27.5 31 L24 30 L20.5 31 L20.5 29.5 L23 28 L23 14.5 L4 16 L4 14 L23 12 L23 11 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  'dash8': {
    viewBox: '0 0 48 48',
    paths: [{
      // High-wing turboprop
      d: `M24 10 L25 10 L25 11.5 L43 13.5 L43 15.5 L25 14 L25 27.5 L27.5 29 L27.5 30.5 L24 29.5 L20.5 30.5 L20.5 29 L23 27.5 L23 14 L5 15.5 L5 13.5 L23 11.5 L23 10 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  // === GENERAL AVIATION ===
  
  'c172': {
    viewBox: '0 0 48 48',
    paths: [{
      // High-wing single-engine
      d: `M24 14 L24.5 14 L24.5 15 L42 16 L42 17.5 L24.5 16.5 L24.5 26 L26.5 27 L26.5 28 L24 27.5 L21.5 28 L21.5 27 L23.5 26 L23.5 16.5 L6 17.5 L6 16 L23.5 15 L23.5 14 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  'piper': {
    viewBox: '0 0 48 48',
    paths: [{
      // Low-wing single-engine
      d: `M24 13 L24.5 13 L24.5 22 L42 23 L42 24.5 L24.5 23.5 L24.5 27 L26 28 L26 29 L24 28.5 L22 29 L22 28 L23.5 27 L23.5 23.5 L6 24.5 L6 23 L23.5 22 L23.5 13 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  // === CARGO/FREIGHTERS ===
  
  'freighter': {
    viewBox: '0 0 48 48',
    paths: [{
      // Bulky fuselage
      d: `M23 4 L27 4 L27 13 L46 18 L46 20.5 L27 17.5 L27 31 L31 33.5 L31 35.5 L24 33 L17 35.5 L17 33.5 L21 31 L21 17.5 L2 20.5 L2 18 L21 13 L21 4 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  // === MILITARY FIGHTER ===
  
  'fighter': {
    viewBox: '0 0 48 48',
    paths: [{
      // Delta/swept wing fighter
      d: `M24 6 L25 6 L25 10 L28 11 L28 12 L25 11.5 L25 13 L46 19 L46 21 L25 16 L25 25 L27 26 L27 28 L24.5 27 L22 28 L22 26 L24 25 L24 16 L2 21 L2 19 L24 13 L24 11.5 L21 12 L21 11 L24 10 L24 6 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  'military-transport': {
    viewBox: '0 0 48 48',
    paths: [{
      // C-17/C-130 style high-wing transport
      d: `M23 10 L26 10 L26 11 L45 13 L45 15.5 L26 13.5 L26 30 L29 32 L29 34 L24 32 L19 34 L19 32 L22 30 L22 13.5 L3 15.5 L3 13 L22 11 L22 10 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  // === HELICOPTERS ===
  
  'helicopter': {
    viewBox: '0 0 48 48',
    paths: [{
      // Main body
      d: `M6 16 L42 16 L42 17 L6 17 Z M23.5 17 L24.5 17 L24.5 20 L32 20 L32 25 L30 27 L18 27 L16 25 L16 20 L23.5 20 Z M30 27 L30 29 L28 30 L20 30 L18 29 L18 27 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },

  // === DRONES/UAV ===
  
  'drone': {
    viewBox: '0 0 48 48',
    paths: [{
      // Quad-copter configuration
      d: `M10 10 L12 10 L12 12 L10 12 Z M36 10 L38 10 L38 12 L36 12 Z M10 36 L12 36 L12 38 L10 38 Z M36 36 L38 36 L38 38 L36 38 Z M18 18 L30 18 L30 30 L18 30 Z M12 12 L18 18 M36 12 L30 18 M12 36 L18 30 M36 36 L30 30`,
      fill: true
    }],
    anchor: [24, 24]
  },

  // === UNKNOWN/RADAR BLIP ===
  
  'unknown': {
    viewBox: '0 0 48 48',
    paths: [{
      // Simple triangle/arrow shape
      d: `M24 12 L28 24 L24 30 L20 24 Z`,
      fill: true
    }],
    anchor: [24, 24]
  },
};

/**
 * Map ICAO aircraft type codes to silhouette names
 * Comprehensive mapping of common aircraft types
 */
export const ICAO_TYPE_TO_SILHOUETTE = {
  // Airbus A320 family
  'A318': 'a320-family',
  'A319': 'a320-family',
  'A320': 'a320-family',
  'A321': 'a320-family',
  'A19N': 'a320-family',
  'A20N': 'a320-family',
  'A21N': 'a320-family',

  // Airbus A330/A340
  'A332': 'a330-family',
  'A333': 'a330-family',
  'A338': 'a330-family',
  'A339': 'a330-family',
  'A342': 'a330-family',
  'A343': 'a330-family',
  'A345': 'a330-family',
  'A346': 'a330-family',

  // Airbus A350
  'A359': 'a330-family',
  'A35K': 'a330-family',

  // Airbus A380
  'A388': 'a380',
  'A380': 'a380',

  // Boeing 737
  'B731': 'b737-family',
  'B732': 'b737-family',
  'B733': 'b737-family',
  'B734': 'b737-family',
  'B735': 'b737-family',
  'B736': 'b737-family',
  'B737': 'b737-family',
  'B738': 'b737-family',
  'B739': 'b737-family',
  'B37M': 'b737-family',
  'B38M': 'b737-family',
  'B39M': 'b737-family',
  'B3XM': 'b737-family',

  // Boeing 757
  'B752': 'b737-family',
  'B753': 'b737-family',
  'B757': 'b737-family',

  // Boeing 767/787
  'B762': 'b767-family',
  'B763': 'b767-family',
  'B764': 'b767-family',
  'B767': 'b767-family',
  'B788': 'b767-family',
  'B789': 'b767-family',
  'B78X': 'b767-family',
  'B787': 'b767-family',

  // Boeing 777
  'B772': 'b777',
  'B773': 'b777',
  'B77L': 'b777',
  'B77W': 'b777',
  'B778': 'b777',
  'B779': 'b777',
  'B777': 'b777',

  // Boeing 747
  'B741': 'b747',
  'B742': 'b747',
  'B743': 'b747',
  'B744': 'b747',
  'B748': 'b747',
  'B74S': 'b747',
  'B747': 'b747',
  'B74F': 'freighter',

  // Embraer E-Jets
  'E170': 'embraer-ejet',
  'E175': 'embraer-ejet',
  'E190': 'embraer-ejet',
  'E195': 'embraer-ejet',
  'E75L': 'embraer-ejet',
  'E75S': 'embraer-ejet',
  'E290': 'embraer-ejet',
  'E295': 'embraer-ejet',

  // CRJ family
  'CRJ1': 'crj-family',
  'CRJ2': 'crj-family',
  'CRJ7': 'crj-family',
  'CRJ9': 'crj-family',
  'CRJX': 'crj-family',

  // ATR
  'AT43': 'atr',
  'AT44': 'atr',
  'AT45': 'atr',
  'AT72': 'atr',
  'AT75': 'atr',
  'AT76': 'atr',

  // Dash 8
  'DH8A': 'dash8',
  'DH8B': 'dash8',
  'DH8C': 'dash8',
  'DH8D': 'dash8',
  'DHC8': 'dash8',

  // Cessna Citations
  'C500': 'citation',
  'C501': 'citation',
  'C510': 'citation',
  'C525': 'citation',
  'C550': 'citation',
  'C551': 'citation',
  'C560': 'citation',
  'C56X': 'citation',
  'C650': 'citation',
  'C680': 'citation',
  'C68A': 'citation',
  'C700': 'citation',
  'C750': 'citation',

  // Gulfstream
  'GL5T': 'gulfstream',
  'GL6T': 'gulfstream',
  'GL7T': 'gulfstream',
  'GLEX': 'gulfstream',
  'G100': 'gulfstream',
  'G150': 'gulfstream',
  'G200': 'gulfstream',
  'G280': 'gulfstream',
  'G350': 'gulfstream',
  'G450': 'gulfstream',
  'G500': 'gulfstream',
  'G550': 'gulfstream',
  'G600': 'gulfstream',
  'G650': 'gulfstream',
  'GALX': 'gulfstream',

  // Cessna 172
  'C172': 'c172',
  'C152': 'c172',
  'C150': 'c172',
  'C182': 'c172',

  // Piper
  'PA28': 'piper',
  'PA32': 'piper',
  'PA34': 'piper',
  'PA44': 'piper',
  'PA46': 'piper',

  // Cargo/Freighters
  'B77F': 'freighter',
  'MD11': 'freighter',
  'A306': 'freighter',
  'A30B': 'freighter',

  // Military transport
  'C130': 'military-transport',
  'C17': 'military-transport',
  'C5': 'military-transport',

  // Fighters
  'F16': 'fighter',
  'F15': 'fighter',
  'F18': 'fighter',
  'F22': 'fighter',
  'F35': 'fighter',
  'FA18': 'fighter',
};

/**
 * Get silhouette definition for an ICAO type code
 * @param {string} icaoType - Aircraft ICAO type code (e.g., "B738", "A320")
 * @returns {Object|null} Silhouette definition or null if not found
 */
export function getSilhouetteByType(icaoType) {
  if (!icaoType) return null;
  
  const typeUpper = icaoType.toUpperCase();
  const silhouetteName = ICAO_TYPE_TO_SILHOUETTE[typeUpper];
  
  return silhouetteName ? AIRCRAFT_SILHOUETTES[silhouetteName] : null;
}

/**
 * Get best silhouette for an aircraft object
 * Falls back to category-based silhouettes if no type-specific match
 * @param {Object} aircraft - Aircraft object with t (type) and category fields
 * @param {string} fallbackType - Fallback icon type from classification
 * @returns {string} Silhouette name to use
 */
export function getBestSilhouette(aircraft, fallbackType = 'a320-family') {
  // Try type-specific silhouette first
  if (aircraft && aircraft.t) {
    const typeMatch = ICAO_TYPE_TO_SILHOUETTE[aircraft.t.toUpperCase()];
    if (typeMatch) return typeMatch;
  }

  // Map fallback types to best silhouette
  const fallbackMap = {
    'airliner': 'a320-family',
    'jet': 'citation',
    'cargo': 'freighter',
    'prop': 'c172',
    'military': 'fighter',
    'helicopter': 'helicopter',
    'government': 'gulfstream',
    'drone': 'drone',
  };

  return fallbackMap[fallbackType] || 'a320-family';
}

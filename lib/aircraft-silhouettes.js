/**
 * Comprehensive Aircraft Silhouette Library
 * Based on tar1090/ADSBExchange style realistic aircraft shapes
 * Each silhouette is designed to be recognizable at small sizes
 */

// Detailed aircraft silhouettes with realistic proportions
export const AIRCRAFT_SILHOUETTES = {
  // === AIRBUS FAMILY ===
  
  // Airbus A320 family (A318/A319/A320/A321)
  'a320-family': {
    viewBox: '0 0 48 48',
    paths: [
      // Fuselage
      { d: 'M24 8v24', stroke: true, strokeWidth: 3.5, opacity: 1 },
      // Wings (swept back, modern jet)
      { d: 'M2 20l22-4M46 20l-22-4', stroke: true, strokeWidth: 3, opacity: 1 },
      // Horizontal stabilizers
      { d: 'M18 32l6-1M30 32l-6-1', stroke: true, strokeWidth: 2, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 32v-8', stroke: true, strokeWidth: 2.5, opacity: 0.9 },
      // Engine pods (underwing)
      { d: 'M10 22v4M38 22v4', stroke: true, strokeWidth: 2.5, opacity: 0.8 },
    ],
  },

  // Airbus A330/A340 - Wide body
  'a330-family': {
    viewBox: '0 0 48 48',
    paths: [
      // Wider fuselage
      { d: 'M24 6v28', stroke: true, strokeWidth: 4.5, opacity: 1 },
      // Larger wings
      { d: 'M1 19l23-3M47 19l-23-3', stroke: true, strokeWidth: 3.5, opacity: 1 },
      // Horizontal stabilizers
      { d: 'M17 34l7-1M31 34l-7-1', stroke: true, strokeWidth: 2.5, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 34v-10', stroke: true, strokeWidth: 3, opacity: 0.9 },
      // Engine pods
      { d: 'M8 21v5M40 21v5', stroke: true, strokeWidth: 3, opacity: 0.8 },
    ],
  },

  // Airbus A380 - Double decker
  'a380': {
    viewBox: '0 0 48 48',
    paths: [
      // Very wide fuselage with double deck indication
      { d: 'M22 6v28M26 6v28', stroke: true, strokeWidth: 2.5, opacity: 1 },
      // Massive wings
      { d: 'M0 18l24-2M48 18l-24-2', stroke: true, strokeWidth: 4, opacity: 1 },
      // Horizontal stabilizers
      { d: 'M16 35l8-1M32 35l-8-1', stroke: true, strokeWidth: 3, opacity: 0.9 },
      // Large vertical stabilizer
      { d: 'M24 35v-12', stroke: true, strokeWidth: 3.5, opacity: 0.9 },
      // Four engines
      { d: 'M6 20v6M16 19v5M32 19v5M42 20v6', stroke: true, strokeWidth: 2.5, opacity: 0.8 },
    ],
  },

  // === BOEING FAMILY ===
  
  // Boeing 737 family (737-700/800/900/MAX)
  'b737-family': {
    viewBox: '0 0 48 48',
    paths: [
      // Fuselage
      { d: 'M24 9v24', stroke: true, strokeWidth: 3.5, opacity: 1 },
      // Wings (slightly less swept than Airbus)
      { d: 'M3 21l21-5M45 21l-21-5', stroke: true, strokeWidth: 3, opacity: 1 },
      // Horizontal stabilizers
      { d: 'M18 33l6-1M30 33l-6-1', stroke: true, strokeWidth: 2, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 33v-8', stroke: true, strokeWidth: 2.5, opacity: 0.9 },
      // Engine pods (underwing, closer to fuselage)
      { d: 'M12 23v4M36 23v4', stroke: true, strokeWidth: 2.5, opacity: 0.8 },
    ],
  },

  // Boeing 757 - Narrow body, longer
  'b757': {
    viewBox: '0 0 48 48',
    paths: [
      // Longer fuselage
      { d: 'M24 6v30', stroke: true, strokeWidth: 3.5, opacity: 1 },
      // Wings
      { d: 'M2 18l22-4M46 18l-22-4', stroke: true, strokeWidth: 3, opacity: 1 },
      // Horizontal stabilizers
      { d: 'M18 36l6-1M30 36l-6-1', stroke: true, strokeWidth: 2, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 36v-10', stroke: true, strokeWidth: 2.5, opacity: 0.9 },
      // Engine pods
      { d: 'M10 20v5M38 20v5', stroke: true, strokeWidth: 2.5, opacity: 0.8 },
    ],
  },

  // Boeing 767/787 - Wide body
  'b767-family': {
    viewBox: '0 0 48 48',
    paths: [
      // Wide fuselage
      { d: 'M24 7v27', stroke: true, strokeWidth: 4.5, opacity: 1 },
      // Wings
      { d: 'M1 19l23-3M47 19l-23-3', stroke: true, strokeWidth: 3.5, opacity: 1 },
      // Horizontal stabilizers
      { d: 'M17 34l7-1M31 34l-7-1', stroke: true, strokeWidth: 2.5, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 34v-10', stroke: true, strokeWidth: 3, opacity: 0.9 },
      // Engine pods (larger)
      { d: 'M8 21v5M40 21v5', stroke: true, strokeWidth: 3, opacity: 0.8 },
    ],
  },

  // Boeing 777 - Heavy wide body
  'b777': {
    viewBox: '0 0 48 48',
    paths: [
      // Wide fuselage
      { d: 'M24 6v29', stroke: true, strokeWidth: 5, opacity: 1 },
      // Large wings
      { d: 'M0 18l24-2M48 18l-24-2', stroke: true, strokeWidth: 4, opacity: 1 },
      // Horizontal stabilizers
      { d: 'M16 35l8-1M32 35l-8-1', stroke: true, strokeWidth: 2.5, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 35v-11', stroke: true, strokeWidth: 3, opacity: 0.9 },
      // Large engine pods
      { d: 'M7 20v6M41 20v6', stroke: true, strokeWidth: 3.5, opacity: 0.8 },
    ],
  },

  // Boeing 747 - Queen of the Skies (distinctive hump)
  'b747': {
    viewBox: '0 0 48 48',
    paths: [
      // Fuselage with upper deck hump
      { d: 'M24 10v25', stroke: true, strokeWidth: 5, opacity: 1 },
      { d: 'M22 6h4v6h-4z', fill: true, opacity: 0.9 }, // Upper deck hump
      // Massive wings
      { d: 'M0 18l24-1M48 18l-24-1', stroke: true, strokeWidth: 4, opacity: 1 },
      // Horizontal stabilizers
      { d: 'M16 35l8-1M32 35l-8-1', stroke: true, strokeWidth: 3, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 35v-12', stroke: true, strokeWidth: 3.5, opacity: 0.9 },
      // Four large engines
      { d: 'M6 20v6M15 19v5M33 19v5M42 20v6', stroke: true, strokeWidth: 3, opacity: 0.8 },
    ],
  },

  // === REGIONAL JETS ===
  
  // Embraer E-Jet (E170/E175/E190/E195)
  'embraer-ejet': {
    viewBox: '0 0 48 48',
    paths: [
      // Smaller fuselage
      { d: 'M24 10v22', stroke: true, strokeWidth: 3, opacity: 1 },
      // Wings
      { d: 'M4 20l20-4M44 20l-20-4', stroke: true, strokeWidth: 2.5, opacity: 1 },
      // Horizontal stabilizers
      { d: 'M19 32l5-1M29 32l-5-1', stroke: true, strokeWidth: 1.5, opacity: 0.9 },
      // T-tail configuration
      { d: 'M24 32v-6', stroke: true, strokeWidth: 2, opacity: 0.9 },
      { d: 'M20 26h8', stroke: true, strokeWidth: 1.5, opacity: 0.9 },
      // Engine pods (rear-mounted)
      { d: 'M18 28v3M30 28v3', stroke: true, strokeWidth: 2, opacity: 0.8 },
    ],
  },

  // Bombardier CRJ (CRJ-700/900)
  'crj-family': {
    viewBox: '0 0 48 48',
    paths: [
      // Narrow fuselage
      { d: 'M24 11v21', stroke: true, strokeWidth: 2.5, opacity: 1 },
      // Small wings
      { d: 'M5 21l19-4M43 21l-19-4', stroke: true, strokeWidth: 2.5, opacity: 1 },
      // T-tail
      { d: 'M24 32v-6', stroke: true, strokeWidth: 2, opacity: 0.9 },
      { d: 'M20 26h8', stroke: true, strokeWidth: 1.5, opacity: 0.9 },
      // Rear-mounted engines
      { d: 'M19 27v4M29 27v4', stroke: true, strokeWidth: 2, opacity: 0.8 },
    ],
  },

  // === TURBOPROPS ===
  
  // ATR 72/42 - High wing turboprop
  'atr': {
    viewBox: '0 0 48 48',
    paths: [
      // Fuselage
      { d: 'M24 12v20', stroke: true, strokeWidth: 3, opacity: 1 },
      // High-mounted wings
      { d: 'M4 14l20-2M44 14l-20-2', stroke: true, strokeWidth: 2.5, opacity: 1 },
      // Propeller discs
      { d: 'M10 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', stroke: true, fill: false, strokeWidth: 1 },
      { d: 'M38 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', stroke: true, fill: false, strokeWidth: 1 },
      // Horizontal stabilizers
      { d: 'M19 32l5-1M29 32l-5-1', stroke: true, strokeWidth: 1.5, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 32v-6', stroke: true, strokeWidth: 2, opacity: 0.9 },
    ],
  },

  // Dash 8 / Q400
  'dash8': {
    viewBox: '0 0 48 48',
    paths: [
      // Fuselage
      { d: 'M24 11v22', stroke: true, strokeWidth: 3, opacity: 1 },
      // High wings
      { d: 'M3 13l21-1M45 13l-21-1', stroke: true, strokeWidth: 2.5, opacity: 1 },
      // Propeller discs
      { d: 'M9 13m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', stroke: true, fill: false, strokeWidth: 1 },
      { d: 'M39 13m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', stroke: true, fill: false, strokeWidth: 1 },
      // Horizontal stabilizers
      { d: 'M19 33l5-1M29 33l-5-1', stroke: true, strokeWidth: 1.5, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 33v-7', stroke: true, strokeWidth: 2, opacity: 0.9 },
    ],
  },

  // === BUSINESS JETS ===
  
  // Cessna Citation family (sleek, swept wings)
  'citation': {
    viewBox: '0 0 48 48',
    paths: [
      // Sleek fuselage
      { d: 'M24 12v18', stroke: true, strokeWidth: 2.5, opacity: 1 },
      // Swept wings
      { d: 'M6 20l18-4M42 20l-18-4', stroke: true, strokeWidth: 2, opacity: 1 },
      // T-tail or low tail
      { d: 'M20 30h8', stroke: true, strokeWidth: 1.5, opacity: 0.9 },
      { d: 'M24 30v-5', stroke: true, strokeWidth: 2, opacity: 0.9 },
      // Rear engines
      { d: 'M20 27v3M28 27v3', stroke: true, strokeWidth: 1.8, opacity: 0.8 },
    ],
  },

  // Gulfstream (large cabin, swept wings)
  'gulfstream': {
    viewBox: '0 0 48 48',
    paths: [
      // Larger fuselage
      { d: 'M24 10v22', stroke: true, strokeWidth: 3, opacity: 1 },
      // Swept wings
      { d: 'M4 19l20-3M44 19l-20-3', stroke: true, strokeWidth: 2.5, opacity: 1 },
      // Horizontal stabilizers
      { d: 'M19 32l5-1M29 32l-5-1', stroke: true, strokeWidth: 1.5, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 32v-7', stroke: true, strokeWidth: 2, opacity: 0.9 },
      // Rear-mounted engines
      { d: 'M19 28v4M29 28v4', stroke: true, strokeWidth: 2.2, opacity: 0.8 },
    ],
  },

  // === GENERAL AVIATION ===
  
  // Cessna 172 (high wing, single prop)
  'c172': {
    viewBox: '0 0 48 48',
    paths: [
      // Small fuselage
      { d: 'M24 15v14', stroke: true, strokeWidth: 2, opacity: 1 },
      // High wing
      { d: 'M8 17h32', stroke: true, strokeWidth: 2, opacity: 1 },
      // Wing struts
      { d: 'M14 17v4M34 17v4', stroke: true, strokeWidth: 1, opacity: 0.7 },
      // Propeller
      { d: 'M22 13h4M24 11v4', stroke: true, strokeWidth: 1.5, opacity: 0.8 },
      // Horizontal stabilizer
      { d: 'M20 29h8', stroke: true, strokeWidth: 1.5, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 29v-4', stroke: true, strokeWidth: 1.5, opacity: 0.9 },
    ],
  },

  // Piper (low wing, single prop)
  'piper': {
    viewBox: '0 0 48 48',
    paths: [
      // Fuselage
      { d: 'M24 14v16', stroke: true, strokeWidth: 2, opacity: 1 },
      // Low wing
      { d: 'M6 24h36', stroke: true, strokeWidth: 2, opacity: 1 },
      // Propeller
      { d: 'M22 12h4M24 10v4', stroke: true, strokeWidth: 1.5, opacity: 0.8 },
      // Horizontal stabilizer
      { d: 'M20 30h8', stroke: true, strokeWidth: 1.5, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 30v-4', stroke: true, strokeWidth: 1.5, opacity: 0.9 },
    ],
  },

  // === CARGO/FREIGHTERS ===
  
  // Cargo variant (bulky fuselage)
  'freighter': {
    viewBox: '0 0 48 48',
    paths: [
      // Wide fuselage
      { d: 'M24 7v28', stroke: true, strokeWidth: 5.5, opacity: 1 },
      // Wings
      { d: 'M1 19l23-3M47 19l-23-3', stroke: true, strokeWidth: 3.5, opacity: 1 },
      // Cargo door indication
      { d: 'M20 18h8v8h-8z', fill: true, opacity: 0.3 },
      // Horizontal stabilizers
      { d: 'M17 35l7-1M31 35l-7-1', stroke: true, strokeWidth: 2.5, opacity: 0.9 },
      // Vertical stabilizer
      { d: 'M24 35v-11', stroke: true, strokeWidth: 3, opacity: 0.9 },
      // Engine pods
      { d: 'M8 21v5M40 21v5', stroke: true, strokeWidth: 3, opacity: 0.8 },
    ],
  },

  // === MILITARY ===
  
  // Fighter jet (delta wing, aggressive)
  'fighter': {
    viewBox: '0 0 48 48',
    paths: [
      // Sleek fuselage
      { d: 'M24 8v20', stroke: true, strokeWidth: 2.5, opacity: 1 },
      // Delta/swept wings
      { d: 'M1 22l23-8M47 22l-23-8', stroke: true, strokeWidth: 3, opacity: 1 },
      // Twin tail fins
      { d: 'M20 28v-6M28 28v-6', stroke: true, strokeWidth: 2, opacity: 0.9 },
      // Canards (front wings)
      { d: 'M18 12l6-2M30 12l-6-2', stroke: true, strokeWidth: 1.5, opacity: 0.8 },
    ],
  },

  // Military transport (C-17, C-130 style)
  'military-transport': {
    viewBox: '0 0 48 48',
    paths: [
      // Wide fuselage (high wing)
      { d: 'M24 12v24', stroke: true, strokeWidth: 4.5, opacity: 1 },
      // High wing
      { d: 'M2 16l22-2M46 16l-22-2', stroke: true, strokeWidth: 3.5, opacity: 1 },
      // T-tail
      { d: 'M24 36v-8', stroke: true, strokeWidth: 3, opacity: 0.9 },
      { d: 'M18 28h12', stroke: true, strokeWidth: 2.5, opacity: 0.9 },
      // Four engines
      { d: 'M8 16v5M16 16v5M32 16v5M40 16v5', stroke: true, strokeWidth: 2, opacity: 0.8 },
    ],
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
  'A19N': 'a320-family', // A319neo
  'A20N': 'a320-family', // A320neo
  'A21N': 'a320-family', // A321neo

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
  'B37M': 'b737-family', // 737 MAX 7
  'B38M': 'b737-family', // 737 MAX 8
  'B39M': 'b737-family', // 737 MAX 9
  'B3XM': 'b737-family', // 737 MAX 10

  // Boeing 757
  'B752': 'b757',
  'B753': 'b757',
  'B757': 'b757',

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
  'B74F': 'freighter', // 747 Freighter

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

  // Cargo/Freighters (with F suffix or known freighters)
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
export function getBestSilhouette(aircraft, fallbackType = 'airliner') {
  // Try type-specific silhouette first
  if (aircraft.t) {
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
  };

  return fallbackMap[fallbackType] || 'a320-family';
}

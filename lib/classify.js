import { DB_FLAGS, AIRCRAFT_CATEGORIES, EMERGENCY_SQUAWKS, AIRCRAFT_COLORS } from './constants';

/**
 * Classify aircraft type based on various factors
 * @param {Object} aircraft - Aircraft data from API
 * @returns {string} - Aircraft classification type
 */
export function classifyAircraft(aircraft) {
  if (!aircraft) return 'unknown';

  // Check for emergency first
  if (isEmergency(aircraft)) {
    return 'emergency';
  }

  // Check for military via dbFlags
  if (isMilitary(aircraft)) {
    return 'military';
  }

  // Check for helicopter via category
  if (isHelicopter(aircraft)) {
    return 'helicopter';
  }

  // Check for government aircraft
  if (isGovernment(aircraft)) {
    return 'government';
  }

  // Check for cargo
  if (isCargo(aircraft)) {
    return 'cargo';
  }

  // Check for private/general aviation
  if (isPrivate(aircraft)) {
    return 'private';
  }

  // Check for special aircraft
  if (isSpecial(aircraft)) {
    return 'special';
  }

  // Check for commercial by category
  if (isCommercial(aircraft)) {
    return 'commercial';
  }

  return 'unknown';
}

/**
 * Check if aircraft is in emergency
 */
export function isEmergency(aircraft) {
  if (!aircraft) return false;

  // Check emergency field
  if (aircraft.emergency && aircraft.emergency !== 'none') {
    return true;
  }

  // Check squawk codes
  if (aircraft.squawk && EMERGENCY_SQUAWKS.includes(aircraft.squawk)) {
    return true;
  }

  return false;
}

/**
 * Check if aircraft is military
 */
export function isMilitary(aircraft) {
  if (!aircraft) return false;

  // Check dbFlags
  if (aircraft.dbFlags && (aircraft.dbFlags & DB_FLAGS.MILITARY)) {
    return true;
  }

  // Check common military callsign prefixes
  const militaryPrefixes = ['RCH', 'EVAC', 'DUKE', 'KING', 'REACH', 'NAVY', 'USAF'];
  if (aircraft.flight) {
    const callsign = aircraft.flight.trim().toUpperCase();
    if (militaryPrefixes.some(prefix => callsign.startsWith(prefix))) {
      return true;
    }
  }

  return false;
}

/**
 * Check if aircraft is a helicopter
 */
export function isHelicopter(aircraft) {
  if (!aircraft) return false;

  // Check category A7 (Rotorcraft)
  if (aircraft.category === 'A7') {
    return true;
  }

  // Check common helicopter type codes
  const heliTypes = ['H60', 'H47', 'H53', 'H64', 'EC35', 'EC45', 'EC55', 'EC75', 'AS50', 'AS55', 'AS65', 'B06', 'B105', 'B212', 'B412', 'B429', 'R22', 'R44', 'R66', 'S76', 'S92', 'AW09', 'AW39', 'AW69', 'AW09', 'AW39', 'A109', 'A139', 'A149', 'A169', 'A189'];
  if (aircraft.t && heliTypes.some(type => aircraft.t.toUpperCase().includes(type))) {
    return true;
  }

  return false;
}

/**
 * Check if aircraft is government (non-military)
 */
export function isGovernment(aircraft) {
  if (!aircraft) return false;

  // Check for government callsign prefixes
  const govPrefixes = ['EXEC', 'SAM', 'AF1', 'AF2', 'GRZLY', 'COAST'];
  if (aircraft.flight) {
    const callsign = aircraft.flight.trim().toUpperCase();
    if (govPrefixes.some(prefix => callsign.startsWith(prefix))) {
      return true;
    }
  }

  return false;
}

/**
 * Check if aircraft is cargo
 */
export function isCargo(aircraft) {
  if (!aircraft) return false;

  // Check common cargo airline callsigns (expanded list)
  const cargoAirlines = [
    'FDX', 'UPS', 'GTI', 'ABX', 'ATN', 'ADB',  // Original list
    'DHL', 'CLX', 'MPH', 'CAL', 'KAL', 'NCA',   // Additional major cargo
    'PAC', 'CPA', 'SIA', 'ANA', 'JAL', 'QFA',   // More cargo carriers
    'FTH', 'PAG', 'ATL', 'AZA', 'AMX', 'CKK',   // Additional cargo
  ];
  if (aircraft.flight) {
    const callsign = aircraft.flight.trim().toUpperCase();
    if (cargoAirlines.some(prefix => callsign.startsWith(prefix))) {
      return true;
    }
  }

  // Check aircraft types commonly used for cargo (expanded and includes F suffix for freighters)
  const cargoTypes = ['B744', 'B748', 'B74F', 'B763', 'B77L', 'B77F', 'MD11', 'A306', 'A30B', 'B764', 'B772', 'B773', 'B752', 'B753'];
  if (aircraft.t) {
    const typeCode = aircraft.t.toUpperCase();
    // Check if type code includes any cargo type or ends with F (freighter designation)
    if (cargoTypes.some(c => typeCode.includes(c)) || typeCode.endsWith('F')) {
      return true;
    }
  }

  return false;
}

/**
 * Check if aircraft is private/general aviation
 */
export function isPrivate(aircraft) {
  if (!aircraft) return false;

  // Check category A1 (Light)
  if (aircraft.category === 'A1') {
    return true;
  }

  // Check for N-number registration with no airline callsign
  if (aircraft.r && aircraft.r.startsWith('N') && (!aircraft.flight || aircraft.flight.trim() === aircraft.r)) {
    return true;
  }

  return false;
}

/**
 * Check if aircraft is special/interesting
 */
export function isSpecial(aircraft) {
  if (!aircraft) return false;

  // Check dbFlags for interesting
  if (aircraft.dbFlags && (aircraft.dbFlags & DB_FLAGS.INTERESTING)) {
    return true;
  }

  return false;
}

/**
 * Check if aircraft is commercial
 */
export function isCommercial(aircraft) {
  if (!aircraft) return false;

  // Check categories A2-A5 (Small to Heavy)
  if (['A2', 'A3', 'A4', 'A5'].includes(aircraft.category)) {
    return true;
  }

  // Check for airline-style callsigns (3 letters + numbers)
  if (aircraft.flight) {
    const callsign = aircraft.flight.trim();
    if (/^[A-Z]{3}\d+/.test(callsign)) {
      return true;
    }
  }

  return false;
}

/**
 * Get color for aircraft type
 */
export function getAircraftColor(aircraft, isSelected = false) {
  if (isSelected) {
    return AIRCRAFT_COLORS.selected;
  }

  const type = classifyAircraft(aircraft);
  return AIRCRAFT_COLORS[type] || AIRCRAFT_COLORS.unknown;
}

/**
 * Get human-readable category description
 */
export function getCategoryDescription(category) {
  return AIRCRAFT_CATEGORIES[category] || 'Unknown';
}

/**
 * Check if aircraft is on ground
 */
export function isOnGround(aircraft) {
  if (!aircraft) return false;

  // Check altitude
  if (aircraft.alt_baro !== undefined) {
    if (aircraft.alt_baro === 'ground' || aircraft.alt_baro <= 0) {
      return true;
    }
  }

  // Check ground speed
  if (aircraft.gs !== undefined && aircraft.gs < 30) {
    return true;
  }

  return false;
}

/**
 * Get data source type
 */
export function getDataSource(aircraft) {
  if (!aircraft) return 'unknown';

  if (aircraft.mlat && aircraft.mlat.length > 0) {
    return 'mlat';
  }

  if (aircraft.tisb && aircraft.tisb.length > 0) {
    return 'tisb';
  }

  return 'adsb';
}

/**
 * Get aircraft icon shape based on physical type
 * This determines the visual icon shape, separate from classification color
 * @param {Object} aircraft - Aircraft data from API
 * @returns {string} - Icon shape type: 'airliner', 'jet', 'helicopter', 'prop', 'cargo', 'military', 'glider', 'drone', 'unknown'
 */
export function getAircraftIconType(aircraft) {
  if (!aircraft) return 'unknown';

  // Check category first (most reliable when available)
  const category = aircraft.category;

  // A7 = Rotorcraft (helicopter)
  if (category === 'A7') {
    return 'helicopter';
  }

  // B1 = Glider, B4 = Ultralight
  if (category === 'B1' || category === 'B4') {
    return 'glider';
  }
  // B6 = UAV/Drone
  if (category === 'B6') {
    return 'drone';
  }

  // Check type code for more specific identification
  const typeCode = aircraft.t?.toUpperCase() || '';

  if (typeCode) {
    // Helicopter type codes (comprehensive list)
    const heliTypes = ['H60', 'H47', 'H53', 'H64', 'EC35', 'EC45', 'EC55', 'EC75',
      'AS50', 'AS55', 'AS65', 'B06', 'B105', 'B212', 'B412', 'B429',
      'R22', 'R44', 'R66', 'S76', 'S92', 'AW09', 'AW39', 'AW69',
      'A109', 'A139', 'A149', 'A169', 'A189', 'B407', 'B505',
      'H125', 'H130', 'H135', 'H145', 'H155', 'H160', 'H175', 'H215', 'H225',
      'EC20', 'EC30', 'EC55', 'EC65', 'MD50', 'MD52', 'MD60', 'MD90',
      'EXPL', 'GAZL', 'PUMA', 'LYNX', 'AS32', 'AS33', 'AS35', 'AS36', 'S61', 'S64', 'S70',
      'BK17', 'K1', 'K2', 'KMAX', 'NH90', 'WASP'];
    if (heliTypes.some(h => typeCode.includes(h))) {
      return 'helicopter';
    }

    // Military aircraft types
    const militaryTypes = ['F16', 'F15', 'F18', 'F22', 'F35', 'F117', 'A10', 'B1B', 'B2', 'B52',
      'C17', 'C130', 'C5', 'KC10', 'KC135', 'KC46', 'E3', 'E6', 'E8', 'P8', 'P3',
      'MQ9', 'RQ4', 'V22', 'CV22', 'T38', 'T6', 'U2', 'SR71', 'EA18', 'EF18',
      'C2', 'E2', 'C40', 'C32', 'VC25', 'EUFI', 'RFAL', 'TORD', 'F14', 'F4', 'F5',
      'A4', 'A6', 'A7', 'C12', 'C37', 'C38', 'RC12', 'RC135', 'EC130', 'AC130',
      'BE35', 'T1', 'T45', 'FA18', 'F104'];
    if (militaryTypes.some(m => typeCode.includes(m))) {
      return 'military';
    }

    // Cargo freighter types
    const cargoTypes = ['B74F', 'B77F', 'B748', 'B744', 'B763', 'B77L', 'MD11', 'A306', 'A30B',
      'A332', 'A333', 'A338', 'A339', 'B764', 'B772', 'B773', 'B752', 'B753'];
    if (cargoTypes.some(c => typeCode.includes(c))) {
      return 'cargo';
    }

    // Small prop/turboprop aircraft (comprehensive)
    const propTypes = ['C172', 'C152', 'C150', 'C177', 'C182', 'C185', 'C206', 'C207', 'C208', 'C210',
      'C310', 'C335', 'C337', 'C340', 'C402', 'C404', 'C414', 'C421', 'C425', 'C441',
      'PA18', 'PA22', 'PA23', 'PA24', 'PA28', 'PA30', 'PA31', 'PA32', 'PA34', 'PA44', 'PA46',
      'BE33', 'BE35', 'BE36', 'BE55', 'BE58', 'BE60', 'BE76', 'BE9L', 'BE20', 'BE30', 'BE99', 'BE10',
      'PC6', 'PC7', 'PC9', 'PC12', 'PC21', 'PC24',
      'TBM7', 'TBM8', 'TBM9', 'P180', 'DA40', 'DA42', 'DA50', 'DA62', 'SR20', 'SR22',
      'M20', 'M600', 'CONI', 'CON1', 'CON2', 'AT43', 'AT44', 'AT45', 'AT72', 'AT75', 'AT76',
      'DH8A', 'DH8B', 'DH8C', 'DH8D', 'DHC2', 'DHC3', 'DHC4', 'DHC5', 'DHC6', 'DHC7', 'DHC8',
      'P28', 'P32', 'P46', 'P210', 'PIVI', 'TRIN', 'RV', 'VANS', 'LANC', 'BN2', 'BN2T',
      'SF34', 'SB20', 'SW4', 'SW3', 'JS31', 'JS32', 'JS41', 'E110', 'E120', 'E121',
      'BDOG', 'AEST', 'PA11', 'PA12', 'PA14', 'PA16', 'PA20', 'J3', 'AC11', 'AC68', 'AC69', 'AC90',
      'C25', 'M7', 'M8', 'M9', 'AA5', 'TB20', 'TB21', 'DR40', 'PITA', 'VENT'];
    if (propTypes.some(p => typeCode.includes(p))) {
      return 'prop';
    }

    // Business jets (comprehensive)
    const bizjetTypes = ['C25A', 'C25B', 'C25C', 'C25M', 'C500', 'C501', 'C510', 'C525', 'C550', 'C551',
      'C560', 'C56X', 'C650', 'C680', 'C68A', 'C700', 'C750',
      'CL30', 'CL35', 'CL60', 'CL30', 'CL35', 'CL60', 'CRJ1', 'CRJ2',
      'GL5T', 'GL6T', 'GL7T', 'GLEX', 'G100', 'G150', 'G200', 'G280', 'G350', 'G450', 'G500', 'G550', 'G600', 'G650', 'GALX',
      'LJ23', 'LJ24', 'LJ25', 'LJ28', 'LJ31', 'LJ35', 'LJ40', 'LJ45', 'LJ55', 'LJ60', 'LJ70', 'LJ75',
      'E35L', 'E50P', 'E55P', 'E135', 'E145', 'E500', 'E545', 'E550',
      'FA10', 'FA20', 'FA50', 'FA7X', 'FA8X', 'F900', 'F2TH', 'FJ10', 'FJ44',
      'H25A', 'H25B', 'H25C', 'HA4T', 'HDJT', 'PRM1', 'SF50', 'EA50', 'BE40', 'BE4W',
      'ASTR', 'WW23', 'WW24', 'WW25', 'SBRL', 'SBR1', 'SBR2',
      'JCOM', 'JSTA', 'P750', 'CVLP', 'CVLT', 'GALX', 'GLEX', 'HOND', 'HA42'];
    if (bizjetTypes.some(b => typeCode.includes(b))) {
      return 'jet';
    }

    // Wide-body airliners
    const widebodyTypes = ['A330', 'A332', 'A333', 'A338', 'A339',
      'A340', 'A342', 'A343', 'A345', 'A346',
      'A350', 'A359', 'A35K',
      'A380', 'A388',
      'B762', 'B763', 'B764', 'B767',
      'B772', 'B773', 'B77L', 'B77W', 'B778', 'B779', 'B777',
      'B788', 'B789', 'B78X', 'B787',
      'B741', 'B742', 'B743', 'B744', 'B748', 'B74S', 'B747',
      'MD11', 'DC10', 'L101', 'IL96', 'IL86', 'A306', 'A30B', 'A3ST'];
    if (widebodyTypes.some(w => typeCode.includes(w))) {
      return 'airliner';
    }

    // Narrow-body airliners
    const narrowbodyTypes = ['A318', 'A319', 'A320', 'A321', 'A19N', 'A20N', 'A21N',
      'B712', 'B717',
      'B731', 'B732', 'B733', 'B734', 'B735', 'B736', 'B737', 'B738', 'B739',
      'B37M', 'B38M', 'B39M', 'B3XM', 'B MAX',
      'B752', 'B753', 'B757',
      'E170', 'E175', 'E190', 'E195', 'E75L', 'E75S', 'E290', 'E295',
      'CRJ1', 'CRJ2', 'CRJ7', 'CRJ9', 'CRJX',
      'MD80', 'MD81', 'MD82', 'MD83', 'MD87', 'MD88', 'MD90', 'DC9',
      'A220', 'BCS1', 'BCS3', 'CS100', 'CS300',
      'B461', 'B462', 'B463', 'BA46', 'RJ1H', 'RJ70', 'RJ85', 'RJ100',
      'F100', 'F50', 'F70', 'F27', 'F28'];
    if (narrowbodyTypes.some(n => typeCode.includes(n))) {
      return 'airliner';
    }
  }

  // Based on ADS-B category size if available
  if (category === 'A5' || category === 'A4' || category === 'A3') {
    return 'airliner'; // Large/Heavy aircraft
  }
  if (category === 'A2') {
    return 'jet'; // Small jets
  }
  if (category === 'A1') {
    return 'prop'; // Light aircraft
  }
  if (category === 'A6') {
    return 'jet'; // High performance
  }

  // Check if military based on classification
  if (isMilitary(aircraft)) {
    return 'military';
  }

  // Check if helicopter based on classification
  if (isHelicopter(aircraft)) {
    return 'helicopter';
  }

  // Fallback: use classifyAircraft to determine icon shape
  // This handles cases where we have callsign/registration but no type code
  const classification = classifyAircraftForIcon(aircraft);

  switch (classification) {
    case 'commercial':
    case 'government':
      return 'airliner';
    case 'cargo':
      return 'cargo';
    case 'military':
      return 'military';
    case 'helicopter':
      return 'helicopter';
    case 'private':
      return 'prop';
    case 'special':
      return 'jet';
    default:
      return 'unknown'; // Use distinct unknown icon for unclassified aircraft
  }
}

/**
 * Simplified aircraft classification for icon fallback
 * Avoids circular dependency with classifyAircraft
 */
function classifyAircraftForIcon(aircraft) {
  if (!aircraft) return 'unknown';

  // Check for helicopter via category
  if (aircraft.category === 'A7') {
    return 'helicopter';
  }

  // Check for cargo by callsign
  const cargoAirlines = ['FDX', 'UPS', 'GTI', 'ABX', 'ATN', 'ADB', 'DHL', 'CLX', 'MPH', 'PAC', 'CAL', 'KAL', 'NCA'];
  if (aircraft.flight) {
    const callsign = aircraft.flight.trim().toUpperCase();
    if (cargoAirlines.some(prefix => callsign.startsWith(prefix))) {
      return 'cargo';
    }
  }

  // Check for private (N-number with no airline callsign or light category)
  if (aircraft.category === 'A1') {
    return 'private';
  }
  if (aircraft.r && aircraft.r.startsWith('N') && (!aircraft.flight || aircraft.flight.trim() === aircraft.r)) {
    return 'private';
  }

  // Check for airline-style callsigns (3 letters + numbers) = commercial
  if (aircraft.flight) {
    const callsign = aircraft.flight.trim();
    if (/^[A-Z]{3}\d+/.test(callsign)) {
      return 'commercial';
    }
  }

  // Check categories A2-A5 (Small to Heavy) = commercial
  if (['A2', 'A3', 'A4', 'A5'].includes(aircraft.category)) {
    return 'commercial';
  }

  return 'unknown';
}

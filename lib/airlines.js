/**
 * Airlines Database
 * Contains major airlines with ICAO/IATA codes, names, countries, and logo URLs
 */

// Major airlines database - sorted by ICAO code
export const AIRLINES = {
  // United States
  AAL: { icao: 'AAL', iata: 'AA', name: 'American Airlines', country: 'US', callsignPrefix: 'AMERICAN' },
  UAL: { icao: 'UAL', iata: 'UA', name: 'United Airlines', country: 'US', callsignPrefix: 'UNITED' },
  DAL: { icao: 'DAL', iata: 'DL', name: 'Delta Air Lines', country: 'US', callsignPrefix: 'DELTA' },
  SWA: { icao: 'SWA', iata: 'WN', name: 'Southwest Airlines', country: 'US', callsignPrefix: 'SOUTHWEST' },
  JBU: { icao: 'JBU', iata: 'B6', name: 'JetBlue Airways', country: 'US', callsignPrefix: 'JETBLUE' },
  ASA: { icao: 'ASA', iata: 'AS', name: 'Alaska Airlines', country: 'US', callsignPrefix: 'ALASKA' },
  NKS: { icao: 'NKS', iata: 'NK', name: 'Spirit Airlines', country: 'US', callsignPrefix: 'SPIRIT WINGS' },
  FFT: { icao: 'FFT', iata: 'F9', name: 'Frontier Airlines', country: 'US', callsignPrefix: 'FRONTIER' },
  HAL: { icao: 'HAL', iata: 'HA', name: 'Hawaiian Airlines', country: 'US', callsignPrefix: 'HAWAIIAN' },
  AAY: { icao: 'AAY', iata: 'G4', name: 'Allegiant Air', country: 'US', callsignPrefix: 'ALLEGIANT' },
  SKW: { icao: 'SKW', iata: 'OO', name: 'SkyWest Airlines', country: 'US', callsignPrefix: 'SKYWEST' },
  ENY: { icao: 'ENY', iata: 'MQ', name: 'Envoy Air', country: 'US', callsignPrefix: 'ENVOY' },
  RPA: { icao: 'RPA', iata: 'YX', name: 'Republic Airways', country: 'US', callsignPrefix: 'BRICKYARD' },
  PDT: { icao: 'PDT', iata: 'PT', name: 'Piedmont Airlines', country: 'US', callsignPrefix: 'PIEDMONT' },
  JIA: { icao: 'JIA', iata: 'OH', name: 'PSA Airlines', country: 'US', callsignPrefix: 'BLUE STREAK' },
  EDV: { icao: 'EDV', iata: '9E', name: 'Endeavor Air', country: 'US', callsignPrefix: 'ENDEAVOR' },
  FDX: { icao: 'FDX', iata: 'FX', name: 'FedEx Express', country: 'US', callsignPrefix: 'FEDEX' },
  UPS: { icao: 'UPS', iata: '5X', name: 'UPS Airlines', country: 'US', callsignPrefix: 'UPS' },
  GTI: { icao: 'GTI', iata: 'GT', name: 'Atlas Air', country: 'US', callsignPrefix: 'GIANT' },
  
  // Europe - UK
  BAW: { icao: 'BAW', iata: 'BA', name: 'British Airways', country: 'GB', callsignPrefix: 'SPEEDBIRD' },
  VIR: { icao: 'VIR', iata: 'VS', name: 'Virgin Atlantic', country: 'GB', callsignPrefix: 'VIRGIN' },
  EZY: { icao: 'EZY', iata: 'U2', name: 'easyJet', country: 'GB', callsignPrefix: 'EASY' },
  TOM: { icao: 'TOM', iata: 'BY', name: 'TUI Airways', country: 'GB', callsignPrefix: 'TOMJET' },
  
  // Europe - Germany
  DLH: { icao: 'DLH', iata: 'LH', name: 'Lufthansa', country: 'DE', callsignPrefix: 'LUFTHANSA' },
  EWG: { icao: 'EWG', iata: 'EW', name: 'Eurowings', country: 'DE', callsignPrefix: 'EUROWINGS' },
  CFG: { icao: 'CFG', iata: 'DE', name: 'Condor', country: 'DE', callsignPrefix: 'CONDOR' },
  
  // Europe - France
  AFR: { icao: 'AFR', iata: 'AF', name: 'Air France', country: 'FR', callsignPrefix: 'AIRFRANS' },
  TVF: { icao: 'TVF', iata: 'TO', name: 'Transavia France', country: 'FR', callsignPrefix: 'TRANSAVIA' },
  
  // Europe - Netherlands
  KLM: { icao: 'KLM', iata: 'KL', name: 'KLM Royal Dutch Airlines', country: 'NL', callsignPrefix: 'KLM' },
  TRA: { icao: 'TRA', iata: 'HV', name: 'Transavia', country: 'NL', callsignPrefix: 'TRANSAVIA' },
  
  // Europe - Spain
  IBE: { icao: 'IBE', iata: 'IB', name: 'Iberia', country: 'ES', callsignPrefix: 'IBERIA' },
  VLG: { icao: 'VLG', iata: 'VY', name: 'Vueling', country: 'ES', callsignPrefix: 'VUELING' },
  
  // Europe - Italy
  AZA: { icao: 'AZA', iata: 'AZ', name: 'ITA Airways', country: 'IT', callsignPrefix: 'ITARROW' },
  
  // Europe - Ireland
  RYR: { icao: 'RYR', iata: 'FR', name: 'Ryanair', country: 'IE', callsignPrefix: 'RYANAIR' },
  EIN: { icao: 'EIN', iata: 'EI', name: 'Aer Lingus', country: 'IE', callsignPrefix: 'SHAMROCK' },
  
  // Europe - Scandinavia
  SAS: { icao: 'SAS', iata: 'SK', name: 'Scandinavian Airlines', country: 'SE', callsignPrefix: 'SCANDINAVIAN' },
  NAX: { icao: 'NAX', iata: 'DY', name: 'Norwegian Air Shuttle', country: 'NO', callsignPrefix: 'NORWEGIAN' },
  FIN: { icao: 'FIN', iata: 'AY', name: 'Finnair', country: 'FI', callsignPrefix: 'FINNAIR' },
  ICE: { icao: 'ICE', iata: 'FI', name: 'Icelandair', country: 'IS', callsignPrefix: 'ICEAIR' },
  
  // Europe - Switzerland/Austria
  SWR: { icao: 'SWR', iata: 'LX', name: 'Swiss International Air Lines', country: 'CH', callsignPrefix: 'SWISS' },
  AUA: { icao: 'AUA', iata: 'OS', name: 'Austrian Airlines', country: 'AT', callsignPrefix: 'AUSTRIAN' },
  
  // Europe - Portugal
  TAP: { icao: 'TAP', iata: 'TP', name: 'TAP Air Portugal', country: 'PT', callsignPrefix: 'AIR PORTUGAL' },
  
  // Europe - Turkey
  THY: { icao: 'THY', iata: 'TK', name: 'Turkish Airlines', country: 'TR', callsignPrefix: 'TURKAIR' },
  PGT: { icao: 'PGT', iata: 'PC', name: 'Pegasus Airlines', country: 'TR', callsignPrefix: 'SUNTURK' },
  
  // Europe - Eastern
  LOT: { icao: 'LOT', iata: 'LO', name: 'LOT Polish Airlines', country: 'PL', callsignPrefix: 'LOT' },
  CSA: { icao: 'CSA', iata: 'OK', name: 'Czech Airlines', country: 'CZ', callsignPrefix: 'CSA' },
  AFL: { icao: 'AFL', iata: 'SU', name: 'Aeroflot', country: 'RU', callsignPrefix: 'AEROFLOT' },
  
  // Middle East
  UAE: { icao: 'UAE', iata: 'EK', name: 'Emirates', country: 'AE', callsignPrefix: 'EMIRATES' },
  ETD: { icao: 'ETD', iata: 'EY', name: 'Etihad Airways', country: 'AE', callsignPrefix: 'ETIHAD' },
  QTR: { icao: 'QTR', iata: 'QR', name: 'Qatar Airways', country: 'QA', callsignPrefix: 'QATARI' },
  SVA: { icao: 'SVA', iata: 'SV', name: 'Saudia', country: 'SA', callsignPrefix: 'SAUDIA' },
  GFA: { icao: 'GFA', iata: 'GF', name: 'Gulf Air', country: 'BH', callsignPrefix: 'GULF AIR' },
  OMA: { icao: 'OMA', iata: 'WY', name: 'Oman Air', country: 'OM', callsignPrefix: 'OMAN AIR' },
  KAC: { icao: 'KAC', iata: 'KU', name: 'Kuwait Airways', country: 'KW', callsignPrefix: 'KUWAITI' },
  ELY: { icao: 'ELY', iata: 'LY', name: 'El Al Israel Airlines', country: 'IL', callsignPrefix: 'ELAL' },
  
  // Asia - East Asia
  CPA: { icao: 'CPA', iata: 'CX', name: 'Cathay Pacific', country: 'HK', callsignPrefix: 'CATHAY' },
  HDA: { icao: 'HDA', iata: 'HX', name: 'Hong Kong Airlines', country: 'HK', callsignPrefix: 'BAUHINIA' },
  SIA: { icao: 'SIA', iata: 'SQ', name: 'Singapore Airlines', country: 'SG', callsignPrefix: 'SINGAPORE' },
  ANA: { icao: 'ANA', iata: 'NH', name: 'All Nippon Airways', country: 'JP', callsignPrefix: 'ALL NIPPON' },
  JAL: { icao: 'JAL', iata: 'JL', name: 'Japan Airlines', country: 'JP', callsignPrefix: 'JAPANAIR' },
  KAL: { icao: 'KAL', iata: 'KE', name: 'Korean Air', country: 'KR', callsignPrefix: 'KOREANAIR' },
  AAR: { icao: 'AAR', iata: 'OZ', name: 'Asiana Airlines', country: 'KR', callsignPrefix: 'ASIANA' },
  CCA: { icao: 'CCA', iata: 'CA', name: 'Air China', country: 'CN', callsignPrefix: 'AIR CHINA' },
  CES: { icao: 'CES', iata: 'MU', name: 'China Eastern Airlines', country: 'CN', callsignPrefix: 'CHINA EASTERN' },
  CSN: { icao: 'CSN', iata: 'CZ', name: 'China Southern Airlines', country: 'CN', callsignPrefix: 'CHINA SOUTHERN' },
  CHH: { icao: 'CHH', iata: 'HU', name: 'Hainan Airlines', country: 'CN', callsignPrefix: 'HAINAN' },
  CAL: { icao: 'CAL', iata: 'CI', name: 'China Airlines', country: 'TW', callsignPrefix: 'DYNASTY' },
  EVA: { icao: 'EVA', iata: 'BR', name: 'EVA Air', country: 'TW', callsignPrefix: 'EVA' },
  
  // Asia - Southeast Asia
  THA: { icao: 'THA', iata: 'TG', name: 'Thai Airways', country: 'TH', callsignPrefix: 'THAI' },
  MAS: { icao: 'MAS', iata: 'MH', name: 'Malaysia Airlines', country: 'MY', callsignPrefix: 'MALAYSIAN' },
  AXM: { icao: 'AXM', iata: 'AK', name: 'AirAsia', country: 'MY', callsignPrefix: 'AIRASIA' },
  GIA: { icao: 'GIA', iata: 'GA', name: 'Garuda Indonesia', country: 'ID', callsignPrefix: 'INDONESIA' },
  PAL: { icao: 'PAL', iata: 'PR', name: 'Philippine Airlines', country: 'PH', callsignPrefix: 'PHILIPPINE' },
  VJC: { icao: 'VJC', iata: 'VJ', name: 'VietJet Air', country: 'VN', callsignPrefix: 'VIETJET' },
  HVN: { icao: 'HVN', iata: 'VN', name: 'Vietnam Airlines', country: 'VN', callsignPrefix: 'VIETNAM AIRLINES' },
  
  // Asia - South Asia
  AIC: { icao: 'AIC', iata: 'AI', name: 'Air India', country: 'IN', callsignPrefix: 'AIRINDIA' },
  IGO: { icao: 'IGO', iata: '6E', name: 'IndiGo', country: 'IN', callsignPrefix: 'IFLY' },
  
  // Oceania
  QFA: { icao: 'QFA', iata: 'QF', name: 'Qantas', country: 'AU', callsignPrefix: 'QANTAS' },
  VOZ: { icao: 'VOZ', iata: 'VA', name: 'Virgin Australia', country: 'AU', callsignPrefix: 'VELOCITY' },
  JST: { icao: 'JST', iata: 'JQ', name: 'Jetstar Airways', country: 'AU', callsignPrefix: 'JETSTAR' },
  ANZ: { icao: 'ANZ', iata: 'NZ', name: 'Air New Zealand', country: 'NZ', callsignPrefix: 'NEW ZEALAND' },
  
  // Africa
  SAA: { icao: 'SAA', iata: 'SA', name: 'South African Airways', country: 'ZA', callsignPrefix: 'SPRINGBOK' },
  MSR: { icao: 'MSR', iata: 'MS', name: 'EgyptAir', country: 'EG', callsignPrefix: 'EGYPTAIR' },
  RAM: { icao: 'RAM', iata: 'AT', name: 'Royal Air Maroc', country: 'MA', callsignPrefix: 'ROYALAIR MAROC' },
  ETH: { icao: 'ETH', iata: 'ET', name: 'Ethiopian Airlines', country: 'ET', callsignPrefix: 'ETHIOPIAN' },
  KQA: { icao: 'KQA', iata: 'KQ', name: 'Kenya Airways', country: 'KE', callsignPrefix: 'KENYA' },
  
  // Americas - Canada
  ACA: { icao: 'ACA', iata: 'AC', name: 'Air Canada', country: 'CA', callsignPrefix: 'AIR CANADA' },
  WJA: { icao: 'WJA', iata: 'WS', name: 'WestJet', country: 'CA', callsignPrefix: 'WESTJET' },
  
  // Americas - Latin America
  AMX: { icao: 'AMX', iata: 'AM', name: 'Aeromexico', country: 'MX', callsignPrefix: 'AEROMEXICO' },
  VOI: { icao: 'VOI', iata: 'Y4', name: 'Volaris', country: 'MX', callsignPrefix: 'VOLARIS' },
  TAM: { icao: 'TAM', iata: 'JJ', name: 'LATAM Brasil', country: 'BR', callsignPrefix: 'TAM' },
  LAN: { icao: 'LAN', iata: 'LA', name: 'LATAM Airlines', country: 'CL', callsignPrefix: 'LAN' },
  AVA: { icao: 'AVA', iata: 'AV', name: 'Avianca', country: 'CO', callsignPrefix: 'AVIANCA' },
  ARG: { icao: 'ARG', iata: 'AR', name: 'Aerolíneas Argentinas', country: 'AR', callsignPrefix: 'ARGENTINA' },
  CMP: { icao: 'CMP', iata: 'CM', name: 'Copa Airlines', country: 'PA', callsignPrefix: 'COPA' },
  
  // Low Cost Carriers - Europe
  WZZ: { icao: 'WZZ', iata: 'W6', name: 'Wizz Air', country: 'HU', callsignPrefix: 'WIZZAIR' },
  
  // Cargo Airlines
  CLX: { icao: 'CLX', iata: 'CV', name: 'Cargolux', country: 'LU', callsignPrefix: 'CARGOLUX' },
  ABW: { icao: 'ABW', iata: 'AB', name: 'AirBridgeCargo', country: 'RU', callsignPrefix: 'AIRBRIDGE CARGO' },
};

// Create lookup maps for fast access by different codes
const icaoToAirline = new Map();
const iataToIcao = new Map();
const callsignPrefixToIcao = new Map();

Object.entries(AIRLINES).forEach(([icao, airline]) => {
  icaoToAirline.set(icao, airline);
  if (airline.iata) {
    iataToIcao.set(airline.iata, icao);
  }
  if (airline.callsignPrefix) {
    // Store both the full prefix and abbreviated versions
    callsignPrefixToIcao.set(airline.callsignPrefix, icao);
  }
});

/**
 * Get airline by ICAO code
 * @param {string} icao - ICAO code (e.g., "UAL")
 * @returns {Object|null} - Airline data or null
 */
export function getAirlineByICAO(icao) {
  if (!icao) return null;
  return icaoToAirline.get(icao.toUpperCase()) || null;
}

/**
 * Get airline by IATA code
 * @param {string} iata - IATA code (e.g., "UA")
 * @returns {Object|null} - Airline data or null
 */
export function getAirlineByIATA(iata) {
  if (!iata) return null;
  const icao = iataToIcao.get(iata.toUpperCase());
  return icao ? icaoToAirline.get(icao) : null;
}

/**
 * Get airline by either ICAO or IATA code
 * @param {string} code - ICAO or IATA code
 * @returns {Object|null} - Airline data or null
 */
export function getAirlineByCode(code) {
  if (!code) return null;
  const upper = code.toUpperCase();
  // Try ICAO first (3 chars typically)
  if (upper.length === 3) {
    const byIcao = getAirlineByICAO(upper);
    if (byIcao) return byIcao;
  }
  // Try IATA (2 chars typically)
  if (upper.length === 2) {
    const byIata = getAirlineByIATA(upper);
    if (byIata) return byIata;
  }
  // Try both anyway
  return getAirlineByICAO(upper) || getAirlineByIATA(upper);
}

/**
 * Extract airline from callsign
 * @param {string} callsign - Flight callsign (e.g., "UAL123", "UNITED123")
 * @returns {Object|null} - Airline data or null
 */
export function getAirlineFromCallsign(callsign) {
  if (!callsign || typeof callsign !== 'string') return null;
  
  const trimmed = callsign.trim().toUpperCase();
  if (trimmed.length < 3) return null;
  
  // Try 3-letter ICAO prefix first (most common)
  const icaoPrefix = trimmed.substring(0, 3);
  const byIcao = getAirlineByICAO(icaoPrefix);
  if (byIcao) return byIcao;
  
  // Try 2-letter IATA prefix
  const iataPrefix = trimmed.substring(0, 2);
  const byIata = getAirlineByIATA(iataPrefix);
  if (byIata) return byIata;
  
  // Try matching callsign prefixes (less common)
  for (const [prefix, icao] of callsignPrefixToIcao) {
    if (trimmed.startsWith(prefix.replace(/\s/g, ''))) {
      return icaoToAirline.get(icao);
    }
  }
  
  return null;
}

/**
 * Parse flight number from callsign
 * @param {string} callsign - Flight callsign (e.g., "UAL123")
 * @returns {Object|null} - { airline, flightNumber, displayFlightNumber } or null
 */
export function parseFlightNumber(callsign) {
  if (!callsign || typeof callsign !== 'string') return null;
  
  const trimmed = callsign.trim().toUpperCase();
  
  // Match pattern: 2-3 letter prefix + flight number
  const match = trimmed.match(/^([A-Z]{2,3})(\d{1,4}[A-Z]?)$/);
  if (!match) return null;
  
  const prefix = match[1];
  const flightNum = match[2];
  const airline = getAirlineByCode(prefix);
  
  if (!airline) return null;
  
  return {
    airline,
    flightNumber: flightNum,
    displayFlightNumber: `${airline.iata || airline.icao}${flightNum}`,
    icaoFlightNumber: `${airline.icao}${flightNum}`,
  };
}

/**
 * Get airline logo URL (using airline logos CDN)
 * @param {string} iataCode - Airline IATA code
 * @returns {string|null} - Logo URL or null
 */
export function getAirlineLogo(iataCode) {
  if (!iataCode) return null;
  // Using a common airline logo CDN format
  return `https://content.airhex.com/content/logos/airlines_${iataCode.toLowerCase()}_100_100_s.png`;
}

/**
 * Get country flag emoji from country code
 * @param {string} countryCode - ISO 3166-1 alpha-2 country code
 * @returns {string} - Flag emoji
 */
export function getCountryFlag(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '🏳️';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}


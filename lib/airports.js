/**
 * Airport Database
 * Contains major airports with ICAO/IATA codes, names, cities, countries, and coordinates
 */

// Major airports database - focus on high-traffic airports globally
export const AIRPORTS = {
  // United States - Major Hubs
  KJFK: { icao: 'KJFK', iata: 'JFK', name: 'John F. Kennedy International', city: 'New York', country: 'US', lat: 40.6413, lon: -73.7781 },
  KLAX: { icao: 'KLAX', iata: 'LAX', name: 'Los Angeles International', city: 'Los Angeles', country: 'US', lat: 33.9425, lon: -118.4081 },
  KORD: { icao: 'KORD', iata: 'ORD', name: "O'Hare International", city: 'Chicago', country: 'US', lat: 41.9742, lon: -87.9073 },
  KATL: { icao: 'KATL', iata: 'ATL', name: 'Hartsfield-Jackson Atlanta International', city: 'Atlanta', country: 'US', lat: 33.6407, lon: -84.4277 },
  KDFW: { icao: 'KDFW', iata: 'DFW', name: 'Dallas/Fort Worth International', city: 'Dallas', country: 'US', lat: 32.8998, lon: -97.0403 },
  KDEN: { icao: 'KDEN', iata: 'DEN', name: 'Denver International', city: 'Denver', country: 'US', lat: 39.8561, lon: -104.6737 },
  KSFO: { icao: 'KSFO', iata: 'SFO', name: 'San Francisco International', city: 'San Francisco', country: 'US', lat: 37.6213, lon: -122.3790 },
  KSEA: { icao: 'KSEA', iata: 'SEA', name: 'Seattle-Tacoma International', city: 'Seattle', country: 'US', lat: 47.4502, lon: -122.3088 },
  KMIA: { icao: 'KMIA', iata: 'MIA', name: 'Miami International', city: 'Miami', country: 'US', lat: 25.7959, lon: -80.2870 },
  KEWR: { icao: 'KEWR', iata: 'EWR', name: 'Newark Liberty International', city: 'Newark', country: 'US', lat: 40.6895, lon: -74.1745 },
  KBOS: { icao: 'KBOS', iata: 'BOS', name: 'Boston Logan International', city: 'Boston', country: 'US', lat: 42.3656, lon: -71.0096 },
  KPHL: { icao: 'KPHL', iata: 'PHL', name: 'Philadelphia International', city: 'Philadelphia', country: 'US', lat: 39.8721, lon: -75.2411 },
  KLGA: { icao: 'KLGA', iata: 'LGA', name: 'LaGuardia', city: 'New York', country: 'US', lat: 40.7769, lon: -73.8740 },
  KIAD: { icao: 'KIAD', iata: 'IAD', name: 'Washington Dulles International', city: 'Washington', country: 'US', lat: 38.9531, lon: -77.4565 },
  KDCA: { icao: 'KDCA', iata: 'DCA', name: 'Ronald Reagan Washington National', city: 'Washington', country: 'US', lat: 38.8512, lon: -77.0402 },
  KPHX: { icao: 'KPHX', iata: 'PHX', name: 'Phoenix Sky Harbor International', city: 'Phoenix', country: 'US', lat: 33.4373, lon: -112.0078 },
  KLAS: { icao: 'KLAS', iata: 'LAS', name: 'Harry Reid International', city: 'Las Vegas', country: 'US', lat: 36.0840, lon: -115.1537 },
  KMSP: { icao: 'KMSP', iata: 'MSP', name: 'Minneapolis-Saint Paul International', city: 'Minneapolis', country: 'US', lat: 44.8848, lon: -93.2223 },
  KDTW: { icao: 'KDTW', iata: 'DTW', name: 'Detroit Metropolitan', city: 'Detroit', country: 'US', lat: 42.2162, lon: -83.3554 },
  KFLL: { icao: 'KFLL', iata: 'FLL', name: 'Fort Lauderdale-Hollywood International', city: 'Fort Lauderdale', country: 'US', lat: 26.0742, lon: -80.1506 },
  KMCO: { icao: 'KMCO', iata: 'MCO', name: 'Orlando International', city: 'Orlando', country: 'US', lat: 28.4312, lon: -81.3081 },
  KIAH: { icao: 'KIAH', iata: 'IAH', name: 'George Bush Intercontinental', city: 'Houston', country: 'US', lat: 29.9902, lon: -95.3368 },
  KCLT: { icao: 'KCLT', iata: 'CLT', name: 'Charlotte Douglas International', city: 'Charlotte', country: 'US', lat: 35.2140, lon: -80.9431 },
  KSAN: { icao: 'KSAN', iata: 'SAN', name: 'San Diego International', city: 'San Diego', country: 'US', lat: 32.7338, lon: -117.1933 },
  KTPA: { icao: 'KTPA', iata: 'TPA', name: 'Tampa International', city: 'Tampa', country: 'US', lat: 27.9755, lon: -82.5332 },
  KPDX: { icao: 'KPDX', iata: 'PDX', name: 'Portland International', city: 'Portland', country: 'US', lat: 45.5898, lon: -122.5951 },
  KSLC: { icao: 'KSLC', iata: 'SLC', name: 'Salt Lake City International', city: 'Salt Lake City', country: 'US', lat: 40.7899, lon: -111.9791 },
  KSTL: { icao: 'KSTL', iata: 'STL', name: 'St. Louis Lambert International', city: 'St. Louis', country: 'US', lat: 38.7487, lon: -90.3700 },
  KBWI: { icao: 'KBWI', iata: 'BWI', name: 'Baltimore/Washington International', city: 'Baltimore', country: 'US', lat: 39.1774, lon: -76.6684 },
  KAUS: { icao: 'KAUS', iata: 'AUS', name: 'Austin-Bergstrom International', city: 'Austin', country: 'US', lat: 30.1975, lon: -97.6664 },
  KRDU: { icao: 'KRDU', iata: 'RDU', name: 'Raleigh-Durham International', city: 'Raleigh', country: 'US', lat: 35.8801, lon: -78.7880 },
  KHNL: { icao: 'KHNL', iata: 'HNL', name: 'Daniel K. Inouye International', city: 'Honolulu', country: 'US', lat: 21.3187, lon: -157.9225 },
  PANC: { icao: 'PANC', iata: 'ANC', name: 'Ted Stevens Anchorage International', city: 'Anchorage', country: 'US', lat: 61.1743, lon: -149.9962 },
  KCMH: { icao: 'KCMH', iata: 'CMH', name: 'John Glenn Columbus International', city: 'Columbus', country: 'US', lat: 39.9981, lon: -82.8958 },
  KRKL: { icao: 'KRKL', iata: 'RKL', name: 'Rickenbacker International Airport', city: 'Columbus', country: 'US', lat: 39.8139, lon: -82.9278 },
  
  // Europe - Major Hubs
  EGLL: { icao: 'EGLL', iata: 'LHR', name: 'London Heathrow', city: 'London', country: 'GB', lat: 51.4700, lon: -0.4543 },
  EGKK: { icao: 'EGKK', iata: 'LGW', name: 'London Gatwick', city: 'London', country: 'GB', lat: 51.1537, lon: -0.1821 },
  EGSS: { icao: 'EGSS', iata: 'STN', name: 'London Stansted', city: 'London', country: 'GB', lat: 51.8860, lon: 0.2389 },
  EGLC: { icao: 'EGLC', iata: 'LCY', name: 'London City', city: 'London', country: 'GB', lat: 51.5048, lon: 0.0495 },
  LFPG: { icao: 'LFPG', iata: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris', country: 'FR', lat: 49.0097, lon: 2.5479 },
  LFPO: { icao: 'LFPO', iata: 'ORY', name: 'Paris Orly', city: 'Paris', country: 'FR', lat: 48.7262, lon: 2.3652 },
  EDDF: { icao: 'EDDF', iata: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt', country: 'DE', lat: 50.0379, lon: 8.5622 },
  EDDM: { icao: 'EDDM', iata: 'MUC', name: 'Munich Airport', city: 'Munich', country: 'DE', lat: 48.3537, lon: 11.7750 },
  EHAM: { icao: 'EHAM', iata: 'AMS', name: 'Amsterdam Schiphol', city: 'Amsterdam', country: 'NL', lat: 52.3105, lon: 4.7683 },
  LEMD: { icao: 'LEMD', iata: 'MAD', name: 'Madrid-Barajas', city: 'Madrid', country: 'ES', lat: 40.4983, lon: -3.5676 },
  LEBL: { icao: 'LEBL', iata: 'BCN', name: 'Barcelona-El Prat', city: 'Barcelona', country: 'ES', lat: 41.2971, lon: 2.0785 },
  LIRF: { icao: 'LIRF', iata: 'FCO', name: 'Rome Fiumicino', city: 'Rome', country: 'IT', lat: 41.8003, lon: 12.2389 },
  LIMC: { icao: 'LIMC', iata: 'MXP', name: 'Milan Malpensa', city: 'Milan', country: 'IT', lat: 45.6306, lon: 8.7281 },
  LSZH: { icao: 'LSZH', iata: 'ZRH', name: 'Zurich Airport', city: 'Zurich', country: 'CH', lat: 47.4647, lon: 8.5492 },
  LOWW: { icao: 'LOWW', iata: 'VIE', name: 'Vienna International', city: 'Vienna', country: 'AT', lat: 48.1103, lon: 16.5697 },
  EBBR: { icao: 'EBBR', iata: 'BRU', name: 'Brussels Airport', city: 'Brussels', country: 'BE', lat: 50.9014, lon: 4.4844 },
  EIDW: { icao: 'EIDW', iata: 'DUB', name: 'Dublin Airport', city: 'Dublin', country: 'IE', lat: 53.4264, lon: -6.2499 },
  EKCH: { icao: 'EKCH', iata: 'CPH', name: 'Copenhagen Airport', city: 'Copenhagen', country: 'DK', lat: 55.6180, lon: 12.6508 },
  ENGM: { icao: 'ENGM', iata: 'OSL', name: 'Oslo Gardermoen', city: 'Oslo', country: 'NO', lat: 60.1939, lon: 11.1004 },
  ESSA: { icao: 'ESSA', iata: 'ARN', name: 'Stockholm Arlanda', city: 'Stockholm', country: 'SE', lat: 59.6519, lon: 17.9186 },
  EFHK: { icao: 'EFHK', iata: 'HEL', name: 'Helsinki-Vantaa', city: 'Helsinki', country: 'FI', lat: 60.3172, lon: 24.9633 },
  LPPT: { icao: 'LPPT', iata: 'LIS', name: 'Lisbon Portela', city: 'Lisbon', country: 'PT', lat: 38.7756, lon: -9.1354 },
  LGAV: { icao: 'LGAV', iata: 'ATH', name: 'Athens International', city: 'Athens', country: 'GR', lat: 37.9364, lon: 23.9445 },
  LTFM: { icao: 'LTFM', iata: 'IST', name: 'Istanbul Airport', city: 'Istanbul', country: 'TR', lat: 41.2753, lon: 28.7519 },
  UUEE: { icao: 'UUEE', iata: 'SVO', name: 'Sheremetyevo International', city: 'Moscow', country: 'RU', lat: 55.9726, lon: 37.4146 },
  UUDD: { icao: 'UUDD', iata: 'DME', name: 'Domodedovo International', city: 'Moscow', country: 'RU', lat: 55.4088, lon: 37.9063 },
  EPWA: { icao: 'EPWA', iata: 'WAW', name: 'Warsaw Chopin', city: 'Warsaw', country: 'PL', lat: 52.1657, lon: 20.9671 },
  LKPR: { icao: 'LKPR', iata: 'PRG', name: 'Václav Havel Airport Prague', city: 'Prague', country: 'CZ', lat: 50.1008, lon: 14.2600 },
  LHBP: { icao: 'LHBP', iata: 'BUD', name: 'Budapest Ferenc Liszt', city: 'Budapest', country: 'HU', lat: 47.4369, lon: 19.2556 },
  
  // Asia-Pacific - Major Hubs
  VHHH: { icao: 'VHHH', iata: 'HKG', name: 'Hong Kong International', city: 'Hong Kong', country: 'HK', lat: 22.3080, lon: 113.9185 },
  WSSS: { icao: 'WSSS', iata: 'SIN', name: 'Singapore Changi', city: 'Singapore', country: 'SG', lat: 1.3644, lon: 103.9915 },
  RJTT: { icao: 'RJTT', iata: 'HND', name: 'Tokyo Haneda', city: 'Tokyo', country: 'JP', lat: 35.5494, lon: 139.7798 },
  RJAA: { icao: 'RJAA', iata: 'NRT', name: 'Tokyo Narita', city: 'Tokyo', country: 'JP', lat: 35.7647, lon: 140.3864 },
  RKSI: { icao: 'RKSI', iata: 'ICN', name: 'Seoul Incheon International', city: 'Seoul', country: 'KR', lat: 37.4691, lon: 126.4505 },
  ZBAA: { icao: 'ZBAA', iata: 'PEK', name: 'Beijing Capital International', city: 'Beijing', country: 'CN', lat: 40.0801, lon: 116.5846 },
  ZSPD: { icao: 'ZSPD', iata: 'PVG', name: 'Shanghai Pudong International', city: 'Shanghai', country: 'CN', lat: 31.1443, lon: 121.8083 },
  ZGGG: { icao: 'ZGGG', iata: 'CAN', name: 'Guangzhou Baiyun International', city: 'Guangzhou', country: 'CN', lat: 23.3924, lon: 113.2988 },
  RCTP: { icao: 'RCTP', iata: 'TPE', name: 'Taiwan Taoyuan International', city: 'Taipei', country: 'TW', lat: 25.0797, lon: 121.2342 },
  VTBS: { icao: 'VTBS', iata: 'BKK', name: 'Suvarnabhumi Airport', city: 'Bangkok', country: 'TH', lat: 13.6900, lon: 100.7501 },
  WMKK: { icao: 'WMKK', iata: 'KUL', name: 'Kuala Lumpur International', city: 'Kuala Lumpur', country: 'MY', lat: 2.7456, lon: 101.7099 },
  WIII: { icao: 'WIII', iata: 'CGK', name: 'Soekarno-Hatta International', city: 'Jakarta', country: 'ID', lat: -6.1256, lon: 106.6559 },
  RPLL: { icao: 'RPLL', iata: 'MNL', name: 'Ninoy Aquino International', city: 'Manila', country: 'PH', lat: 14.5086, lon: 121.0194 },
  VVNB: { icao: 'VVNB', iata: 'HAN', name: 'Noi Bai International', city: 'Hanoi', country: 'VN', lat: 21.2212, lon: 105.8070 },
  VVTS: { icao: 'VVTS', iata: 'SGN', name: 'Tan Son Nhat International', city: 'Ho Chi Minh City', country: 'VN', lat: 10.8188, lon: 106.6520 },
  VIDP: { icao: 'VIDP', iata: 'DEL', name: 'Indira Gandhi International', city: 'New Delhi', country: 'IN', lat: 28.5562, lon: 77.1000 },
  VABB: { icao: 'VABB', iata: 'BOM', name: 'Chhatrapati Shivaji Maharaj International', city: 'Mumbai', country: 'IN', lat: 19.0896, lon: 72.8656 },
  VOBL: { icao: 'VOBL', iata: 'BLR', name: 'Kempegowda International', city: 'Bangalore', country: 'IN', lat: 13.1986, lon: 77.7066 },
  YSSY: { icao: 'YSSY', iata: 'SYD', name: 'Sydney Kingsford Smith', city: 'Sydney', country: 'AU', lat: -33.9399, lon: 151.1753 },
  YMML: { icao: 'YMML', iata: 'MEL', name: 'Melbourne Airport', city: 'Melbourne', country: 'AU', lat: -37.6690, lon: 144.8410 },
  YBBN: { icao: 'YBBN', iata: 'BNE', name: 'Brisbane Airport', city: 'Brisbane', country: 'AU', lat: -27.3842, lon: 153.1175 },
  NZAA: { icao: 'NZAA', iata: 'AKL', name: 'Auckland Airport', city: 'Auckland', country: 'NZ', lat: -37.0082, lon: 174.7850 },
  
  // Middle East - Major Hubs
  OMDB: { icao: 'OMDB', iata: 'DXB', name: 'Dubai International', city: 'Dubai', country: 'AE', lat: 25.2532, lon: 55.3657 },
  OERK: { icao: 'OERK', iata: 'RUH', name: 'King Khalid International', city: 'Riyadh', country: 'SA', lat: 24.9576, lon: 46.6988 },
  OEJN: { icao: 'OEJN', iata: 'JED', name: 'King Abdulaziz International', city: 'Jeddah', country: 'SA', lat: 21.6796, lon: 39.1565 },
  OTHH: { icao: 'OTHH', iata: 'DOH', name: 'Hamad International', city: 'Doha', country: 'QA', lat: 25.2609, lon: 51.6138 },
  OBBI: { icao: 'OBBI', iata: 'BAH', name: 'Bahrain International', city: 'Manama', country: 'BH', lat: 26.2708, lon: 50.6336 },
  OOMS: { icao: 'OOMS', iata: 'MCT', name: 'Muscat International', city: 'Muscat', country: 'OM', lat: 23.5933, lon: 58.2844 },
  OKBK: { icao: 'OKBK', iata: 'KWI', name: 'Kuwait International', city: 'Kuwait City', country: 'KW', lat: 29.2266, lon: 47.9689 },
  OIIE: { icao: 'OIIE', iata: 'IKA', name: 'Imam Khomeini International', city: 'Tehran', country: 'IR', lat: 35.4161, lon: 51.1522 },
  LLBG: { icao: 'LLBG', iata: 'TLV', name: 'Ben Gurion International', city: 'Tel Aviv', country: 'IL', lat: 32.0114, lon: 34.8867 },
  
  // Africa - Major Hubs
  FAOR: { icao: 'FAOR', iata: 'JNB', name: 'O.R. Tambo International', city: 'Johannesburg', country: 'ZA', lat: -26.1392, lon: 28.2460 },
  FACT: { icao: 'FACT', iata: 'CPT', name: 'Cape Town International', city: 'Cape Town', country: 'ZA', lat: -33.9648, lon: 18.6017 },
  HECA: { icao: 'HECA', iata: 'CAI', name: 'Cairo International', city: 'Cairo', country: 'EG', lat: 30.1219, lon: 31.4056 },
  GMMN: { icao: 'GMMN', iata: 'CMN', name: 'Mohammed V International', city: 'Casablanca', country: 'MA', lat: 33.3675, lon: -7.5900 },
  HKJK: { icao: 'HKJK', iata: 'NBO', name: 'Jomo Kenyatta International', city: 'Nairobi', country: 'KE', lat: -1.3192, lon: 36.9278 },
  DNMM: { icao: 'DNMM', iata: 'LOS', name: 'Murtala Muhammed International', city: 'Lagos', country: 'NG', lat: 6.5774, lon: 3.3212 },
  HAAB: { icao: 'HAAB', iata: 'ADD', name: 'Addis Ababa Bole International', city: 'Addis Ababa', country: 'ET', lat: 8.9779, lon: 38.7993 },
  
  // Americas - Other Major Airports
  CYYZ: { icao: 'CYYZ', iata: 'YYZ', name: 'Toronto Pearson International', city: 'Toronto', country: 'CA', lat: 43.6777, lon: -79.6248 },
  CYVR: { icao: 'CYVR', iata: 'YVR', name: 'Vancouver International', city: 'Vancouver', country: 'CA', lat: 49.1967, lon: -123.1815 },
  CYUL: { icao: 'CYUL', iata: 'YUL', name: 'Montréal-Trudeau International', city: 'Montreal', country: 'CA', lat: 45.4706, lon: -73.7408 },
  MMMX: { icao: 'MMMX', iata: 'MEX', name: 'Mexico City International', city: 'Mexico City', country: 'MX', lat: 19.4363, lon: -99.0721 },
  MMUN: { icao: 'MMUN', iata: 'CUN', name: 'Cancún International', city: 'Cancún', country: 'MX', lat: 21.0365, lon: -86.8771 },
  SBGR: { icao: 'SBGR', iata: 'GRU', name: 'São Paulo–Guarulhos International', city: 'São Paulo', country: 'BR', lat: -23.4356, lon: -46.4731 },
  SCEL: { icao: 'SCEL', iata: 'SCL', name: 'Arturo Merino Benítez International', city: 'Santiago', country: 'CL', lat: -33.3930, lon: -70.7858 },
  SAEZ: { icao: 'SAEZ', iata: 'EZE', name: 'Ministro Pistarini International', city: 'Buenos Aires', country: 'AR', lat: -34.8222, lon: -58.5358 },
  SKBO: { icao: 'SKBO', iata: 'BOG', name: 'El Dorado International', city: 'Bogotá', country: 'CO', lat: 4.7016, lon: -74.1469 },
  SPJC: { icao: 'SPJC', iata: 'LIM', name: 'Jorge Chávez International', city: 'Lima', country: 'PE', lat: -12.0219, lon: -77.1143 },
  TNCM: { icao: 'TNCM', iata: 'SXM', name: 'Princess Juliana International', city: 'Sint Maarten', country: 'SX', lat: 18.0410, lon: -63.1089 },
  TJSJ: { icao: 'TJSJ', iata: 'SJU', name: 'Luis Muñoz Marín International', city: 'San Juan', country: 'PR', lat: 18.4394, lon: -66.0018 },
};

// Create lookup maps for fast access
const iataToIcao = new Map();
const icaoToAirport = new Map();

Object.entries(AIRPORTS).forEach(([icao, airport]) => {
  icaoToAirport.set(icao, airport);
  if (airport.iata) {
    iataToIcao.set(airport.iata, icao);
  }
});

/**
 * Get airport by ICAO code
 * @param {string} icao - ICAO code (e.g., "KJFK")
 * @returns {Object|null} - Airport data or null
 */
export function getAirportByICAO(icao) {
  if (!icao) return null;
  return icaoToAirport.get(icao.toUpperCase()) || null;
}

/**
 * Get airport by IATA code
 * @param {string} iata - IATA code (e.g., "JFK")
 * @returns {Object|null} - Airport data or null
 */
export function getAirportByIATA(iata) {
  if (!iata) return null;
  const icao = iataToIcao.get(iata.toUpperCase());
  return icao ? icaoToAirport.get(icao) : null;
}

/**
 * Get airport by either ICAO or IATA code
 * @param {string} code - ICAO or IATA code
 * @returns {Object|null} - Airport data or null
 */
export function getAirport(code) {
  if (!code) return null;
  const upper = code.toUpperCase();
  // Try ICAO first (4 chars typically)
  if (upper.length === 4) {
    const byIcao = getAirportByICAO(upper);
    if (byIcao) return byIcao;
  }
  // Try IATA (3 chars typically)
  if (upper.length === 3) {
    const byIata = getAirportByIATA(upper);
    if (byIata) return byIata;
  }
  // Try both anyway
  return getAirportByICAO(upper) || getAirportByIATA(upper);
}

/**
 * Find nearest airport to a given position
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} maxDistanceNm - Maximum distance in nautical miles (default 50)
 * @returns {Object|null} - Nearest airport with distance or null
 */
export function findNearestAirport(lat, lon, maxDistanceNm = 50) {
  let nearest = null;
  let minDistance = Infinity;
  
  for (const [, airport] of icaoToAirport) {
    const distance = calculateDistanceNm(lat, lon, airport.lat, airport.lon);
    if (distance < minDistance && distance <= maxDistanceNm) {
      minDistance = distance;
      nearest = { ...airport, distance: Math.round(distance * 10) / 10 };
    }
  }
  
  return nearest;
}

/**
 * Calculate distance between two points in nautical miles
 */
function calculateDistanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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


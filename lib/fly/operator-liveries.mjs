// Representative operator paint for live traffic. This is a presentation
// catalogue, not an airframe/registration database: a callsign identifies an
// operator but cannot identify a special, leased or heritage paint scheme.
// Colours are hand-tuned sRGB approximations for the game's existing lighting.
// Unknown operators retain the original neutral fleet paint.
//
// Prefix source: the existing lib/airlines.js catalogue, cross-checked against
// the FAA's ICAO three-letter designator table (including RCH/CNV/RRR/CFC):
// https://www.faa.gov/air_traffic/publications/atpubs/cnt_html/chap3_section_3.html
// Airline IDs are three-letter designators followed by a flight number:
// https://www.faa.gov/regulations_policies/advisory_circulars/index.cfm/go/document.information/documentID/1043324
// Paint references for the requested three US operators and newer identities:
// https://history.southwest.com/our-stories/our-heart-livery/
// https://ir.united.com/news-releases/news-release-details/out-gold-blue-united-airlines-unveils-its-next-fleet-paint/
// https://news.delta.com/new-era-style-introducing-distinctly-delta-uniform-collection
// https://www.airindia.com/in/en/about-us.html
// https://www.koreanair.com/contents/whatsnew/newci
// https://news.jetblue.com/latest-news/press-release-details/2023/JetBlue-Introduces-Its-Boldest-Bluest-Plane--Ever--With-Livery-Refresh-Reflecting-Its-Role-as-Industry-Disruptor/default.aspx
//
// No regional-to-parent guessing: SKW/RPA can fly for multiple brands, and a
// marketing codeshare is not the operator painted on the aircraft. CMB is a
// military contract identifier, not proof of military ownership or paint.

const WHITE = '#f4f5f4';
const GREY = '#c3c9ce';

function airline(id, name, prefixes, marking, code, fin, accent, options = {}) {
  const body = options.body ?? WHITE;
  return {
    id, name, kind: 'airline', prefixes, marking, code,
    tail: options.tail ?? 'text',
    colors: {
      body, belly: options.belly ?? body, fin,
      nacelle: options.nacelle ?? fin, wing: options.wing ?? GREY,
      accent, radome: options.radome ?? body,
      ink: options.ink ?? fin, tailInk: options.tailInk ?? WHITE,
    },
    bellyStyle: options.bellyStyle ?? (options.belly ? 1 : 0),
    cheat: options.cheat ?? false,
  };
}

function military(id, name, prefixes, marking, code, options = {}) {
  const body = options.body ?? '#899195';
  return {
    id, name, kind: 'military', prefixes, marking, code,
    tail: options.tail ?? 'text',
    colors: {
      body, belly: body, fin: body, nacelle: body, wing: body,
      accent: options.accent ?? '#424b50', radome: '#626b70',
      ink: '#3d464b', tailInk: '#3d464b',
    },
    bellyStyle: 0, cheat: false,
  };
}

// Append-only order: index addresses a 256 x 128 cell in the shared atlas
// (eight columns, at most eight rows). The instance stores index + 1; zero
// means neutral and does not consume an atlas cell. Keep <= 63 records.
const LIVERIES = [
  // North America. Delta, Southwest and United have bespoke tail artwork.
  airline('delta', 'Delta Air Lines', ['DAL'], 'DELTA', 'DL', '#152b4d', '#ce183a', { belly: '#152b4d', tail: 'delta', tailInk: '#ce183a' }),
  airline('southwest', 'Southwest Airlines', ['SWA'], 'Southwest', 'WN', '#2e54a4', '#f4c247', { body: '#2e54a4', ink: WHITE, tail: 'southwest', tailInk: '#d62336' }),
  airline('united', 'United Airlines', ['UAL'], 'UNITED', 'UA', '#1657ac', '#69b5e4', { belly: '#c1c6cc', ink: '#193b75', tail: 'united', tailInk: '#69b5e4', cheat: true }),
  airline('american', 'American Airlines', ['AAL'], 'American', 'AA', '#316caa', '#ca213b', { body: '#d9dfe3', ink: '#34434c', tail: 'stripes' }),
  airline('jetblue', 'JetBlue Airways', ['JBU'], 'jetBlue', 'jetBlue', '#172e61', '#68afd9', { body: '#172e61', ink: WHITE }),
  airline('alaska', 'Alaska Airlines', ['ASA'], 'Alaska', 'AS', '#153d59', '#a8cf45', { ink: '#153d59', nacelle: WHITE }),
  airline('hawaiian', 'Hawaiian Airlines', ['HAL'], 'HAWAIIAN', 'HA', '#623d88', '#df3c88', { nacelle: WHITE }),
  airline('spirit', 'Spirit Airlines', ['NKS'], 'spirit', 'spirit', '#f4cf2e', '#24292b', { body: '#f4cf2e', ink: '#24292b', tailInk: '#24292b' }),
  airline('frontier', 'Frontier Airlines', ['FFT'], 'FRONTIER', 'F9', '#218044', '#72b586', { nacelle: WHITE }),
  airline('allegiant', 'Allegiant Air', ['AAY'], 'allegiant', 'G4', '#1758a3', '#f4a92b', { belly: '#1758a3' }),
  airline('air-canada', 'Air Canada', ['ACA'], 'AIR CANADA', 'AC', '#22272b', '#cf263d', { belly: '#22272b', nacelle: '#22272b', ink: '#22272b', tailInk: '#cf263d' }),
  airline('westjet', 'WestJet', ['WJA'], 'WestJet', 'WS', '#123c52', '#27a7ac', { nacelle: WHITE }),
  airline('aeromexico', 'Aeromexico', ['AMX'], 'AEROMEXICO', 'AM', '#19375d', '#df253a', { nacelle: WHITE }),
  airline('copa', 'Copa Airlines', ['CMP'], 'Copa Airlines', 'CM', '#173b6c', '#d6b176', { belly: '#d6dadd', nacelle: WHITE }),
  airline('avianca', 'Avianca', ['AVA'], 'avianca', 'AV', '#d62736', '#9c1a2e', { nacelle: '#d62736', ink: '#d62736' }),
  airline('latam', 'LATAM Airlines', ['LAN', 'TAM'], 'LATAM', 'LATAM', '#292a64', '#df2758', { nacelle: WHITE, tail: 'stripes' }),

  // Europe.
  airline('british-airways', 'British Airways', ['BAW'], 'BRITISH AIRWAYS', 'BA', '#172f54', '#c5223a', { belly: '#172f54', tail: 'stripes' }),
  airline('virgin-atlantic', 'Virgin Atlantic', ['VIR'], 'virgin atlantic', 'Virgin', '#c9223e', '#79223f', { body: '#eeefef', nacelle: '#c9223e', ink: '#523144' }),
  airline('easyjet', 'easyJet', ['EZY'], 'easyJet', 'easyJet', '#ec6f17', '#ec6f17', { nacelle: '#ec6f17', ink: '#ec6f17' }),
  airline('ryanair', 'Ryanair', ['RYR'], 'RYANAIR', 'RYR', '#173766', '#e6bc47', { belly: '#173766', nacelle: WHITE, tailInk: '#e6bc47', cheat: true }),
  airline('lufthansa', 'Lufthansa', ['DLH'], 'Lufthansa', 'LH', '#152b4f', '#152b4f', { nacelle: WHITE }),
  airline('air-france', 'Air France', ['AFR'], 'AIR FRANCE', 'AF', '#1e3970', '#d5293f', { nacelle: WHITE, tail: 'stripes' }),
  airline('klm', 'KLM Royal Dutch Airlines', ['KLM'], 'KLM', 'KLM', '#279acc', '#16457a', { body: '#51afd6', belly: WHITE, nacelle: '#51afd6', ink: WHITE, bellyStyle: 2, cheat: true }),
  airline('iberia', 'Iberia', ['IBE'], 'IBERIA', 'IB', '#c72733', '#eda92e', { nacelle: WHITE, tail: 'stripes' }),
  airline('vueling', 'Vueling', ['VLG'], 'vueling', 'VY', '#7f898e', '#efce2e', { nacelle: '#efce2e', ink: '#6c767b' }),
  airline('aer-lingus', 'Aer Lingus', ['EIN'], 'Aer Lingus', 'EI', '#0c716b', '#85be41', { nacelle: '#0c716b' }),
  airline('finnair', 'Finnair', ['FIN'], 'FINNAIR', 'F', '#182d56', '#182d56', { nacelle: WHITE }),
  airline('sas', 'Scandinavian Airlines', ['SAS'], 'SAS', 'SAS', '#174791', '#b6bdc7', { nacelle: '#174791', ink: '#808a95' }),
  airline('swiss', 'Swiss International Air Lines', ['SWR'], 'SWISS', '+', '#ce2437', '#ce2437', { nacelle: WHITE }),
  airline('austrian', 'Austrian Airlines', ['AUA'], 'Austrian', 'OS', '#cf2538', '#cf2538', { nacelle: WHITE, tail: 'stripes' }),
  airline('tap', 'TAP Air Portugal', ['TAP'], 'TAP AIR PORTUGAL', 'TAP', '#c9293c', '#75b543', { nacelle: '#75b543', ink: '#5c9f3f', tail: 'stripes' }),
  airline('turkish', 'Turkish Airlines', ['THY'], 'TURKISH AIRLINES', 'TK', '#d52536', '#d52536', { nacelle: WHITE, ink: '#17335b' }),
  airline('lot', 'LOT Polish Airlines', ['LOT'], 'LOT', 'LOT', '#183c71', '#183c71', { nacelle: WHITE }),
  airline('wizz', 'Wizz Air', ['WZZ'], 'W!ZZ', 'W!ZZ', '#d72786', '#512b89', { belly: '#d72786', nacelle: '#d72786', ink: '#512b89' }),

  // Middle East, Asia, Oceania and Africa.
  airline('emirates', 'Emirates', ['UAE'], 'Emirates', 'EK', '#158658', '#d32c35', { nacelle: WHITE, ink: '#b58a47', tail: 'stripes' }),
  airline('etihad', 'Etihad Airways', ['ETD'], 'ETIHAD', 'EY', '#b5a078', '#64513a', { body: '#ece5d6', nacelle: '#ece5d6', ink: '#826638', tail: 'stripes' }),
  airline('qatar', 'Qatar Airways', ['QTR'], 'QATAR', 'QR', '#d2d5d8', '#722944', { body: '#e4e5e6', nacelle: '#e4e5e6', ink: '#722944', tailInk: '#722944' }),
  airline('saudia', 'Saudia', ['SVA'], 'SAUDIA', 'SV', '#126546', '#2a6592', { nacelle: WHITE, ink: '#126546' }),
  airline('cathay', 'Cathay Pacific', ['CPA'], 'CATHAY PACIFIC', 'CX', '#145b59', '#c1d5d2', { nacelle: WHITE }),
  airline('singapore', 'Singapore Airlines', ['SIA'], 'SINGAPORE AIRLINES', 'SQ', '#193452', '#cda44c', { belly: '#d8dddf', nacelle: WHITE, tailInk: '#cda44c', cheat: true }),
  airline('ana', 'All Nippon Airways', ['ANA'], 'ANA', 'ANA', '#194d9b', '#37a5d8', { nacelle: WHITE, cheat: true }),
  airline('japan-airlines', 'Japan Airlines', ['JAL'], 'JAPAN AIRLINES', 'JAL', WHITE, '#cd2a3c', { nacelle: WHITE, ink: '#25282d', tailInk: '#cd2a3c' }),
  airline('korean', 'Korean Air', ['KAL'], 'KOREAN', 'KE', '#84b9d3', '#193b64', { body: '#84b9d3', belly: WHITE, nacelle: '#84b9d3', ink: '#193b64', tailInk: '#193b64' }),
  airline('air-china', 'Air China', ['CCA'], 'AIR CHINA', 'CA', WHITE, '#ce2c3d', { nacelle: WHITE, ink: '#1b3671', tailInk: '#ce2c3d', cheat: true }),
  airline('china-eastern', 'China Eastern Airlines', ['CES'], 'CHINA EASTERN', 'MU', WHITE, '#c8293b', { nacelle: WHITE, ink: '#1d3973', tailInk: '#1d3973' }),
  airline('china-southern', 'China Southern Airlines', ['CSN'], 'CHINA SOUTHERN', 'CZ', '#206fa9', '#d24d58', { nacelle: WHITE, ink: '#1b4f86', cheat: true }),
  airline('eva', 'EVA Air', ['EVA'], 'EVA AIR', 'EVA', '#207c4c', '#dc8d2f', { belly: '#207c4c', nacelle: WHITE, cheat: true }),
  airline('china-airlines', 'China Airlines', ['CAL'], 'CHINA AIRLINES', 'CI', '#405a9a', '#de8bb5', { nacelle: WHITE }),
  airline('thai', 'Thai Airways', ['THA'], 'THAI', 'THAI', '#67327a', '#e3b84b', { nacelle: WHITE, tailInk: '#e3b84b' }),
  airline('air-india', 'Air India', ['AIC'], 'AIR INDIA', 'AI', '#bb263c', '#d6ab64', { nacelle: '#bb263c', ink: '#8b2343', tailInk: '#d6ab64' }),
  airline('indigo', 'IndiGo', ['IGO'], 'IndiGo', '6E', '#26529b', '#26529b', { belly: '#26529b', nacelle: '#26529b' }),
  airline('qantas', 'Qantas', ['QFA'], 'QANTAS', 'QF', '#d12637', '#d12637', { nacelle: WHITE, ink: '#2b3035' }),
  airline('air-new-zealand', 'Air New Zealand', ['ANZ'], 'AIR NEW ZEALAND', 'NZ', '#25292d', '#25292d', { nacelle: WHITE }),
  airline('ethiopian', 'Ethiopian Airlines', ['ETH'], 'Ethiopian', 'ET', '#328447', '#d03838', { nacelle: WHITE, ink: '#b42f38', tail: 'stripes', tailInk: '#e7bd3d' }),

  // Cargo operators retain their operator branding on freighter variants.
  airline('fedex', 'FedEx Express', ['FDX'], 'FedEx', 'FedEx', '#5b287e', '#ed8b2c', { nacelle: WHITE, ink: '#5b287e' }),
  airline('ups', 'UPS Airlines', ['UPS'], 'Worldwide Services', 'UPS', '#5c402d', '#d2ac59', { belly: '#5c402d', nacelle: WHITE, ink: '#5c402d', tailInk: '#d2ac59', cheat: true }),
  airline('atlas', 'Atlas Air', ['GTI'], 'ATLAS AIR', 'ATLAS', '#183a6a', '#c5a15b', { belly: '#183a6a', nacelle: '#183a6a', tailInk: '#c5a15b' }),
  airline('cargolux', 'Cargolux', ['CLX'], 'cargolux', 'CV', '#c72b3e', '#c72b3e', { nacelle: WHITE, ink: '#c72b3e' }),

  // Service-level approximations only; no invented serial, unit or squadron.
  military('us-air-force', 'U.S. Air Force', ['RCH'], 'U.S. AIR FORCE', 'USAF'),
  military('us-navy', 'U.S. Navy', ['CNV'], 'NAVY', 'NAVY', { body: '#a5adb1' }),
  military('royal-air-force', 'Royal Air Force', ['RRR'], 'ROYAL AIR FORCE', 'RAF', { body: '#9ba4a9', tail: 'roundel', accent: '#a83d43' }),
  military('canadian-forces', 'Canadian Armed Forces', ['CFC'], 'CANADA', 'CAF', { body: '#969e9f' }),
  military('military-low-vis', 'Military low visibility', [], '', ''),
];

/** Immutable records shared by palette, markings atlas and pure resolver. */
export const OPERATOR_LIVERIES = Object.freeze(LIVERIES.map((livery, index) => Object.freeze({
  ...livery,
  index,
  prefixes: Object.freeze(livery.prefixes.slice()),
  colors: Object.freeze(livery.colors),
})));

const BY_PREFIX = new Map(OPERATOR_LIVERIES.flatMap((livery) => livery.prefixes.map((prefix) => [prefix, livery])));
const MILITARY_FALLBACK = OPERATOR_LIVERIES[OPERATOR_LIVERIES.length - 1];

function isMilitary(meta, paletteClass) {
  return paletteClass === 'military'
    || meta?.iconType === 'military'
    || meta?.military === true
    || (Number.isInteger(meta?.dbFlags) && (meta.dbFlags & 1) !== 0);
}

/**
 * A representative livery for the current observation, or null for neutral.
 * Accept only a known ICAO prefix plus a digit-led flight ID (ADS-B's eight
 * characters, with optional padding between prefix and flight number). No
 * IATA/telephony guessing, string-prefix matching, hex lookup or registration
 * inference. Reading metadata on every call lets a reused track change paint
 * when a flight number arrives, changes or disappears.
 */
export function liveryForAircraft(meta, paletteClass = 'civil') {
  const militaryAircraft = isMilitary(meta, paletteClass);
  const fallback = militaryAircraft ? MILITARY_FALLBACK : null;
  const flight = meta?.flight ?? meta?.callsign;
  if (typeof flight !== 'string') return fallback;
  const callsign = flight.trim().toUpperCase();
  const match = /^([A-Z]{3})[ \t]*(\d[A-Z0-9]{0,4})$/.exec(callsign);
  if (!match) return fallback;

  // Some feeds repeat the registration in flight. Even when it happens to
  // resemble a designator, that provides no operator evidence.
  if (typeof meta?.r === 'string') {
    const registration = meta.r.toUpperCase().replace(/[\s-]/g, '');
    if (registration && registration === `${match[1]}${match[2]}`) return fallback;
  }

  const livery = BY_PREFIX.get(match[1]);
  if (!livery) return fallback;
  if (militaryAircraft && livery.kind !== 'military') return fallback;
  return livery;
}

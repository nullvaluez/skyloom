/**
 * R24 fixture — a synthetic ADS-B fleet at the `/api/aircraft` shape.
 *
 * The real route returns `{ ...upstream, ac: [...] }` with `now` in the
 * payload (app/api/aircraft/route.js:185/226) and an `x-adsb-source` header;
 * lib/api.js:69 calls `/api/aircraft?lat&lon&dist` with lat/lon already
 * rounded to 0.05 deg. hooks/use-fly-traffic.js:105 IGNORES a batch whose
 * `now` equals the previous one, so `now` must advance even when the fleet
 * does not.
 *
 * FIELDS the client actually reads (lib/workers/aircraft-processor.worker.js
 * :733-768 and the classify/rarity tables): hex, lat, lon, alt_baro (number or
 * 'ground'), alt_geom, gs (kt), track (deg), baro_rate (fpm), t, flight, r,
 * squawk, category, seen / seen_pos.
 *
 * DETERMINISM. `FLY_FIXTURE_TRAFFIC`:
 *   off     -> `{ ac: [] }` (a legitimate 200 with an honest empty cell; use
 *              it for the strictest fixed-pose pixel and draw gates)
 *   static  -> DEFAULT. Positions are evaluated at a FIXED epoch, so every run
 *              starts from the identical layout; the client still dead-reckons
 *              them forward from receipt exactly as it does live.
 *   moving  -> positions advance on the wall clock (for tracer / near-miss
 *              behaviour, not for pixel gates)
 */
import { prng, rand2 } from './noise.mjs';

const T0 = 1767225600; // 2026-01-01T00:00:00Z — the frozen fixture epoch
const NM_PER_DEG = 60;

// A spread across every archetype the fleet classifies: airliners (incl.
// explicit-prefix families), regional, bizjet, GA prop, turboprop, heli,
// military, cargo, glider, drone, and the R14 warbird/classic set.
const TYPES = [
  ['A320', 'commercial'], ['A21N', 'commercial'], ['B738', 'commercial'],
  ['B38M', 'commercial'], ['B77W', 'commercial'], ['B789', 'commercial'],
  ['A388', 'commercial'], ['A359', 'commercial'], ['E75L', 'commercial'],
  ['CRJ9', 'commercial'], ['AT76', 'commercial'], ['DH8D', 'commercial'],
  ['B748', 'cargo'], ['B763', 'cargo'], ['MD11', 'cargo'], ['A124', 'cargo'],
  ['GLF6', 'jet'], ['C56X', 'jet'], ['E55P', 'jet'],
  ['C172', 'prop'], ['SR22', 'prop'], ['DA40', 'prop'], ['PA28', 'prop'],
  ['PC12', 'prop'], ['BE20', 'prop'], ['C208', 'prop'],
  ['EC35', 'helicopter'], ['R44', 'helicopter'], ['B06', 'helicopter'],
  ['F16', 'military'], ['C130', 'military'], ['KC35', 'military'],
  ['C17', 'military'], ['E3TF', 'military'],
  ['ASK21', 'glider'], ['DG40', 'glider'],
  ['MQ9', 'drone'],
  ['P51', 'warbird'], ['SPIT', 'warbird'], ['B17', 'warbird'],
  ['B29', 'warbird'], ['DC3', 'warbird'], ['T6', 'warbird'], ['YK52', 'warbird'],
];

const AIRLINES = ['UAL', 'DAL', 'AAL', 'SWA', 'BAW', 'DLH', 'AFR', 'JAL', 'FDX', 'UPS'];

function hex6(n) {
  return (n >>> 0).toString(16).padStart(6, '0').slice(-6);
}

/**
 * @param {number} qLat query centre (already 0.05-rounded by lib/api.js)
 * @param {number} qLon
 * @param {number} dist nautical miles
 * @param {string} mode off | static | moving
 * @param {number} count fleet size
 */
export function fleet(qLat, qLon, dist, mode = 'static', count = 300) {
  if (mode === 'off') return [];
  const nowSec = mode === 'moving' ? Date.now() / 1000 : T0;
  const dt = nowSec - T0;
  // The seed is the QUERY CELL, so panning the aeroplane to a new cell brings
  // a new-but-deterministic fleet, exactly as a real spatial query does.
  const cellSeed = Math.round(qLat * 20) * 100003 + Math.round(qLon * 20) * 7919;
  const out = [];
  for (let i = 0; i < count; i++) {
    const rnd = prng((cellSeed ^ (i * 2654435761)) >>> 0);
    // Golden-angle spiral: even coverage of the query disc without clumping.
    const rad = Math.sqrt((i + 0.5) / count) * dist * 0.92;
    const ang = i * 2.399963229728653 + rand2(i, 1, cellSeed) * 0.4;
    const dLat = (rad * Math.cos(ang)) / NM_PER_DEG;
    const dLon = (rad * Math.sin(ang)) / (NM_PER_DEG * Math.cos((qLat * Math.PI) / 180));
    const [t, klass] = TYPES[i % TYPES.length];

    let alt;
    let gs;
    if (klass === 'commercial' || klass === 'cargo') {
      alt = 24000 + Math.floor(rnd() * 17000);
      gs = 380 + Math.floor(rnd() * 130);
    } else if (klass === 'jet' || klass === 'military') {
      alt = 12000 + Math.floor(rnd() * 26000);
      gs = 280 + Math.floor(rnd() * 220);
    } else if (klass === 'helicopter') {
      alt = 400 + Math.floor(rnd() * 2200);
      gs = 60 + Math.floor(rnd() * 70);
    } else if (klass === 'glider') {
      alt = 3000 + Math.floor(rnd() * 6000);
      gs = 45 + Math.floor(rnd() * 40);
    } else if (klass === 'drone') {
      alt = 8000 + Math.floor(rnd() * 12000);
      gs = 120 + Math.floor(rnd() * 60);
    } else {
      alt = 1200 + Math.floor(rnd() * 9000);
      gs = 90 + Math.floor(rnd() * 130);
    }
    const track = Math.floor(rnd() * 360);
    const baroRate = Math.round((rnd() - 0.5) * 1600);
    // Dead-reckon from the frozen epoch (0 in 'static').
    const spdDegLat = (gs / 3600 / NM_PER_DEG) * dt;
    const lat = qLat + dLat + spdDegLat * Math.cos((track * Math.PI) / 180);
    const lon =
      qLon + dLon + (spdDegLat * Math.sin((track * Math.PI) / 180)) / Math.cos((qLat * Math.PI) / 180);

    const isAirline = klass === 'commercial' || klass === 'cargo';
    const reg = `N${100 + (i % 800)}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 7) % 26))}`;
    const ac = {
      hex: hex6(0xa00000 + ((cellSeed + i * 7919) & 0xffffff)),
      type: 'adsb_icao',
      flight: isAirline
        ? `${AIRLINES[i % AIRLINES.length]}${100 + (i % 899)}  `
        : `${reg}  `,
      r: reg,
      t,
      alt_baro: alt,
      alt_geom: alt + 75,
      gs,
      track,
      baro_rate: baroRate,
      squawk: i % 97 === 13 ? '7700' : i % 61 === 29 ? '7600' : String(1200 + (i % 5000)).padStart(4, '0'),
      category: klass === 'commercial' ? 'A3' : klass === 'helicopter' ? 'A7' : klass === 'cargo' ? 'A5' : 'A1',
      lat,
      lon,
      nic: 8,
      seen: 0.4,
      seen_pos: 0.4,
      messages: 1200 + i,
      rssi: -12.5,
    };
    if (i % 53 === 7) {
      ac.alt_baro = 'ground';
      ac.gs = 8;
    }
    out.push(ac);
  }
  return out;
}

export function aircraftPayload(qLat, qLon, dist, mode, count) {
  const ac = fleet(qLat, qLon, dist, mode, count);
  return {
    // `now` must ADVANCE every poll or use-fly-traffic.js:105 drops the batch.
    now: Date.now() / 1000,
    messages: 1e7,
    total: ac.length,
    ctime: Date.now(),
    ptime: 3,
    msg: 'No error',
    ac,
  };
}

export { TYPES as FIXTURE_TYPES };

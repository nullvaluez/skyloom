// Run from any working directory: node scripts/verify-lounge-directory.mjs.
// The directory may expose only airports whose existing snapshot geometry can
// pass the actual runtime registry validation. It never creates flight starts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = new URL('../' + specifier.slice(2), import.meta.url).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (fs.existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });

const root = new URL('../', import.meta.url);
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, root), 'utf8'));
const registry = await import('../lib/fly/operations-airports.js');
const originalFlights = [...registry.OPERATIONS_AIRPORTS];
const { LOUNGE_AIRPORTS, LOUNGE_REGIONS, searchLoungeAirports } = await import('../lib/fly/lounge-airports.mjs');
const { LOUNGE_SEATS } = await import('../lib/fly/lounge-seats.js');
const { LOUNGE_SEATS_PIER } = await import('../lib/fly/lounge-seats-pier.js');
const { FLAGSHIP_AIRPORTS } = await import('../lib/fly/airport-observation.mjs');
const { AIRPORTS } = await import('../lib/airports.js');
const index = read('public/data/runways/v1/index.json').runways;
const byIdent = new Map();
for (const row of index) {
  if (!byIdent.has(row.ident)) byIdent.set(row.ident, []);
  byIdent.get(row.ident).push(row);
}
const regions = new Map();
const geometry = (row) => {
  if (!regions.has(row.region)) regions.set(row.region, read(`public/data/runways/v1/regions/${row.region}.json`).airports);
  return regions.get(row.region).find((a) => a.id === row.id);
};
let checks = 0;
const check = (name, run) => { run(); checks++; console.log(`PASS ${name}`); };
const find = (query, options) => searchLoungeAirports(LOUNGE_AIRPORTS, query, options);

check('importing the lounge directory does not register any flight airport', () => {
  assert.deepEqual(registry.OPERATIONS_AIRPORTS, originalFlights);
  assert.deepEqual([...registry.AUTHORED_AIRPORT_IDS].sort(), ['KCMH', 'KLCK', 'KOSU']);
});
check('at least 150 unique frozen lounge entries and seven frozen regions', () => {
  assert.ok(LOUNGE_AIRPORTS.length >= 150);
  assert.ok(Object.isFrozen(LOUNGE_AIRPORTS) && Object.isFrozen(LOUNGE_REGIONS));
  assert.equal(new Set(LOUNGE_AIRPORTS.map((a) => a.ident)).size, LOUNGE_AIRPORTS.length);
  assert.equal(new Set(LOUNGE_REGIONS.map((r) => r.id)).size, 7);
  for (const entry of [...LOUNGE_AIRPORTS, ...LOUNGE_REGIONS]) assert.ok(Object.isFrozen(entry));
});
check('every region has substantial coverage and each entry has complete metadata', () => {
  for (const region of LOUNGE_REGIONS) assert.ok(LOUNGE_AIRPORTS.filter((a) => a.region === region.id).length >= 10, region.id);
  for (const a of LOUNGE_AIRPORTS) {
    assert.equal(a.id, a.ident);
    assert.match(a.ident, /^[A-Z0-9-]+$/);
    assert.match(a.country, /^[A-Z]{2}$/);
    assert.match(a.iata, /^[A-Z]{3}$/);
    assert.ok(a.name && a.city && LOUNGE_REGIONS.some((r) => r.id === a.region));
    assert.ok(Number.isFinite(a.lat) && Math.abs(a.lat) <= 85 && Number.isFinite(a.lon) && Math.abs(a.lon) <= 180, a.ident);
    if (a.aliases) assert.ok(Object.isFrozen(a.aliases));
  }
});
check('all lounge identities resolve to usable checked-in runtime runway geometry', () => {
  for (const a of LOUNGE_AIRPORTS) {
    const authored = originalFlights.find((r) => r.id === a.ident);
    const rows = byIdent.get(a.ident) || [];
    assert.ok(authored || rows.length, `${a.ident}: no runway`);
    for (const row of rows) {
      const raw = geometry(row);
      assert.ok(raw, `${row.id}: missing region geometry`);
      const registered = registry.registerAirport(raw);
      const frame = registry.airportFrame(registered);
      assert.ok(frame.length >= 150 && registered.width >= 4, row.id);
      const distanceKm = Math.hypot((row.lat - a.lat) * 111.32, (row.lon - a.lon) * Math.cos(a.lat * Math.PI / 180) * 111.32);
      assert.ok(distanceKm < 40, `${row.id}: directory coordinates ${distanceKm.toFixed(1)} km away`);
    }
  }
});
check('existing flagship identities and valid hub labels are retained', () => {
  for (const a of FLAGSHIP_AIRPORTS) assert.ok(LOUNGE_AIRPORTS.some((b) => b.ident === a.id), a.id);
  for (const hub of Object.values(AIRPORTS)) {
    if (hub.icao === 'KRKL') continue;
    const a = find(hub.icao)[0];
    assert.ok(a, hub.icao);
    assert.equal(a.name, hub.name);
    assert.equal(a.city, hub.city);
  }
  assert.equal(find('KRKL').length, 0);
});
check('stored classic and pier seats still name valid runways at the same airport', () => {
  for (const table of [LOUNGE_SEATS, LOUNGE_SEATS_PIER]) {
    for (const a of LOUNGE_AIRPORTS) {
      const seat = table[a.ident];
      if (!seat) continue;
      assert.equal(seat.runway.split(':')[0], a.ident);
      const runway = registry.airportById(seat.runway);
      assert.ok(runway, `${a.ident}: unavailable seat runway ${seat.runway}`);
      assert.ok(Number.isFinite(seat.along) && seat.along >= 0 && seat.along <= registry.airportFrame(runway).length, seat.runway);
      assert.ok(Number.isFinite(seat.cross) && seat.floorM > 0, seat.runway);
    }
  }
});
check('ICAO, IATA, dataset identifiers and legacy aliases select the intended airport', () => {
  for (const [query, ident] of [['JFK', 'KJFK'], ['KJFK', 'KJFK'], ['LHR', 'EGLL'], ['INN', 'LOWI'], ['KHNL', 'PHNL'], ['HNL', 'PHNL'], ['OKBK', 'OKKK'], ['KWI', 'OKKK'], ['SPJC', 'SPIM'], ['LIM', 'SPIM']]) assert.equal(find(query)[0]?.ident, ident, query);
});
check('source municipality corrections retain island and service-city discovery aliases', () => {
  for (const [query, ident, city] of [['Grand Cayman', 'MWCR', 'George Town'], ['Tahiti', 'NTAA', 'Papeete'], ['Madeira', 'LPMA', 'Funchal'], ['Bucharest', 'LROP', 'Otopeni'], ['Bali Denpasar', 'WADD', 'Kuta, Badung']]) {
    const airport = find(query).find((a) => a.ident === ident);
    assert.equal(airport?.city, city, query);
  }
});
check('accent-insensitive and unordered multi-token city/country search works', () => {
  for (const [query, ident] of [['Sao Paulo', 'SBGR'], ['São Paulo', 'SBGR'], ['malaga spain', 'LEMG'], ['Bali Indonesia', 'WADD'], ['New York JFK', 'KJFK'], ['Canada Calgary', 'CYYC'], ['UAE Abu Dhabi', 'OMAA'], ['Perth Australia', 'YPPH']]) assert.ok(find(query).some((a) => a.ident === ident), query);
  assert.ok(find('United States').length >= 30);
  assert.equal(find('not-a-real-airport-identifier').length, 0);
});
check('filters, limits and duplicate input preserve airport-level results', () => {
  assert.equal(find('', { limit: 8 }).length, 8);
  assert.equal(find('', { limit: 0 }).length, 0);
  assert.equal(find('', { region: 'missing' }).length, 0);
  assert.equal(find('JFK', { region: 'asia' }).length, 0);
  for (const region of LOUNGE_REGIONS) assert.ok(find('', { region: region.id }).every((a) => a.region === region.id));
  const result = searchLoungeAirports([...LOUNGE_AIRPORTS, ...LOUNGE_AIRPORTS], '', { limit: Infinity });
  assert.equal(result.length, LOUNGE_AIRPORTS.length);
});

console.log(`LOUNGE DIRECTORY: ${checks}/${checks}; ${LOUNGE_AIRPORTS.length} airports; ${LOUNGE_REGIONS.map((r) => `${r.id}=${find('', { region: r.id }).length}`).join(', ')}`);

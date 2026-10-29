// Real lounge catalog + registry regression: all destinations under bounded
// registry pressure, including the runway referenced by every stored seat.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({ resolve(s, c, next) {
  if (s.startsWith('@/')) s = new URL('../' + s.slice(2), import.meta.url).href;
  if (s.startsWith('.') || s.startsWith('file:')) {
    const u = new URL(s, c.parentURL);
    if (fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c);
  }
  return next(s, c);
} });

const { LOUNGE_AIRPORTS } = await import('../lib/fly/lounge-airports.mjs');
const { ensureLoungeAirport, searchLoungeCatalog } = await import('../lib/fly/lounge-catalog.js');
const registry = await import('../lib/fly/operations-airports.js');
const catalog = await import('../lib/fly/runway-catalog.js');
const { resolveLoungeSite, storedSeat } = await import('../lib/fly/lounge-site.js');
const index = JSON.parse(fs.readFileSync('public/data/runways/v1/index.json', 'utf8')).runways;
const saved = new Map();
globalThis.localStorage = { setItem: (k, v) => saved.set(k, v), getItem: (k) => saved.get(k) };
let offline = false;
globalThis.fetch = async (url) => ({ ok: !offline, json: async () => JSON.parse(fs.readFileSync('public' + url, 'utf8')) });
let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };

await check('failed worldwide search retries without poisoning the catalog cache', async () => {
  offline = true;
  await assert.rejects(searchLoungeCatalog('JFK'), /could not load/);
  offline = false;
  assert.equal((await searchLoungeCatalog('JFK'))[0].ident, 'KJFK');
});
await check('search groups parallel runways and handles city, IATA, accents and catalog-only airports', async () => {
  const jfk = await searchLoungeCatalog('JFK');
  assert.equal(jfk.filter((a) => a.ident === 'KJFK').length, 1);
  for (const [term, id] of [['LHR', 'EGLL'], ['Sao Paulo', 'SBGR'], ['Tokyo', 'RJTT'], ['Bali Indonesia', 'WADD'], ['KBTV', 'KBTV'], ['KOSU', 'KOSU'], ['Ohio State', 'KOSU'], ['KLCK', 'KLCK'], ['Rickenbacker', 'KLCK']]) {
    const rows = await searchLoungeCatalog(term);
    assert.ok(rows.some((a) => a.ident === id), term);
    assert.equal(new Set(rows.map((a) => a.ident)).size, rows.length, term);
  }
  assert.deepEqual(await searchLoungeCatalog('no-such-airport-99999'), []);
});

let stored = 0, generic = 0, peak = 0;
await check('all 180 lounges load their full airport and retain stored seat runways through nearby discovery', async () => {
  for (const destination of LOUNGE_AIRPORTS) {
    const role = Symbol(destination.id);
    catalog.protectRunwayIdent(role, destination.id);
    try {
      const airport = await ensureLoungeAirport(destination.id);
      assert.ok(airport, destination.id);
      assert.equal(JSON.parse(saved.get('fly-runway-last-v1')).id, airport.id, 'preloading retains the chosen cache row');
      await catalog.loadNearbyRunways(airport.a.lat, airport.a.lon);
      // Stored lounges can face a shorter runway that is absent from the
      // nearest-eight list. All of this airport's rows must still be present.
      if (airport.authored === false) for (const row of index.filter((r) => r.ident === destination.id)) {
        assert.ok(registry.airportById(row.id), row.id);
      }
      for (const variant of ['classic', 'pier']) {
        const seat = storedSeat(airport, { variant });
        const site = resolveLoungeSite(airport, { variant });
        assert.equal(site.ident, destination.id);
        for (const n of [site.x, site.z, site.groundY, site.floorM, site.heading]) assert.ok(Number.isFinite(n), destination.id);
        if (seat) {
          assert.equal(site.runwayId, seat.seat.runway, `${destination.id} ${variant}`);
          assert.notEqual(site.source, 'generic', `${destination.id} ${variant}`);
          assert.equal(site.variant, variant);
          stored++;
        } else generic++;
      }
      peak = Math.max(peak, registry.OPERATIONS_AIRPORTS.length - registry.AUTHORED_AIRPORT_IDS.size);
      assert.ok(peak <= catalog.RUNWAY_ACTIVE_LIMIT, `bounded registration: ${peak}`);
    } finally { catalog.protectRunwayIdent(role, null); }
  }
  assert.ok(stored > 200 && generic > 0, 'both stored and runtime/fallback placements exercised');
  assert.equal(catalog.protectedRunwayIdents().size, 0, 'temporary roles released');
});
await check('cancelled airport preparation stops without a transfer or saved flight setup', async () => {
  assert.equal(await ensureLoungeAirport('KJFK', { cancelled: () => true }), null);
  assert.equal(await ensureLoungeAirport('NOT-A-REAL-AIRPORT'), null);
  assert.equal(saved.has('fly-last-setup-v1'), false);
  assert.equal(saved.has('fly-runway-departure-v1'), false);
  assert.deepEqual([...registry.AUTHORED_AIRPORT_IDS].sort(), ['KCMH', 'KLCK', 'KOSU']);
});

await check('real watch transfer pins a full hub and cancellation preserves the seated airport', async () => {
  const { Vector3, PerspectiveCamera } = await import('three');
  const { connectAirportWatch } = await import('../lib/fly/airport-watch-runtime.js');
  const { useFlyStore } = await import('../stores/fly-store.js');
  globalThis.window = { location: { search: '?graphicsReview=1&airports=on' }, matchMedia: () => ({ matches: false }) };
  const flight = { pos: new Vector3(), cfg: { speeds: { slow: 60, boost: 300 } }, heading: 0, speed: 100, pitch: 0, bank: 0 };
  const runtime = {
    flight,
    engine: {
      worldToGeo: (p) => new Vector3(p.x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(-p.z / 6378137)) - Math.PI / 2) * 180 / Math.PI, p.y),
      getGroundAt: () => ({ tileZ: 18, elev: 250 }),
    },
    traffic: { tracks: new Map(), items: [] },
    targeting: { lockedHex: null },
    input: { neutralize() {}, keys: new Set() },
    adventures: { suspend() {} },
    warpToGeo(lat, lon, { altM, headingRad = 0 }) {
      const p = registry.projectAirportPoint(lon, lat);
      flight.pos.set(p.x, altM, p.z); flight.heading = headingRad; return true;
    },
  };
  const dispose = connectAirportWatch(runtime);
  try {
    assert.equal(await runtime.airportWatch.enter('KORD'), true);
    assert.equal(runtime.airportWatch.site.ident, 'KORD');
    assert.notEqual(runtime.airportWatch.site.source, 'generic');
    for (const row of index.filter((r) => r.ident === 'KORD')) assert.ok(registry.airportById(row.id), row.id);
    assert.deepEqual([...catalog.protectedRunwayIdents()], ['KORD']);
    const position = flight.pos.clone();
    const pending = runtime.airportWatch.enter('KDEN');
    runtime.airportWatch.cancelPending();
    assert.equal(await pending, false);
    assert.equal(runtime.airportWatch.site.ident, 'KORD');
    assert.equal(flight.pos.distanceTo(position), 0);
    assert.deepEqual([...catalog.protectedRunwayIdents()], ['KORD']);
    // Reproduce the actual picker flow, rather than entering while its
    // default store value is already false. Successful entry closes it;
    // that closure must not cancel this airport's async seat refinement.
    useFlyStore.setState({ airportBrowserOpen: true });
    assert.equal(await runtime.airportWatch.enter('NZQN'), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(useFlyStore.getState().airportBrowserOpen, false);
    assert.equal(runtime.airportWatch.seatPending, false, 'successful picker dismissal must finish runtime placement');
    runtime.airportWatch.updateCamera(0, new PerspectiveCamera(50, 16 / 9, 2.5, 600000));
    assert.equal(runtime.airportWatch.validated, true);
    assert.equal(runtime.airportWatch.site.ident, 'NZQN');
  } finally { dispose(); delete globalThis.window; }
  assert.equal(catalog.protectedRunwayIdents().size, 0);
});

console.log(`LOUNGE CATALOG: ${checks}/${checks}; ${LOUNGE_AIRPORTS.length} destinations; ${stored} stored placements; ${generic} runtime/fallback placements; ${peak}/${catalog.RUNWAY_ACTIVE_LIMIT} resident rows`);

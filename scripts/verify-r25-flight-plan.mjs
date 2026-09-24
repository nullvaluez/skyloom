/**
 * R25 B FLIGHT PLAN — verify-r25-flight-plan (NODE gate; no browser, no GL, no server).
 *
 * Plan FLY_ROUND25_PLAN.md "B — FLIGHT PLAN", gates row:
 *   destination sanity · search parity with the old Atlas ranking over 60
 *   queries · last-setup round trip + corrupt/ineligible cases · daylight spot
 *   under a pinned clock · placement math for all 9 aircraft
 * plus the house-rule-2 proof that FLIGHT_PLAN off is today's tree:
 *   the REAL GroundHangar server-rendered next to the r25-w0 GroundHangar
 *   (react-dom/server, byte-compared) and the runtime launch/stage/Continue
 *   services driven against a real FlightOperations + FlightModel.
 *
 * SECTIONS
 *  [1] destinations: 11 curated entries, ids, finite fields, web-mercator band,
 *      altM >= clearM + 400, clearM >= groundM, each start within its named
 *      landmark's radius, and every tall structure / summit named in
 *      destinations.js that lies within 5 km is <= clearM (the clear-height
 *      rule checked arithmetically, not trusted).
 *  [2] search parity: lib/fly/poi/search.js rankAtlasEntries vs the r25-w0
 *      Atlas.jsx inline ranking (its text is read from the tag and evaluated,
 *      not paraphrased) over 60 queries, and warpOptsFor vs the old function;
 *      Atlas.jsx now imports both and no longer defines them.
 *  [3] searchDestinations: <= 6, featured first, accent folding, duplicate
 *      collapse, deterministic searched starts (city 3 km out with the sun
 *      behind, military 4 km out at 1,200 m).
 *  [4] last setup: flag-off arms (no write, null read, KOSU spawn) and the
 *      round trip for free/featured, free/searched, ops runway, glider
 *      practice; 16 corrupt / ineligible cases read null; describeSetup.
 *  [5] title spot: pinned clocks (sun elevation in [minSunElDeg, 50]),
 *      golden-hour preference, fallback, toy → Manhattan, and the
 *      resolveInitialSpawn precedence (bypass/no title → KOSU literal, last
 *      setup, daylight spot).
 *  [6] placement math: all 9 aircraft x 11 destinations x {authored ground,
 *      high DEM, unknown} — altitude max(altM, ground + minAglM), heading,
 *      cruise speed inside the aircraft's envelope.
 *  [7] runtime: connectFlightOperations with a real FlightOperations +
 *      FlightModel and a mercator engine fake — launchFreeFlight lands
 *      airborne at the placement for all 9 aircraft; stageDestination warps
 *      with {stage:true} (or not, when already there), polls readiness, and
 *      pumps frames only with FRONT_DOOR off; launchSetup relaunches free and
 *      ops setups exactly and closes the menu; launchGlider unchanged.
 *  [8] hangar markup: FLIGHT_PLAN off renders byte-identical to r25-w0 (ops
 *      and a store-set 'free' mode alike); ON+ops adds only the mode chip;
 *      ON+free renders every testid the plan names.
 *
 * VERDICTS: PASS / FAIL. Exit 1 on any FAIL.
 *
 * RED FIRST: `R25B_RED=1 node scripts/verify-r25-flight-plan.mjs` loads
 * flight-plan.js, operations-runtime.js and GroundHangar.jsx AT THE r25-w0 TAG
 * (the W0 stubs) — recorded in scripts/r25-b-flight-plan.md.
 *
 * Run:  node scripts/verify-r25-flight-plan.mjs
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
register(pathToFileURL(path.join(HERE, '_node-resolve.mjs')).href);
register(pathToFileURL(path.join(HERE, '_alias-loader.mjs')).href);
register(pathToFileURL(path.join(HERE, '_r25-b-ssr-loader.mjs')).href);
process.env.NODE_ENV = 'development';

const RED = process.env.R25B_RED === '1';
let pass = 0,
  fail = 0;
const fails = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : (fail++, fails.push(name));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const section = (t) => console.log(`\n[${t}]`);
const tryGate = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    gate(name, false, `threw: ${String(e?.message || e).split('\n')[0]}`);
  }
};

const url = (rel, w0 = false) => pathToFileURL(path.join(ROOT, rel)).href + (w0 ? '?r25bw0' : '');
const imp = (rel, w0 = false) => import(url(rel, w0));
const impOpt = async (rel) => {
  try {
    return await imp(rel);
  } catch (e) {
    return { __missing: String(e?.message || e).split('\n')[0] };
  }
};
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });

globalThis.window ??= { location: { search: '', href: 'http://localhost/' } };

const C = await imp('lib/fly/fly-constants.js');
const FP = await imp('lib/fly/flight-plan.js', RED);
const DST = RED ? { __missing: 'r25-w0 has no lib/fly/destinations.js' } : await impOpt('lib/fly/destinations.js');
const SRCH = RED ? { __missing: 'r25-w0 has no lib/fly/poi/search.js' } : await impOpt('lib/fly/poi/search.js');
const { buildAtlasList } = await imp('lib/fly/poi/index.js');
const { PLAYER_AIRCRAFT, resolveAircraft, aircraftName } = await imp('lib/fly/player-aircraft.js');
const { airportById, airportPoint, projectAirportPoint, airportEligible, OPERATIONS_AIRPORTS } = await imp(
  'lib/fly/operations-airports.js'
);
const { computeSun } = await imp('lib/fly/sun-model.js');
const { useFlyStore } = await imp('stores/fly-store.js');

const SHIPPED = { plan: C.FLIGHT_PLAN.enabled, door: C.FRONT_DOOR.enabled };
const setPlan = (on) => (C.FLIGHT_PLAN.enabled = on);
const DEG = Math.PI / 180;
const km = (a, b, c, d) => {
  const dLat = (c - a) * 111.32;
  const dLon = (d - b) * 111.32 * Math.cos(((a + c) / 2) * DEG);
  return Math.hypot(dLat, dLon);
};
const IDS = [
  'grand-canyon',
  'manhattan',
  'swiss-alps',
  'rio',
  'tokyo',
  'yosemite',
  'sydney',
  'dubai',
  'napali',
  'geirangerfjord',
  'columbus-practice',
];

// ===========================================================================
section('1 destinations');
// Independent reference points (published positions of the named landmark
// each start is authored against) and the tall things within reach of it.
const ANCHOR = {
  'grand-canyon': { at: [36.0658, -112.1175], maxKm: 4, why: 'Yavapai Point' },
  manhattan: { at: [40.7033, -74.017], maxKm: 2.5, why: 'The Battery' },
  'swiss-alps': { at: [46.5935, 7.9091], maxKm: 0.5, why: 'Lauterbrunnen village' },
  rio: { at: [-22.9486, -43.1566], maxKm: 3, why: 'Sugarloaf' },
  tokyo: { at: [35.6365, 139.763], maxKm: 3, why: 'Rainbow Bridge' },
  yosemite: { at: [37.7156, -119.677], maxKm: 2.5, why: 'Tunnel View' },
  sydney: { at: [-33.8568, 151.2153], maxKm: 3.5, why: 'Sydney Opera House' },
  dubai: { at: [25.1972, 55.2744], maxKm: 5, why: 'Burj Khalifa' },
  napali: { at: [22.1714, -159.6558], maxKm: 2.5, why: 'Kalalau Beach' },
  geirangerfjord: { at: [62.1008, 7.2059], maxKm: 5, why: 'Geiranger village' },
  'columbus-practice': { at: [40.07715, -83.0816], maxKm: 0.1, why: 'KOSU 09R threshold' },
};
const TALL = [
  ['One World Trade Center', 40.7127, -74.0134, 541],
  ['Empire State Building', 40.7484, -73.9857, 443],
  ['Burj Khalifa', 25.1972, 55.2744, 828],
  ['Tokyo Tower', 35.6586, 139.7454, 333],
  ['Tokyo Skytree', 35.7101, 139.8107, 634],
  ['Sydney Tower', -33.8705, 151.2089, 309],
  ['Sugarloaf', -22.9486, -43.1566, 396],
  ['Corcovado + statue', -22.9519, -43.2105, 748],
  ['El Capitan', 37.734, -119.6377, 2307],
  ['Half Dome', 37.7459, -119.5332, 2694],
  ['Sentinel Dome', 37.723, -119.5845, 2476],
  ['Brahma Temple', 36.1206, -112.0831, 2317],
  ['Grand Canyon South Rim (Yavapai)', 36.0658, -112.1175, 2170],
  ['Jungfrau', 46.5367, 7.9625, 4158],
  ['Schilthorn', 46.5579, 7.8353, 2970],
  ['Männlichen', 46.612, 7.941, 2343],
  ['Eiger', 46.5776, 8.0053, 3967],
  ['Kalalau Lookout', 22.151, -159.6461, 1230],
  ['Waiʻaleʻale', 22.0706, -159.4984, 1569],
  ['Dalsnibba', 62.047, 7.268, 1476],
];
await tryGate('1a destinations module + FEATURED_DESTINATIONS', () => {
  if (DST.__missing) throw new Error(DST.__missing);
  const F = FP.FEATURED_DESTINATIONS;
  gate('1a destinations module + FEATURED_DESTINATIONS', Array.isArray(F) && F === DST.DESTINATIONS && F.length === 11, `n=${F?.length}`);
});
await tryGate('1b ids', () => {
  const ids = (FP.FEATURED_DESTINATIONS || []).map((d) => d.id);
  gate('1b the 11 plan destinations, unique ids, catalog order', JSON.stringify(ids) === JSON.stringify(IDS), ids.join(','));
});
await tryGate('1c fields', () => {
  const bad = [];
  for (const d of FP.FEATURED_DESTINATIONS || []) {
    const num = ['lat', 'lon', 'altM', 'groundM', 'clearM', 'headingDeg', 'tz'].every((k) => Number.isFinite(d[k]));
    const ok =
      num &&
      Math.abs(d.lat) < 85 &&
      Math.abs(d.lon) <= 180 &&
      d.headingDeg >= 0 &&
      d.headingDeg < 360 &&
      d.title?.radiusM > 0 &&
      d.title?.aglM > 0 &&
      typeof d.name === 'string' &&
      d.name &&
      typeof d.blurb === 'string' &&
      typeof d.glyph === 'string' &&
      d.kind === 'featured' &&
      Object.isFrozen(d);
    if (!ok) bad.push(d.id);
  }
  gate('1c every field finite / in range / frozen', bad.length === 0 && (FP.FEATURED_DESTINATIONS || []).length > 0, bad.join(',') || 'all 11');
});
await tryGate('1d clearance rule', () => {
  const rows = (FP.FEATURED_DESTINATIONS || []).map((d) => `${d.id} ${d.altM}>=${d.clearM}+400`);
  const bad = (FP.FEATURED_DESTINATIONS || []).filter((d) => !(d.altM >= d.clearM + 400 && d.clearM >= d.groundM));
  gate('1d altM >= clearM + 400 and clearM >= groundM', bad.length === 0 && rows.length === 11, bad.map((d) => d.id).join(',') || `${rows.length} ok`);
});
await tryGate('1e anchors', () => {
  const out = [];
  let ok = (FP.FEATURED_DESTINATIONS || []).length === 11;
  for (const d of FP.FEATURED_DESTINATIONS || []) {
    const a = ANCHOR[d.id];
    const k = a ? km(d.lat, d.lon, a.at[0], a.at[1]) : Infinity;
    if (!(k <= a?.maxKm)) ok = false;
    out.push(`${d.id} ${k.toFixed(2)}km`);
  }
  gate('1e every start within its named landmark radius', ok, out.join(' · '));
});
await tryGate('1f tall structures', () => {
  const hits = [];
  let ok = (FP.FEATURED_DESTINATIONS || []).length === 11;
  for (const d of FP.FEATURED_DESTINATIONS || []) {
    for (const [name, la, lo, h] of TALL) {
      const k = km(d.lat, d.lon, la, lo);
      if (k <= 5) {
        hits.push(`${d.id}:${name} ${h}m@${k.toFixed(1)}km`);
        if (h > d.clearM) ok = false;
      }
    }
  }
  gate('1f every named summit/tower within 5 km is <= clearM', ok, hits.join(' · '));
});
await tryGate('1g columbus practice is the glider spot', () => {
  const d = FP.FEATURED_DESTINATIONS.find((x) => x.id === 'columbus-practice');
  const a = airportById('KOSU').a;
  gate(
    '1g columbus-practice = KOSU 09R threshold, ~600 m above the field (today\'s glider practice)',
    !!d && km(d.lat, d.lon, a.lat, a.lon) < 0.05 && Math.abs(d.altM - (a.elevation + 600)) < 5 && d.headingDeg === 0,
    d ? `${km(d.lat, d.lon, a.lat, a.lon).toFixed(3)} km, alt ${d.altM} vs ${(a.elevation + 600).toFixed(1)}` : 'missing'
  );
});

// ===========================================================================
section('2 search parity with the r25-w0 Atlas');
const W0_ATLAS = git('show', 'r25-w0:components/fly/hud/Atlas.jsx');
const rankBody = W0_ATLAS.slice(
  W0_ATLAS.indexOf('const results = useMemo(() => {') + 'const results = useMemo(() => {'.length,
  W0_ATLAS.indexOf('}, [entries, query]);')
);
const warpBody = W0_ATLAS.slice(W0_ATLAS.indexOf('function warpOptsFor(entry) {') + 'function warpOptsFor(entry) {'.length, W0_ATLAS.indexOf('\n}\n', W0_ATLAS.indexOf('function warpOptsFor(entry) {')));
const oldRank = new Function('entries', 'query', 'MAX_RESULTS', rankBody);
const oldWarp = new Function('entry', warpBody);
const ENTRIES = buildAtlasList();
const QUERIES = [
  'a', 'an', 'new', 'new york', 'york', 'san', 'san f', 'par', 'paris', 'lon',
  'london', 'tok', 'tokyo', 'ber', 'jfk', 'kjfk', 'lax', 'ord', 'egll', 'base',
  'afb', 'air force', 'naval', 'spotting', 'bridge', 'tower', 'statue', 'grand', 'canyon', 'mount',
  'mt', 'lake', 'city', 'port', 'saint', 'st', 'ohio', 'columbus', 'dublin', 'oh',
  'denver', 'den', 'sea', 'seattle', 'rio', 'sydney', 'dubai', 'x', 'zz', '  paris  ',
  'PARIS', 'Tokyo', 'münchen', 'munich', 'são', 'sao', 'quebec', 'reykjavik', 'ab', '',
];
gate('2a the reference is the r25-w0 inline code (read from the tag, 60 queries)', rankBody.includes('hits.sort(') && warpBody.includes('Math.random()') && QUERIES.length === 60, `${QUERIES.length} queries, ${ENTRIES.length} entries`);
await tryGate('2b rankAtlasEntries parity', () => {
  if (SRCH.__missing) throw new Error(SRCH.__missing);
  const diffs = [];
  let nonEmpty = 0;
  for (const q of QUERIES) {
    const a = oldRank(ENTRIES, q, 9).map((e) => e.key);
    const b = SRCH.rankAtlasEntries(ENTRIES, q, 9).map((e) => e.key);
    if (a.length) nonEmpty++;
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(q);
  }
  gate('2b rankAtlasEntries === old Atlas ranking over 60 queries', diffs.length === 0 && nonEmpty >= 50, diffs.length ? `diff: ${diffs.join('|')}` : `${nonEmpty} non-empty lists identical`);
});
await tryGate('2c warpOptsFor parity', () => {
  if (SRCH.__missing) throw new Error(SRCH.__missing);
  const real = Math.random;
  const bad = [];
  try {
    for (const kind of ['city', 'airport', 'military', 'hotspot', 'landmark']) {
      for (const r of [0, 0.25, 0.9]) {
        Math.random = () => r;
        const a = JSON.stringify(oldWarp({ kind }));
        Math.random = real;
        const b = JSON.stringify(SRCH.warpOptsFor({ kind }, () => r));
        Math.random = () => r;
        const c = JSON.stringify(SRCH.warpOptsFor({ kind })); // default rand = Math.random (the Atlas call)
        if (a !== b || a !== c) bad.push(`${kind}@${r}`);
      }
    }
  } finally {
    Math.random = real;
  }
  gate('2c warpOptsFor === old (injected rand and the Atlas default)', bad.length === 0, bad.join(',') || '15 cases');
});
await tryGate('2d Atlas imports the moved functions', () => {
  const src = RED ? W0_ATLAS : require_('components/fly/hud/Atlas.jsx');
  const ok =
    /import \{ rankAtlasEntries, warpOptsFor \} from '@\/lib\/fly\/poi\/search';/.test(src) &&
    !/function warpOptsFor\(/.test(src) &&
    !/hits\.sort\(/.test(src) &&
    /rankAtlasEntries\(entries, query, MAX_RESULTS\)/.test(src) &&
    /\.\.\.warpOptsFor\(entry\)/.test(src);
  gate('2d Atlas.jsx imports rankAtlasEntries/warpOptsFor and keeps its call shapes', ok);
});
function require_(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

// ===========================================================================
section('3 searchDestinations');
await tryGate('3a', () => {
  const r = FP.searchDestinations('grand', 6);
  gate('3a featured first ("grand" → Grand Canyon at #0), <= 6', r.length > 0 && r.length <= 6 && r[0]?.id === 'grand-canyon', r.map((d) => d.id).join(','));
});
await tryGate('3b', () => {
  const r = FP.searchDestinations('napali', 6);
  gate('3b accent folding ("napali" finds Nāpali Coast)', r[0]?.id === 'napali', r.map((d) => d.name).join(','));
});
await tryGate('3c', () => {
  const r = FP.searchDestinations('manhattan', 6);
  const names = r.map((d) => d.name.toLowerCase());
  gate('3c duplicate names collapse onto the featured entry', r[0]?.id === 'manhattan' && names.filter((n) => n === 'manhattan').length === 1, names.join(','));
});
await tryGate('3d', () => {
  const r = FP.searchDestinations('denver', 6);
  const d = r.find((x) => x.name === 'Denver');
  const c = ENTRIES.find((e) => e.key === 'city:Denver');
  const k = d && c ? km(d.lat, d.lon, c.lat, c.lon) : NaN;
  const ok =
    !!d &&
    d.id === 'poi:city:Denver' &&
    Math.abs(k - C.FLIGHT_PLAN.freeFlight.cityOffsetM / 1000) < 0.05 &&
    d.lat < c.lat &&
    Math.abs(d.headingDeg) < 1e-9 &&
    d.altM === C.FLIGHT_PLAN.freeFlight.fallbackAltMslM &&
    Object.isFrozen(d);
  gate('3d a searched city starts cityOffsetM south of it, nose north (sun behind), at fallbackAltMslM', ok, d ? `${k.toFixed(3)} km, hdg ${d.headingDeg}, alt ${d.altM}` : 'no Denver');
});
await tryGate('3e', () => {
  const sub = ENTRIES.find((e) => e.kind === 'city' && e.lat < -20);
  const d = FP.searchDestinations(sub.name.toLowerCase(), 6).find((x) => x.poiKey === sub.key);
  gate('3e southern hemisphere: start north of the city, nose south', !!d && d.lat > sub.lat && Math.abs(d.headingDeg - 180) < 1e-9, d ? `${sub.name} hdg ${d.headingDeg}` : `no ${sub?.name}`);
});
await tryGate('3f', () => {
  const m = ENTRIES.find((e) => e.kind === 'military');
  const a = FP.resolveDestination(m);
  const b = FP.resolveDestination(m);
  const k = km(a.lat, a.lon, m.lat, m.lon);
  gate('3f military: 4 km out at 1,200 m, deterministic bearing, nose on the field', a.lat === b.lat && a.lon === b.lon && a.altM === 1200 && Math.abs(k - 4) < 0.05, `${m.name} ${k.toFixed(3)} km hdg ${a.headingDeg.toFixed(1)}`);
});
await tryGate('3g', () => {
  const all = QUERIES.flatMap((q) => FP.searchDestinations(q, 6));
  const bad = all.filter((d) => !FP.resolveDestination(d) || d.altM < 100 || !Number.isFinite(d.lat));
  gate('3g every result over the 60 queries is <= 6 and resolvable', QUERIES.every((q) => FP.searchDestinations(q, 6).length <= 6) && bad.length === 0 && all.length > 100, `${all.length} results`);
});

// ===========================================================================
section('4 last setup (fly-last-setup-v1)');
const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const KEY = C.FLIGHT_PLAN.lastSetupKey;
await tryGate('4a flag off', () => {
  setPlan(false);
  const st = mem();
  FP.saveLastSetup({ flightMode: 'free', aircraftId: 'prop', dest: 'grand-canyon' }, st);
  const wrote = st.m.size > 0;
  st.setItem(KEY, JSON.stringify({ v: 1, flightMode: 'free', aircraftId: 'prop', dest: { id: 'grand-canyon' } }));
  const read = FP.readLastSetup(st);
  const kosu = airportById('KOSU').a;
  const spawn = FP.resolveInitialSpawn({ title: true, now: Date.UTC(2026, 5, 21, 18), style: 'satellite', storage: st });
  gate(
    '4a FLIGHT_PLAN off: no write, null read (Continue hidden), spawn = the W0 KOSU literal',
    !wrote && read === null && JSON.stringify(spawn) === JSON.stringify({ lat: kosu.lat, lon: kosu.lon }),
    JSON.stringify(spawn)
  );
});
setPlan(true);
const ROUND = [
  ['free featured', { flightMode: 'free', aircraftId: 'glider', dest: 'grand-canyon' }],
  ['free searched', { flightMode: 'free', aircraftId: 'airliner', dest: FP.searchDestinations?.('denver', 6)?.find?.((d) => d.name === 'Denver') ?? null }],
  ['ops runway', { flightMode: 'ops', aircraftId: 'fighter', airportId: 'KCMH', start: 'runway' }],
  ['ops apron prop KOSU', { flightMode: 'ops', aircraftId: 'prop', airportId: 'KOSU', start: 'apron' }],
  ['glider practice', { flightMode: 'ops', aircraftId: 'glider', start: 'practice' }],
];
for (const [name, setup] of ROUND) {
  await tryGate(`4b ${name}`, () => {
    const st = mem();
    const wrote = FP.saveLastSetup(setup, st, 1234);
    const back = FP.readLastSetup(st);
    const want = FP.normalizeSetup(setup);
    const same =
      !!back &&
      !!want &&
      back.flightMode === want.flightMode &&
      back.aircraftId === want.aircraftId &&
      back.at === 1234 &&
      (want.flightMode === 'free'
        ? ['id', 'lat', 'lon', 'altM', 'headingDeg', 'name'].every((k) => back.dest[k] === want.dest[k])
        : back.airportId === want.airportId && back.start === want.start);
    gate(`4b round trip: ${name}`, wrote === true && same, back ? FP.describeSetup(back) : 'null');
  });
}
const CORRUPT = [
  ['not JSON', '{nope'],
  ['JSON array', '[]'],
  ['JSON null', 'null'],
  ['wrong version', JSON.stringify({ v: 2, flightMode: 'free', aircraftId: 'prop', dest: { id: 'grand-canyon' } })],
  ['unknown aircraft', JSON.stringify({ v: 1, flightMode: 'free', aircraftId: 'blimp', dest: { id: 'grand-canyon' } })],
  ['unknown mode', JSON.stringify({ v: 1, flightMode: 'hover', aircraftId: 'prop' })],
  ['ineligible: cargo at KOSU', JSON.stringify({ v: 1, flightMode: 'ops', aircraftId: 'cargo', airportId: 'KOSU', start: 'apron' })],
  ['ineligible: glider on a runway', JSON.stringify({ v: 1, flightMode: 'ops', aircraftId: 'glider', airportId: 'KOSU', start: 'runway' })],
  ['unknown airport', JSON.stringify({ v: 1, flightMode: 'ops', aircraftId: 'fighter', airportId: 'KJFK', start: 'apron' })],
  ['unknown start', JSON.stringify({ v: 1, flightMode: 'ops', aircraftId: 'fighter', airportId: 'KCMH', start: 'gate' })],
  ['free without dest', JSON.stringify({ v: 1, flightMode: 'free', aircraftId: 'prop' })],
  ['unknown featured id', JSON.stringify({ v: 1, flightMode: 'free', aircraftId: 'prop', dest: { id: 'atlantis' } })],
  ['searched dest at 89°N', JSON.stringify({ v: 1, flightMode: 'free', aircraftId: 'prop', dest: { id: 'poi:city:X', name: 'X', lat: 89, lon: 0, altM: 800, headingDeg: 0 } })],
  ['searched dest altM NaN', '{"v":1,"flightMode":"free","aircraftId":"prop","dest":{"id":"poi:city:X","name":"X","lat":10,"lon":0,"altM":"800","headingDeg":0}}'],
  ['searched dest name too long', JSON.stringify({ v: 1, flightMode: 'free', aircraftId: 'prop', dest: { id: 'poi:city:X', name: 'X'.repeat(200), lat: 10, lon: 0, altM: 800, headingDeg: 0 } })],
  ['oversized blob', JSON.stringify({ v: 1, flightMode: 'free', aircraftId: 'prop', dest: { id: 'grand-canyon' }, pad: 'x'.repeat(5000) })],
];
await tryGate('4c corrupt', () => {
  const leaked = [];
  for (const [name, raw] of CORRUPT) {
    const st = mem();
    st.setItem(KEY, raw);
    if (FP.readLastSetup(st) !== null) leaked.push(name);
  }
  const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
  const blocked = FP.readLastSetup(throwing) === null && FP.saveLastSetup({ flightMode: 'free', aircraftId: 'prop', dest: 'rio' }, throwing) === false;
  // the positive control for the whole list: a valid row DOES read back
  const st = mem();
  st.setItem(KEY, JSON.stringify({ v: 1, flightMode: 'free', aircraftId: 'prop', dest: { id: 'grand-canyon' } }));
  const control = FP.readLastSetup(st)?.dest?.id === 'grand-canyon';
  gate(`4c ${CORRUPT.length} corrupt/ineligible rows read null (Continue hidden); blocked storage never throws; valid control reads`, leaked.length === 0 && blocked && control && CORRUPT.length === 16, leaked.join(',') || `control ${control}`);
});
await tryGate('4d describe', () => {
  const a = FP.describeSetup({ flightMode: 'free', aircraftId: 'glider', dest: 'grand-canyon' });
  const b = FP.describeSetup({ flightMode: 'ops', aircraftId: 'fighter', airportId: 'KCMH', start: 'runway' });
  const c = FP.describeSetup({ flightMode: 'ops', aircraftId: 'glider', start: 'practice' });
  const d = FP.describeSetup({ flightMode: 'ops', aircraftId: 'cargo', airportId: 'KOSU', start: 'apron' });
  gate('4d describeSetup labels (and null for an ineligible setup)', a === `${aircraftName('glider')} · Free Flight over Grand Canyon` && b === 'Vector · KCMH · Runway' && /Glider practice/.test(c) && d === null, `${a} | ${b} | ${c}`);
});
await tryGate('4e featured rehydrate', () => {
  const st = mem();
  FP.saveLastSetup({ flightMode: 'free', aircraftId: 'prop', dest: 'yosemite' }, st);
  const raw = JSON.parse(st.getItem(KEY));
  gate('4e featured destinations persist by id only (rehydrated from the catalog)', JSON.stringify(raw.dest) === '{"id":"yosemite"}' && FP.readLastSetup(st).dest === FP.FEATURED_DESTINATIONS.find((d) => d.id === 'yosemite'), JSON.stringify(raw.dest));
});

// ===========================================================================
section('5 title spot under a pinned clock');
await tryGate('5a daylight picks', () => {
  const rows = [];
  let ok = true;
  let differing = new Set();
  for (let h = 0; h < 24; h += 1) {
    const now = Date.UTC(2026, 8, 23, h, 0, 0);
    const d = FP.pickTitleSpot({ now, style: 'satellite' });
    const el = Math.asin(computeSun(d.lon, d.lat, now).sinEl) / DEG;
    const inBand = el >= C.FLIGHT_PLAN.titleSpot.minSunElDeg && el <= 50;
    const anyInBand = FP.FEATURED_DESTINATIONS.some((x) => {
      if (x.id === 'columbus-practice') return false;
      const e = Math.asin(computeSun(x.lon, x.lat, now).sinEl) / DEG;
      return e >= C.FLIGHT_PLAN.titleSpot.minSunElDeg && e <= 50;
    });
    if (anyInBand ? !inBand : d.id !== 'grand-canyon') ok = false;
    differing.add(d.id);
    rows.push(`${h}Z:${d.id}@${el.toFixed(0)}°`);
  }
  gate('5a every UTC hour on 2026-09-23 picks a spot with the sun in [minSunElDeg, 50]° (else the fallback)', ok && differing.size >= 4, rows.join(' '));
});
await tryGate('5b golden hour', () => {
  // Find an hour where two spots are in band and exactly one is golden (<= 18°).
  let found = null;
  for (let m = 0; m < 24 * 60 && !found; m += 20) {
    const now = Date.UTC(2026, 8, 23, 0, m);
    const els = FP.FEATURED_DESTINATIONS.filter((x) => x.id !== 'columbus-practice').map((x) => [x, Math.asin(computeSun(x.lon, x.lat, now).sinEl) / DEG]);
    const band = els.filter(([, e]) => e >= 8 && e <= 50);
    const golden = band.filter(([, e]) => e <= 18);
    const mid = band.filter(([, e]) => e > 18);
    if (golden.length && mid.length) found = { now, golden, pick: FP.pickTitleSpot({ now, style: 'satellite' }) };
  }
  gate('5b golden-hour bonus: a golden spot beats a mid-day one', !!found && found.golden.some(([x]) => x === found.pick), found ? `${new Date(found.now).toISOString()} → ${found.pick.id}` : 'no mixed hour found');
});
await tryGate('5c fallback + toy', () => {
  const pd = C.FLIGHT_PLAN.titleSpot.preferDaylight;
  C.FLIGHT_PLAN.titleSpot.preferDaylight = false;
  const fb = FP.pickTitleSpot({ now: Date.UTC(2026, 8, 23, 12), style: 'satellite' }).id;
  C.FLIGHT_PLAN.titleSpot.preferDaylight = pd;
  const toy = FP.pickTitleSpot({ now: Date.UTC(2026, 8, 23, 3), style: 'toy' }).id;
  gate('5c preferDaylight off → grand-canyon; toy → manhattan', fb === 'grand-canyon' && toy === 'manhattan', `${fb} / ${toy}`);
});
await tryGate('5d spawn precedence', () => {
  const kosu = airportById('KOSU').a;
  const lit = JSON.stringify({ lat: kosu.lat, lon: kosu.lon });
  const st = mem();
  const noTitle = JSON.stringify(FP.resolveInitialSpawn({ title: false, storage: st }));
  // no env.title: the real resolver — W0/flag-off front door ⇒ 'hangar' ⇒ KOSU; the bypass pin ⇒ KOSU
  window.__flyTitleBypass = true;
  const bypass = JSON.stringify(FP.resolveInitialSpawn({ storage: st }));
  delete window.__flyTitleBypass;
  const fresh = FP.resolveInitialSpawn({ title: true, storage: st, now: Date.UTC(2026, 8, 23, 18), style: 'satellite' });
  const want = FP.pickTitleSpot({ now: Date.UTC(2026, 8, 23, 18), style: 'satellite' });
  const toy = FP.resolveInitialSpawn({ title: true, storage: st, now: Date.UTC(2026, 8, 23, 18), style: 'toy' });
  FP.saveLastSetup({ flightMode: 'free', aircraftId: 'prop', dest: 'sydney' }, st);
  const last = FP.resolveInitialSpawn({ title: true, storage: st, now: Date.UTC(2026, 8, 23, 18), style: 'toy' });
  const opsSt = mem();
  FP.saveLastSetup({ flightMode: 'ops', aircraftId: 'fighter', airportId: 'KLCK', start: 'approach' }, opsSt);
  const ops = FP.resolveInitialSpawn({ title: true, storage: opsSt });
  const klck = airportById('KLCK').a;
  const ok =
    noTitle === lit &&
    bypass === lit &&
    fresh.dest === want &&
    fresh.altM === want.altM &&
    fresh.title.radiusM === want.title.radiusM &&
    toy.destId === 'manhattan' &&
    last.destId === 'sydney' &&
    ops.lat === klck.lat &&
    ops.lon === klck.lon &&
    ops.altM === undefined;
  gate('5d spawn: no title / bypass → KOSU literal; last setup (even in toy) → its spot; else daylight spot (+title params); toy → Manhattan; ops → airport', ok, `fresh ${fresh.destId}, toy ${toy.destId}, last ${last.destId}, ops ${ops.destId}`);
});

// ===========================================================================
section('6 placement math, all 9 aircraft');
await tryGate('6a placement', () => {
  const minAgl = C.FLIGHT_PLAN.freeFlight.minAglM;
  const bad = [];
  let n = 0;
  for (const a of PLAYER_AIRCRAFT) {
    const cfg = resolveAircraft(a.id).cfg;
    for (const d of FP.FEATURED_DESTINATIONS) {
      for (const g of [d.groundM, d.altM + 100, null]) {
        const p = FP.freeFlightPlacement(d, g, cfg);
        const gEff = g ?? d.groundM;
        const want = Math.max(d.altM, gEff + minAgl);
        n++;
        if (
          p.altM !== want ||
          p.altM - gEff < minAgl ||
          p.lat !== d.lat ||
          p.lon !== d.lon ||
          Math.abs(p.headingRad - d.headingDeg * DEG) > 1e-12 ||
          p.speed !== cfg.speeds.cruise ||
          !(cfg.speeds.cruise > cfg.speeds.slow)
        )
          bad.push(`${a.id}@${d.id}/${g}`);
      }
    }
  }
  gate('6a altitude max(altM, ground+minAglM), heading, cruise inside the envelope — 9 aircraft x 11 destinations x 3 grounds', bad.length === 0 && n === 9 * 11 * 3, bad.slice(0, 5).join(',') || `${n} placements`);
});

// ===========================================================================
section('7 runtime services (real FlightOperations + FlightModel)');
const { FlightOperations } = await imp('lib/fly/flight-operations.js');
const { FlightModel } = await imp('lib/fly/flight-model.js');
const THREE = await import('three');
const OR = await imp('lib/fly/operations-runtime.js', RED);
const R = 6378137;
function makeWorld({ elev = null } = {}) {
  const warps = [];
  const store = useFlyStore.getState();
  const engine = {
    object: null,
    map: new THREE.EventDispatcher(),
    _anchor: new THREE.Vector3(),
    geoToWorld: (lon, lat, alt = 0) => {
      const p = projectAirportPoint(lon, lat);
      return new THREE.Vector3(p.x, alt, p.z);
    },
    worldToGeo: (v) => new THREE.Vector3((v.x / R) / DEG, (2 * Math.atan(Math.exp(-v.z / R)) - Math.PI / 2) / DEG, v.y),
    getElevationAt: () => elev,
    notifyWarp() {},
  };
  const flight = new FlightModel(resolveAircraft('fighter').cfg);
  const operations = new FlightOperations();
  const runtime = {};
  const counts = { snap: 0, disarm: 0, neutral: 0, rebase: 0 };
  runtime.warpToGeo = (lat, lon, opts = {}) => {
    warps.push({ lat, lon, ...opts });
    if (!opts.stage) return false;
    flight.pos.copy(engine.geoToWorld(lon, lat, opts.altM ?? 800));
    return true;
  };
  const off = OR.connectFlightOperations({
    runtime,
    operations,
    flight,
    input: { neutralize: () => counts.neutral++, speedPreset: null },
    autopilot: { disengage() {} },
    chase: { snap: () => counts.snap++ },
    engine,
    rebase: () => counts.rebase++,
    crashSys: { disarm: () => counts.disarm++ },
    crashRef: { current: { state: 'crashing' } },
  });
  void store;
  return { runtime, operations, flight, engine, warps, counts, off };
}
await tryGate('7a launchFreeFlight', () => {
  const bad = [];
  let n = 0;
  for (const a of PLAYER_AIRCRAFT) {
    for (const d of FP.FEATURED_DESTINATIONS) {
      n++;
      const w = makeWorld({ elev: d.groundM });
      const epoch = useFlyStore.getState().warpEpoch;
      const ok = w.runtime.launchFreeFlight(a.id, d.id);
      const g = w.engine.worldToGeo(w.flight.pos);
      const p = FP.freeFlightPlacement(d, d.groundM, resolveAircraft(a.id).cfg);
      const good =
        ok === true &&
        w.operations.phase === 'airborne' &&
        w.operations.profile === null &&
        !w.operations.grounded &&
        Math.abs(g.y - d.lat) < 1e-6 &&
        Math.abs(g.x - d.lon) < 1e-6 &&
        Math.abs(w.flight.pos.y - p.altM) < 1e-9 &&
        Math.abs(w.flight.heading - p.headingRad) < 1e-12 &&
        w.flight.speed === resolveAircraft(a.id).cfg.speeds.cruise &&
        w.flight.cfg === resolveAircraft(a.id).cfg &&
        useFlyStore.getState().aircraftId === a.id &&
        useFlyStore.getState().warpEpoch === epoch + 1 &&
        useFlyStore.getState().warpKind === 'far' &&
        w.counts.disarm === 1 &&
        w.runtime.titleSpot === d.title &&
        (w.flight._trimT > 0 || !C.WARP_TRIM?.enabled);
      if (!good) bad.push(`${a.id}@${d.id}`);
      w.off();
    }
  }
  gate('7a launchFreeFlight: 9 aircraft x 11 destinations land airborne at the placement, cruise, far-warp hold, crash disarmed, trim armed', bad.length === 0 && n === 99, bad.slice(0, 6).join(',') || `${n} launches`);
});
await tryGate('7b launchFreeFlight rejects', () => {
  const w = makeWorld();
  const r = [w.runtime.launchFreeFlight('prop', 'atlantis'), w.runtime.launchFreeFlight('prop', 'KCMH'), w.runtime.launchFreeFlight('prop', null)];
  gate('7b unknown / ops-airport / null destinations are refused', r.every((x) => x === false) && w.operations.phase === 'hangar', r.join(','));
  w.off();
});
await tryGate('7c staging', async () => {
  setPlan(true);
  const doorWas = C.FRONT_DOOR.enabled;
  C.FRONT_DOOR.enabled = false;
  globalThis.__r25bInvalidations = 0;
  const w = makeWorld({ elev: 12 });
  useFlyStore.getState().setHangarOpen(true);
  const styleWas = useFlyStore.getState().mapStyle;
  useFlyStore.setState({ mapStyle: 'satellite' }); // worldReadiness path (+ its 600 ms settle)
  const kosu = FP.resolveDestination('columbus-practice');
  w.flight.pos.copy(w.engine.geoToWorld(kosu.lon, kosu.lat, 800));
  const here = w.runtime.stageDestination('columbus-practice');
  const noWarp = w.warps.length === 0 && w.runtime.staging?.key === 'columbus-practice' && w.runtime.staging.warped === false;
  const far = w.runtime.stageDestination('manhattan');
  const warp = w.warps.at(-1);
  const staged = far && warp?.stage === true && Math.abs(warp.lat - 40.7) < 1e-9 && w.runtime.staging.key === 'manhattan' && w.runtime.staging.warped === true && w.operations.phase === 'hangar';
  const again = w.runtime.stageDestination('manhattan') && w.warps.length === 1 && w.runtime.titleSpot === FP.resolveDestination('manhattan').title;
  // readiness: not ready (no terrain stats) → the FRONT_DOOR-off pump runs at 4 Hz
  await new Promise((r) => setTimeout(r, 620));
  const pumpedOff = globalThis.__r25bInvalidations;
  // mark the world ready the way worldReadiness reads it → the poll latches ready and stops
  Object.assign(w.runtime, {
    terraStats: { sharp: true, camTileZ: 16, targetZ: 16 },
    earthSurface: { near: { ready: true }, materials: { state: 'ready' }, forest: { nearPending: 0, sourceCommit: 1 }, commits: 1, airports: { nearPending: 0 } },
    flight: { pos: { y: 6000 }, latDeg: 40.7 },
    groundElevVis: 0,
    modelsReady: true,
    liveFleetReady: true,
    prewarm: { done: true },
  });
  const notYet = w.runtime.staging.ready === false; // 600 ms continuous readiness first
  await new Promise((r) => setTimeout(r, 1200));
  const ready = notYet && w.runtime.staging.ready === true && Number.isFinite(w.runtime.staging.readyMs);
  const readyMs = w.runtime.staging.readyMs;
  const polls = w.runtime.staging.polls;
  await new Promise((r) => setTimeout(r, 300));
  const stopped = w.runtime.staging.polls === polls;
  // FRONT_DOOR on: A's <StagePump> owns the frames — B's poll never invalidates
  C.FRONT_DOOR.enabled = true;
  globalThis.__r25bInvalidations = 0;
  delete w.runtime.terraStats;
  w.runtime.stageDestination('tokyo');
  await new Promise((r) => setTimeout(r, 620));
  const pumpedOn = globalThis.__r25bInvalidations;
  C.FRONT_DOOR.enabled = doorWas;
  // flag off: staging refused outright
  setPlan(false);
  const refused = w.runtime.stageDestination('rio') === false;
  setPlan(true);
  // ops airport: only when genuinely far (the Columbus cluster never stage-warps)
  w.flight.pos.copy(w.engine.geoToWorld(kosu.lon, kosu.lat, 800));
  const n = w.warps.length;
  const opsNear = w.runtime.stageDestination('KCMH') === false && w.warps.length === n;
  w.off();
  useFlyStore.setState({ mapStyle: styleWas });
  gate('7c stage: already-there → poll only; far → warpToGeo{stage:true}, frozen in hangar; idempotent; title orbit params follow the staged spot', noWarp && here && staged && again, `here ${here}/${noWarp}, far ${staged}`);
  gate('7d readiness poll latches ready and stops; FRONT_DOOR off pumps frames (4 Hz), on never does', ready && stopped && pumpedOff >= 2 && pumpedOn === 0, `readyMs ${readyMs}, pumps off=${pumpedOff} on=${pumpedOn}`);
  gate('7e FLIGHT_PLAN off refuses staging; ops airports inside the Columbus cluster never stage-warp', refused && opsNear);
});
await tryGate('7f launchSetup', () => {
  setPlan(true);
  const store = globalThis.localStorage;
  const ls = mem();
  globalThis.localStorage = ls;
  window.localStorage = ls;
  try {
    const w = makeWorld({ elev: 10 });
    useFlyStore.getState().setScreen('title');
    const free = w.runtime.launchSetup({ flightMode: 'free', aircraftId: 'bizjet', dest: 'dubai' });
    const s1 = useFlyStore.getState();
    const ac1 = ls.getItem('fly-aircraft');
    const poseA = [w.flight.pos.x, w.flight.pos.y, w.flight.pos.z, w.flight.heading];
    const saved = FP.readLastSetup(ls);
    // Continue: relaunch exactly what was saved from another pose
    w.flight.pos.set(0, 0, 0);
    w.flight.heading = 2;
    useFlyStore.getState().setScreen('title');
    const again = w.runtime.launchSetup(saved);
    const poseB = [w.flight.pos.x, w.flight.pos.y, w.flight.pos.z, w.flight.heading];
    const exact = poseA.every((v, i) => v === poseB[i]);
    const ops = w.runtime.launchSetup({ flightMode: 'ops', aircraftId: 'fighter', airportId: 'KCMH', start: 'runway' });
    const opsOk = ops && w.operations.profile?.id === 'fighter' && w.operations.airport?.id === 'KCMH' && w.operations.phase === 'parked' && ls.getItem('fly-departure') === 'KCMH';
    const opsSaved = FP.readLastSetup(ls);
    const bad = w.runtime.launchSetup({ flightMode: 'ops', aircraftId: 'cargo', airportId: 'KOSU', start: 'apron' });
    const glider = w.runtime.launchSetup({ flightMode: 'ops', aircraftId: 'glider', start: 'practice' });
    const p = airportPoint(airportById('KOSU'), 0);
    const gliderOk = glider && Math.abs(w.flight.pos.y - (p.y + 600)) < 1e-9 && w.flight.heading === 0 && w.operations.phase === 'airborne';
    w.off();
    const why = { free, again, exact, screen: s1.screen, hangarOpen: s1.hangarOpen, mode: s1.flightMode, saved: saved?.dest?.id, ac: ac1 };
    gate('7f launchSetup: free → airborne, menus closed (screen flight, hangarOpen false), saved; Continue relaunches the exact pose', free && again && exact && s1.screen === 'flight' && s1.hangarOpen === false && s1.flightMode === 'free' && saved?.dest?.id === 'dubai' && ac1 === 'bizjet', JSON.stringify(why));
    gate('7g launchSetup: ops runway at KCMH lines up and persists; ineligible refused; glider practice = launchGlider (KOSU +600 m, hdg 0)', opsOk && opsSaved?.airportId === 'KCMH' && opsSaved.start === 'runway' && bad === false && gliderOk);
  } finally {
    globalThis.localStorage = store;
    window.localStorage = store;
  }
});
await tryGate('7h launchGlider unchanged', () => {
  // Git blobs use LF; Windows working trees may use CRLF. Compare code, not checkout policy.
  const src = require_('lib/fly/operations-runtime.js').replace(/\r\n/g, '\n');
  const w0 = git('show', 'r25-w0:lib/fly/operations-runtime.js');
  const body = (t) => t.slice(t.indexOf('runtime.launchGlider = () => {'), t.indexOf('};', t.indexOf('runtime.launchGlider = () => {')) + 2);
  // code lines only: B rewrote the comment above launchGlider, not a statement
  const beginDep = (t) => t.slice(t.indexOf('const sync = () => {'), t.indexOf('runtime.launchGlider')).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  gate('7h sync / beginDeparture / retry / lineUp / launchGlider bodies are the r25-w0 text byte-for-byte', body(src) === body(w0) && beginDep(src) === beginDep(w0) && body(src).length > 100);
});

// ===========================================================================
section('8 hangar markup (react-dom/server)');
const React = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
// zustand's SSR snapshot is api.getInitialState() — the ORIGINAL state object
// (a reference, never replaced by setState). The render below writes the arm's
// fields into it, and into the live state for getState() readers.
const W0H = await imp('components/fly/hud/GroundHangar.jsx', true);
const NEWH = await imp('components/fly/hud/GroundHangar.jsx', RED);
const kosuGeo = airportById('KOSU').a;
const render = (Mod, mode) => {
  const arm = { flightMode: mode, hangarOpen: true, screen: 'hangar', spawn: null };
  Object.assign(useFlyStore.getInitialState(), arm);
  useFlyStore.setState(arm);
  const runtime = { geo: { x: kosuGeo.lon, y: kosuGeo.lat } };
  return renderToStaticMarkup(React.createElement(Mod.GroundHangar, { runtime }));
};
await tryGate('8a flag-off identity', () => {
  setPlan(false);
  const w0ops = render(W0H, 'ops');
  const newOps = render(NEWH, 'ops');
  const w0free = render(W0H, 'free');
  const newFree = render(NEWH, 'free');
  gate('8a FLIGHT_PLAN off: hangar markup byte-identical to r25-w0 (ops, and with flightMode forced free)', w0ops === newOps && w0free === newFree && w0ops.length > 2000, `${w0ops.length} / ${newOps.length} chars`);
});
await tryGate('8b on + ops', () => {
  setPlan(true);
  const doorWas = C.FRONT_DOOR.enabled;
  C.FRONT_DOOR.enabled = false;
  const w0ops = render(W0H, 'ops');
  const on = render(NEWH, 'ops');
  const chip = '<span class="ops-mode-chip" data-testid="hangar-mode" data-mode="ops">Takeoff &amp; Landing</span>';
  C.FRONT_DOOR.enabled = true;
  const withDoor = render(NEWH, 'ops');
  C.FRONT_DOOR.enabled = doorWas;
  const back = /<button type="button" class="ops-hangar-back" data-testid="hangar-back">.*?Title<\/button>/.exec(withDoor)?.[0] ?? '';
  gate('8b FLIGHT_PLAN on, ops mode: today\'s panel + only the mode chip (and "‹ Title" only with FRONT_DOOR on)', on.replace(chip, '') === w0ops && on.includes(chip) && !on.includes('hangar-back') && back && withDoor.replace(back, '') === on, `chip ${on.includes(chip)}, back ${!!back}`);
});
await tryGate('8c on + free', () => {
  setPlan(true);
  const html = render(NEWH, 'free');
  const need = ['data-testid="hangar-dest-search"', 'id="free-flight-search"', 'data-testid="hangar-dest-selected"', 'data-testid="hangar-stage-status"', 'data-state="', 'data-testid="hangar-mode" data-mode="free"', 'data-testid="hangar-fly"', ...IDS.map((id) => `data-testid="hangar-dest-${id}"`)];
  const missing = need.filter((t) => !html.includes(t));
  const sel = /data-testid="hangar-dest-selected" data-dest="([^"]+)"/.exec(html)?.[1];
  const opsGone = !html.includes('id="departure-airport"');
  gate('8c FLIGHT_PLAN on, free mode: search, 11 featured cards, selection, stage status, mode chip, Fly; default = the spot the flight is at', missing.length === 0 && sel === 'columbus-practice' && opsGone, missing.join(',') || `default ${sel}`);
});
await tryGate('8d Fly label + results', () => {
  if (typeof NEWH.FreeDispatch !== 'function') throw new Error('FreeDispatch not exported');
  const dest = FP.resolveDestination('grand-canyon');
  const results = FP.searchDestinations('par', 6);
  const html = renderToStaticMarkup(
    React.createElement(NEWH.FreeDispatch, { dest, query: 'par', setQuery() {}, results, cursor: 0, onSearchKey() {}, choose() {}, stage: { state: 'staging', pct: 40 }, ready: true, live: true, failed: false, retryPreview() {}, start() {} })
  );
  const n = (html.match(/data-testid="hangar-dest-result-\d"/g) || []).length;
  gate('8d hangar-fly reads "Fly to {name}"; <= 6 results as hangar-dest-result-{n}; stage status carries data-state', html.includes('<span>Fly to Grand Canyon</span>') && n === results.length && n <= 6 && n > 0 && html.includes('data-state="staging"'), `${n} results`);
});

// ===========================================================================
C.FLIGHT_PLAN.enabled = SHIPPED.plan;
C.FRONT_DOOR.enabled = SHIPPED.door;
console.log(`\nverify-r25-flight-plan${RED ? ' (RED: r25-w0 stubs)' : ''}: ${pass} passed / ${fail} failed`);
if (fail) console.log(`FAILED: ${fails.join(' | ')}`);
process.exit(fail ? 1 : 0);

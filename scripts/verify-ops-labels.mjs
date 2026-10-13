// GATE TO GATE — verify-ops-labels (node; no browser, no GL, no server).
//
// lib/fly/ops-labels.mjs (FLY_GATE_TO_GATE_PLAN.md W0.7, design-experience
// W0.5/W0.6):
//   1. No label from any registered or catalog airport carries a raw catalog
//      id (/[A-Z0-9]+:\d/) — the authored three, every runway index row and
//      every region record registered through the real registry.
//   2. airportChoices is unique by ident (the HUD/hangar lists listed a
//      catalog destination twice and every runway of an airport), honours
//      include / exclude / ineligible / near, and stays eligible.
//   3. RUNWAY_MINIMA: airportEligible is unchanged (old inline table, every
//      record x every aircraft) and catalogEligible agrees on index rows.
//   4. The unit formatters round-trip and print aviation units.
// The module is imported BEFORE any resolver hook is registered: node gates
// can use it bare.
// Run: node scripts/verify-ops-labels.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// No hooks yet: the labels module and the registry must load bare.
const O = await imp('lib/fly/ops-labels.mjs');
const registry = await imp('lib/fly/operations-airports.js');

let pass = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name} — ${String(error?.message || error).split('\n')[0]}`);
  }
}

const DATA = path.join(ROOT, 'public/data/runways/v1');
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8')).runways;
const regionRows = (region) => JSON.parse(fs.readFileSync(path.join(DATA, 'regions', `${region}.json`), 'utf8')).airports;
const REGIONS = [...new Set(index.map((r) => r.region))];
const AIRCRAFT = [...Object.keys(registry.RUNWAY_MINIMA), 'glider'];
const RAW_ID = /[A-Z0-9]+:\d/;
const AUTHORED = registry.OPERATIONS_AIRPORTS.filter((a) => registry.AUTHORED_AIRPORT_IDS.has(a.id));

// Every way a label reaches the screen: the parts, the joined line, both runway ends.
function labelTexts(a) {
  const l = O.airportLabel(a);
  return [l.code, l.name, l.runway ?? '', `${l.code} · ${l.name} · Runway ${l.runway}`, O.runwayLabel(a) ?? '', O.runwayLabel(a, true) ?? ''];
}

// The pre-G2G airportEligible (operations-airports.js before W0), verbatim.
function legacyEligible(airport, aircraft) {
  if (!airport || aircraft === 'glider' || (airport.fleet && !airport.fleet.includes(aircraft))) return false;
  if (airport.authored !== false) return true;
  const minimum = { prop: 350, 'warbird-prop': 650, 'warbird-jet': 1000, fighter: 1100, military: 1500, bizjet: 1200, airliner: 2000, cargo: 2400, 'flying-wing': 2200 };
  return minimum[aircraft] != null && registry.airportFrame(airport).length - (airport.thresholdA || 0) - (airport.thresholdB || 0) >= minimum[aircraft] && airport.width >= (['airliner', 'cargo', 'military', 'flying-wing'].includes(aircraft) ? 30 : 12);
}

// ---- section: labels --------------------------------------------------------
console.log('\n[labels]');

await check('known airports read as code, short name and runway pair', () => {
  const lowi = index.find((r) => r.id === 'LOWI:08-26');
  assert.deepEqual(O.airportLabel(lowi), { code: 'LOWI', name: 'Innsbruck', runway: '08/26' });
  assert.deepEqual(O.airportLabel(registry.airportById('KCMH')), { code: 'KCMH', name: 'John Glenn Columbus', runway: '10R/28L' });
  assert.deepEqual(O.airportLabel('EGLL:09L-27R'), { code: 'EGLL', name: 'EGLL', runway: '09L/27R' });
  assert.equal(O.runwayLabel(lowi), '08');
  assert.equal(O.runwayLabel(lowi, true), '26');
  assert.equal(O.runwayLabel(registry.airportById('KLCK'), true), '23R');
  assert.equal(O.airportLabel(null), null);
  assert.equal(O.shortAirportName('John F. Kennedy International Airport'), 'John F. Kennedy International');
});

await check(`no label carries a raw catalog id: ${AUTHORED.length} authored, ${index.length} index rows, every region record registered`, () => {
  const bad = [];
  for (const a of AUTHORED) for (const t of labelTexts(a)) if (RAW_ID.test(t)) bad.push(`${a.id}: ${t}`);
  for (const r of index) for (const t of labelTexts(r)) if (RAW_ID.test(t)) bad.push(`${r.id}: ${t}`);
  let registered = 0;
  for (const region of REGIONS) {
    for (const row of regionRows(region)) {
      const a = registry.registerAirport(row);
      registered++;
      for (const t of [...labelTexts(a), ...labelTexts(a.id)]) if (RAW_ID.test(t)) bad.push(`${a.id}: ${t}`);
    }
    registry.retainDiscoveredAirports([]);
  }
  assert.ok(registered >= index.length * 0.95, `${registered} registered`);
  assert.deepEqual(bad.slice(0, 5), []);
});

// ---- section: choices -------------------------------------------------------
console.log('\n[choices]');

// A registry with several runways per airport (KJFK 4, EGLL 2) plus LOWI.
const rowsOf = (ident) => {
  const ids = new Set(index.filter((r) => r.ident === ident).map((r) => r.id));
  return REGIONS.flatMap((g) => (index.some((r) => r.region === g && ids.has(r.id)) ? regionRows(g).filter((row) => ids.has(row.id)) : []));
};
const kjfk = rowsOf('KJFK').map((r) => registry.registerAirport(r));
const egll = rowsOf('EGLL').map((r) => registry.registerAirport(r));
const lowi = rowsOf('LOWI').map((r) => registry.registerAirport(r));

await check('the old HUD expression listed duplicates; airportChoices is unique by ident for every aircraft', () => {
  const destination = kjfk[2];
  const old = [...registry.OPERATIONS_AIRPORTS, ...(registry.airportById(destination.id)?.authored === false ? [registry.airportById(destination.id)] : [])];
  assert.ok(new Set(old.map((a) => a.id)).size < old.length, 'the old list repeated a key');
  for (const aircraft of AIRCRAFT) {
    for (const opts of [{}, { include: destination.id }, { ineligible: true }, { near: { lat: 40.6, lon: -73.8 } }]) {
      const list = O.airportChoices(aircraft, opts);
      const idents = list.map(O.airportIdent);
      assert.equal(new Set(idents).size, idents.length, `${aircraft} ${JSON.stringify(opts)}`);
      if (!opts.ineligible) assert.ok(list.every((a) => registry.airportEligible(a, aircraft)), aircraft);
    }
  }
  assert.equal(O.airportChoices('glider').length, 0, 'the glider takes no runway');
});

await check('include stands for its ident; exclude, ineligible, near, maxKm and limit', () => {
  const airliner = O.airportChoices('airliner', { include: kjfk[3].id });
  assert.equal(airliner.find((a) => O.airportIdent(a) === 'KJFK').id, kjfk[3].id);
  // Registry order kept: authored three first (eligible ones), then discovery order.
  const prop = O.airportChoices('prop');
  assert.deepEqual(prop.slice(0, 3).map((a) => a.id), ['KOSU', 'KCMH', 'KLCK']);
  assert.ok(prop.every((a, i) => i === 0 || registry.OPERATIONS_AIRPORTS.indexOf(prop[i - 1]) < registry.OPERATIONS_AIRPORTS.indexOf(a)));
  // The prop flies from KOSU; the airliner cannot, and KOSU only shows with `ineligible`.
  assert.ok(!O.airportChoices('airliner').some((a) => a.id === 'KOSU'));
  assert.ok(O.airportChoices('airliner', { ineligible: true }).some((a) => a.id === 'KOSU'));
  assert.ok(!O.airportChoices('prop', { exclude: lowi[0].id }).some((a) => O.airportIdent(a) === 'LOWI'));
  assert.ok(!O.airportChoices('prop', { exclude: 'KJFK' }).some((a) => O.airportIdent(a) === 'KJFK'));
  const near = O.airportChoices('prop', { near: { lat: 51.47, lon: -0.45 }, maxKm: 2000 });
  assert.equal(O.airportIdent(near[0]), 'EGLL');
  assert.ok(near.every((a) => O.airportIdent(a) !== 'KJFK'), 'beyond maxKm');
  assert.equal(O.airportChoices('prop', { limit: 2 }).length, 2);
});

await check('the hangar list (ineligible shown disabled) keeps one row per airport and never the selected catalog runway twice', () => {
  for (const selected of [kjfk[1].id, 'KOSU']) {
    const pinned = registry.airportById(selected)?.authored === false ? selected : null;
    const list = O.airportChoices('cargo', { ineligible: true, exclude: pinned });
    const shown = [...(pinned ? [selected] : []), ...list.map((a) => a.id)];
    assert.equal(new Set(shown.map((id) => id.split(':')[0])).size, shown.length, selected);
    assert.ok(shown.includes(selected));
  }
});

// ---- section: minima --------------------------------------------------------
console.log('\n[minima]');

await check('airportEligible with the exported RUNWAY_MINIMA is the old inline table, every record x every aircraft', () => {
  let compared = 0;
  const odd = [undefined, null, 'constructor', 'toString', 'helicopter'];
  for (const region of REGIONS) {
    for (const row of regionRows(region)) {
      const a = registry.registerAirport(row);
      for (const aircraft of [...AIRCRAFT, ...odd]) {
        assert.equal(registry.airportEligible(a, aircraft), legacyEligible(a, aircraft), `${a.id} ${aircraft}`);
        compared++;
      }
    }
    registry.retainDiscoveredAirports([]);
  }
  for (const a of AUTHORED) for (const aircraft of [...AIRCRAFT, ...odd]) assert.equal(registry.airportEligible(a, aircraft), legacyEligible(a, aircraft));
  assert.ok(compared > 100000, `${compared} comparisons`);
  assert.ok(Object.isFrozen(registry.RUNWAY_MINIMA) && Object.values(registry.RUNWAY_MINIMA).every(Object.isFrozen));
});

await check('catalogEligible applies the minima to index rows and agrees with the registered records', () => {
  const lowiRow = index.find((r) => r.id === 'LOWI:08-26');
  assert.equal(O.catalogEligible(lowiRow, 'airliner'), true);
  assert.equal(O.catalogEligible(lowiRow, 'cargo'), false);
  assert.equal(O.catalogEligible(lowiRow, 'glider'), false);
  assert.equal(O.catalogEligible(lowiRow, 'constructor'), false);
  assert.equal(O.catalogEligible(null, 'prop'), false);
  // Registered records also subtract displaced thresholds and use the
  // geodesic endpoint length, and index rows round to whole metres: compare
  // where none of that can flip the answer (no thresholds, lengths within
  // 5 m, both values clear of each minimum by more than the rounding).
  let agree = 0, total = 0;
  const disagree = [];
  const byId = new Map(index.map((r) => [r.id, r]));
  for (const region of REGIONS) {
    for (const row of regionRows(region)) {
      const a = registry.registerAirport(row), r = byId.get(a.id);
      if (!r || a.thresholdA || a.thresholdB || Math.abs(registry.airportFrame(a).length - r.length) > 5) continue;
      for (const aircraft of AIRCRAFT) {
        const min = registry.RUNWAY_MINIMA[aircraft];
        if (min && (Math.abs(r.length - min.length) <= 6 || Math.abs(r.width - min.width) <= 1)) continue;
        total++;
        if (O.catalogEligible(r, aircraft) === registry.airportEligible(a, aircraft)) agree++;
        else disagree.push(`${a.id} ${aircraft}`);
      }
    }
    registry.retainDiscoveredAirports([]);
  }
  assert.ok(total > 30000, `${total} comparisons`);
  assert.deepEqual(disagree.slice(0, 5), [], `${agree}/${total}`);
});

// ---- section: units ---------------------------------------------------------
console.log('\n[units]');

await check('formatters print aviation units and round-trip within their rounding', () => {
  assert.equal(O.fmtKt(77.17), '150 kt');
  assert.equal(O.fmtFt(762), '2,500 ft');
  assert.equal(O.fmtFpm(-1.6256), '−320 fpm');
  assert.equal(O.fmtFpm(0.001), '0 fpm');
  assert.equal(O.fmtNm(7778.4), '4.2 nm');
  assert.equal(O.fmtNm(68524), '37 nm');
  for (const f of [O.fmtKt, O.fmtFt, O.fmtFpm, O.fmtNm]) assert.match(f(NaN), /^— /);
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) {
    const speed = rand() * 300, height = (rand() - 0.1) * 14000, vs = (rand() - 0.5) * 40, dist = rand() * 400000;
    assert.ok(Math.abs(O.unitValue(O.fmtKt(speed)) / O.KT_PER_MPS - speed) <= 0.5 / O.KT_PER_MPS + 1e-9);
    assert.ok(Math.abs(O.unitValue(O.fmtFt(height)) / O.FT_PER_M - height) <= 0.5 / O.FT_PER_M + 1e-9);
    assert.ok(Math.abs(O.unitValue(O.fmtFpm(vs)) / O.FPM_PER_MPS - vs) <= 0.5 / O.FPM_PER_MPS + 1e-9);
    const nm = dist / O.M_PER_NM;
    assert.ok(Math.abs(O.unitValue(O.fmtNm(dist)) - nm) <= (nm < 10 ? 0.05 : 0.5) + 1e-9);
  }
});

// The one shortAirportName: the lounge's sky module re-exports this module's.
// (airport-watch-sky.mjs pulls in extensionless app imports, so hooks now.)
register(pathToFileURL(path.join(HERE, '_node-resolve.mjs')).href);
await check('airport-watch-sky re-exports the one shortAirportName', async () => {
  const sky = await imp('lib/fly/airport-watch-sky.mjs');
  assert.equal(sky.shortAirportName, O.shortAirportName);
});

// ---- summary ----------------------------------------------------------------
const total = pass + failures.length;
console.log(`\nOPS LABELS: ${pass}/${total}${failures.length ? ` — FAILED: ${failures.join(' | ')}` : ''}`);
process.exit(failures.length ? 1 : 0);

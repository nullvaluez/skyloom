/**
 * TRUE EARTH — verify-attribution: the data credits shown in the app, baked
 * into photo exports and listed in CREDITS.md (lib/fly/tile-sources.js).
 *
 * THE DEFECTS
 *  - every satellite-world building, road, water body, land-cover class and
 *    airport comes from OpenStreetMap via OpenFreeMap's OpenMapTiles tiles,
 *    but the satellite credit set named none of the three (ODbL requires the
 *    OpenStreetMap credit wherever the data is shown);
 *  - the proxy fails over between three ADS-B feeds and reports the serving
 *    one in `x-adsb-source`, but the credit always said adsb.lol.
 *
 * THE CONTRACT
 *  (1) both style sets credit OpenStreetMap, OpenMapTiles and OpenFreeMap;
 *      satellite also keeps Esri and ESA WorldCover;
 *  (2) every feed name the proxy can serve has a flight-data credit, and
 *      attributionsFor() swaps exactly the flight-data line for the live feed
 *      (an unknown or missing feed keeps the default list);
 *  (3) the Credits panel lists every feed;
 *  (4) scripts/gen-credits.mjs's mirror equals CREDITS_ATTRIBUTIONS, and
 *      CREDITS.md carries every label.
 *
 * Run: node scripts/verify-attribution.mjs
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
register('./_node-resolve.mjs', import.meta.url);
// tile-sources.js imports the vendored three-tile plugin, which builds an
// OffscreenCanvas at module scope. An inert stub lets node import the REAL
// module (nothing here draws).
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  const inert = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : inert), apply: () => inert, construct: () => inert });
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return inert; } };
}
const { ATTRIBUTIONS_BY_STYLE, FLIGHT_DATA_ATTRIBUTIONS, CREDITS_ATTRIBUTIONS, attributionsFor } = await import('../lib/fly/tile-sources.js');

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const labels = (list) => list.map((a) => a.label);

// (1)
{
  const need = ['© OpenStreetMap contributors', '© OpenMapTiles', 'Tiles © OpenFreeMap'];
  const sat = labels(ATTRIBUTIONS_BY_STYLE.satellite);
  const toy = labels(ATTRIBUTIONS_BY_STYLE.toy);
  const ok =
    need.every((l) => sat.includes(l) && toy.includes(l)) &&
    sat.includes('© Esri, Maxar, Earthstar Geographics') &&
    sat.some((l) => l.startsWith('© ESA WorldCover'));
  check('(1) both styles credit OpenStreetMap, OpenMapTiles and OpenFreeMap; satellite keeps Esri and ESA', ok);
}

// (2)
{
  const route = readFileSync(path.join(ROOT, 'app/api/aircraft/route.js'), 'utf8');
  const feeds = [...route.matchAll(/^\s*name: '([^']+)'/gm)].map((m) => m[1]);
  const missing = feeds.filter((f) => !FLIGHT_DATA_ATTRIBUTIONS[f]);
  let swapOk = true;
  for (const f of feeds) {
    const list = attributionsFor('satellite', f);
    const flight = list.filter((a) => a.label.startsWith('Flight data ©'));
    const others = list.filter((a) => !a.label.startsWith('Flight data ©'));
    const baseOthers = ATTRIBUTIONS_BY_STYLE.satellite.filter((a) => !a.label.startsWith('Flight data ©'));
    if (flight.length !== 1 || flight[0] !== FLIGHT_DATA_ATTRIBUTIONS[f] || JSON.stringify(others) !== JSON.stringify(baseOthers)) swapOk = false;
  }
  const unknownOk = attributionsFor('satellite', 'nope') === ATTRIBUTIONS_BY_STYLE.satellite && attributionsFor('toy', null) === ATTRIBUTIONS_BY_STYLE.toy;
  check(
    '(2) every proxy feed has a credit; attributionsFor swaps only the flight-data line',
    feeds.length >= 3 && missing.length === 0 && swapOk && unknownOk,
    `feeds: ${feeds.join(', ')}${missing.length ? `; missing: ${missing.join(', ')}` : ''}`,
  );
}

// (3)
{
  const panel = labels(CREDITS_ATTRIBUTIONS);
  const ok = Object.values(FLIGHT_DATA_ATTRIBUTIONS).every((a) => panel.includes(a.label)) && panel.includes('© OpenStreetMap contributors');
  check('(3) the Credits panel lists every feed and OpenStreetMap', ok);
}

// (4)
{
  const gen = readFileSync(path.join(ROOT, 'scripts/gen-credits.mjs'), 'utf8');
  const mirror = [...gen.matchAll(/\{ label: '([^']+)', href: '([^']+)' \}/g)].map((m) => ({ label: m[1], href: m[2] }));
  const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
  const same = JSON.stringify(mirror) === JSON.stringify(CREDITS_ATTRIBUTIONS.map(({ label, href }) => ({ label, href })));
  const inDoc = CREDITS_ATTRIBUTIONS.every((a) => credits.includes(`- ${a.label} — ${a.href}`));
  check('(4) gen-credits mirror equals CREDITS_ATTRIBUTIONS and CREDITS.md carries every line', same && inDoc);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Build lib/fly/lounge-seats.js: a lounge seat for every golden-hour hub
// (lib/airports.js) that has no authored flagship seat, chosen by
// lib/fly/lounge-seat.js from the airport's OpenStreetMap data.
//
//   node scripts/build-lounge-seats.mjs [--only KORD,KLAX] [--cache <dir>]
//
// Loads each airport the way the browser's 'sat-airport' worker does
// (OpenFreeMap z14 tiles -> buildAirfieldTile -> mergeAirfieldTiles), with
// raw tiles cached on disk (default .graphics-review/lounge-seats/tiles,
// gitignored), and prints what every seat stands on. Network access to
// tiles.openfreemap.org is required; no keys. Re-run when the seat scoring
// (SEAT in lib/fly/observation-config.js) or the set layout changes.
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(s, c, next) {
    if (s.startsWith('@/')) s = new URL('../' + s.slice(2), import.meta.url).href;
    if (s.startsWith('.') || s.startsWith('file:')) {
      const u = new URL(s, c.parentURL);
      if (fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c);
    }
    return next(s, c);
  },
});

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CACHE = path.resolve(arg('cache', path.join(ROOT, '.graphics-review/lounge-seats/tiles')));
fs.mkdirSync(CACHE, { recursive: true });
const variant = process.argv.includes('--pier') ? 'pier' : 'classic';
const offline = process.argv.includes('--offline');
const SOURCE_CACHE = arg('source-cache', null);
const destination = variant === 'pier' ? 'lib/fly/lounge-seats-pier.js' : 'lib/fly/lounge-seats.js';

const registry = await import('../lib/fly/operations-airports.js');
const { buildAirfieldTile, AIRFIELD_TILE_REVISION } = await import('../lib/fly/airfield/airfield-tile.js');
const { loadAirfieldFeatures } = await import('../lib/fly/airfield/airfield-data.js');
const { chooseLoungeSeat } = await import('../lib/fly/lounge-seat.js');
const { LOUNGE_SITE } = await import('../lib/fly/observation-config.js');
const { AIRPORTS } = await import('../lib/airports.js');
const { PbfReader } = await import('pbf');
const { VectorTile } = await import('@mapbox/vector-tile');

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/runways/v1/index.json'), 'utf8')).runways;
const regions = new Map();
const region = (r) => {
  if (!regions.has(r)) regions.set(r, JSON.parse(fs.readFileSync(path.join(ROOT, `public/data/runways/v1/regions/${r}.json`), 'utf8')).airports);
  return regions.get(r);
};
const identOf = (a) => a.ident || String(a.id).split(':')[0];

/** Register the catalog runways around an ident (as the runtime does); its runway records. */
function registerAround(ident) {
  const item = catalog.filter((r) => r.ident === ident).sort((x, y) => (y.length || 0) - (x.length || 0))[0];
  if (!item) return registry.OPERATIONS_AIRPORTS.filter((r) => identOf(r) === ident);
  for (const it of catalog.filter((r) => Math.abs(r.lat - item.lat) < 0.25 && Math.abs(r.lon - item.lon) * Math.cos((item.lat * Math.PI) / 180) < 0.25)) {
    const row = region(it.region).find((x) => x.id === it.id);
    if (row) try { registry.registerAirport(row); } catch { /* invalid rows are skipped like the runtime does */ }
  }
  return registry.OPERATIONS_AIRPORTS.filter((r) => identOf(r) === ident);
}

const previousAudit = variant === 'pier' && fs.existsSync(path.join(ROOT, 'scripts/lounge-pier-audit.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/lounge-pier-audit.json'), 'utf8')) : null;
let template = null, planet = offline ? 'cached-unversioned' : '';
async function tileTemplate() {
  if (template) return template;
  const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
  template = tj.tiles[0];
  planet = (template.match(/planet\/([^/]+)\//) || [])[1] || '';
  return template;
}
const api = {
  async buildTile(z, x, y, detail, options = {}) {
    if (detail !== 'sat-airport') throw new Error(`unexpected detail ${detail}`);
    const file = path.join(CACHE, `${z}-${x}-${y}.pbf`);
    let buf;
    if (fs.existsSync(file)) buf = fs.readFileSync(file);
    else if (SOURCE_CACHE && fs.existsSync(path.join(SOURCE_CACHE, `${z}-${x}-${y}.pbf`))) buf = fs.readFileSync(path.join(SOURCE_CACHE, `${z}-${x}-${y}.pbf`));
    else {
      if (offline) throw new Error(`uncached tile ${z}/${x}/${y}`);
      const url = (await tileTemplate()).replace('{z}', z).replace('{x}', x).replace('{y}', y);
      const res = await fetch(url);
      if (res.status === 404 || res.status === 204) { fs.writeFileSync(file, Buffer.alloc(0)); return { empty: true }; }
      if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
    }
    if (!buf.length) return { empty: true };
    const airfield = buildAirfieldTile(new VectorTile(new PbfReader(new Uint8Array(buf))), { z, x, y }, null, options);
    return { airfield: { ...airfield, revision: AIRFIELD_TILE_REVISION } };
  },
};

const only = arg('only', '');
const hubs = Object.values(AIRPORTS).map((a) => a.icao).filter((icao) => icao && (variant === 'pier' || !LOUNGE_SITE.flagship[icao]));
const list = only ? only.split(',') : [...new Set(variant === 'pier' ? [...hubs, ...Object.keys(LOUNGE_SITE.flagship)] : hubs)];
const seats = {};
const rows = [], audit = [];
if (!offline) await tileTemplate();
for (const ident of list) {
  const runways = registerAround(ident);
  if (!runways.length) { rows.push(`${ident.padEnd(5)} not in the runway catalog: classic fallback`); audit.push({ ident, selected: false, error: 'not in runway catalog', source: planet }); console.log(rows.at(-1)); continue; }
  let seat = null, note = '';
  try {
    const features = await loadAirfieldFeatures(runways[0], { api, occluders: variant === 'pier' });
    seat = chooseLoungeSeat(runways, features, { variant });
    audit.push({ ident, tiles: features.tiles, selected: !!seat, seat, source: planet });
    if (!seat && features.tiles?.failed) note = 'incomplete tile evidence: classic fallback';
    else if (!seat) note = variant === 'pier' ? 'no safe two-sided seat: classic fallback' : 'no acceptable seat: generic seat';
  } catch (e) {
    note = `load failed (${e.message}): ${variant === 'pier' ? 'classic fallback' : 'generic seat'}`;
    audit.push({ ident, selected: false, error: e.message, source: planet });
  }
  if (seat) {
    seats[ident] = { runway: seat.runwayId, along: seat.along, cross: seat.cross, floorM: seat.floorM, rearSet: seat.rearSet === true };
    const f = seat.detail.footprint, b = seat.detail.blocked;
    rows.push(`${ident.padEnd(5)} ${seat.runwayId.padEnd(16)} along ${String(seat.along).padStart(5)} cross ${String(seat.cross).padStart(5)} floor ${seat.floorM}` +
      `  score ${String(seat.score).padStart(6)}  stands apron ${f.stands.apron}/${f.stands.n} taxiway ${f.stands.taxiway}  gates ${f.gates}  blocked ${b.faced}/${b.other}`);
  } else rows.push(`${ident.padEnd(5)} ${note}`);
  console.log(rows.at(-1));
}

const body = Object.keys(seats).sort().map((k) => {
  const s = seats[k];
  return `  ${k}: Object.freeze({ runway: '${s.runway}', along: ${s.along}, cross: ${s.cross}, floorM: ${s.floorM}${variant === 'pier' ? `, variant: 'pier', rearSet: ${s.rearSet}` : ''} }),`;
}).join('\n');
const out = `// GENERATED by scripts/build-lounge-seats.mjs — do not edit by hand; re-run it.
// Lounge seats for ${variant === 'pier' ? 'all catalog hubs and flagships' : 'golden-hour hubs without an authored flagship'}, chosen by lib/fly/lounge-seat.js from OpenStreetMap data
// (OpenFreeMap ${SOURCE_CACHE || offline ? 'mixed cached tiles; cache snapshot date unavailable; fetched planet ' : 'planet '}${(offline ? previousAudit?.fetchedPlanet : planet) || 'unknown'}${offline ? '; offline rescore from existing cache' : ''}) and the runway catalog. Same shape as
// LOUNGE_SITE.flagship: the runway faced, metres along it from its first end,
// metres off its centreline (+ = right of that direction), floor height.
export const ${variant === 'pier' ? 'LOUNGE_SEATS_PIER' : 'LOUNGE_SEATS'} = Object.freeze({
${body}
});
`;
if (!only) {
  fs.writeFileSync(path.join(ROOT, destination), out);
  console.log(`\nwrote ${destination}: ${Object.keys(seats).length} seats of ${list.length} hubs`);
} else console.log(`\n(--only: ${destination} not written)\n${out}`);
if (variant === 'pier' && !only) fs.writeFileSync(path.join(ROOT, 'scripts/lounge-pier-audit.json'), JSON.stringify({ variant, source: SOURCE_CACHE || offline ? 'mixed cached OpenFreeMap tiles' : planet, fetchedPlanet: offline ? previousAudit?.fetchedPlanet ?? null : planet, cachedSnapshotDate: null, offlineRescore: offline, safetyRevision: 3, occlusionRevision: 1, visualCertification: false, airports: list.length, selected: audit.filter((a) => a.selected).length, fallback: audit.filter((a) => !a.selected).length, rows: audit }, null, 2) + '\n');

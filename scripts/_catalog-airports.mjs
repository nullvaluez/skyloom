// Node gates: register a catalog airport (and its neighbours, from which
// lounge-site.js picks the terminal side) straight from public/data, the way
// lib/fly/runway-catalog.js does at runtime. Same rules as the loader inside
// scripts/verify-airport-set.mjs.
//
//   const registry = await import('../lib/fly/operations-airports.js');
//   const airport = loadCatalogAirport(registry, 'KJFK');
import fs from 'node:fs';

let index = null;
const regions = new Map();
const region = (r) => {
  if (!regions.has(r)) regions.set(r, JSON.parse(fs.readFileSync(`public/data/runways/v1/regions/${r}.json`, 'utf8')).airports);
  return regions.get(r);
};

/** The registered record for an id or ident (the longest runway for an ident), or throws. */
export function loadCatalogAirport(registry, id) {
  const known = registry.airportById(id);
  if (known) return known;
  index ??= JSON.parse(fs.readFileSync('public/data/runways/v1/index.json', 'utf8')).runways;
  const item = index.find((r) => r.id === id) || index.filter((r) => r.ident === id).sort((x, y) => (y.length || 0) - (x.length || 0))[0];
  if (!item) throw new Error(`the catalog has no ${id}`);
  for (const it of index.filter((r) => Math.abs(r.lat - item.lat) < 0.25 && Math.abs(r.lon - item.lon) * Math.cos((item.lat * Math.PI) / 180) < 0.25)) {
    const row = region(it.region).find((x) => x.id === it.id);
    if (row) try { registry.registerAirport(row); } catch { /* invalid rows are skipped like the runtime does */ }
  }
  const a = registry.airportById(item.id);
  if (!a) throw new Error(`could not register ${id}`);
  return a;
}

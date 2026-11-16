/**
 * World Pass: compare the capture telemetry of two or more look-pass-capture
 * manifests, shot by shot (render calls / triangles, and the satBuildings /
 * satSkyline / satRoads / satVeg counters in telemetry.world).
 *
 *   node scripts/world-pass-telemetry-compare.cjs <dirA> <dirB> [<dirC> ...] [--shots=nyc-low__noon,...] [--json=<out>]
 *
 * Each <dir> holds a manifest.json. A shot missing from a manifest prints '-'.
 * Body counts that must match on a settled ring (the same resident tiles):
 * satBuildings chunks / ready / empty / columns, satSkyline chunks / ready /
 * tris / verts. Streaming totals (draws, triangles, fades) breathe by a few
 * percent between pages and are reported, not judged.
 */
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
const opts = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }));
const dirs = argv.filter((a) => !a.startsWith('--'));
if (dirs.length < 2) {
  console.error('usage: world-pass-telemetry-compare.cjs <dirA> <dirB> [...] [--shots=a__t,b__t] [--json=out]');
  process.exit(2);
}
const manifests = dirs.map((d) => ({ dir: d, label: path.basename(d), m: JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')) }));
const shotKey = (c) => `${c.pose}__${c.time}`;
const wanted = typeof opts.shots === 'string' ? opts.shots.split(',') : [...new Set(manifests[0].m.captures.map(shotKey))];

const FIELDS = [
  ['render.calls', (t) => t.render?.calls],
  ['render.triangles', (t) => t.render?.triangles],
  ['bld.chunks', (t) => t.world?.satBuildings?.chunks],
  ['bld.ready', (t) => t.world?.satBuildings?.ready],
  ['bld.empty', (t) => t.world?.satBuildings?.empty],
  ['bld.columns', (t) => t.world?.satBuildings?.columns],
  ['bld.fadeTwins', (t) => t.world?.satBuildings?.fadeTwins],
  ['bld.degenDropped', (t) => t.world?.satBuildings?.degenDropped],
  ['bld.degenScanned', (t) => t.world?.satBuildings?.degenScanned],
  ['sky.chunks', (t) => t.world?.satSkyline?.chunks],
  ['sky.ready', (t) => t.world?.satSkyline?.ready],
  ['sky.empty', (t) => t.world?.satSkyline?.empty],
  ['sky.tris', (t) => t.world?.satSkyline?.tris],
  ['sky.verts', (t) => t.world?.satSkyline?.verts],
  ['sky.fadeTwins', (t) => t.world?.satSkyline?.fadeTwins],
  ['roads.ready', (t) => t.world?.satRoads?.ready],
  ['veg.ready', (t) => t.world?.satVeg?.ready],
  ['veg.vegPts', (t) => t.world?.satVeg?.vegPts],
  ['frame.meanLuma', (t, c) => c.metrics?.frame?.meanLuma],
];
const out = {};
for (const shot of wanted) {
  console.log(`\n${shot}`);
  console.log(['field'.padEnd(20), ...manifests.map((x) => x.label.padStart(12))].join(' '));
  out[shot] = {};
  const caps = manifests.map((x) => x.m.captures.find((c) => shotKey(c) === shot) ?? null);
  for (const [name, get] of FIELDS) {
    const vals = caps.map((c) => (c ? get(c.telemetry ?? {}, c) : undefined));
    out[shot][name] = vals;
    const same = vals.every((v) => v === vals[0]);
    console.log([name.padEnd(20), ...vals.map((v) => String(v ?? '-').padStart(12)), same ? '' : '  *'].join(' '));
  }
  out[shot].settled = caps.map((c) => c?.worldSettled ?? null);
  out[shot].urlFlags = caps.map((c) => c?.telemetry?.urlFlags ?? null);
}
if (typeof opts.json === 'string') fs.writeFileSync(opts.json, JSON.stringify({ dirs, shots: out }, null, 1));

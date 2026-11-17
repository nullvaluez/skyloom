// World Pass A (TRUTH) round 2b tuning probe (not product code). The live OpenFreeMap build 20261115 (tiles
// cached in --cache, WP_TILE_CACHE or the OS temp dir), this tree's worker modules (WP_ROOT to point elsewhere).
// node tune.mjs --places a,b [--r 1] [--out f.json] [--cls]
// Per place: hold-out (mapped <= 24 m and all) law vs legacy; per class (mapped, as if unmapped): n, actual p50,
// law p50, signed bias, MAE law / legacy; the verifier's dense-shed metric (unmapped >= 1000 m2, coverWide >= 0.3,
// legacy >= 12, law < 9) by class; and the share of inferred houses with 2+ storeys.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = process.env.WP_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const BUILD = '20261115_080022_pt';
const CACHE = arg('--cache') ?? process.env.WP_TILE_CACHE ?? path.join(os.tmpdir(), 'wp-truth-tiles-' + BUILD);
fs.mkdirSync(CACHE, { recursive: true });
const req = createRequire(path.join(process.env.WP_MODROOT ?? ROOT, 'package.json'));
const probe = (base) => { for (const ext of ['', '.js', '.mjs', '/index.js']) { const p = base + ext; if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href; } return null; };
registerHooks({ resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) { const u = probe(path.join(ROOT, spec.slice(2))); if (u) return { url: u, shortCircuit: true }; }
  if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:')) { const base = fileURLToPath(new URL(spec, ctx.parentURL)); if (!(fs.existsSync(base) && fs.statSync(base).isFile())) { const u = probe(base); if (u) return { url: u, shortCircuit: true }; } }
  return next(spec, ctx);
} });
const { VectorTile } = await import(pathToFileURL(req.resolve('@mapbox/vector-tile')).href);
const PbfMod = await import(pathToFileURL(req.resolve('pbf')).href);
const Pbf = PbfMod.PbfReader ?? PbfMod.default;
const Wk = (p) => import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker', p)).href);
const { createTileCtx } = await Wk('tile-ctx.js');
const { admitFootprints } = await Wk('sat-buildings/admission.js');
const { suburbanContext, truthTable } = await Wk('sat-buildings/typology.js');
const { heightOf, truthHeight, nearHeight } = await Wk('sat-buildings/height.js');
const { classifyRingsSat } = await Wk('geom.js');
const { WORLD_TRUTH } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
const TEMPLATE = `https://tiles.openfreemap.org/planet/${BUILD}/{z}/{x}/{y}.pbf`;
export const PLACES = {
  powell: [40.158, -83.075], 'powell-subdiv2': [40.205, -83.088], 'phoenix-suburb': [33.38, -111.84], nyc: [40.748, -73.994], brooklyn: [40.678, -73.97],
  paris: [48.853, 2.33], london: [51.502, -0.1], tokyo: [35.67, 139.735], 'iowa-farm': [41.95, -93.7], 'westerville-oh': [40.13, -82.93],
  'richfield-mn': [44.878, -93.285], 'alpharetta-ga': [34.056, -84.265], 'raleigh-cary': [35.77, -78.80], boise: [43.60, -116.30], 'houston-katy': [29.78, -95.75],
  amsterdam: [52.37, 4.89], rome: [41.90, 12.49], osaka: [34.69, 135.50], vienna: [48.21, 16.37], 'buenos-aires': [-34.60, -58.38], boston: [42.35, -71.06],
  barcelona: [41.39, 2.17], 'hong-kong-kowloon': [22.32, 114.17], istanbul: [41.04, 28.98], 'istanbul-kadikoy': [40.99, 29.03], ankara: [39.92, 32.85],
  tehran: [35.70, 51.40], athens: [37.98, 23.73], casablanca: [33.59, -7.62], riyadh: [24.71, 46.68], baku: [40.41, 49.87], 'jersey-city': [40.72, -74.05],
  lisbon: [38.72, -9.14], 'lower-manhattan': [40.71, -74.01], 'queens-lic': [40.745, -73.94], copenhagen: [55.68, 12.57], rio: [-22.91, -43.18], 'miami-hialeah': [25.86, -80.30],
  cairo: [30.05, 31.24], dubai: [25.2, 55.27], seoul: [37.56, 126.98], mumbai: [19.07, 72.88], madrid: [40.42, -3.70], berlin: [52.52, 13.40], 'mexico-city': [19.43, -99.13],
  'sao-paulo': [-23.55, -46.63], sydney: [-33.87, 151.21], chicago: [41.88, -87.63], 'la-suburb': [34.0, -118.1], warsaw: [52.23, 21.01], singapore: [1.30, 103.85],
  toronto: [43.65, -79.38], columbus: [39.96, -83.0], 'seattle-suburb': [47.6, -122.2], lagos: [6.45, 3.4],
};
const tileOf = (lat, lon, z) => { const n = 2 ** z; const x = Math.floor(((lon + 180) / 360) * n); const r = (lat * Math.PI) / 180; const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); return [x, y]; };
async function tileBytes(z, x, y) {
  const f = path.join(CACHE, `${z}-${x}-${y}.pbf`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const url = TEMPLATE.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  for (let a = 0; ; a++) {
    try { const r = await fetch(url); if (r.status === 404 || r.status === 204) { fs.writeFileSync(f, Buffer.alloc(0)); return Buffer.alloc(0); } if (!r.ok) throw new Error(`http ${r.status}`); const b = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(f, b); return b; }
    catch (e) { if (a >= 3) throw e; await new Promise((res) => setTimeout(res, 1500 * (a + 1))); }
  }
}
const WORLD = 2 * Math.PI * 6378137;
const OFF = { v: 1, key: 'wp1-0', any: false, tier: null, truth: { on: false } };
const ON = { v: 1, key: 'tune', any: true, tier: 'ultra', truth: { on: true, heights: true, typology: true, smallBand: true, roofs: true, worker: JSON.parse(JSON.stringify(WORLD_TRUTH.worker)) }, arrival: { on: false, worker: null }, reach: { on: false, worker: null }, look: { on: false, worker: null }, ground: { on: false, worker: null } };
function ctxFor(vt, z, x, y, worldPass) {
  const tileSpan = WORLD / 2 ** z; const mercX0 = -WORLD / 2 + x * tileSpan; const mercYTop = WORLD / 2 - y * tileSpan;
  const cx = mercX0 + tileSpan / 2; const cz = -(mercYTop - tileSpan / 2);
  const latC = ((2 * Math.atan(Math.exp(-cz / 6378137)) - Math.PI / 2) * 180) / Math.PI; const k = 1 / Math.cos((latC * Math.PI) / 180);
  const frame = { tileSpan, mercX0, mercYTop, cx, cz, k, t0: 0, visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true };
  return createTileCtx(vt, frame, { z, x, y, detail: 'sat-buildings', options: { visuals: true, trueAreas: true, worldPass }, v: 26, diag: false, clutterOnly: false });
}
const pct = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))].toFixed(2); };
const only = arg('--places')?.split(',');
const RAD = Number(arg('--r') ?? 1);
const report = {};
for (const [name, [lat, lon]] of Object.entries(PLACES)) {
  if (only && !only.includes(name)) continue;
  const [tx, ty] = tileOf(lat, lon, 14);
  const ho = { law: [], leg: [] }, hoAll = { law: [], leg: [] };
  const byCls = {}; const bigM = {}; const shed = {}; let shedN = 0; let bigDense = 0; const houses = { n: 0, two: 0 }; const regions = {};
  const inf = [];
  for (let dy = -RAD; dy <= RAD; dy++) for (let dx = -RAD; dx <= RAD; dx++) {
    const x = tx + dx, y = ty + dy; const bytes = await tileBytes(14, x, y); if (!bytes.length) continue;
    const vt = new VectorTile(new Pbf(bytes)); if (!vt.layers.building) continue;
    const off = ctxFor(vt, 14, x, y, OFF); const items = admitFootprints(off, classifyRingsSat); off.suburban = suburbanContext(items, off);
    const legacy = new Map(); for (const it of items) legacy.set(it.id, { it, h: heightOf(it, off, 'near').h });
    const on = ctxFor(new VectorTile(new Pbf(bytes)), 14, x, y, ON); const T = truthTable(on);
    regions[T.region] = (regions[T.region] ?? 0) + 1;
    const onItems = admitFootprints(on, classifyRingsSat); on.suburban = suburbanContext(onItems, on);
    for (const it of onItems) {
      const e = T.byId.get(it.id); const lg = legacy.get(it.id); if (!e) continue;
      const h = heightOf(it, on, 'near').h;
      if (it.rawH > 0) {
        if (e.minY > 0.5 || !lg) continue;
        const pn = truthHeight(e, T, e).h; const po = nearHeight({ ...lg.it, rawH: 0 }, off).h;
        hoAll.law.push(Math.abs(pn - it.rawH)); hoAll.leg.push(Math.abs(po - it.rawH));
        if (it.rawH <= 24) { ho.law.push(Math.abs(pn - it.rawH)); ho.leg.push(Math.abs(po - it.rawH)); }
        const c = (byCls[e.cls] ??= { n: 0, act: [], law: [], dLaw: [], dLeg: [], sLaw: [], cov: [], covW: [], A: [] });
        if (it.rawH <= 30) { c.n++; c.act.push(it.rawH); c.law.push(pn); c.dLaw.push(Math.abs(pn - it.rawH)); c.dLeg.push(Math.abs(po - it.rawH)); c.sLaw.push(pn - it.rawH); c.cov.push(e.cover); c.covW.push(e.coverWide); c.A.push(e.clsM2); }
        if (e.clsM2 >= 1000 && e.coverWide >= 0.3 && it.rawH <= 40) { const b = (bigM[e.cls] ??= { act: [], law: [], dLaw: [], dLeg: [] }); b.act.push(it.rawH); b.law.push(pn); b.dLaw.push(Math.abs(pn - it.rawH)); b.dLeg.push(Math.abs(po - it.rawH)); }
        continue;
      }
      inf.push(h);
      const L = e._law; if (L && L.cls === 'house') { houses.n++; if (L.storeys >= 2) houses.two++; }
      if (e.wholeM2 >= 1000 && e.coverWide >= 0.3) { bigDense++; if (h < 9 && lg && lg.h >= 12) { shedN++; shed[e.cls] = (shed[e.cls] ?? 0) + 1; } }
    }
  }
  const cls = {}; for (const [k, c] of Object.entries(byCls)) cls[k] = { n: c.n, act: pct(c.act, 0.5), law: pct(c.law, 0.5), bias: pct(c.sLaw, 0.5), mae: pct(c.dLaw, 0.5), leg: pct(c.dLeg, 0.5), cov: pct(c.cov, 0.5), covW: pct(c.covW, 0.5), A: pct(c.A, 0.5) };
  const R = (report[name] = { regions, ho24: { n: ho.law.length, law: pct(ho.law, 0.5), leg: pct(ho.leg, 0.5) }, hoAll: { n: hoAll.law.length, law: pct(hoAll.law, 0.5), leg: pct(hoAll.leg, 0.5) }, cls, shed: { n: shedN, of: bigDense, byCls: shed }, house2: houses.n ? +(houses.two / houses.n).toFixed(3) : null, houseN: houses.n, inf: { p10: pct(inf, 0.1), p50: pct(inf, 0.5), p90: pct(inf, 0.9) } });
  console.log(`${name.padEnd(18)} ${JSON.stringify(R.regions)} ho24 ${R.ho24.law}/${R.ho24.leg} n${R.ho24.n} all ${R.hoAll.law}/${R.hoAll.leg} | shed ${shedN}/${bigDense} ${JSON.stringify(shed)} | house2+ ${R.house2} n${R.houseN} | inf ${R.inf.p10}/${R.inf.p50}/${R.inf.p90}`);
  if (argv.includes('--big')) for (const [k, b] of Object.entries(bigM)) console.log(`     BIG ${k.padEnd(11)} n${String(b.act.length).padEnd(5)} act ${pct(b.act, 0.5)} law ${pct(b.law, 0.5)} mae ${pct(b.dLaw, 0.5)} leg ${pct(b.dLeg, 0.5)}`);
  if (argv.includes('--cls')) for (const [k, c] of Object.entries(cls)) console.log(`     ${k.padEnd(11)} n${String(c.n).padEnd(6)} act ${c.act} law ${c.law} bias ${c.bias} mae ${c.mae} leg ${c.leg} cov ${c.cov} covW ${c.covW} A ${c.A}`);
}
if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(report, null, 1));




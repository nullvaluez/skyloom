// World Pass A (TRUTH) round 2b worker-cost bench (not product code). node scripts/wp-truth-r2b-bench.mjs [--places a,b] [--reps 5]
// Env: SKYON=1 skips the legacy skyline arm, SKYONLY=off|on times only that skyline arm (for --cpu-prof).
// Per z14 tile: legacy (admit + heights) vs law (table + admit + heights), warm, p50 of reps.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = process.env.WP_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const CACHE = arg('--cache') ?? process.env.WP_TILE_CACHE ?? path.join(os.tmpdir(), 'wp-truth-tiles-20261115_080022_pt'); // fill it with wp-truth-r2b-tune.mjs first
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
const W = (p) => import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker', p)).href);
const { createTileCtx } = await W('tile-ctx.js');
const { admitFootprints } = await W('sat-buildings/admission.js');
const { suburbanContext, truthTable } = await W('sat-buildings/typology.js');
const { heightOf } = await W('sat-buildings/height.js');
const { classifyRingsSat } = await W('geom.js');
const { buildSatSkyline } = await W('sat-skyline.js');
const { WORLD_TRUTH } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
const PLACES = { nyc: [40.748, -73.994], paris: [48.853, 2.33], tokyo: [35.67, 139.735], 'hong-kong-kowloon': [22.32, 114.17], london: [51.502, -0.1], 'phoenix-suburb': [33.38, -111.84], istanbul: [41.04, 28.98] };
const only = arg('--places')?.split(',');
const REPS = Number(arg('--reps') ?? 5);
const RAD = Number(arg('--r') ?? 1);
const tileOf = (lat, lon, z) => { const n = 2 ** z; const x = Math.floor(((lon + 180) / 360) * n); const r = (lat * Math.PI) / 180; const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); return [x, y]; };
const WORLD = 2 * Math.PI * 6378137;
const OFF = { v: 1, key: 'wp1-0', any: false, tier: null, truth: { on: false } };
const ON = { v: 1, key: 'bench', any: true, tier: 'ultra', truth: { on: true, heights: true, typology: true, smallBand: true, roofs: true, worker: JSON.parse(JSON.stringify(WORLD_TRUTH.worker)) }, arrival: { on: false, worker: null }, reach: { on: false, worker: null }, look: { on: false, worker: null }, ground: { on: false, worker: null } };
function ctxFor(vt, z, x, y, worldPass) {
  const tileSpan = WORLD / 2 ** z; const mercX0 = -WORLD / 2 + x * tileSpan; const mercYTop = WORLD / 2 - y * tileSpan;
  const cx = mercX0 + tileSpan / 2; const cz = -(mercYTop - tileSpan / 2);
  const latC = ((2 * Math.atan(Math.exp(-cz / 6378137)) - Math.PI / 2) * 180) / Math.PI; const k = 1 / Math.cos((latC * Math.PI) / 180);
  const frame = { tileSpan, mercX0, mercYTop, cx, cz, k, t0: 0, visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true };
  return createTileCtx(vt, frame, { z, x, y, detail: 'sat-buildings', options: { visuals: true, trueAreas: true, worldPass }, v: 26, diag: false, clutterOnly: false });
}
function skyCtx(vt, z, x, y, worldPass) {
  const c = ctxFor(vt, z, x, y, worldPass); c.detail = 'sat-skyline'; return c;
}
const med = (a) => { const s = a.slice().sort((p, q) => p - q); return +s[Math.floor((s.length - 1) / 2)].toFixed(1); };
const out = {};
for (const [name, [lat, lon]] of Object.entries(PLACES)) {
  if (only && !only.includes(name)) continue;
  const [tx, ty] = tileOf(lat, lon, 14);
  const offT = []; const onT = []; const tabT = []; const sOff = []; const sOn = [];
  for (let dy = -RAD; dy <= RAD; dy++) for (let dx = -RAD; dx <= RAD; dx++) {
    const f = path.join(CACHE, `14-${tx + dx}-${ty + dy}.pbf`);
    if (!fs.existsSync(f)) continue;
    const bytes = fs.readFileSync(f); if (!bytes.length) continue;
    const a = []; const b = []; const c = []; const d = []; const g = [];
    for (let r = 0; r < REPS + 1; r++) {
      const vt0 = new VectorTile(new Pbf(bytes)); if (!vt0.layers.building) break;
      if (process.env.SKYONLY) { const s0 = performance.now(); if (process.env.SKYONLY === 'off') buildSatSkyline(skyCtx(new VectorTile(new Pbf(bytes)), 14, tx + dx, ty + dy, OFF)); else buildSatSkyline(skyCtx(new VectorTile(new Pbf(bytes)), 14, tx + dx, ty + dy, ON)); if (r > 0) a.push(performance.now() - s0); continue; }
      const t0 = performance.now(); const off = ctxFor(vt0, 14, tx + dx, ty + dy, OFF); const i0 = admitFootprints(off, classifyRingsSat); off.suburban = suburbanContext(i0, off); for (const it of i0) heightOf(it, off, 'near'); const t1 = performance.now();
      const vt1 = new VectorTile(new Pbf(bytes));
      const t2 = performance.now(); const on = ctxFor(vt1, 14, tx + dx, ty + dy, ON); truthTable(on); const t3 = performance.now(); const i1 = admitFootprints(on, classifyRingsSat); on.suburban = suburbanContext(i1, on); for (const it of i1) heightOf(it, on, 'near'); const t4 = performance.now();
      const t5 = performance.now(); if (!process.env.SKYON) buildSatSkyline(skyCtx(new VectorTile(new Pbf(bytes)), 14, tx + dx, ty + dy, OFF)); const t6 = performance.now(); buildSatSkyline(skyCtx(new VectorTile(new Pbf(bytes)), 14, tx + dx, ty + dy, ON)); const t7 = performance.now();
      if (r > 0) { a.push(t1 - t0); b.push(t4 - t2); c.push(t3 - t2); d.push(t6 - t5); g.push(t7 - t6); }
    }
    if (process.env.SKYONLY) { if (a.length) offT.push(Math.min(...a)); continue; }
    if (a.length) { offT.push(Math.min(...a)); onT.push(Math.min(...b)); tabT.push(Math.min(...c)); sOff.push(Math.min(...d)); sOn.push(Math.min(...g)); }
  }
  out[name] = { tiles: offT.length, legacy: med(offT), law: med(onT), table: med(tabT), legacyMax: Math.max(...offT), lawMax: Math.max(...onT), skyLegacy: med(sOff), skyLaw: med(sOn), skyLegacySum: +sOff.reduce((p, q) => p + q, 0).toFixed(0), skyLawSum: +sOn.reduce((p, q) => p + q, 0).toFixed(0) };
  console.log(name.padEnd(20), JSON.stringify(out[name]));
  if (globalThis.__tt) { const s = Object.values(globalThis.__tt).reduce((a, b) => a + b, 0); console.log('   sections%', JSON.stringify(Object.fromEntries(Object.entries(globalThis.__tt).map(([k, v]) => [k, Math.round((v / s) * 100)])))); globalThis.__tt = {}; }
}
if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(out, null, 1));






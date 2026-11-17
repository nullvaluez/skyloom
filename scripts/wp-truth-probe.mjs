/**
 * World Pass A (TRUTH) probe: the one height law against the legacy rules on
 * recorded OpenFreeMap z14 tiles, run through the REAL worker modules
 * (lib/fly/toy-world/worker/sat-buildings/*) in node.
 *
 *   node scripts/wp-truth-probe.mjs [--places a,b] [--out file.json]
 *
 * Per place (a 3x3 of z14 tiles around the pose):
 *   holdout   every mapped, ground-standing, admitted footprint has its height
 *             hidden and predicted: the new law (leave-one-out evidence) vs the
 *             legacy near rule (house band / suburban typology / sqrt-area
 *             curve). Absolute error p50 / p90, signed median, share within 3 m.
 *   inferred  the heights the near ring gives unmapped admitted footprints,
 *             legacy vs law (p50 / p90 / max), and the law's class / provenance mix.
 *   seam      footprints cut by a tile edge, seen from both tiles (same sid):
 *             share whose heights agree, legacy (per-tile ids) vs law.
 *   nearFar   unmapped far-hatch candidates (>= 900 m2): far ring height ==
 *             near ring height under the law (and under the legacy rules).
 *   admitted  polygons, admitted today (70 m2 floor on the clipped fragment)
 *             and the 15-70 m2 band (whole footprint), for M2.
 *
 * Tiles are cached in .graphics-review/world-pass/truth/tiles/ (fetched once
 * from the OpenFreeMap planet build the W0 proof recorded, then replayed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.graphics-review/world-pass/truth/tiles');
const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : null;
};
const probe = (base) => {
  for (const ext of ['', '.js', '.mjs', '/index.js']) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href;
  }
  return null;
};
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) {
      const u = probe(path.join(ROOT, spec.slice(2)));
      if (u) return { url: u, shortCircuit: true };
    }
    if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:')) {
      const base = fileURLToPath(new URL(spec, ctx.parentURL));
      if (!(fs.existsSync(base) && fs.statSync(base).isFile())) {
        const u = probe(base);
        if (u) return { url: u, shortCircuit: true };
      }
    }
    return next(spec, ctx);
  },
});

const { VectorTile } = await import('@mapbox/vector-tile');
const PbfMod = await import('pbf');
const Pbf = PbfMod.PbfReader ?? PbfMod.default;
const W = (p) => import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker', p)).href);
const { createTileCtx } = await W('tile-ctx.js');
const { admitFootprints } = await W('sat-buildings/admission.js');
const { suburbanContext, truthTable } = await W('sat-buildings/typology.js');
const { heightOf, truthHeight, nearHeight } = await W('sat-buildings/height.js');
const { classifyRingsSat } = await W('geom.js');
const { WORLD_TRUTH, SAT_POLY_COVER } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);

const TEMPLATE = 'https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf';
const PLACES = {
  nyc: [40.748, -73.994],
  brooklyn: [40.678, -73.97],
  paris: [48.853, 2.33],
  london: [51.502, -0.1],
  tokyo: [35.67, 139.735],
  'phoenix-suburb': [33.38, -111.84],
  lagos: [6.45, 3.39],
  dubai: [25.185, 55.26],
  powell: [40.199, -83.0811],
  owens: [36.6, -118.1],
  'iowa-farm': [41.95, -93.7],
};
const only = arg('--places')?.split(',');
const out = arg('--out');
const RAD = Number(arg('--r') ?? 1); // tile radius around the pose (1 = 3x3)

const tileOf = (lat, lon, z) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
};
fs.mkdirSync(CACHE, { recursive: true });
async function tileBytes(z, x, y) {
  const f = path.join(CACHE, `${z}-${x}-${y}.pbf`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const url = TEMPLATE.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  for (let a = 0; ; a++) {
    try {
      const r = await fetch(url);
      if (r.status === 404 || r.status === 204) {
        fs.writeFileSync(f, Buffer.alloc(0));
        return Buffer.alloc(0);
      }
      if (!r.ok) throw new Error(`http ${r.status}`);
      const b = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(f, b);
      return b;
    } catch (e) {
      if (a >= 3) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
    }
  }
}

const WORLD = 2 * Math.PI * 6378137;
const OFF = { v: 1, key: 'wp1-0', any: false, tier: null, truth: { on: false } };
const ON = {
  v: 1,
  key: 'probe',
  any: true,
  tier: 'ultra',
  truth: { on: true, heights: true, typology: true, smallBand: true, roofs: true, worker: JSON.parse(JSON.stringify(WORLD_TRUTH.worker)) },
  arrival: { on: false, worker: null },
  reach: { on: false, worker: null },
  look: { on: false, worker: null },
  ground: { on: false, worker: null },
};
function ctxFor(vt, z, x, y, worldPass) {
  const tileSpan = WORLD / 2 ** z;
  const mercX0 = -WORLD / 2 + x * tileSpan;
  const mercYTop = WORLD / 2 - y * tileSpan;
  const cx = mercX0 + tileSpan / 2;
  const cz = -(mercYTop - tileSpan / 2);
  const latC = ((2 * Math.atan(Math.exp(-cz / 6378137)) - Math.PI / 2) * 180) / Math.PI;
  const k = 1 / Math.cos((latC * Math.PI) / 180);
  const frame = { tileSpan, mercX0, mercYTop, cx, cz, k, t0: 0, visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true };
  return createTileCtx(vt, frame, { z, x, y, detail: 'sat-buildings', options: { visuals: true, trueAreas: true, worldPass }, v: 25, diag: false, clutterOnly: false });
}
const pct = (a, q) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))].toFixed(2);
};
const r2 = (v) => (v == null ? null : +v.toFixed(3));

const report = {};
for (const [name, [lat, lon]] of Object.entries(PLACES)) {
  if (only && !only.includes(name)) continue;
  const [tx, ty] = tileOf(lat, lon, 14);
  const ho = { newErr: [], oldErr: [], newSigned: [], oldSigned: [] };
  const hoLow = { newErr: [], oldErr: [], newSigned: [], oldSigned: [] }; // mapped <= the law's cap
  const inf = { old: [], law: [], cls: {}, prov: {}, byCls: {} };
  const seamMap = new Map();
  const nf = { n: 0, lawSame: 0, legacySame: 0 };
  const adm = { tiles: 0, emptyToday: 0, emptyTruth: 0, polygons: 0, admittedToday: 0, admittedTruth: 0, band15to70Whole: 0, rescuedHalves: 0, mapped: 0 };
  let msLaw = 0;
  let msLegacy = 0;
  for (let dy = -RAD; dy <= RAD; dy++) {
    for (let dx = -RAD; dx <= RAD; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      const bytes = await tileBytes(14, x, y);
      if (!bytes.length) continue;
      const vt = new VectorTile(new Pbf(bytes));
      if (!vt.layers.building) continue;
      // legacy (flag off)
      const off = ctxFor(vt, 14, x, y, OFF);
      const tl = performance.now();
      const items = admitFootprints(off, classifyRingsSat);
      off.suburban = suburbanContext(items, off);
      for (const it of items) heightOf(it, off, 'near');
      msLegacy += performance.now() - tl;
      const legacyById = new Map(items.map((it) => [it.id, it]));
      // law (flag on)
      const on = ctxFor(vt, 14, x, y, ON);
      const t0 = performance.now();
      const T = truthTable(on);
      const onItems = admitFootprints(on, classifyRingsSat);
      on.suburban = suburbanContext(onItems, on);
      for (const it of onItems) heightOf(it, on, 'near');
      msLaw += performance.now() - t0;
      adm.polygons += T.entries.length;
      adm.admittedToday += items.length;
      adm.admittedTruth += onItems.length;
      adm.tiles += 1;
      if (items.length === 0) adm.emptyToday += 1;
      if (onItems.length === 0) adm.emptyTruth += 1;
      for (const e of T.entries) {
        if (e.wholeM2 >= 15 && e.wholeM2 < 70.4) adm.band15to70Whole += 1;
        if (e.areaM2 < SAT_POLY_COVER.minAreaM2 && e.wholeM2 >= 70.4) adm.rescuedHalves += 1;
      }
      for (const it of onItems) {
        const lit = legacyById.get(it.id);
        const e = T.byId.get(it.id);
        if (!lit || !e) continue;
        if (it.rawH > 0) {
          adm.mapped += 1;
          if (e.minY > 0.5) continue;
          const truthH = it.rawH;
          const pn = truthHeight(e, T, e).h;
          const po = nearHeight({ ...lit, rawH: 0 }, off).h;
          ho.newErr.push(Math.abs(pn - truthH));
          ho.oldErr.push(Math.abs(po - truthH));
          ho.newSigned.push(pn - truthH);
          ho.oldSigned.push(po - truthH);
          if (truthH <= WORLD_TRUTH.worker.heights.maxInventedM) {
            hoLow.newErr.push(Math.abs(pn - truthH));
            hoLow.oldErr.push(Math.abs(po - truthH));
            hoLow.newSigned.push(pn - truthH);
            hoLow.oldSigned.push(po - truthH);
          }
          continue;
        }
        const hl = heightOf(it, on, 'near');
        const ho2 = nearHeight(lit, off);
        inf.law.push(hl.h);
        inf.old.push(ho2.h);
        const law = e._law;
        inf.cls[law.cls] = (inf.cls[law.cls] ?? 0) + 1;
        (inf.byCls[law.cls] ??= []).push(hl.h);
        inf.prov[law.prov] = (inf.prov[law.prov] ?? 0) + 1;
        if (e.straddle) {
          const rec = seamMap.get(e.sid) ?? [];
          rec.push({ tile: `${x}/${y}`, law: hl.h, old: ho2.h });
          seamMap.set(e.sid, rec);
        }
        if (it.areaM2 >= 900) {
          nf.n += 1;
          const on2 = ctxFor(vt, 14, x, y, ON);
          const off2 = ctxFor(vt, 14, x, y, OFF);
          const far = heightOf({ rawH: 0, areaM2: it.areaM2, id: it.id, hatch: true }, on2, 'far').h;
          const farOld = heightOf({ rawH: 0, areaM2: it.areaM2, id: it.id, hatch: true }, off2, 'far').h;
          if (Math.abs(far - hl.h) < 1e-9) nf.lawSame += 1;
          if (Math.abs(farOld - ho2.h) < 1) nf.legacySame += 1;
        }
      }
    }
  }
  let pairs = 0;
  let lawAgree = 0;
  let oldAgree = 0;
  for (const rec of seamMap.values()) {
    const tiles = new Set(rec.map((r) => r.tile));
    if (tiles.size < 2) continue;
    pairs += 1;
    if (Math.max(...rec.map((r) => r.law)) - Math.min(...rec.map((r) => r.law)) < 0.01) lawAgree += 1;
    if (Math.max(...rec.map((r) => r.old)) - Math.min(...rec.map((r) => r.old)) < 0.01) oldAgree += 1;
  }
  const within = (a, m) => (a.length ? r2(a.filter((v) => v <= m).length / a.length) : null);
  const hstat = (o) => ({
    n: o.newErr.length,
    law: { absP50: pct(o.newErr, 0.5), absP90: pct(o.newErr, 0.9), signedP50: pct(o.newSigned, 0.5), within3m: within(o.newErr, 3) },
    legacy: { absP50: pct(o.oldErr, 0.5), absP90: pct(o.oldErr, 0.9), signedP50: pct(o.oldSigned, 0.5), within3m: within(o.oldErr, 3) },
  });
  report[name] = {
    holdoutUpToCap: hstat(hoLow),
    holdout: {
      n: ho.newErr.length,
      law: { absP50: pct(ho.newErr, 0.5), absP90: pct(ho.newErr, 0.9), signedP50: pct(ho.newSigned, 0.5), within3m: within(ho.newErr, 3) },
      legacy: { absP50: pct(ho.oldErr, 0.5), absP90: pct(ho.oldErr, 0.9), signedP50: pct(ho.oldSigned, 0.5), within3m: within(ho.oldErr, 3) },
    },
    inferred: {
      n: inf.law.length,
      legacy: { p50: pct(inf.old, 0.5), p90: pct(inf.old, 0.9), max: inf.old.length ? r2(Math.max(...inf.old)) : null },
      law: { p50: pct(inf.law, 0.5), p90: pct(inf.law, 0.9), max: inf.law.length ? r2(Math.max(...inf.law)) : null },
      cls: inf.cls,
      clsP50: Object.fromEntries(Object.entries(inf.byCls).map(([c, a]) => [c, pct(a, 0.5)])),
      prov: inf.prov,
    },
    seam: { pairs, lawAgree: pairs ? r2(lawAgree / pairs) : null, legacyAgree: pairs ? r2(oldAgree / pairs) : null },
    nearFar: { n: nf.n, lawSame: nf.lawSame, legacySameWithin1m: nf.legacySame },
    admitted: adm,
    lawMsPer9Tiles: +msLaw.toFixed(0),
    legacyMsPer9Tiles: +msLegacy.toFixed(0),
  };
  console.log(name, JSON.stringify(report[name]));
}
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));

/**
 * World Pass A (TRUTH) round-2 probe: the height law against the legacy rules
 * on recorded OpenFreeMap z14 tiles, run through the REAL worker modules in
 * node. Not product code.
 *
 *   node scripts/wp-truth-r2-probe.mjs [--places a,b] [--set tuning|holdout|all] [--r 1] [--out file.json]
 *
 * Per place (a (2r+1)^2 block of z14 tiles):
 *   holdout    every mapped, ground-standing, admitted footprint has its height
 *              hidden and predicted: the law (leave-one-out evidence) against
 *              the legacy near rule. Up to the law's cap (24 m) and all heights.
 *   inferred   the heights given to UNMAPPED admitted footprints: p10 / p50 /
 *              p90 / max, the share on the single most common height (0.5 m
 *              bins), the share at the cap, and per class the storey mix.
 *   houses     the class 'house': share drawn with 2 or more storeys.
 *   bigLow     unmapped footprints >= 1,000 m2 drawn under 9 m, by class, and
 *              how many of them stand in dense cover (>= 0.3).
 *   seam       GEOMETRIC seam pairs (no sid used): for each footprint of tile A
 *              that touches the shared edge, the point 0.75 units across the
 *              edge must lie in a raw ring of tile B. Over every such pair of
 *              unmapped admitted halves: share whose heights agree within
 *              0.01 m, p90 / max gap, share with equal sid and equal class.
 *   empty      tiles with no admitted body, legacy and law.
 *
 * Tiles: the recorded planet build 20261101_080013_pt (cached under
 * .graphics-review/world-pass/truth/tiles and truth/verify/tiles). The live
 * build changed on 2026-11-15; these numbers are for the recorded one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GR = path.join(ROOT, '.graphics-review/world-pass/truth');
const CACHES = [path.join(GR, 'tiles'), path.join(GR, 'verify/tiles'), path.join(GR, 'verify-tiles')].filter((d) => fs.existsSync(d));
const WRITE = path.join(GR, 'tiles');
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
const { classifyRingsSat, clipRing, pointInPoly } = await W('geom.js');
const { WORLD_TRUTH } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);

const TEMPLATE = 'https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf';
// [lat, lon, dx tiles, dy tiles]
const TUNING = {
  nyc: [40.748, -73.994],
  brooklyn: [40.678, -73.97],
  paris: [48.853, 2.33],
  london: [51.502, -0.1],
  tokyo: [35.67, 139.735],
  'phoenix-suburb': [33.38, -111.84],
  lagos: [6.45, 3.39],
  dubai: [25.185, 55.26],
  powell: [40.158, -83.075],
  'powell-north': [40.199, -83.0811],
  owens: [36.6, -118.1],
  'iowa-farm': [41.95, -93.7],
};
// never used to set a tunable (the wave-1 verifier's out-of-sample set)
const HOLDOUT = {
  'nyc-oos': [40.748, -73.994, 0, 6],
  'paris-oos': [48.853, 2.33, 6, 0],
  'london-oos': [51.502, -0.1, -6, 0],
  'tokyo-oos': [35.67, 139.735, 0, -6],
  'phoenix-oos': [33.38, -111.84, 6, 0],
  'lagos-oos': [6.45, 3.39, 6, 0],
  'dubai-oos': [25.185, 55.26, -6, 0],
  berlin: [52.52, 13.405],
  chicago: [41.88, -87.63],
  'la-suburb': [34.02, -118.15],
  madrid: [40.42, -3.7],
  seoul: [37.55, 126.98],
  sydney: [-33.87, 151.21],
  'sao-paulo': [-23.55, -46.63],
  mumbai: [19.07, 72.88],
  'seattle-suburb': [47.61, -122.2],
  toronto: [43.66, -79.39],
  columbus: [39.98, -83.0],
  'mexico-city': [19.42, -99.16],
  istanbul: [41.04, 28.98],
  warsaw: [52.23, 21.01],
  singapore: [1.31, 103.85],
  cairo: [30.05, 31.24],
};
const setName = arg('--set') ?? 'all';
const PLACES = setName === 'tuning' ? TUNING : setName === 'holdout' ? HOLDOUT : { ...TUNING, ...HOLDOUT };
const only = arg('--places')?.split(',');
const out = arg('--out');
const RAD = Number(arg('--r') ?? 1);
const legacyOnly = argv.includes('--fast');

const tileOf = (lat, lon, z) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
};
fs.mkdirSync(WRITE, { recursive: true });
async function tileBytes(z, x, y) {
  for (const d of CACHES) {
    const f = path.join(d, `${z}-${x}-${y}.pbf`);
    if (fs.existsSync(f)) return fs.readFileSync(f);
  }
  const f = path.join(WRITE, `${z}-${x}-${y}.pbf`);
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
  return createTileCtx(vt, frame, { z, x, y, detail: 'sat-buildings', options: { visuals: true, trueAreas: true, worldPass }, v: 26, diag: false, clutterOnly: false });
}
const pct = (a, q) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))].toFixed(2);
};
const r3 = (v) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(3));
const within = (a, m) => (a.length ? r3(a.filter((v) => v <= m).length / a.length) : null);

function buildTile(vt, z, x, y) {
  const off = ctxFor(vt, z, x, y, OFF);
  const items = admitFootprints(off, classifyRingsSat);
  off.suburban = suburbanContext(items, off);
  const legacy = new Map();
  for (const it of items) legacy.set(it.id, { it, h: heightOf(it, off, 'near').h });
  const on = ctxFor(vt, z, x, y, ON);
  const t0 = performance.now();
  const T = truthTable(on);
  const onItems = admitFootprints(on, classifyRingsSat);
  on.suburban = suburbanContext(onItems, on);
  const law = new Map();
  for (const it of onItems) law.set(it.id, { it, h: heightOf(it, on, 'near').h });
  const ms = performance.now() - t0;
  const layer = vt.layers.building;
  const ext = layer.extent;
  const raws = new Map();
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || f.properties.hide_3d) continue;
    const raw = f.loadGeometry();
    const keep = [];
    const rawOf = new Map();
    for (const r of raw) {
      const c = clipRing(r, ext);
      if (c.length >= 3) {
        keep.push(c);
        rawOf.set(c, r);
      }
    }
    const polys = classifyRingsSat(keep);
    const fid = typeof f.id === 'number' ? f.id : i;
    for (let pi = 0; pi < polys.length; pi++) {
      const pid = (Math.imul(fid, 2654435761) ^ Math.imul(pi + 1, 40503)) >>> 0;
      raws.set(pid, { clip: polys[pi].outer, raw: rawOf.get(polys[pi].outer) ?? null });
    }
  }
  return { ext, T, legacy, law, raws, off, on, ms, nLegacy: items.length, nLaw: onItems.length };
}

const report = {};
for (const [name, [lat, lon, dxT = 0, dyT = 0]] of Object.entries(PLACES)) {
  if (only && !only.includes(name)) continue;
  const [tx0, ty0] = tileOf(lat, lon, 14);
  const tx = tx0 + dxT;
  const ty = ty0 + dyT;
  const tiles = new Map();
  for (let dy = -RAD; dy <= RAD; dy++) {
    for (let dx = -RAD; dx <= RAD; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      const bytes = await tileBytes(14, x, y);
      if (!bytes.length) {
        tiles.set(`${x}/${y}`, { x, y, none: true });
        continue;
      }
      const vt = new VectorTile(new Pbf(bytes));
      if (!vt.layers.building) {
        tiles.set(`${x}/${y}`, { x, y, none: true });
        continue;
      }
      tiles.set(`${x}/${y}`, { x, y, ...buildTile(vt, 14, x, y) });
    }
  }
  const ho = { law: [], leg: [], lawS: [], legS: [] };
  const hoLow = { law: [], leg: [], lawS: [], legS: [] };
  const inf = { law: [], leg: [], cls: {}, storeys: {} };
  const houses = { n: 0, two: 0 };
  const bigLow = { n: 0, dense: 0, byCls: {} };
  const empty = { tiles: 0, legacy: 0, law: 0 };
  const mapped = {};
  let ms = 0;
  for (const t of tiles.values()) {
    empty.tiles += 1;
    if (t.none) {
      empty.legacy += 1;
      empty.law += 1;
      continue;
    }
    ms += t.ms;
    if (t.nLegacy === 0) empty.legacy += 1;
    if (t.nLaw === 0) empty.law += 1;
    for (const [id, { it, h }] of t.law) {
      const e = t.T.byId.get(id);
      const lg = t.legacy.get(id);
      if (!e) continue;
      if (it.rawH > 0) {
        if (e.minY > 0.5 || !lg) continue;
        (mapped[e.cls] ??= []).push(it.rawH);
        const pn = truthHeight(e, t.T, e).h;
        const po = nearHeight({ ...lg.it, rawH: 0 }, t.off).h;
        ho.law.push(Math.abs(pn - it.rawH));
        ho.leg.push(Math.abs(po - it.rawH));
        ho.lawS.push(pn - it.rawH);
        ho.legS.push(po - it.rawH);
        if (it.rawH <= 24) {
          hoLow.law.push(Math.abs(pn - it.rawH));
          hoLow.leg.push(Math.abs(po - it.rawH));
          hoLow.lawS.push(pn - it.rawH);
          hoLow.legS.push(po - it.rawH);
        }
        continue;
      }
      inf.law.push(h);
      if (lg) inf.leg.push(lg.h);
      const law = e._law;
      if (law) {
        inf.cls[law.cls] = (inf.cls[law.cls] ?? 0) + 1;
        const sm = (inf.storeys[law.cls] ??= {});
        sm[law.storeys] = (sm[law.storeys] ?? 0) + 1;
        if (law.cls === 'house') {
          houses.n += 1;
          if (law.storeys >= 2) houses.two += 1;
        }
        if (e.wholeM2 >= 1000 && h < 9) {
          bigLow.n += 1;
          if (e.cover >= 0.3) bigLow.dense += 1;
          bigLow.byCls[law.cls] = (bigLow.byCls[law.cls] ?? 0) + 1;
        }
      }
    }
  }
  // geometric seam pairs
  const seam = { n: 0, agree: 0, diffs: [], sidSame: 0, clsSame: 0, legN: 0, legAgree: 0, mixed: 0 };
  for (const a of tiles.values()) {
    if (a.none) continue;
    for (const [ddx, ddy] of [
      [1, 0],
      [0, 1],
    ]) {
      const b = tiles.get(`${a.x + ddx}/${a.y + ddy}`);
      if (!b || b.none) continue;
      const ext = a.ext;
      for (const [id, rec] of a.law) {
        const ra = a.raws.get(id);
        if (!ra) continue;
        const edge = ra.clip.filter((q) => (ddx ? q.x >= ext - 0.01 : q.y >= ext - 0.01));
        if (edge.length < 2) continue;
        let mx = 0;
        let my = 0;
        for (const q of edge) {
          mx += q.x;
          my += q.y;
        }
        mx /= edge.length;
        my /= edge.length;
        const px = ddx ? -0.75 : mx;
        const py = ddx ? my : -0.75;
        let hit = null;
        for (const [idB, rb] of b.raws) {
          if (!rb.raw) continue;
          if (pointInPoly({ outer: rb.raw, holes: [] }, px, py)) {
            hit = idB;
            break;
          }
        }
        if (hit == null) continue;
        const lb = b.law.get(hit);
        if (!lb) continue;
        if (rec.it.rawH > 0 || lb.it.rawH > 0) {
          if (!(rec.it.rawH > 0 && lb.it.rawH > 0)) seam.mixed += 1;
          continue;
        }
        seam.n += 1;
        const d = Math.abs(rec.h - lb.h);
        seam.diffs.push(d);
        if (d < 0.01) seam.agree += 1;
        else if (argv.includes('--seamDebug') && (seam.dbg = (seam.dbg ?? 0) + 1) <= 12) {
          const ea = a.T.byId.get(id);
          const eb = b.T.byId.get(hit);
          const f = (e) => ({ sid: e.sid, cls: e.cls, seam: !!e.seam, str: e.straddle, A: +e.clsM2.toFixed(1), cov: +e.cover.toFixed(3), adj: +e.coverAdj.toFixed(3), wide: +e.coverWide.toFixed(3), lu: e.landuse, sh: e.shared, hole: +e.holeFrac.toFixed(3), bb: [e.bx0, e.by0, e.bx1, e.by1], reg: e.region, st: e._law?.storeys, prov: e._law?.prov });
          console.log('SEAM', name, ddx ? 'x' : 'y', rec.h.toFixed(2), lb.h.toFixed(2), JSON.stringify(f(ea)), JSON.stringify(f(eb)));
        }
        if (rec.it.sid === lb.it.sid) seam.sidSame += 1;
        if (rec.it.truthCls === lb.it.truthCls) seam.clsSame += 1;
        const ga = a.legacy.get(id);
        const gb = b.legacy.get(hit);
        if (ga && gb) {
          seam.legN += 1;
          if (Math.abs(ga.h - gb.h) < 0.01) seam.legAgree += 1;
        }
      }
    }
  }
  const binned = new Map();
  for (const h of inf.law) {
    const b = Math.round(h * 2) / 2;
    binned.set(b, (binned.get(b) ?? 0) + 1);
  }
  let modeH = null;
  let modeN = 0;
  for (const [b, n] of binned)
    if (n > modeN) {
      modeN = n;
      modeH = b;
    }
  const cap = WORLD_TRUTH.worker.heights.maxInventedM;
  const hs = (o) => ({
    n: o.law.length,
    law: { p50: pct(o.law, 0.5), p90: pct(o.law, 0.9), signed: pct(o.lawS, 0.5), w3: within(o.law, 3) },
    leg: { p50: pct(o.leg, 0.5), p90: pct(o.leg, 0.9), signed: pct(o.legS, 0.5), w3: within(o.leg, 3) },
  });
  report[name] = {
    tiles: empty.tiles,
    holdoutLe24: hs(hoLow),
    holdoutAll: hs(ho),
    inferred: {
      n: inf.law.length,
      law: { p10: pct(inf.law, 0.1), p50: pct(inf.law, 0.5), p90: pct(inf.law, 0.9), max: pct(inf.law, 1) },
      leg: { p10: pct(inf.leg, 0.1), p50: pct(inf.leg, 0.5), p90: pct(inf.leg, 0.9), max: pct(inf.leg, 1) },
      modeH,
      modeShare: inf.law.length ? r3(modeN / inf.law.length) : null,
      atCapShare: inf.law.length ? r3(inf.law.filter((v) => v >= cap - 0.6).length / inf.law.length) : null,
      cls: inf.cls,
      storeys: inf.storeys,
    },
    houses: { n: houses.n, twoPlusShare: houses.n ? r3(houses.two / houses.n) : null },
    bigLow,
    seam: {
      pairs: seam.n,
      agree: seam.n ? r3(seam.agree / seam.n) : null,
      gapP90: pct(seam.diffs, 0.9),
      gapMax: pct(seam.diffs, 1),
      sidSame: seam.n ? r3(seam.sidSame / seam.n) : null,
      clsSame: seam.n ? r3(seam.clsSame / seam.n) : null,
      legacyAgree: seam.legN ? r3(seam.legAgree / seam.legN) : null,
      mixedMappedUnmapped: seam.mixed,
    },
    empty,
    mapped: Object.fromEntries(Object.entries(mapped).map(([c, a]) => [c, [a.length, pct(a, 0.25), pct(a, 0.5), pct(a, 0.75)]])),
    lawMsPerTile: +(ms / Math.max(1, empty.tiles - empty.legacy)).toFixed(1),
  };
  const R = report[name];
  console.log(
    `${name.padEnd(15)} ho24 ${R.holdoutLe24.law.p50}/${R.holdoutLe24.leg.p50} (n ${R.holdoutLe24.n}) hoAll ${R.holdoutAll.law.p50}/${R.holdoutAll.leg.p50} | inf p10/50/90 ${R.inferred.law.p10}/${R.inferred.law.p50}/${R.inferred.law.p90} mode ${R.inferred.modeH}@${R.inferred.modeShare} cap ${R.inferred.atCapShare} | house2+ ${R.houses.twoPlusShare} (n ${R.houses.n}) | bigLow ${R.bigLow.n} dense ${R.bigLow.dense} ${JSON.stringify(R.bigLow.byCls)} | seam ${R.seam.pairs} agree ${R.seam.agree} p90 ${R.seam.gapP90} sid ${R.seam.sidSame} cls ${R.seam.clsSame} leg ${R.seam.legacyAgree} | empty ${R.empty.legacy}->${R.empty.law}/${R.empty.tiles} | ${R.lawMsPerTile} ms`,
  );
}
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));

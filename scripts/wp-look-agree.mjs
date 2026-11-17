/**
 * World Pass D (LOOK) round 2 node gate: agreement measured on what the worker
 * emits, each with a control arm that must disagree (round 1 reported part
 * piles 214 to 0, true by construction).
 *   node scripts/wp-look-agree.mjs [--out <json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
const OUT = arg('--out') ?? path.join(ROOT, '.graphics-review/world-pass/look/roofphoto.json');
const only = arg('--only');

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

// --- inputs ---------------------------------------------------------------------
const PROOF_IN = path.join(ROOT, '.graphics-review/world-pass/w0/proof-inputs');
const LOOK_IN = path.join(ROOT, '.graphics-review/world-pass/look/inputs');
fs.mkdirSync(LOOK_IN, { recursive: true });
const proofIndex = fs.existsSync(path.join(PROOF_IN, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(PROOF_IN, 'index.json'), 'utf8')) : {};
const lookIndexFile = path.join(LOOK_IN, 'index.json');
const lookIndex = fs.existsSync(lookIndexFile) ? JSON.parse(fs.readFileSync(lookIndexFile, 'utf8')) : {};
async function getBytes(url) {
  const pr = proofIndex[url];
  if (pr) return { status: pr.status, body: fs.readFileSync(path.join(PROOF_IN, pr.file)) };
  const lr = lookIndex[url];
  if (lr) return { status: lr.status, body: fs.readFileSync(path.join(LOOK_IN, lr.file)) };
  let res;
  for (let a = 0; ; a++) {
    try {
      res = await fetch(url, { credentials: 'omit' });
      if (res.status >= 500 || res.status === 429) throw new Error(`http ${res.status}`);
      break;
    } catch (e) {
      if (a >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (a + 1)));
    }
  }
  const body = Buffer.from(await res.arrayBuffer());
  const file = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32) + '.bin';
  fs.writeFileSync(path.join(LOOK_IN, file), body);
  lookIndex[url] = { file, status: res.status };
  fs.writeFileSync(lookIndexFile, JSON.stringify(lookIndex, null, 1));
  return { status: res.status, body };
}

const { VectorTile } = await import('@mapbox/vector-tile');
const { PbfReader } = await import('pbf');
const { default: sharp } = await import('sharp');
const C = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
const { createTileCtx } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/tile-ctx.js')).href);
const { buildSatBuildings } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/sat-buildings/index.js')).href);
const { architectureContext, architectureStyle } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/sat-buildings/typology.js')).href);
const { colourOf } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/sat-buildings/colour.js')).href);
const PS = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/photo-sampler.js')).href);
const AR = await import(pathToFileURL(path.join(ROOT, 'lib/fly/architectural-realism.js')).href);

const tj = JSON.parse((await getBytes('https://tiles.openfreemap.org/planet')).body.toString('utf8'));
const TEMPLATE = tj.tiles[0];

/** The request world-pass.js builds with only WORLD_LOOK on (schema v1, Ultra). */
function lookRequest(overrides = {}) {
  const streams = { truth: ['heights', 'typology', 'smallBand', 'roofs'], arrival: ['fastQuery', 'drapeCap', 'workerPrep', 'uploads', 'footings', 'readiness'], reach: ['standIns'], look: ['roofPhoto', 'walls', 'structures', 'authority'], ground: ['trees', 'bridges'] };
  const req = { v: 1, key: 'wp1-ultra-look', any: true, tier: 'ultra' };
  for (const [s, subs] of Object.entries(streams)) {
    const on = s === 'look';
    req[s] = { on, ...Object.fromEntries(subs.map((k) => [k, on && (overrides[k] ?? C.WORLD_LOOK[k]) !== false])), worker: on ? JSON.parse(JSON.stringify(C.WORLD_LOOK.worker)) : null };
  }
  return req;
}

const PLACES = {
  nyc: [40.7549, -73.984],
  brooklyn: [40.678, -73.944],
  paris: [48.8566, 2.3522],
  london: [51.5045, -0.0865], // London Bridge, 14/8188/5448 (the Shard)
  tokyo: [35.6812, 139.7671],
  phoenix: [33.38, -111.84],
};
const tileOf = (lat, lon, z) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
};
const WORLD = 2 * Math.PI * 6378137;
function frameOf(z, x, y) {
  const tileSpan = WORLD / 2 ** z;
  const mercX0 = -WORLD / 2 + x * tileSpan;
  const mercYTop = WORLD / 2 - y * tileSpan;
  const cx = mercX0 + tileSpan / 2;
  const cz = -(mercYTop - tileSpan / 2);
  const latC = (2 * Math.atan(Math.exp(-cz / 6378137)) - Math.PI / 2) * (180 / Math.PI);
  const k = 1 / Math.cos((latC * Math.PI) / 180);
  return { tileSpan, mercX0, mercYTop, cx, cz, k, t0: performance.now(), visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true };
}
const ESRI = 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
async function photoFor(z, x, y, cfg) {
  const sub = 2 ** (cfg.zoom - z);
  const size = 256 * sub;
  const comps = [];
  const valid = new Uint8Array(sub * sub);
  for (let j = 0; j < sub; j++) {
    for (let i = 0; i < sub; i++) {
      const r = await getBytes(ESRI.replace('{z}', cfg.zoom).replace('{y}', y * sub + j).replace('{x}', x * sub + i));
      if (r.status !== 200 || r.body.length === cfg.placeholderBytes) continue;
      comps.push({ input: await sharp(r.body).resize(256, 256).removeAlpha().png().toBuffer(), left: i * 256, top: j * 256 });
      valid[j * sub + i] = 1;
    }
  }
  const rgb = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).composite(comps).ensureAlpha().raw().toBuffer();
  const s = z - cfg.refZoom;
  const rr = await getBytes(ESRI.replace('{z}', cfg.refZoom).replace('{y}', y >> s).replace('{x}', x >> s));
  let ref = null;
  if (rr.status === 200 && rr.body.length !== cfg.placeholderBytes) {
    const span = 1 << s, cell = 256 / span;
    const data = await sharp(rr.body).resize(256, 256).ensureAlpha().extract({ left: (x % span) * cell, top: (y % span) * cell, width: cell, height: cell }).raw().toBuffer();
    ref = { n: cell, rgba: new Uint8ClampedArray(data) };
  }
  return PS.photoFromPixels(new Uint8ClampedArray(rgb), size, valid, sub, ref, cfg);
}

// --- agreement gate (round 2: measurements that can fail) ---------------------
//
// Every number here is read off the FINAL bundle the worker emits (vertex
// colours and style bytes), or off the far colour function, never off the
// relation's own bookkeeping, and each has a control arm that must disagree.
//   S  structures: a multi-part structure (relateParts group) whose kept parts
//      carry different wall-top colours in the bundle. Control: look.structures off.
//   M  seam halves (Midtown E-W 4824|4825 and N-S 6157|6158): building halves
//      paired by their contact span on the shared seam (+-3 tile units), wall
//      tops compared in the two bundles. Reported as measured (no bar).
//   F  near vs far: for every admitted building, every wall (tagged included),
//      the far wall exactly as the live callers ask for it (lookFarColour with
//      no far01, as colourOf 'far' calls it; divided by the constant far wall
//      shade) and its material, against the near wall and material in the
//      bundle; with lookFarPrepare (the near ring's structure key), without it
//      (the round-1 part key), and at round 2's live far01 0.6 (a control that
//      must differ). Round 3: round 2 measured only far01 = 0 and untagged walls,
//      while the live callers used 0.6 (verifier, far-verify.json).
const LR = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/look-roofs.js')).href);
const ST = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/sat-buildings/structures.js')).href);
const AD = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/sat-buildings/admission.js')).href);
const G = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/geom.js')).href);
const CO = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/sat-buildings/colour.js')).href);

async function regionalRGBA(z, x, y, cfg) {
  const s = z - cfg.refZoom;
  const r = await getBytes(ESRI.replace('{z}', cfg.refZoom).replace('{y}', y >> s).replace('{x}', x >> s));
  if (r.status !== 200 || r.body.length === cfg.placeholderBytes) return null;
  return new Uint8ClampedArray(await sharp(r.body).resize(256, 256).ensureAlpha().raw().toBuffer());
}
const opts = { visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true, airportLandmarks: false, operationsAirports: [] };
const report = { date: new Date().toISOString(), structures: {}, seams: {}, nearFar: {}, pass: true, fails: [] };
const fail = (m) => {
  report.pass = false;
  report.fails.push(m);
  console.log('FAIL', m);
};

/** Build a near tile; returns its items with the wall-top colour read off the bundle. */
async function near(z, x, y, overrides = {}) {
  const mvt = await getBytes(TEMPLATE.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  const req = lookRequest(overrides);
  const cfg = PS.photoConfig(req.look);
  PS.regionalSeed(z, x, y, cfg, await regionalRGBA(z, x, y, cfg));
  const options = { ...opts, worldPass: req };
  const inB = LR.lookBegin(z, x, y, 'sat-buildings', options);
  const ctx = createTileCtx(new VectorTile(new PbfReader(new Uint8Array(mvt.body))), { ...frameOf(z, x, y), ...inB.frame() }, { z, x, y, detail: 'sat-buildings', options, v: 26 });
  const out = LR.lookAfterBuild(buildSatBuildings(ctx), ctx);
  const sb = out.satBuilding;
  // Per anchor: every distinct wall colour the run carries (wall tops, AO bases,
  // stepped levels, split faces), the brightest as its representative.
  const top = new Map();
  for (let v = 0; v < sb.anchor.length / 2; v++) {
    if (sb.style[v * 3 + 2] === 0) continue;
    const k = `${sb.anchor[v * 2]},${sb.anchor[v * 2 + 1]}`;
    const c = [sb.col[v * 3], sb.col[v * 3 + 1], sb.col[v * 3 + 2]].map((q) => (sb.col instanceof Uint8Array ? q / 255 : q));
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    let t = top.get(k);
    if (!t) top.set(k, (t = { L, c, z: sb.style[v * 3 + 2], all: [] }));
    if (L > t.L) Object.assign(t, { L, c });
    if (t.all.length < 64 && !t.all.some((q) => q[0] === c[0] && q[1] === c[1] && q[2] === c[2])) t.all.push(c);
  }
  // An anchor shared by two kept buildings (a part and an outline with one
  // centroid) cannot say whose wall a vertex is: those are left out (counted).
  const per = new Map();
  for (const it of ctx.look.items) {
    const a = LR.anchorOf(it, ctx);
    const k = `${a[0]},${a[1]}`;
    per.set(k, (per.get(k) || 0) + 1);
  }
  const rows = new Map();
  let shared = 0;
  for (const it of ctx.look.items) {
    const a = LR.anchorOf(it, ctx);
    const k = `${a[0]},${a[1]}`;
    if (per.get(k) > 1) {
      shared += 1;
      continue;
    }
    const t = top.get(k);
    if (t) rows.set(it, t);
  }
  return { ctx, rows, items: ctx.look.items, sharedAnchor: shared };
}
const dmax = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const TOL = 2.5 / 255;

// S: structures.
for (const [name, ll] of [['nyc', PLACES.nyc], ['london', PLACES.london], ['paris', PLACES.paris], ['tokyo', PLACES.tokyo]]) {
  const [x, y] = tileOf(...ll, 14);
  const res = {};
  for (const arm of ['on', 'control']) {
    const N = await near(14, x, y, arm === 'control' ? { structures: false } : {});
    // The relation over the SAME admitted set (computed independently of the build's own bookkeeping).
    const adm = AD.admitFootprints(N.ctx, G.classifyRingsSat);
    const rel = ST.relateParts(adm, N.ctx);
    const sig = (it) => it.polys.map((p) => p.outer.map((q) => `${q.x},${q.y}`).join(";")).join("|"); // the whole footprint (a partial key collides)
    const bySig = new Map(N.items.map((it) => [sig(it), it]));
    const groups = new Map();
    adm.forEach((it, i) => {
      if (rel.group[i] < 0 || !rel.keep[i]) return;
      const nit = bySig.get(sig(it));
      const row = nit && N.rows.get(nit);
      if (!row) return;
      if (!groups.has(rel.group[i])) groups.set(rel.group[i], []);
      groups.get(rel.group[i]).push(row);
    });
    let multi = 0, split = 0;
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      multi += 1;
      // The parts agree when their brightest wall colour is one the root's walls carry, in the same material.
      if (g.some((r) => r.z !== g[0].z || !g[0].all.some((c) => dmax(r.c, c) <= TOL))) split += 1;
    }
    res[arm] = { structures: multi, partsDisagree: split };
  }
  report.structures[name] = res;
  console.log('S', name, JSON.stringify(res));
  if (res.on.partsDisagree) fail(`S ${name}: ${res.on.partsDisagree} of ${res.on.structures} structures have parts with different wall tops`);
  if (res.control.structures && !res.control.partsDisagree) fail(`S ${name}: the control arm (structures off) agrees too, so the measure cannot fail`);
}

// M: seams (as measured).
{
  const A = await near(14, 4824, 6157), B = await near(14, 4825, 6157), S2 = await near(14, 4824, 6158);
  const contacts = (N, side) => {
    const E = N.ctx.extent, out = [];
    for (const it of N.items) {
      const r = N.rows.get(it);
      if (!r) continue;
      const ring = it.polys[0].outer;
      let lo = Infinity, hi = -Infinity;
      for (let e = 0, q = ring.length - 1; e < ring.length; q = e++) {
        const a = ring[q], b = ring[e];
        const on = side === 'E' ? Math.abs(a.x - E) < 1e-3 && Math.abs(b.x - E) < 1e-3 : side === 'W' ? Math.abs(a.x) < 1e-3 && Math.abs(b.x) < 1e-3 : side === 'S' ? Math.abs(a.y - E) < 1e-3 && Math.abs(b.y - E) < 1e-3 : Math.abs(a.y) < 1e-3 && Math.abs(b.y) < 1e-3;
        if (!on) continue;
        const v = side === 'E' || side === 'W' ? [a.y, b.y] : [a.x, b.x];
        lo = Math.min(lo, ...v);
        hi = Math.max(hi, ...v);
      }
      if (hi - lo > 0.5) out.push({ r, lo, hi });
    }
    return out;
  };
  for (const [label, P, Q, sa, sb2] of [['E-W 4824|4825', A, B, 'E', 'W'], ['N-S 6157|6158', A, S2, 'S', 'N']]) {
    const Lc = contacts(P, sa), Rc = contacts(Q, sb2);
    let pairs = 0, same = 0, colourDiffers = 0, materialDiffers = 0, gainDiffers = 0;
    for (const l of Lc) {
      const m = Rc.find((q) => Math.abs(q.lo - l.lo) < 3 && Math.abs(q.hi - l.hi) < 3);
      if (!m) continue;
      pairs += 1;
      if (dmax(l.r.c, m.r.c) <= TOL && l.r.z === m.r.z) same += 1;
      if (dmax(l.r.c, m.r.c) > TOL) colourDiffers += 1;
      if (l.r.z % 4 !== m.r.z % 4) materialDiffers += 1;
      else if (l.r.z !== m.r.z) gainDiffers += 1;
    }
    report.seams[label] = { pairs, sameWallTop: same, colourDiffers, materialDiffers, gainDiffers };
    console.log('M', label, JSON.stringify(report.seams[label]));
  }
}

// F: near vs far at the near ring's edge.
for (const [name, ll] of [['nyc', PLACES.nyc], ['paris', PLACES.paris], ['tokyo', PLACES.tokyo], ['london', PLACES.london]]) {
  const [x, y] = tileOf(...ll, 14);
  const N = await near(14, x, y);
  const mvt = await getBytes(TEMPLATE.replace('{z}', 14).replace('{x}', x).replace('{y}', y));
  const res = {};
  for (const arm of ['prepared', 'partKey', 'round2']) {
    const req = lookRequest();
    const ctxF = createTileCtx(new VectorTile(new PbfReader(new Uint8Array(mvt.body))), { ...frameOf(14, x, y) }, { z: 14, x, y, detail: 'sat-skyline', options: { ...opts, worldPass: req }, v: 26 });
    const adm = AD.admitFootprints(ctxF, G.classifyRingsSat);
    if (arm !== 'partKey') CO.lookFarPrepare(adm, ctxF);
    const arch = architectureContext(ctxF.vt, ctxF);
    const sig = (it) => it.polys.map((p) => p.outer.map((q) => `${q.x},${q.y}`).join(";")).join("|"); // the whole footprint (a partial key collides)
    const nearBySig = new Map(N.items.map((it) => [sig(it), it]));
    let n = 0, differ = 0, multiN = 0, multiDiffer = 0;
    const rel = ST.relateParts(adm, ctxF);
    adm.forEach((it, i) => {
      const nit = nearBySig.get(sig(it));
      const row = nit && N.rows.get(nit);
      if (!row) return;
      const item = { ...it, h: nit.h };
      const style = architectureStyle(item, arch, ctxF.extent, ctxF.kA);
      // Round 3: the far colour exactly as the live callers ask for it (colourOf
      // 'far' passes no far01), every wall, tagged ones included; and the far
      // material must be the near wall's (style byte: material + 4 x (gain + 1)).
      const f = CO.lookFarColour(item, style, ctxF, arm === 'round2' ? 0.6 : undefined); // round2: the control, round 2's live far01
      const m = row.z % 4;
      if (f.mode !== (m === 2 ? 1 : m === 3 ? 2 : 0)) {
        n += 1;
        differ += 1;
        if (rel.group[i] >= 0) {
          multiN += 1;
          multiDiffer += 1;
        }
        return;
      }
      // The far wall, scaled the two ways the near ring scales its wall (top and
      // the AO base), must be a colour the near walls of that building carry.
      // Round 3: the far wall is the near wall times the far wall shade (a constant, look.worker.far.wallShade).
      const shade = C.WORLD_LOOK.worker.far.wallShade ?? 1;
      const farTop = f.wall.map((c) => (c / shade) * C.SAT_BUILDINGS.wallTopGain);
      const T = CO.buildingTones();
      const aoT = Math.min(1, Math.max(0, nit.h / C.SAT_BUILDINGS.wallBaseRefM));
      const baseMul = T.wallBaseMul[0] + (T.wallBaseMul[1] - T.wallBaseMul[0]) * aoT;
      const farBase = f.wall.map((c) => (c / shade) * baseMul);
      const q = (v) => Math.round(Math.min(1, v) * 255) / 255;
      const bad = !row.all.some((c) => dmax(farTop.map(q), c) <= TOL || dmax(farBase.map(q), c) <= TOL);
      n += 1;
      if (bad) differ += 1;
      if (rel.group[i] >= 0) {
        multiN += 1;
        if (bad) multiDiffer += 1;
      }
    });
    res[arm] = { buildings: n, differ, multiPart: multiN, multiPartDiffer: multiDiffer };
  }
  report.nearFar[name] = res;
  console.log('F', name, JSON.stringify(res));
  // Bar: no multi-part structure may differ (the key), and at most 0.1 % of all
  // buildings (round 2 measured 1 of 3,523 in Paris: the classifier gave one
  // footprint family 0 in the near build and 1 in the far build; not a key).
  if (res.prepared.multiPartDiffer || res.prepared.differ > 0.001 * res.prepared.buildings) fail(`F ${name}: ${res.prepared.differ} of ${res.prepared.buildings} far walls (${res.prepared.multiPartDiffer} multi-part) differ from the near wall (colour or material) as the live callers ask`);
  if (!res.round2.differ) fail(`F ${name}: the round-2 control (far01 0.6) agrees too, so the measure cannot fail here`);
  if (res.partKey.multiPart && !res.partKey.multiPartDiffer) fail(`F ${name}: the part-key control agrees on every multi-part building, so the measure cannot fail here`);
}

const out = arg('--out') ?? path.join(ROOT, '.graphics-review/world-pass/look/r3/agree-gate.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 1));
console.log(report.pass ? 'PASS' : `FAIL (${report.fails.length})`, out);
process.exit(report.pass ? 0 : 1);

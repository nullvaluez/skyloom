/**
 * World Pass D (LOOK) round 3 node measure: the far colour (lookFarColour) of each
 * building against what the near ring draws for it, in three worker states.
 *   node scripts/wp-look-far.mjs [--only <place>] [--out <json>]
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

// --- far colour against the near ring (round 3) ------------------------------------
//
// Per place: a 3 x 3 block of near tiles is built and patched with its z16
// photo (the worker learns roof against region, as it does live). Then the far
// colour (lookFarColour, as REACH's stand-ins and the far mass call it) of the
// SAME buildings is read in three worker states:
//   cold     no regional photo decoded, nothing learned (a far tile built first)
//   region   the regional photo decoded, nothing learned (a far-only worker)
//   learned  the regional photo and this worker's learned roof correction
// and compared with what the near ring draws for those buildings (the final
// near roofs and walls of the same footprints, read off the bundle).
// CIELAB dE76 of each building's far colour against its near colour (median /
// p90 / share over 10), roofs and walls, untagged and tagged walls apart; plus
// the sRGB luma and chroma of the medians (the "pale far city" check).
const LR = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/look-roofs.js')).href);
const AD = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/sat-buildings/admission.js')).href);
const G = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/geom.js')).href);
const CO = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/sat-buildings/colour.js')).href);
const lin2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055);
function lab(lin) {
  const L = lin.map((c) => Math.max(0, Math.min(1, c)));
  const X = (0.4124 * L[0] + 0.3576 * L[1] + 0.1805 * L[2]) / 0.95047;
  const Y = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
  const Z = (0.0193 * L[0] + 0.1192 * L[1] + 0.9505 * L[2]) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a, b) => {
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
const qs = (arr) => {
  const s = arr.slice().sort((a, b) => a - b);
  const q = (f) => (s.length ? +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(2) : null);
  return { n: s.length, med: q(0.5), p90: q(0.9), over10: s.length ? +((100 * s.filter((v) => v > 10).length) / s.length).toFixed(1) : null };
};
const medLin = (list) => [0, 1, 2].map((c) => list.map((v) => v[c]).sort((a, b) => a - b)[list.length >> 1]);
const lc = (lin) => {
  const s = lin.map((c) => lin2s(c) * 255);
  return { luma: +(0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]).toFixed(1), chroma: +(Math.max(...s) - Math.min(...s)).toFixed(1) };
};
async function regionalRGBA(z, x, y, cfg) {
  const s = z - cfg.refZoom;
  const r = await getBytes(ESRI.replace('{z}', cfg.refZoom).replace('{y}', y >> s).replace('{x}', x >> s));
  if (r.status !== 200 || r.body.length === cfg.placeholderBytes) return null;
  return new Uint8ClampedArray(await sharp(r.body).resize(256, 256).ensureAlpha().raw().toBuffer());
}
const opts = { visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true, airportLandmarks: false, operationsAirports: [] };
const FARPLACES = {
  'paris-north': [48.872, 2.345],
  nyc: PLACES.nyc,
  brooklyn: PLACES.brooklyn,
  london: PLACES.london,
  tokyo: PLACES.tokyo,
  phoenix: PLACES.phoenix,
};
const FS = { wallShade: 1, roofShade: 1, ...C.WORLD_LOOK.worker.far };
const report = {};
const sig = (it) => it.polys.map((p) => p.outer.map((q) => `${q.x},${q.y}`).join(';')).join('|');
for (const [name, ll] of Object.entries(FARPLACES)) {
  if (only && !name.includes(only)) continue;
  const [cx, cy] = tileOf(...ll, 14);
  const req = lookRequest();
  req.key = `far-${name}`;
  const cfg = PS.photoConfig(req.look);
  const options = { ...opts, worldPass: req };
  const mvtOf = async (x, y) => (await getBytes(TEMPLATE.replace('{z}', 14).replace('{x}', x).replace('{y}', y))).body;
  const farOf = async (x, y) => {
    const ctxF = createTileCtx(new VectorTile(new PbfReader(new Uint8Array(await mvtOf(x, y)))), { ...frameOf(14, x, y) }, { z: 14, x, y, detail: 'sat-skyline', options, v: 26 });
    const adm = AD.admitFootprints(ctxF, G.classifyRingsSat);
    CO.lookFarPrepare(adm, ctxF);
    const arch = architectureContext(ctxF.vt, ctxF);
    const m = new Map();
    for (const it of adm) {
      const item = { ...it, h: it.h ?? it.rawH ?? 12 };
      m.set(sig(it), CO.lookFarColour(item, architectureStyle(item, arch, ctxF.extent, ctxF.kA), ctxF));
    }
    return m;
  };
  // cold: no regional photo in this worker, nothing learned (fresh place: a new regional key).
  PS.regionalSeed(14, cx, cy, cfg, null);
  const cold = await farOf(cx, cy);
  // region: the regional photo decoded, nothing learned yet.
  PS.regionalSeed(14, cx, cy, cfg, await regionalRGBA(14, cx, cy, cfg));
  const region = await farOf(cx, cy);
  // The near ring: a 3 x 3 block built and patched (learns), the centre read back.
  const build = async (x, y) => {
    PS.regionalSeed(14, x, y, cfg, await regionalRGBA(14, x, y, cfg));
    const inB = LR.lookBegin(14, x, y, 'sat-buildings', options);
    const ctx = createTileCtx(new VectorTile(new PbfReader(new Uint8Array(await mvtOf(x, y)))), { ...frameOf(14, x, y), ...inB.frame() }, { z: 14, x, y, detail: 'sat-buildings', options, v: 26 });
    const out = LR.lookAfterBuild(buildSatBuildings(ctx), ctx);
    return { ctx, out };
  };
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const { out } = await build(cx + dx, cy + dy);
    if (out.lookPatch) await LR.lookRoofPatch(out.lookPatch, await photoFor(14, cx + dx, cy + dy, cfg));
  }
  const learned = await farOf(cx, cy);
  const N = await build(cx, cy); // rebuilt from the finished roofs: what the near ring draws
  const near = new Map();
  for (const r of N.ctx.look.rec || []) near.set(sig(r.item), r);
  // The near wall: the wall top colour of that building in the bundle.
  const sb = N.out.satBuilding;
  const wallTop = new Map();
  for (let v = 0; v < sb.anchor.length / 2; v++) {
    if (sb.style[v * 3 + 2] === 0) continue;
    const k = `${sb.anchor[v * 2]},${sb.anchor[v * 2 + 1]}`;
    const c = [sb.col[v * 3], sb.col[v * 3 + 1], sb.col[v * 3 + 2]].map((q) => (sb.col instanceof Uint8Array ? q / 255 : q));
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const t = wallTop.get(k);
    if (!t || L > t.L) wallTop.set(k, { L, c, z: sb.style[v * 3 + 2] });
  }
  const res = { tile: [14, cx, cy] };
  for (const [arm, far] of [['cold', cold], ['region', region], ['learned', learned]]) {
    const dR = [], dW = [], dWt = [], farR = [], nearR = [], farW = [], nearW = [];
    for (const it of N.ctx.look.items) {
      const f = far.get(sig(it));
      const r = near.get(sig(it));
      if (!f) continue;
      if (r && r.roof) {
        const fr = f.roof.map((c) => c / FS.roofShade); // before the far shade (a constant)
        dR.push(dE(fr, r.roof));
        farR.push(fr);
        nearR.push(r.roof);
      }
      const a = LR.anchorOf(it, N.ctx);
      const w = wallTop.get(`${a[0]},${a[1]}`);
      if (w) {
        const ft = f.wall.map((c) => Math.min(1, (c / FS.wallShade) * C.SAT_BUILDINGS.wallTopGain)); // before the far shade (a constant)
        (w.z % 4 === 1 ? dW : dWt).push(dE(ft, w.c)); // material = byte % 4 (round 3: + 4 x (night gain + 1))
        if (w.z % 4 === 1) {
          farW.push(ft);
          nearW.push(w.c);
        }
      }
    }
    res[arm] = {
      roof: { ...qs(dR), far: farR.length ? lc(medLin(farR)) : null, near: nearR.length ? lc(medLin(nearR)) : null },
      wallUntagged: { ...qs(dW), far: farW.length ? lc(medLin(farW)) : null, near: nearW.length ? lc(medLin(nearW)) : null },
      wallTagged: qs(dWt),
    };
  }
  res.corr = PS.regionalCorr(`11/${cx >> 3}/${cy >> 3}`);
  report[name] = res;
  console.log(name, JSON.stringify(res));
}
const outFile = arg('--out') ?? path.join(ROOT, '.graphics-review/world-pass/look/r3/far.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log('DONE', outFile);
process.exit(0);

/**
 * World Pass D (LOOK) round 2 node measure: a tile whose photo has not landed
 * against its neighbours whose photos have (no tile-shaped patch).
 *   node scripts/wp-look-fallback.mjs [--only <place>] [--out <json>]
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

// --- the fallback against its neighbours (round 2) --------------------------------
//
// A tile whose photo has not landed yet must not stand out as a tile-shaped
// patch. Per place, a 3 x 3 block of z14 tiles: the eight neighbours are built
// and patched with their photos first (the worker learns roof against region
// and the neighbours' medians, as it does live), then the centre is built
// WITHOUT its photo. Measured, CIELAB dE76 of sRGB medians over each tile's roofs:
//   fallback   centre (fallback roofs) against the mean of its neighbours (photo roofs)
//   final      centre (its own photo roofs, after the patch) against the same neighbours
//   palette    centre with round 1's fallback (the typology palette roof) against them
// `fallback` near `final` (and well under `palette`) is "sits with its neighbours".
const LR = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/look-roofs.js')).href);
const lin2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
function lab(srgb) {
  const L = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
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
const median3 = (list) => [0, 1, 2].map((c) => list.map((v) => v[c]).sort((a, b) => a - b)[list.length >> 1]);
async function regionalRGBA(z, x, y, cfg) {
  const s = z - cfg.refZoom;
  const r = await getBytes(ESRI.replace('{z}', cfg.refZoom).replace('{y}', y >> s).replace('{x}', x >> s));
  if (r.status !== 200 || r.body.length === cfg.placeholderBytes) return null;
  return new Uint8ClampedArray(await sharp(r.body).resize(256, 256).ensureAlpha().raw().toBuffer());
}
const opts = { visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true, airportLandmarks: false, operationsAirports: [] };
const report = {};
for (const [name, ll] of [['brooklyn', PLACES.brooklyn], ['paris', PLACES.paris], ['phoenix', PLACES.phoenix], ['nyc', PLACES.nyc]]) {
  if (only && !name.includes(only)) continue;
  const [cx, cy] = tileOf(...ll, 14);
  const req = lookRequest();
  req.key = `fallback-${name}`;
  const cfg = PS.photoConfig(req.look);
  const options = { ...opts, worldPass: req };
  const build = async (x, y) => {
    const mvt = await getBytes(TEMPLATE.replace('{z}', 14).replace('{x}', x).replace('{y}', y));
    PS.regionalSeed(14, x, y, cfg, await regionalRGBA(14, x, y, cfg));
    const inB = LR.lookBegin(14, x, y, 'sat-buildings', options);
    const ctx = createTileCtx(new VectorTile(new PbfReader(new Uint8Array(mvt.body))), { ...frameOf(14, x, y), ...inB.frame() }, { z: 14, x, y, detail: 'sat-buildings', options, v: 26 });
    const out = LR.lookAfterBuild(buildSatBuildings(ctx), ctx);
    return { ctx, out };
  };
  const roofsOf = (ctx) => ctx.look.rec.filter((r) => r.roof).map((r) => r.roof.map(lin2s));
  const nbMedians = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const { ctx, out } = await build(cx + dx, cy + dy);
    if (!out.lookPatch) continue;
    const photo = await photoFor(14, cx + dx, cy + dy, cfg);
    await LR.lookRoofPatch(out.lookPatch, photo);
    // The neighbour's final roofs: rebuilt from the worker's finished roofs.
    const re = await build(cx + dx, cy + dy);
    const r = roofsOf(re.ctx);
    if (r.length >= 20) nbMedians.push(median3(r));
  }
  const nb = [0, 1, 2].map((c) => nbMedians.reduce((a, m) => a + m[c], 0) / nbMedians.length);
  const C = await build(cx, cy);
  const fallback = median3(roofsOf(C.ctx));
  // Round 1's fallback: the typology palette roof (colourOf with the look off).
  const OFF = { v: 1, key: 'wp1-0', any: false, tier: null };
  const c0 = createTileCtx(C.ctx.vt, frameOf(14, cx, cy), { z: 14, x: cx, y: cy, detail: 'sat-buildings', options: { ...opts, worldPass: OFF }, v: 26 });
  const arch0 = architectureContext(C.ctx.vt, c0);
  const palette = median3(C.ctx.look.items.map((it) => {
    const hash2 = (((Math.imul(it.id, 2246822519) + 374761393) >>> 0) % 4096) / 4096;
    return colourOf(it, architectureStyle(it, arch0, c0.extent, c0.kA), c0, 'near', hash2).roofCol.map(lin2s);
  }));
  const photo = await photoFor(14, cx, cy, cfg);
  await LR.lookRoofPatch(C.out.lookPatch, photo);
  const F = await build(cx, cy);
  const final = median3(roofsOf(F.ctx));
  const spread = nbMedians.map((m) => dE(m, nb));
  report[name] = {
    neighbours: nbMedians.length,
    fallbackSrc: C.out.lookRoofs,
    dE: { fallback: +dE(fallback, nb).toFixed(1), final: +dE(final, nb).toFixed(1), palette: +dE(palette, nb).toFixed(1), neighbourSpread: +(spread.reduce((a, b) => a + b, 0) / spread.length).toFixed(1) },
  };
  console.log(name, JSON.stringify(report[name]));
}
const outFile = arg('--out') ?? path.join(ROOT, '.graphics-review/world-pass/look/r2/fallback.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log('DONE', outFile);

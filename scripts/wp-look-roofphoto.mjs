/**
 * World Pass D (LOOK) probe: roof colour against the photo, before and after.
 *
 *   node scripts/wp-look-roofphoto.mjs [--out <json>] [--only <place>]
 *
 * For one z14 tile per place it builds the near ring ('sat-buildings', the
 * Enhanced options the engine sends) in-process twice: flags off, and with the
 * look stream on (the request built from WORLD_LOOK the way lib/fly/world-pass.js
 * builds it), feeding the worker's photo half the Esri mosaic decoded with sharp
 * (photo-sampler.js photoFromPixels; the browser half fetches the same tiles).
 *
 * Reference read (independent of the sampler's guards and de-light): the
 * critique-realism probe's rule (scripts/wp-probe-realism-roofphoto.mjs):
 * pixels inside the footprint with a 1.5-unit inset, green and shadow
 * (< 0.55 x tile median) rejected, >= 35 % surviving, interquartile mean, sRGB.
 * Compared per building, CIELAB delta E 76, against:
 *   before-shader   the flat-roof hash palette CITY_FACADES paints by day
 *                   (what the player sees today; value jitter ignored)
 *   before-worker   the worker's typology palette roof (today's vertex colour)
 *   after           the look stream's roof (photo / structure / block / palette)
 * Also: the share of roofs that took the photo, a structure mate, the block
 * median and the palette, and the worker build ms with the look on vs off.
 *
 * Inputs: OpenFreeMap tiles from the W0 proof store when recorded, else
 * fetched once into .graphics-review/world-pass/look/inputs/ (Esri tiles too).
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

// --- colour maths -----------------------------------------------------------------
const lin2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
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
/** The critique-realism reference read, sRGB 0-1, or null. */
function refRead(photo, poly, E) {
  const S = photo.size, s = S / E;
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const q of poly.outer) {
    minx = Math.min(minx, q.x * s); maxx = Math.max(maxx, q.x * s); miny = Math.min(miny, q.y * s); maxy = Math.max(maxy, q.y * s);
  }
  const inRing = (x, y, r) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const inPoly = (x, y) => inRing(x, y, poly.outer) && !poly.holes.some((h) => inRing(x, y, h));
  const keep = [];
  let total = 0;
  for (let y = Math.max(0, Math.floor(miny)); y <= Math.min(S - 1, Math.ceil(maxy)); y++) {
    for (let x = Math.max(0, Math.floor(minx)); x <= Math.min(S - 1, Math.ceil(maxx)); x++) {
      const gx = (x + 0.5) / s, gy = (y + 0.5) / s, d = 1.5 / s;
      if (!inPoly(gx, gy) || !inPoly(gx + d, gy) || !inPoly(gx - d, gy) || !inPoly(gx, gy + d) || !inPoly(gx, gy - d)) continue;
      if (!photo.valid[Math.floor(y / (S / photo.sub)) * photo.sub + Math.floor(x / (S / photo.sub))]) continue;
      total++;
      const o = (y * S + x) * 4;
      const c = [photo.rgba[o], photo.rgba[o + 1], photo.rgba[o + 2]];
      const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const green = c[1] > c[0] * 1.08 && c[1] > c[2] * 1.05;
      if (!green && L >= photo.medianL * 255 * 0.55) keep.push([L, ...c]);
    }
  }
  if (total < 8 || keep.length < Math.max(6, total * 0.35)) return null;
  keep.sort((a, b) => a[0] - b[0]);
  const t = keep.slice(keep.length >> 2, Math.max((keep.length >> 2) + 1, (3 * keep.length) >> 2));
  return [1, 2, 3].map((k) => t.reduce((a, v) => a + v[k], 0) / t.length / 255);
}
const shaderRoof = (() => {
  const B = AR.REALISTIC_CITY_PALETTE;
  const cuts = B.flatRoofShares.map((_, i) => B.flatRoofShares.slice(0, i + 1).reduce((a, b) => a + b, 0));
  return (seed) => {
    const h = (seed * 0.9127 + 0.37) % 1;
    const i = cuts.findIndex((c) => h < c);
    return hex(B.flatRoofs[i < 0 ? B.flatRoofs.length - 1 : i]);
  };
})();
const stat = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return { n: s.length, mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2), p50: +s[s.length >> 1].toFixed(2), p90: +s[Math.floor(s.length * 0.9)].toFixed(2) };
};

// --- run ---------------------------------------------------------------------------
const OFF = { v: 1, key: 'wp1-0', any: false, tier: null };
const result = {};
for (const [name, [lat, lon]] of Object.entries(PLACES)) {
  if (only && !name.includes(only)) continue;
  const [x, y] = tileOf(lat, lon, 14);
  const z = 14;
  const mvt = await getBytes(TEMPLATE.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  const req = lookRequest();
  const cfg = PS.photoConfig(req.look);
  const photo = await photoFor(z, x, y, cfg);
  const opts = { visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true, airportLandmarks: false, operationsAirports: [] };
  const times = { off: [], on: [] };
  let ctxOn = null, outOn = null, ctxOff = null;
  for (let rep = 0; rep < 3; rep++) {
    const vtA = new VectorTile(new PbfReader(new Uint8Array(mvt.body)));
    const a = createTileCtx(vtA, frameOf(z, x, y), { z, x, y, detail: 'sat-buildings', options: { ...opts, worldPass: OFF }, v: 25 });
    let t = performance.now();
    buildSatBuildings(a);
    times.off.push(performance.now() - t);
    ctxOff = a;
    const vtB = new VectorTile(new PbfReader(new Uint8Array(mvt.body)));
    const b = createTileCtx(vtB, { ...frameOf(z, x, y), lookPhoto: photo }, { z, x, y, detail: 'sat-buildings', options: { ...opts, worldPass: req }, v: 25 });
    t = performance.now();
    outOn = buildSatBuildings(b);
    times.on.push(performance.now() - t);
    ctxOn = b;
  }
  const E = ctxOn.extent;
  const archCtx = architectureContext(ctxOn.vt, ctxOn);
  const roofs = ctxOn.look.prep.roofs;
  const d = { beforeShader: [], beforeWorker: [], after: [], afterLow: [], beforeShaderLow: [] };
  const src = { photo: 0, structure: 0, block: 0, palette: 0 };
  let compared = 0;
  for (const it of ctxOn.look.items) {
    if (!it.polys || it.h === undefined) continue;
    const style = architectureStyle(it, archCtx, E, ctxOn.kA);
    const hash2 = (((Math.imul(it.id, 2246822519) + 374761393) >>> 0) % 4096) / 4096;
    const r = roofs.roofOf(it);
    src[r ? r.src : 'palette'] += 1;
    const ref = refRead(photo, it.polys[0], E);
    if (!ref) continue;
    compared++;
    const before = colourOf(it, style, ctxOff, 'near', hash2).roofCol.map(lin2s);
    const after = colourOf(it, style, ctxOn, 'near', hash2).roofCol.map(lin2s);
    const sh = shaderRoof(style.seed);
    d.beforeShader.push(dE(sh, ref));
    d.beforeWorker.push(dE(before, ref));
    d.after.push(dE(after, ref));
    if (it.h < cfg.maxH) {
      d.afterLow.push(dE(after, ref));
      d.beforeShaderLow.push(dE(sh, ref));
    }
  }
  const n = Object.values(src).reduce((a, b) => a + b, 0);
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  result[name] = {
    tile: [z, x, y],
    photoTiles: roofs.stats.photoTiles,
    exposureRef: !!photo.ratio,
    buildings: n,
    share: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, +(v / Math.max(1, n)).toFixed(3)])),
    counts: src,
    eligibleUnder30m: roofs.stats.eligible,
    comparedWithReference: compared,
    deltaE: { beforeShader: stat(d.beforeShader), beforeWorker: stat(d.beforeWorker), after: stat(d.after), beforeShaderUnder30m: stat(d.beforeShaderLow), afterUnder30m: stat(d.afterLow) },
    buildMs: { off: +med(times.off).toFixed(1), on: +med(times.on).toFixed(1), added: +(med(times.on) - med(times.off)).toFixed(1) },
    emptyOn: outOn.empty === true,
  };
  console.log(name, JSON.stringify(result[name]));
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log('wrote', OUT);

/**
 * World Pass D (LOOK) round 3 node measure: the night wall albedo (the vertex colour
 * every wall shows at night) by family and wall material, flags off against WORLD_LOOK.
 *   node scripts/wp-look-night.mjs [--at lat,lon] [--out <json>]
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

// --- night wall albedo (round 3) ------------------------------------------------
//
// At night the city facade pass steps aside (cityDay = 0) and every wall's
// albedo is its vertex colour. Per arm, over a 3 x 3 block of z14 tiles round
// Penn Station: the wall area (triangle area, world m2) by style family and by
// LOOK's wall material (style byte: 1 shader's choice, 2 curtain glass, 3
// opaque), and the area-weighted mean linear luma of the wall vertex colour.
// Arms: off (the flags-off request), look (WORLD_LOOK as shipped in the request).
// nightWallLuma: the albedo the shader draws at night (round 3: x the wall's night gain).
const LR = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/look-roofs.js')).href);
async function regionalRGBA(z, x, y, cfg) {
  const s = z - cfg.refZoom;
  const r = await getBytes(ESRI.replace('{z}', cfg.refZoom).replace('{y}', y >> s).replace('{x}', x >> s));
  if (r.status !== 200 || r.body.length === cfg.placeholderBytes) return null;
  return new Uint8ClampedArray(await sharp(r.body).resize(256, 256).ensureAlpha().raw().toBuffer());
}
const opts = { visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true, airportLandmarks: false, operationsAirports: [] };
const OFF = (() => {
  const r = lookRequest();
  r.look = { ...r.look, on: false, roofPhoto: false, walls: false, structures: false, authority: false, worker: null };
  r.key = 'wp1-0';
  r.any = false;
  r.tier = null;
  return r;
})();
const place = (arg('--at') || '40.7505,-73.9934').split(',').map(Number);
const [cx, cy] = tileOf(place[0], place[1], 14);
const report = { at: place, arms: {} };
for (const arm of ['off', 'look']) {
  const req = arm === 'off' ? OFF : lookRequest();
  const fam = {}, mode = {};
  let A = 0, AL = 0, NL = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = cx + dx, y = cy + dy;
    const mvt = await getBytes(TEMPLATE.replace('{z}', 14).replace('{x}', x).replace('{y}', y));
    const options = { ...opts, worldPass: req };
    let inB = null;
    if (arm !== 'off') {
      const cfg = PS.photoConfig(req.look);
      PS.regionalSeed(14, x, y, cfg, await regionalRGBA(14, x, y, cfg));
      inB = LR.lookBegin(14, x, y, 'sat-buildings', options);
    }
    const ctx = createTileCtx(new VectorTile(new PbfReader(new Uint8Array(mvt.body))), { ...frameOf(14, x, y), ...(inB ? inB.frame() : null) }, { z: 14, x, y, detail: 'sat-buildings', options, v: 26 });
    let out = buildSatBuildings(ctx);
    if (inB) out = LR.lookAfterBuild(out, ctx);
    const sb = out.satBuilding;
    if (!sb) continue;
    const P = sb.pos, I = sb.idx, col = sb.col, st = sb.style;
    const cv = (v, c) => (col instanceof Uint8Array ? col[v * 3 + c] / 255 : col[v * 3 + c]);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      if (st[a * 3 + 2] === 0) continue;
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      let L = 0;
      for (const v of [a, b, c]) L += (0.2126 * cv(v, 0) + 0.7152 * cv(v, 1) + 0.0722 * cv(v, 2)) / 3;
      const f = st[a * 3], z = st[a * 3 + 2];
      const m = z < 4 ? z : z % 4; // the material (round 3: the byte is material + 4 x (gain code + 1))
      const gain = z > 3.5 ? 2 ** (-1 + (4 * (Math.floor(z / 4) - 1)) / 62) : 1; // the shader's night gain
      NL += area * L * gain;
      (fam[f] ??= { A: 0, AL: 0 }).A += area;
      fam[f].AL += area * L;
      (mode[m] ??= { A: 0, AL: 0 }).A += area;
      mode[m].AL += area * L;
      A += area;
      AL += area * L;
    }
  }
  const fin = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { areaShare: +((100 * v.A) / A).toFixed(1), luma: +(v.AL / v.A).toFixed(4) }]));
  report.arms[arm] = { wallLuma: +(AL / A).toFixed(4), nightWallLuma: +(NL / A).toFixed(4), byFamily: fin(fam), byMode: fin(mode) };
  console.log(arm, JSON.stringify(report.arms[arm]));
}
const outFile = arg('--out');
if (outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
}
process.exit(0);

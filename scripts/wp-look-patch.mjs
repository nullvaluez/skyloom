/**
 * World Pass D (LOOK) round 2 node gate: the late roof photo is colour only and
 * exact. A tile built without its photo and then patched equals the tile built
 * with it, byte for byte; a rebuild after the patch draws the same colours.
 *   node scripts/wp-look-patch.mjs [--only <place>] [--out <json>]
 * Inputs: the proof inputs and .graphics-review/world-pass/look/inputs (fetched once).
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

// --- the late roof photo gate (round 2) ------------------------------------------
//
// Per place, with the look on (and once more with ARRIVAL's workerPrep on, so the
// bundle carries Uint8 colours and compacted vertices):
//   A  the tile built WITH the photo (what a build would draw if it waited)
//   B  the tile built WITHOUT it (regional fallback), then lookAfterBuild, then
//      the patch computed by lookRoofPatch with the same photo, applied to B's
//      colour array the way lib/fly/look-roof-patch.js writes it
//   C  the tile rebuilt after the patch (the worker's finished roofs)
// Gates (each can fail):
//   P1  every attribute of A and B except colour is byte-identical (the patch
//       is colour only, no geometry);
//   P2  B patched == A, every colour byte (the patch reaches every roof vertex,
//       and only roof vertices: walls and clutter untouched);
//   P3  C == A, every colour byte, and C asks for no patch;
//   P4  B differs from A somewhere (the fallback is not secretly the photo).
const LR = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/look-roofs.js')).href);

async function regionalRGBA(z, x, y, cfg) {
  const s = z - cfg.refZoom;
  const r = await getBytes(ESRI.replace('{z}', cfg.refZoom).replace('{y}', y >> s).replace('{x}', x >> s));
  if (r.status !== 200 || r.body.length === cfg.placeholderBytes) return null;
  return new Uint8ClampedArray(await sharp(r.body).resize(256, 256).ensureAlpha().raw().toBuffer());
}

const bytesOf = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const report = { date: new Date().toISOString(), places: {}, pass: true, fails: [] };
const fail = (m) => {
  report.pass = false;
  report.fails.push(m);
  console.log('FAIL', m);
};
const opts = { visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true, airportLandmarks: false, operationsAirports: [] };
const GATE_PLACES = { nyc: PLACES.nyc, brooklyn: PLACES.brooklyn, paris: PLACES.paris, phoenix: PLACES.phoenix, tokyo: PLACES.tokyo };

for (const [name, [lat, lon]] of Object.entries(GATE_PLACES)) {
  if (only && !name.includes(only)) continue;
  const z = 14;
  const [x, y] = tileOf(lat, lon, z);
  const mvt = await getBytes(TEMPLATE.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  for (const [prep, cold] of [[false, false], [true, false], [true, true]]) {
    const req = lookRequest();
    if (prep) req.arrival = { ...req.arrival, on: true, workerPrep: true, worker: {} };
    req.key = `wp1-ultra-look${prep ? '-prep' : ''}${cold ? '-cold' : ''}`; // the worker's finished-roof cache is keyed by it
    const cfg = PS.photoConfig(req.look);
    const photo = await photoFor(z, x, y, cfg);
    const reg = await regionalRGBA(z, x, y, cfg);
    // cold: the regional photo has not landed when B builds (first tile of an area).
    PS.regionalSeed(z, x, y, cfg, cold ? null : reg);
    const options = { ...opts, worldPass: req };
    const ctxOf = (extra) => createTileCtx(new VectorTile(new PbfReader(new Uint8Array(mvt.body))), { ...frameOf(z, x, y), ...extra }, { z, x, y, detail: 'sat-buildings', options, v: 26 });
    // B: without the photo, then the late patch.
    const inB = LR.lookBegin(z, x, y, 'sat-buildings', options);
    const ctxB = ctxOf(inB.frame());
    const B = LR.lookAfterBuild(buildSatBuildings(ctxB), ctxB);
    if (cold) PS.regionalSeed(z, x, y, cfg, reg);
    // A: with the photo, and the fallback inputs the patch will use (the regional
    // photo and this worker's correction as they stand now; no neighbour median).
    const fbNow = LR.lookBegin(z, x, y, 'sat-buildings', options).frame().lookFallback;
    const ctxA = ctxOf({ lookPhoto: photo, lookFallback: { ...fbNow, neighbour: null } });
    const A = LR.lookAfterBuild(buildSatBuildings(ctxA), ctxA); // the same after-build step (wall material codes)
    const tag = `${name}${prep ? '+prep' : ''}${cold ? '+cold' : ''}`;
    const row = { tile: [z, x, y], verts: A.satBuilding.pos.length / 3, colType: A.satBuilding.col.constructor.name, photoTiles: photo.valid.reduce((p, q) => p + q, 0), regional: !!reg };
    for (const k of ['pos', 'idx', 'anchor', 'uv', 'style', 'normal']) {
      if (!A.satBuilding[k]) continue;
      if (!bytesOf(A.satBuilding[k]).equals(bytesOf(B.satBuilding[k]))) fail(`${tag} P1 ${k} differs between the photo build and the fallback build`);
    }
    const colA = A.satBuilding.col, colB = B.satBuilding.col.slice();
    let diffBefore = 0;
    for (let i = 0; i < colA.length; i += 3) if (colA[i] !== colB[i] || colA[i + 1] !== colB[i + 1] || colA[i + 2] !== colB[i + 2]) diffBefore++;
    row.fallbackRoofs = B.lookRoofs;
    row.vertsDifferBeforePatch = diffBefore;
    if (!B.lookPatch) fail(`${tag} no lookPatch on the fallback build`);
    if (!diffBefore) fail(`${tag} P4 the fallback build equals the photo build`);
    const P = await LR.lookRoofPatch(B.lookPatch, photo);
    row.patchVerts = P.verts.length;
    row.patchWallVerts = P.wallVerts;
    row.patchedRoofs = P.counts;
    for (let i = 0; i < P.verts.length; i++) for (let c = 0; c < 3; c++) colB[P.verts[i] * 3 + c] = P.col[i * 3 + c];
    // Exact, except a split wall vertex (an interpolated colour, recovered from
    // its quantised value): within 2e-6 relative (Float32) or 1 (Uint8).
    const tol = colA instanceof Uint8Array ? 1 : 2e-6;
    let diffAfter = 0, firstBad = -1, inexact = 0;
    for (let i = 0; i < colA.length; i += 3) {
      if (colA[i] === colB[i] && colA[i + 1] === colB[i + 1] && colA[i + 2] === colB[i + 2]) continue;
      let near = true;
      for (let c = 0; c < 3; c++) if (Math.abs(colA[i + c] - colB[i + c]) > tol * Math.max(1, Math.abs(colA[i + c]))) near = false;
      if (near) {
        inexact++;
        continue;
      }
      diffAfter++;
      if (firstBad < 0) firstBad = i / 3;
    }
    row.vertsDifferAfterPatch = diffAfter;
    row.vertsWithinQuantum = inexact;
    if (diffAfter) fail(`${tag} P2 ${diffAfter} vertices differ after the patch (first ${firstBad}: A ${[...colA.subarray(firstBad * 3, firstBad * 3 + 3)]} B ${[...colB.subarray(firstBad * 3, firstBad * 3 + 3)]})`);
    // C: the rebuild after the patch.
    const inC = LR.lookBegin(z, x, y, 'sat-buildings', options);
    const ctxC = ctxOf(inC.frame());
    const Cb = LR.lookAfterBuild(buildSatBuildings(ctxC), ctxC);
    if (!bytesOf(Cb.satBuilding.col).equals(bytesOf(colA))) fail(`${tag} P3 the rebuild after the patch differs from the photo build`);
    if (Cb.lookPatch) fail(`${tag} P3 the rebuild after the patch asks for another patch`);
    row.rebuild = { cached: Cb.lookRoofs?.cached ?? 0, patch: Cb.lookPatch ?? null };
    report.places[tag] = row;
    console.log(tag, JSON.stringify(row));
  }
}
const out = arg('--out') ?? path.join(ROOT, '.graphics-review/world-pass/look/r2/patch-gate.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 1));
console.log(report.pass ? 'PASS' : `FAIL (${report.fails.length})`, out);
process.exit(report.pass ? 0 : 1);

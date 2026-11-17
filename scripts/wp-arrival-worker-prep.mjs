/**
 * WORLD PASS B (ARRIVAL, workerPrep): what the worker's finalize prep changes,
 * on the recorded inputs of scripts/world-pass-worker-proof.mjs (run that once
 * first; nothing is fetched here).
 *
 *   node scripts/wp-arrival-worker-prep.mjs
 *
 * Per place, the Enhanced sat-buildings bundle with the all-off request and with
 * WORLD_ARRIVAL on (workerPrep) must hold, or the gate fails:
 *   (a) no exactly-degenerate triangle in the ON index (FLASH_GUARD has nothing to drop);
 *   (b) every ON vertex is referenced and every index is in range;
 *   (c) the same triangles: the OFF body and detail triangle multisets, minus their
 *       exactly-degenerate triangles, equal the ON ones (each triangle keyed by its three
 *       vertices' position, colour, anchor, uv and style, in winding order; colours
 *       compared on the 1/255 grid the ON colours are stored on);
 *   (d) runs tile the vertices with one anchor each; regions tile the body range;
 *   (e) result.wp carries the request key;
 *   (f) r2, WORLD_ARRIVAL.worker.quantize: position (Int16 x4, 1/16 m), anchor (Int16 x2) and
 *       uv (Int16 x2, 1/512) are the OFF values on their lattices; the ON triangles are the OFF
 *       triangles with every vertex snapped to the lattices, minus the ones the snap collapses
 *       (exactly degenerate on the lattice); no ON triangle is degenerate; runs still tile;
 *   and it reports bytes and vertices OFF against ON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUTS = path.join(ROOT, '.graphics-review/world-pass/w0/proof-inputs');
const TREE = ROOT;

// --- module hooks (scripts/world-pass-worker-proof.mjs) -------------------------
const COMLINK = 'file:///world-pass-comlink-stub.mjs';
const probe = (base) => {
  for (const ext of ['', '.js', '.mjs', '/index.js']) {
    const p = base + ext;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href;
    } catch {
      /* next */
    }
  }
  return null;
};
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: COMLINK, shortCircuit: true };
    if (spec.startsWith('@/')) {
      const u = probe(path.join(TREE, spec.slice(2)));
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
  load(url, ctx, next) {
    if (url === COMLINK) return { format: 'module', shortCircuit: true, source: 'export const expose=(a)=>{globalThis.__worldPassApi=a;}; export const transfer=(v)=>v;' };
    return next(url, ctx);
  },
});
const index = JSON.parse(fs.readFileSync(path.join(INPUTS, 'index.json'), 'utf8'));
globalThis.fetch = async (input) => {
  const url = String(input?.url ?? input);
  const rec = index[url];
  if (!rec) throw new Error(`input not recorded: ${url}`);
  const body = fs.readFileSync(path.join(INPUTS, rec.file));
  const nullBody = rec.status === 204 || rec.status === 304 || (rec.status >= 100 && rec.status < 200);
  return new Response(nullBody ? null : body, { status: rec.status, headers: rec.type ? { 'content-type': rec.type } : {} });
};

// --- cases ---------------------------------------------------------------------------
const tileOf = (lat, lon, z) => {
  const n = 2 ** z, x = Math.floor(((lon + 180) / 360) * n), r = (lat * Math.PI) / 180;
  return [x, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
};
const PLACES = [['midtown', 40.7549, -73.984], ['paris', 48.8566, 2.3522], ['tokyo', 35.6812, 139.7671], ['phoenix-suburb', 33.38, -111.84], ['powell-oh', 40.158, -83.075], ['hong-kong', 22.282, 114.158], ['san-francisco', 37.7937, -122.3965], ['lagos', 6.455, 3.394], ['owens', 36.6, -118.1]];
const RUNWAY = { airportLandmarks: false, operationsAirports: [] };
const ENH = { visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true, ...RUNWAY };
const STREAMS = { truth: ['heights', 'typology', 'smallBand', 'roofs'], arrival: ['fastQuery', 'drapeCap', 'workerPrep', 'uploads', 'footings', 'readiness'], reach: ['standIns'], look: ['roofPhoto', 'walls', 'structures', 'authority'], ground: ['trees', 'bridges'] };
const KEY = 'wp1-ultra-test-0';
const request = (arrival, worker = {}) => {
  const req = { v: 1, key: arrival ? KEY : 'wp1-0', any: !!arrival, tier: arrival ? 'ultra' : null };
  for (const [s, subs] of Object.entries(STREAMS)) {
    const on = arrival && s === 'arrival';
    req[s] = { on, ...Object.fromEntries(subs.map((k) => [k, on])), worker: on ? worker : null };
  }
  return { worldPass: req };
};

await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
const api = globalThis.__worldPassApi;
const bytesOf = (b) => ['pos', 'col', 'anchor', 'uv', 'idx', 'normal', 'style'].reduce((s, k) => s + (b[k]?.byteLength ?? 0), 0);
const degenerate = (pos, a, b, c) => {
  a *= 3; b *= 3; c *= 3;
  const abx = pos[b] - pos[a], aby = pos[b + 1] - pos[a + 1], abz = pos[b + 2] - pos[a + 2];
  const acx = pos[c] - pos[a], acy = pos[c + 1] - pos[a + 1], acz = pos[c + 2] - pos[a + 2];
  const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
  return nx * nx + ny * ny + nz * nz <= 0;
};
const vkey = (b, v, colScale) => {
  const c = b.col, s = b.style;
  const col = [0, 1, 2].map((k) => Math.round((c[v * 3 + k] / colScale) * 255));
  return `${b.pos[v * 3]},${b.pos[v * 3 + 1]},${b.pos[v * 3 + 2]}|${col}|${b.anchor[v * 2]},${b.anchor[v * 2 + 1]}|${b.uv[v * 2]},${b.uv[v * 2 + 1]}|${s ? [s[v * 3], s[v * 3 + 1], s[v * 3 + 2]] : ''}`;
};
const tris = (b, from, to, colScale, skipDegenerate) => {
  const out = [];
  for (let i = from; i + 2 < to; i += 3) {
    const a = b.idx[i], c1 = b.idx[i + 1], c2 = b.idx[i + 2];
    if (skipDegenerate && degenerate(b.pos, a, c1, c2)) continue;
    out.push(`${vkey(b, a, colScale)}#${vkey(b, c1, colScale)}#${vkey(b, c2, colScale)}`);
  }
  return out.sort();
};
let fail = 0;
const check = (ok, msg) => {
  if (!ok) {
    fail += 1;
    console.log('  FAIL', msg);
  }
  return ok;
};
let sumOff = 0, sumOn = 0, vOff = 0, vOn = 0, tOff = 0, tOn = 0;
for (const [name, lat, lon] of PLACES) {
  const [x, y] = tileOf(lat, lon, 14);
  const off = await api.buildTile(14, x, y, 'sat-buildings', { ...ENH, ...request(false) });
  const on = await api.buildTile(14, x, y, 'sat-buildings', { ...ENH, ...request(true) });
  const A = off.satBuilding, B = on.satBuilding;
  if (!A || !B) {
    check(!A && !B && on.empty === off.empty, `${name}: empty in one arm only`);
    console.log(`${name.padEnd(15)} empty in both arms (${off.reason ?? '-'}); no mesh`);
    continue;
  }
  check(on.wp === KEY && off.wp === undefined, `${name}: result.wp stamp (on ${on.wp}, off ${off.wp})`);
  const P = B.prep, nV = B.pos.length / 3;
  let deg = 0;
  for (let i = 0; i + 2 < B.idx.length; i += 3) if (degenerate(B.pos, B.idx[i], B.idx[i + 1], B.idx[i + 2])) deg += 1;
  check(deg === 0, `${name}: ${deg} degenerate triangles in the ON index`);
  const used = new Uint8Array(nV);
  let inRange = true;
  for (const v of B.idx) {
    if (v >= nV) inRange = false;
    else used[v] = 1;
  }
  check(inRange, `${name}: index out of range`);
  check(used.every((u) => u === 1), `${name}: unreferenced vertices`);
  const auxA = A.meta.auxiliaryIndexCount, auxB = B.meta.auxiliaryIndexCount;
  const colScale = P.colNormalized ? 255 : 1;
  const offBody = tris(A, 0, auxA, 1, true), onBody = tris(B, 0, auxB, colScale, false);
  const offDet = tris(A, auxA, A.idx.length, 1, true), onDet = tris(B, auxB, B.idx.length, colScale, false);
  check(offBody.length === onBody.length && offBody.every((t, i) => t === onBody[i]), `${name}: body triangles differ (${offBody.length} vs ${onBody.length})`);
  check(offDet.length === onDet.length && offDet.every((t, i) => t === onDet[i]), `${name}: detail triangles differ (${offDet.length} vs ${onDet.length})`);
  const rs = P.runStart, nR = rs.length - 1;
  let runsOk = rs[0] === 0 && rs[nR] === nV;
  for (let r = 0; r < nR && runsOk; r++) {
    if (!(rs[r + 1] > rs[r])) runsOk = false;
    for (let v = rs[r]; v < rs[r + 1] && runsOk; v++) if (B.anchor[v * 2] !== P.runAnchor[r * 2] || B.anchor[v * 2 + 1] !== P.runAnchor[r * 2 + 1]) runsOk = false;
  }
  check(runsOk, `${name}: runs do not tile the vertices with one anchor each`);
  let at = 0, regOk = true;
  for (let k = 0; k < P.regions.length / 12; k++) {
    if (P.regions[k * 12] !== at) regOk = false;
    at += P.regions[k * 12 + 1];
  }
  check(regOk && at === auxB, `${name}: regions do not tile the body range`);
  let footOk = P.footStart.length === nR + 1 && P.footStart[nR] === P.footBottom.length;
  for (let r = 0; r < nR && footOk; r++) for (let j = P.footStart[r]; j < P.footStart[r + 1]; j++) { const v = P.footBottom[j]; if (v < rs[r] || v >= rs[r + 1] || B.pos[v * 3 + 1] !== P.runMinY[r] || !(P.runMinY[r] < 0)) footOk = false; }
  check(footOk, `${name}: footing vertices are not each run's wall bottom`);
  const bo = bytesOf(A), bn = bytesOf(B);
  sumOff += bo; sumOn += bn; vOff += A.pos.length / 3; vOn += nV; tOff += A.idx.length / 3; tOn += B.idx.length / 3;
  let degOff = 0;
  for (let i = 0; i + 2 < A.idx.length; i += 3) if (degenerate(A.pos, A.idx[i], A.idx[i + 1], A.idx[i + 2])) degOff += 1;
  console.log(`${name.padEnd(15)} tris ${A.idx.length / 3} (${degOff} degenerate) -> ${B.idx.length / 3} (${deg}) | verts ${A.pos.length / 3} -> ${nV} | runs ${nR}, regions ${P.regions.length / 12} | ${(bo / 1048576).toFixed(2)} -> ${(bn / 1048576).toFixed(2)} MiB (-${(100 * (1 - bn / bo)).toFixed(1)} %) | col ${P.colNormalized ? 'u8' : 'f32'}, footing verts ${P.footBottom.length}, normal ${P.normalPacked ? 'i8' : 'f32'}`);
}
// --- (f) r2: the quantized arm ------------------------------------------------------
const snapKey = (b, v, colScale, q) => {
  const c = b.col, s = b.style, P = q ? 4 : 3, k = q ? 1 / 16 : 1, ku = q ? 1 / 512 : 1;
  const r16 = (x) => Math.round(x * 16) / 16, r512 = (x) => Math.round(x * 512) / 512;
  const px = q ? b.pos[v * P] * k : r16(b.pos[v * 3]), py = q ? b.pos[v * P + 1] * k : r16(b.pos[v * 3 + 1]), pz = q ? b.pos[v * P + 2] * k : r16(b.pos[v * 3 + 2]);
  const ax = q ? b.anchor[v * 2] * k : r16(b.anchor[v * 2]), az = q ? b.anchor[v * 2 + 1] * k : r16(b.anchor[v * 2 + 1]);
  const u = q ? b.uv[v * 2] * ku : r512(b.uv[v * 2]), w = q ? b.uv[v * 2 + 1] * ku : r512(b.uv[v * 2 + 1]);
  const col = [0, 1, 2].map((j) => Math.round((c[v * 3 + j] / colScale) * 255));
  return { key: `${px},${py},${pz}|${col}|${ax},${az}|${u},${w}|${s ? [s[v * 3], s[v * 3 + 1], s[v * 3 + 2]] : ''}`, p: [px, py, pz] };
};
const degP = (a, b, c) => { const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2]; const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx; return nx * nx + ny * ny + nz * nz <= 0; };
const trisQ = (b, from, to, colScale, q) => {
  const out = [];
  for (let i = from; i + 2 < to; i += 3) {
    const A = snapKey(b, b.idx[i], colScale, q), B = snapKey(b, b.idx[i + 1], colScale, q), C = snapKey(b, b.idx[i + 2], colScale, q);
    if (degP(A.p, B.p, C.p)) continue;
    out.push(`${A.key}#${B.key}#${C.key}`);
  }
  return out.sort();
};
let qOff = 0, qOn = 0;
for (const [name, lat, lon] of PLACES) {
  const [x, y] = tileOf(lat, lon, 14);
  const off = await api.buildTile(14, x, y, 'sat-buildings', { ...ENH, ...request(false) });
  const on = await api.buildTile(14, x, y, 'sat-buildings', { ...ENH, ...request(true, { quantize: true }) });
  const A = off.satBuilding, B = on.satBuilding;
  if (!A || !B) { check(!A && !B, `${name} (q): empty in one arm only`); continue; }
  const P = B.prep;
  if (!P.posQ) { console.log(`${name.padEnd(15)} quantize: tile kept Float32 (extent outside the lattice)`); continue; }
  check(B.pos instanceof Int16Array && B.pos.length === (B.anchor.length / 2) * 4 && B.anchor instanceof Int16Array && B.uv instanceof Int16Array && P.posQ === 16 && P.uvQ === 512, `${name} (q): layout`);
  const nV = B.anchor.length / 2;
  let deg = 0;
  for (let i = 0; i + 2 < B.idx.length; i += 3) { const a = B.idx[i] * 4, b = B.idx[i + 1] * 4, c = B.idx[i + 2] * 4, p = B.pos; if (degP([p[a], p[a + 1], p[a + 2]], [p[b], p[b + 1], p[b + 2]], [p[c], p[c + 1], p[c + 2]])) deg++; }
  check(deg === 0, `${name} (q): ${deg} degenerate triangles on the lattice`);
  const used = new Uint8Array(nV);
  for (const v of B.idx) if (v < nV) used[v] = 1;
  check(used.every((u) => u === 1), `${name} (q): unreferenced vertices`);
  const auxA = A.meta.auxiliaryIndexCount, auxB = B.meta.auxiliaryIndexCount, colScale = P.colNormalized ? 255 : 1;
  const ob = trisQ(A, 0, auxA, 1, false), nb = trisQ(B, 0, auxB, colScale, true), od = trisQ(A, auxA, A.idx.length, 1, false), nd = trisQ(B, auxB, B.idx.length, colScale, true);
  check(ob.length === nb.length && ob.every((t, i) => t === nb[i]), `${name} (q): body triangles differ (${ob.length} vs ${nb.length})`);
  check(od.length === nd.length && od.every((t, i) => t === nd[i]), `${name} (q): detail triangles differ (${od.length} vs ${nd.length})`);
  const rs = P.runStart, nR = rs.length - 1;
  let runsOk = rs[0] === 0 && rs[nR] === nV;
  for (let r = 0; r < nR && runsOk; r++) for (let v = rs[r]; v < rs[r + 1] && runsOk; v++) if (B.anchor[v * 2] / 16 !== P.runAnchor[r * 2] || B.anchor[v * 2 + 1] / 16 !== P.runAnchor[r * 2 + 1]) runsOk = false;
  check(runsOk, `${name} (q): runs do not tile the vertices with one anchor each`);
  const hp = B.housePts;
  if (hp) { const set = new Set(); for (let r = 0; r < nR; r++) set.add(`${P.runAnchor[r * 2]},${P.runAnchor[r * 2 + 1]}`); let miss = 0; for (let i = 0; i < hp.length; i += 2) if (!set.has(`${hp[i]},${hp[i + 1]}`)) miss++; check(miss === 0, `${name} (q): ${miss} house anchors match no run`); }
  const bo = bytesOf(A), bn = bytesOf(B);
  qOff += bo; qOn += bn;
  console.log(`${name.padEnd(15)} quantized: tris ${B.idx.length / 3} (lattice-collapsed vs prep: ${(ob.length + od.length) - (A.idx.length / 3)}) | verts ${nV} | ${(bo / 1048576).toFixed(2)} -> ${(bn / 1048576).toFixed(2)} MiB (-${(100 * (1 - bn / bo)).toFixed(1)} %)`);
}
console.log(`TOTAL quantized ${(qOff / 1048576).toFixed(1)} -> ${(qOn / 1048576).toFixed(1)} MiB (-${(100 * (1 - qOn / qOff)).toFixed(1)} %)`);
console.log(`TOTAL ${(sumOff / 1048576).toFixed(1)} -> ${(sumOn / 1048576).toFixed(1)} MiB (-${(100 * (1 - sumOn / sumOff)).toFixed(1)} %), vertices ${vOff} -> ${vOn} (-${(100 * (1 - vOn / vOff)).toFixed(1)} %), triangles ${tOff} -> ${tOn}`);
console.log(fail ? `FAIL ${fail}` : 'PASS worker prep: no degenerate triangles, the same triangles, runs and regions tile, wp stamped; quantized: the same triangles on the lattice');
process.exit(fail ? 1 : 0);

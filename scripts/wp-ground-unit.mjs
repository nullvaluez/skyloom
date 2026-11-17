/**
 * WORLD PASS E (GROUND): node unit gate for the canopy pieces that need no GPU.
 *   (1) the worker's edge-bucketed polygon fill paints exactly the cells
 *       earth-surface-mask's paintSurfacePolygon paints (random polygons with
 *       holes, both windings, partly outside the tile);
 *   (2) selectCanopy draws every tree exactly once at one level (a synthetic
 *       hierarchy), degrades by distance when the near pool is full, and stops
 *       at the far cap;
 *   (3) an empty chunk list places nothing.
 *   node scripts/wp-ground-unit.mjs
 */
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probe = (base) => { for (const ext of ['', '.js', '.mjs', '/index.js']) { const p = base + ext; if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href; } return null; };
registerHooks({ resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) { const u = probe(path.join(ROOT, spec.slice(2))); if (u) return { url: u, shortCircuit: true }; }
  if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:')) { const base = fileURLToPath(new URL(spec, ctx.parentURL)); if (!(fs.existsSync(base) && fs.statSync(base).isFile())) { const u = probe(base); if (u) return { url: u, shortCircuit: true }; } }
  return next(spec, ctx);
} });
const { paintSurfacePolygon } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/earth-surface-mask.js')).href);
const { fillPolygonFast } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/worker/ground-canopy.js')).href);
const { selectCanopy, planCanopy, edgeDensity } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/ground-canopy-select.js')).href);
let pass = 0, fail = 0;
const gate = (ok, name, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };

// (1) fill equivalence
let rnd = 7; const rand = () => (rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0) / 4294967296;
let diffCells = 0, cells = 0;
for (let t = 0; t < 400; t++) {
  const rings = [];
  const nr = 1 + (rand() < 0.3 ? 1 : 0);
  for (let r = 0; r < nr; r++) {
    const cx = -300 + rand() * 4700, cy = -300 + rand() * 4700, rad = 20 + rand() * (r ? 300 : 1800), n = 3 + Math.floor(rand() * 40);
    const ring = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 * (rand() < 0.5 ? 1 : -1); const rr = rad * (0.4 + rand() * 0.6); ring.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr }); }
    rings.push(ring);
  }
  for (const size of [256, 1024]) {
    const a = new Uint8Array(size * size), b = new Uint8Array(size * size);
    paintSurfacePolygon(a, size, rings, 4096, 1);
    fillPolygonFast(b, size, rings, 4096, 1);
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) diffCells++; if (a[i]) cells++; }
  }
}
gate(diffCells === 0, '(1) edge-bucketed fill == paintSurfacePolygon', `${diffCells} differing cells of ${cells} filled, 400 polygons x 2 sizes`);

// (2) selection: synthetic chunk, 16 x 16 L0 lattice of trees, full hierarchy
function synthChunk(cx, cz, n = 32, cell = 10) {
  const l0 = [], l1 = [], l2 = [], l3 = [];
  const push = (dst, kids, stride, first, count) => { let sx = 0, sz = 0; for (let c = 0; c < count; c++) { sx += kids[(first + c) * stride]; sz += kids[(first + c) * stride + 1]; } dst.push(sx / count, sz / count, 5, 10, 0, first, count); };
  for (let j3 = 0; j3 < n; j3 += 8) for (let i3 = 0; i3 < n; i3 += 8) { const f2 = l2.length / 7;
    for (let q2 = 0; q2 < 4; q2++) { const i2 = i3 + (q2 & 1) * 4, j2 = j3 + (q2 >> 1) * 4, f1 = l1.length / 7;
      for (let q1 = 0; q1 < 4; q1++) { const i1 = i2 + (q1 & 1) * 2, j1 = j2 + (q1 >> 1) * 2, f0 = l0.length / 5;
        for (let q0 = 0; q0 < 4; q0++) { const i = i1 + (q0 & 1), j = j1 + (q0 >> 1); l0.push((i - n / 2) * cell, (j - n / 2) * cell, 4, 10, 0); }
        push(l1, l0, 5, f0, l0.length / 5 - f0); }
      push(l2, l1, 7, f1, l1.length / 7 - f1); }
    push(l3, l2, 7, f2, l2.length / 7 - f2); }
  return { cx, cz, canopy: { l0: Float32Array.from(l0), l1: Float32Array.from(l1), l2: Float32Array.from(l2), l3: Float32Array.from(l3) } };
}
const chunk = synthChunk(0, 0);
const covered = (o) => {
  const seen = new Uint8Array(chunk.canopy.l0.length / 5);
  const mark = (lvl, i) => { if (lvl === 0) { seen[i]++; return; } const a = chunk.canopy['l' + lvl]; for (let c = a[i * 7 + 5], e = c + a[i * 7 + 6]; c < e; c++) mark(lvl - 1, c); };
  const r = selectCanopy([chunk], 0, 0, o, (ch, i) => mark(0, i), (ch, lvl, i) => mark(lvl, i));
  return { r, seen };
};
let { r, seen } = covered({ k: 1, nearCap: 1e6, farCap: 1e6, d0: 60, d1: 120, d2: 200, d3: 1e6 });
gate(seen.every((v) => v === 1), '(2a) every tree drawn exactly once across levels', `near ${r.near} far ${r.far} trees ${seen.length}`);
gate(r.near > 0 && r.far > 0, '(2b) both levels used at these distances');
({ r, seen } = covered({ k: 1, nearCap: 40, farCap: 1e6, d0: 1e6, d1: 1e6, d2: 1e6, d3: 1e6 }));
gate(seen.every((v) => v === 1) && r.near <= 40, '(2c) a full near pool degrades to patches, still once each', `near ${r.near} far ${r.far}`);
({ r } = covered({ k: 1, nearCap: 1e6, farCap: 5, d0: 0, d1: 0, d2: 0, d3: 1e6 }));
gate(r.far <= 5 && r.cut > 0, '(2d) the far cap stops the walk', `far ${r.far} cut ${r.cut}`);
r = selectCanopy([], 0, 0, { k: 1, nearCap: 10, farCap: 10, d0: 1, d1: 2, d2: 3, d3: 4 }, () => {}, () => {});
gate(r.near === 0 && r.far === 0, '(3) no chunk, no instance');

// (4) round 2: the view cone. Beyond `keep` only L3 cells in front of the camera are planned; each planned
// tree still once; within `keep` everything is planned all round.
{
  const big = synthChunk(0, 0, 64, 10);
  const seen = new Uint8Array(big.canopy.l0.length / 5);
  const mark = (lvl, i) => { if (lvl === 0) { seen[i]++; return; } const a = big.canopy['l' + lvl]; for (let c = a[i * 7 + 5], e = c + a[i * 7 + 6]; c < e; c++) mark(lvl - 1, c); };
  const cone = { x: 1, z: 0, cos: Math.cos(Math.PI / 4), keep: 120 };
  selectCanopy([big], 0, 0, { k: 1, nearCap: 1e6, farCap: 1e6, d0: 60, d1: 120, d2: 200, d3: 1e6, cone }, (ch, i) => mark(0, i), (ch, lvl, i) => mark(lvl, i));
  let behind = 0, nearMissing = 0, twice = 0;
  const l0 = big.canopy.l0;
  for (let i = 0; i < seen.length; i++) {
    const x = l0[i * 5], z = l0[i * 5 + 1], d = Math.hypot(x, z);
    if (seen[i] > 1) twice++;
    if (d < 60 && !seen[i]) nearMissing++;
    if (seen[i] && d > 300 && x / d < Math.cos(Math.PI / 4) - 0.35) behind++;
  }
  gate(twice === 0 && nearMissing === 0 && behind === 0, '(4) view cone: in front beyond keep, all round within it, once each', `twice ${twice} nearMissing ${nearMissing} behind ${behind}`);
}
// (5) round 2: sigma (screen size) moves crowns into patches, never drops or doubles a tree.
{
  const runs = [1, 0.5].map((sigma) => {
    const seen = new Uint8Array(chunk.canopy.l0.length / 5);
    const mark = (lvl, i) => { if (lvl === 0) { seen[i]++; return; } const a = chunk.canopy['l' + lvl]; for (let c = a[i * 7 + 5], e = c + a[i * 7 + 6]; c < e; c++) mark(lvl - 1, c); };
    const res = selectCanopy([chunk], 0, 0, { k: 1, nearCap: 1e6, farCap: 1e6, d0: 60, d1: 120, d2: 200, d3: 1e6, sigma }, (ch, i) => mark(0, i), (ch, lvl, i) => mark(lvl, i));
    return { res, once: seen.every((v) => v === 1) };
  });
  gate(runs.every((q) => q.once) && runs[1].res.near < runs[0].res.near && runs[1].res.near + runs[1].res.far < runs[0].res.near + runs[0].res.far, '(5) sigma < 1: fewer crowns, fewer instances, every tree once', `sigma 1: ${runs[0].res.near}+${runs[0].res.far}, sigma 0.5: ${runs[1].res.near}+${runs[1].res.far}`);
}
// (6) round 2: the edge band dissolves from 1 to 0, and a cut plan moves the band to the cut.
{
  const s = {};
  const it = planCanopy([chunk], 0, 0, { k: 1, nearCap: 1e6, farCap: 6, d0: 0, d1: 0, d2: 0, d3: 1e6 }, s);
  let q = it.next(); while (!q.done) q = it.next();
  const p = q.value;
  gate(p.cut > 0 && Math.abs(p.edgeB - p.farthest) < 1e-6 && edgeDensity(p, p.edgeA - 1) === 1 && edgeDensity(p, p.edgeB) === 0, '(6) edge band at the cut, density 1 inside to 0 at its end', `edge ${p.edgeA.toFixed(1)}..${p.edgeB.toFixed(1)}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

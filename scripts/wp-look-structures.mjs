/**
 * World Pass D (LOOK, M2) probe: part piles and seam twins, before and after.
 *
 *   node scripts/wp-look-structures.mjs [--out <json>]
 *
 * Per tile (London Bridge 14/8188/5448 with the Shard, Midtown 14/4824/6157,
 * Paris, Tokyo) it admits the footprints exactly as the near ring does
 * (admission.js admitFootprints) and relates them (structures.js relateParts).
 * A PART PILE is a structure of two or more parts that renders in more than
 * one look (style family or wall colour differs between parts), or a footprint
 * drawn although the relation hides it (a twin, a part inside a bigger mapped
 * volume, an outline covered by its own parts).
 *   before: every item keeps its own id (today), nothing is hidden.
 *   after:  the look stream's path (colour.js lookStyle): each part restyled
 *           from its root under the shared look id; hidden items are not drawn.
 * Seam twins: for Midtown and its east neighbour, buildings cut by the shared
 * seam are paired by their contact span; a pair "splits" when its two halves
 * get different looks (before: per-tile polygon ids; after: the seam id).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const OUT = argv.indexOf('--out') >= 0 ? argv[argv.indexOf('--out') + 1] : path.join(ROOT, '.graphics-review/world-pass/look/structures.json');
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
const PROOF_IN = path.join(ROOT, '.graphics-review/world-pass/w0/proof-inputs');
const LOOK_IN = path.join(ROOT, '.graphics-review/world-pass/look/inputs');
fs.mkdirSync(LOOK_IN, { recursive: true });
const idx = (d) => (fs.existsSync(path.join(d, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')) : {});
const proofIndex = idx(PROOF_IN), lookIndex = idx(LOOK_IN);
async function getBytes(url) {
  if (proofIndex[url]) return fs.readFileSync(path.join(PROOF_IN, proofIndex[url].file));
  if (lookIndex[url]) return fs.readFileSync(path.join(LOOK_IN, lookIndex[url].file));
  const body = Buffer.from(await (await fetch(url)).arrayBuffer());
  const file = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32) + '.bin';
  fs.writeFileSync(path.join(LOOK_IN, file), body);
  lookIndex[url] = { file, status: 200 };
  fs.writeFileSync(path.join(LOOK_IN, 'index.json'), JSON.stringify(lookIndex, null, 1));
  return body;
}
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { VectorTile } = await import('@mapbox/vector-tile');
const { PbfReader } = await import('pbf');
const { createTileCtx } = await imp('lib/fly/toy-world/worker/tile-ctx.js');
const { admitFootprints } = await imp('lib/fly/toy-world/worker/sat-buildings/admission.js');
const { classifyRingsSat } = await imp('lib/fly/toy-world/worker/geom.js');
const { relateParts, seamId } = await imp('lib/fly/toy-world/worker/sat-buildings/structures.js');
const { architectureContext, architectureStyle } = await imp('lib/fly/toy-world/worker/sat-buildings/typology.js');
const tj = JSON.parse((await getBytes('https://tiles.openfreemap.org/planet')).toString('utf8'));
const WORLD = 2 * Math.PI * 6378137;
function frameOf(z, x, y) {
  const tileSpan = WORLD / 2 ** z;
  const mercX0 = -WORLD / 2 + x * tileSpan, mercYTop = WORLD / 2 - y * tileSpan;
  const cx = mercX0 + tileSpan / 2, cz = -(mercYTop - tileSpan / 2);
  const latC = (2 * Math.atan(Math.exp(-cz / 6378137)) - Math.PI / 2) * (180 / Math.PI);
  return { tileSpan, mercX0, mercYTop, cx, cz, k: 1 / Math.cos((latC * Math.PI) / 180), t0: 0, visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true };
}
const req = { v: 1, key: 'wp1-ultra-look', any: true, tier: 'ultra', look: { on: true, roofPhoto: true, walls: true, structures: true, authority: true, worker: {} } };
for (const s of ['truth', 'arrival', 'reach', 'ground']) req[s] = { on: false, worker: null };
async function admit(z, x, y) {
  const vt = new VectorTile(new PbfReader(new Uint8Array(await getBytes(tj.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y)))));
  const ctx = createTileCtx(vt, frameOf(z, x, y), { z, x, y, detail: 'sat-buildings', options: { visuals: true, trueAreas: true, worldPass: req }, v: 25 });
  const items = admitFootprints(ctx, classifyRingsSat);
  return { ctx, items, arch: architectureContext(vt, ctx) };
}
const lookKey = (style) => `${style.family}:${style.walls[style.variant]}`;
const TILES = { london: [14, 8188, 5448], midtown: [14, 4824, 6157], paris: [14, 8299, 5636], tokyo: [14, 14552, 6451] };
const out = {};
for (const [name, [z, x, y]] of Object.entries(TILES)) {
  const { ctx, items, arch } = await admit(z, x, y);
  const rel = relateParts(items, ctx);
  const groups = new Map();
  items.forEach((it, i) => {
    if (rel.group[i] < 0 || !rel.keep[i]) return;
    if (!groups.has(rel.group[i])) groups.set(rel.group[i], []);
    groups.get(rel.group[i]).push(i);
  });
  let pilesBefore = 0, pilesAfter = 0;
  const shard = [];
  const examples = [];
  for (const members of groups.values()) {
    const before = new Set(members.map((i) => lookKey(architectureStyle(items[i], arch, ctx.extent, ctx.kA))));
    const r = items[rel.root[members[0]]];
    const lid = r.sid ?? seamId(r, ctx) ?? r.id;
    const top = rel.top[members[0]];
    const rootLook = top > 0 && top !== r.rawH ? { ...r, rawH: top } : r;
    const after = new Set(members.map(() => lookKey(architectureStyle({ ...rootLook, id: lid }, arch, ctx.extent, ctx.kA))));
    if (members.some((i) => items[i].rawH >= 250)) shard.push({ parts: members.length, heights: members.map((i) => items[i].rawH), tags: members.map((i) => items[i].archTags), looksBefore: [...before], looksAfter: [...after] });
    if (before.size > 1) pilesBefore++;
    if (after.size > 1) pilesAfter++;
    if (examples.length < 4 && before.size > 1) examples.push({ parts: members.length, heights: members.map((i) => items[i].rawH), looksBefore: [...before], looksAfter: [...after] });
  }
  const hidden = rel.dropped.twin + rel.dropped.inside + rel.dropped.outline;
  out[name] = { tile: [z, x, y], items: items.length, structures: groups.size, partsInStructures: [...groups.values()].reduce((a, m) => a + m.length, 0), hiddenDrawnBefore: hidden, hiddenDrawnAfter: 0, dropped: rel.dropped, partPilesBefore: pilesBefore + hidden, partPilesAfter: pilesAfter, multiLookStructuresBefore: pilesBefore, multiLookStructuresAfter: pilesAfter, tallest: shard, examples };
  console.log(name, JSON.stringify(out[name]));
}
// Seam twins: Midtown and its east neighbour.
{
  const A = await admit(14, 4824, 6157), B = await admit(14, 4825, 6157);
  const contact = (it, ctx, side) => {
    const E = ctx.extent, ring = it.polys[0].outer, bx = side === 'E' ? E : 0;
    let lo = Infinity, hi = -Infinity;
    for (let e = 0, q = ring.length - 1; e < ring.length; q = e++) {
      const a = ring[q], b = ring[e];
      if (Math.abs(a.x - bx) < 1e-3 && Math.abs(b.x - bx) < 1e-3) {
        lo = Math.min(lo, a.y, b.y);
        hi = Math.max(hi, a.y, b.y);
      }
    }
    return hi > lo ? `${Math.round(lo)}:${Math.round(hi)}` : null;
  };
  const left = new Map(), right = new Map();
  for (const it of A.items) { const c = contact(it, A.ctx, 'E'); if (c) left.set(c, it); }
  for (const it of B.items) { const c = contact(it, B.ctx, 'W'); if (c) right.set(c, it); }
  let pairs = 0, splitBefore = 0, splitAfter = 0, idMatch = 0;
  for (const [c, a] of left) {
    const b = right.get(c);
    if (!b) continue;
    pairs++;
    const sa = architectureStyle(a, A.arch, A.ctx.extent, A.ctx.kA), sb = architectureStyle(b, B.arch, B.ctx.extent, B.ctx.kA);
    if (lookKey(sa) !== lookKey(sb)) splitBefore++;
    const ia = seamId(a, A.ctx), ib = seamId(b, B.ctx);
    if (ia === ib) idMatch++; else if (process.env.DBG) console.log('MISMATCH', c, JSON.stringify(a.polys[0].outer.filter(p=>p.x<1||p.x>4095||p.y<1||p.y>4095).map(p=>[+p.x.toFixed(3),+p.y.toFixed(3)])), JSON.stringify(b.polys[0].outer.filter(p=>p.x<1||p.x>4095||p.y<1||p.y>4095).map(p=>[+p.x.toFixed(3),+p.y.toFixed(3)])));
    const ta = architectureStyle({ ...a, id: ia ?? a.id }, A.arch, A.ctx.extent, A.ctx.kA), tb = architectureStyle({ ...b, id: ib ?? b.id }, B.arch, B.ctx.extent, B.ctx.kA);
    if (lookKey(ta) !== lookKey(tb)) splitAfter++;
  }
  out.seam = { tiles: ['14/4824/6157', '14/4825/6157'], pairs, seamIdMatch: idMatch, splitLookBefore: splitBefore, splitLookAfter: splitAfter };
  console.log('seam', JSON.stringify(out.seam));
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote', OUT);

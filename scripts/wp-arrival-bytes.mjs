/**
 * WORLD PASS B r2: per-attribute building bytes per vertex, CPU arrays and a GPU
 * estimate (a 3-component 8- or 16-bit attribute is stored as 4 components under
 * ANGLE / D3D11), for the Enhanced sat-buildings bundle of one z14 tile per place,
 * with every flag off, WORLD_ARRIVAL alone, and TRUTH + ARRIVAL + REACH + LOOK
 * (each stream's worker tunables from fly-constants). Runs on the recorded inputs
 * of scripts/world-pass-worker-proof.mjs (run that once first; nothing is
 * fetched, so LOOK's roof photos fall back as when the photo is missing).
 *
 *   node scripts/wp-arrival-bytes.mjs [--arms=off,arrival,all4]
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
const tileOf = (lat, lon, z) => {
  const n = 2 ** z, x = Math.floor(((lon + 180) / 360) * n), r = (lat * Math.PI) / 180;
  return [x, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
};
const PLACES = [['midtown', 40.7549, -73.984], ['paris', 48.8566, 2.3522], ['tokyo', 35.6812, 139.7671], ['phoenix-suburb', 33.38, -111.84], ['hong-kong', 22.282, 114.158], ['san-francisco', 37.7937, -122.3965]];
const RUNWAY = { airportLandmarks: false, operationsAirports: [] };
const ENH = { visuals: true, trueAreas: true, sceneryForms: true, showcaseEarth: true, ...RUNWAY };
const STREAMS = { truth: ['heights', 'typology', 'smallBand', 'roofs'], arrival: ['fastQuery', 'drapeCap', 'workerPrep', 'uploads', 'footings', 'readiness'], reach: ['standIns'], look: ['roofPhoto', 'walls', 'structures', 'authority'], ground: ['trees', 'bridges'] };
const FC = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
const BLOCK = { truth: FC.WORLD_TRUTH, arrival: FC.WORLD_ARRIVAL, reach: FC.WORLD_REACH, look: FC.WORLD_LOOK, ground: FC.WORLD_GROUND };
const request = (on) => {
  const any = on.length > 0;
  const req = { v: 1, key: any ? 'wp1-ultra-bytes-' + on.join('') : 'wp1-0', any, tier: any ? 'ultra' : null };
  for (const [s, subs] of Object.entries(STREAMS)) {
    const o = on.includes(s);
    req[s] = { on: o, ...Object.fromEntries(subs.map((k) => [k, o])), worker: o ? JSON.parse(JSON.stringify(BLOCK[s]?.worker ?? {})) : null };
  }
  return { worldPass: req };
};
const ARMS = { off: [], arrival: ['arrival'], all4: ['truth', 'arrival', 'reach', 'look'] };
const only = (process.argv.find((a) => a.startsWith('--arms=')) ?? '').slice(7);
await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
const api = globalThis.__worldPassApi;
const gpuOf = (a, comps) => {
  if (!a) return 0;
  const bpe = a.BYTES_PER_ELEMENT, n = a.length / comps;
  // D3D11 (ANGLE) has no 3-component 8- or 16-bit vertex format: such an attribute is
  // expanded to 4 components on upload. Float32x3 is native.
  const c = comps === 3 && bpe < 4 ? 4 : comps;
  return n * c * bpe;
};
const KEYS = [['pos', 3], ['col', 3], ['anchor', 2], ['uv', 2], ['normal', 3], ['style', 3], ['idx', 1]];
const tot = {};
for (const [name, lat, lon] of PLACES) {
  const [x, y] = tileOf(lat, lon, 14);
  for (const [arm, on] of Object.entries(ARMS)) {
    if (only && !only.split(',').includes(arm)) continue;
    const r = await api.buildTile(14, x, y, 'sat-buildings', { ...ENH, ...request(on) });
    const b = r.satBuilding;
    if (!b) { console.log(name, arm, 'empty'); continue; }
    const comps = (k, d) => (b.prep?.[k + 'Comps'] ?? d);
    const nV = b.anchor.length / 2, aux = b.meta.auxiliaryIndexCount;
    let cpu = 0, gpu = 0;
    const parts = [];
    for (const [k, c0] of KEYS) {
      const a = b[k]; if (!a) continue;
      const c = comps(k, c0);
      cpu += a.byteLength; const g = gpuOf(a, c); gpu += g;
      parts.push(`${k} ${a.constructor.name.replace('Array', '')}x${c} ${(a.byteLength / nV).toFixed(1)}B`);
    }
    const T = (tot[arm] ??= { cpu: 0, gpu: 0, v: 0, i: 0 });
    T.cpu += cpu; T.gpu += gpu; T.v += nV; T.i += b.idx.length;
    console.log(`${name.padEnd(15)} ${arm.padEnd(8)} verts ${nV} idx ${b.idx.length} (detail ${b.idx.length - aux}) | cpu ${(cpu / 1048576).toFixed(2)} MiB ${(cpu / nV).toFixed(1)} B/v | gpu ${(gpu / 1048576).toFixed(2)} MiB ${(gpu / nV).toFixed(1)} B/v | ${parts.join(', ')}`);
  }
}
for (const [arm, T] of Object.entries(tot)) console.log(`TOTAL ${arm}: cpu ${(T.cpu / 1048576).toFixed(1)} MiB, gpu ${(T.gpu / 1048576).toFixed(1)} MiB, verts ${T.v}, indices ${T.i}`);

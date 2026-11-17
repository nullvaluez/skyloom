/** WORLD PASS B r2b: the sliced collision-column grid (columnGridBegin / columnGridStep) builds
 * exactly what the shipped buildColumnGrid builds, sliced to 128 columns a call or in one go.
 * The three functions are read from the engine source (they are module-private).
 *   node scripts/wp-arrival-r2b-colgrid.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../lib/fly/toy-world/sat-building-engine.js'), 'utf8');
const grab = (n) => {
  const i = src.indexOf(`function ${n}(`);
  if (i < 0) throw Error(`missing ${n}`);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw Error(`unbalanced ${n}`);
};
const f = new Function('WORLD_SIZE', 'COLUMN_GRID_N', `${['clampIdx', 'buildColumnGrid', 'columnGridBegin', 'columnGridStep'].map(grab).join('\n')}; return { buildColumnGrid, columnGridBegin, columnGridStep };`)(2 * Math.PI * 6378137, 8);
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
let bad = 0, maxCalls = 0;
const span = (2 * Math.PI * 6378137) / 2 ** 14;
for (let t = 0; t < 300; t++) {
  const n = t === 0 ? 0 : Math.floor(rnd() * 4000), cx = 1234.5, cz = -5678.25;
  const xs = new Float64Array(n), zs = new Float64Array(n), tp = new Float64Array(n), rs = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = cx + (rnd() - 0.5) * span * 1.1; zs[i] = cz + (rnd() - 0.5) * span * 1.1; tp[i] = rnd() * 300; rs[i] = rnd() * 80; }
  const A = f.buildColumnGrid(cx, cz, 14, xs, zs, tp, rs);
  const G = f.columnGridBegin(cx, cz, 14, n);
  let calls = 1;
  while (!f.columnGridStep(G, xs, zs, tp, rs, t % 2 ? -1 : Infinity)) calls++;
  maxCalls = Math.max(maxCalls, calls);
  if (JSON.stringify({ ...A, data: [...A.data] }) !== JSON.stringify({ ...G.grid, data: [...G.grid.data] })) bad++;
}
console.log(`${bad ? 'FAIL' : 'PASS'} sliced column grid = buildColumnGrid on 300 tiles (half sliced, up to ${maxCalls} calls), ${bad} mismatches`);
process.exit(bad ? 1 : 0);

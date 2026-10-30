/**
 * SHIP PASS FRAME (FR-6, D16) — re-derive the one budget table from real
 * device reports.
 *
 *   node scripts/derive-budget-table.mjs [report.json ...] [--write] [--headroom=0.05]
 *
 * With no files it reads .graphics-review/device-reports/*.json (where the dev
 * server's /api/dev/device-report saves `?diag=1` → Benchmark → Send). Each
 * report is filed under the row lib/fly/tier-budgets.js budgetIdFor() holds it
 * to (ultra / high / medium / phone / tablet / low). For every row with at
 * least one report:
 *   draws, triangles, textureMiB  = the worst measured peak × (1 + headroom)
 *                                   (D16: a census gate fails a regression over 5%)
 *   gpuMs                         = the worst measured p95 GPU ms × (1 + headroom), if any report has one
 *   stallsPerMin, missedFrac      = the section 2 targets are POLICY and stay; the
 *                                   measured values are printed beside them
 * and the row becomes `provisional: false` with the report files as sources.
 * Rows with no report keep their provisional values.
 *
 * Without --write it prints the table and the diff. With --write it rewrites
 * the block between `// BUDGET TABLE begin` and `// BUDGET TABLE end` in
 * lib/fly/tier-budgets.js (CRLF-safe), so the owner turns the table real in
 * one command after the W0.6 runs (FLY_SHIP_PASS.md section 9).
 */
import { register } from 'node:module';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

register('./_node-resolve.mjs', import.meta.url);
const { BUDGET_TABLE, budgetIdFor, missedShare } = await import('../lib/fly/tier-budgets.js');

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, '.graphics-review', 'device-reports');
const FILE = path.join(ROOT, 'lib', 'fly', 'tier-budgets.js');
const argv = process.argv.slice(2);
const write = argv.includes('--write');
const headroom = Number((argv.find((a) => a.startsWith('--headroom=')) ?? '--headroom=0.05').split('=')[1]);
const files = argv.filter((a) => !a.startsWith('--'));
const inputs = files.length ? files : existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(DIR, f)) : [];
const MiB = 1048576;

if (!inputs.length) {
  console.log('No device reports found (pass files, or save them under .graphics-review/device-reports/). The table stays provisional.');
  process.exit(0);
}

const groups = {};
for (const f of inputs) {
  let r;
  try {
    r = JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    console.log(`SKIP ${f}: ${e.message}`);
    continue;
  }
  (groups[budgetIdFor(r)] ??= []).push({ file: path.relative(ROOT, path.resolve(f)), r });
}

const up = (v) => (Number.isFinite(v) ? Math.ceil(v * (1 + headroom)) : null);
const max = (xs) => {
  const v = xs.filter(Number.isFinite);
  return v.length ? Math.max(...v) : null;
};
const next = {};
const notes = [];
for (const [id, base] of Object.entries(BUDGET_TABLE)) {
  const got = groups[id];
  if (!got?.length) {
    next[id] = { ...base };
    continue;
  }
  const draws = max(got.map(({ r }) => r.renderer?.callsPeak ?? r.renderer?.calls));
  const tris = max(got.map(({ r }) => r.renderer?.trianglesPeak ?? r.renderer?.triangles));
  const tex = max(got.map(({ r }) => (Number.isFinite(r.renderer?.textureBytes) ? r.renderer.textureBytes / MiB : null)));
  const gpu = max(got.map(({ r }) => r.frame?.gpuMs));
  const stalls = max(got.map(({ r }) => r.frame?.long100PerMin));
  const missed = max(got.map(({ r }) => r.frame?.missed?.frac ?? (Array.isArray(r.frame?.dts) ? missedShare(r.frame.dts, base.targetFps).frac : null)));
  next[id] = {
    ...base,
    draws: up(draws) ?? base.draws,
    triangles: up(tris) ?? base.triangles,
    textureMiB: up(tex) ?? base.textureMiB,
    gpuMs: gpu != null ? Math.round(gpu * (1 + headroom) * 10) / 10 : base.gpuMs,
    provisional: false,
    sources: [...got.map(({ file, r }) => `${file} (${r.gpu?.renderer ?? 'GPU ?'}, ${r.at ?? 'undated'})`), `derived ${new Date().toISOString().slice(0, 10)}: peak +${Math.round(headroom * 100)}%`],
  };
  notes.push(`${id}: ${got.length} report(s); measured draws ${draws ?? '—'}, triangles ${tris ?? '—'}, texture ${tex != null ? tex.toFixed(1) : '—'} MiB, GPU ${gpu ?? '—'} ms, stalls/min ${stalls ?? '—'} (target ${base.stallsPerMin}), missed share ${missed != null ? missed.toFixed(4) : '—'} (target ${base.missedFrac})`);
}

const lit = (v) => (typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : Array.isArray(v) ? `[${v.map(lit).join(', ')}]` : v === null ? 'null' : String(v));
const block = [
  '// BUDGET TABLE begin (scripts/derive-budget-table.mjs rewrites this block)',
  'export const BUDGET_TABLE = Object.freeze({',
  ...Object.entries(next).map(([id, b]) => {
    const keys = ['label', 'classes', 'targetFps', 'draws', 'triangles', 'textureMiB', 'geometryMiB', 'gpuMs', 'stallsPerMin', 'missedFrac', 'provisional', 'sources'];
    return `  ${id}: Object.freeze({ ${keys.map((k) => `${k}: ${lit(b[k] ?? null)}`).join(', ')} }),`;
  }),
  '});',
  '// BUDGET TABLE end',
].join('\n');

for (const n of notes) console.log(n);
for (const [id, b] of Object.entries(next)) {
  const a = BUDGET_TABLE[id];
  const moved = ['draws', 'triangles', 'textureMiB', 'gpuMs'].filter((k) => a[k] !== b[k]).map((k) => `${k} ${a[k]} → ${b[k]}`);
  console.log(`${id.padEnd(7)} ${b.provisional ? 'provisional' : 'MEASURED   '} ${moved.length ? moved.join(', ') : 'unchanged'}`);
}
if (!write) {
  console.log('\n(dry run — pass --write to rewrite lib/fly/tier-budgets.js)');
  process.exit(0);
}
const src = readFileSync(FILE, 'utf8');
const crlf = src.includes('\r\n');
const text = src.replace(/\r\n/g, '\n');
const a = text.indexOf('// BUDGET TABLE begin');
const z = text.indexOf('// BUDGET TABLE end');
if (a < 0 || z < a) throw new Error('BUDGET TABLE markers not found in lib/fly/tier-budgets.js');
const out = text.slice(0, a) + block + text.slice(z + '// BUDGET TABLE end'.length);
writeFileSync(FILE, crlf ? out.replace(/\n/g, '\r\n') : out);
console.log(`\nWrote ${path.relative(ROOT, FILE)}. Run node scripts/verify-ship-frame.mjs and node scripts/verify-device-report.mjs next.`);

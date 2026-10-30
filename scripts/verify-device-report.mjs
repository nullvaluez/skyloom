/**
 * TRUE EARTH — verify-device-report: grade device reports from the
 * diagnostics overlay (`?diag=1` → Benchmark → Send report), saved by the dev
 * server under .graphics-review/device-reports/.
 *
 *   node scripts/verify-device-report.mjs                  grade every saved report
 *   node scripts/verify-device-report.mjs path/to/r.json   grade specific files
 *
 * A report is graded against its device's tier budget (lib/fly/tier-budgets.js);
 * an unmeasured row is reported as UNMEASURED, never as a pass. With no saved
 * reports (the cloud container: no real GPU), it self-tests the grader and the
 * GPU classifier on real renderer strings instead, and says so.
 */
import { register } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
register('./_node-resolve.mjs', import.meta.url);
// SHIP PASS FRAME (FR-6): the one budget table (lib/fly/tier-budgets.js).
const { gradeReport, BUDGET_TABLE, missedShare } = await import('../lib/fly/tier-budgets.js');
const { gpuClass } = await import('../lib/fly/device-class.js');

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, '.graphics-review', 'device-reports');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = args.length
  ? args
  : existsSync(DIR)
    ? readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(DIR, f))
    : [];

let failed = 0;
if (files.length) {
  for (const file of files) {
    const report = JSON.parse(readFileSync(file, 'utf8'));
    const g = gradeReport(report);
    console.log(`\n${path.relative(ROOT, file)}`);
    console.log(`  ${report.gpu?.renderer ?? 'GPU unknown'} → ${report.gpu?.class} (${g.label}${g.provisional ? ', PROVISIONAL budget row' : ''})`);
    console.log(`  build ${report.build?.sha || '?'} · ${report.benchmark ? `benchmark ${report.benchmark.id}, reveal ${report.benchmark.revealMs} ms` : 'snapshot (no benchmark)'} · flags ${JSON.stringify(report.flags?.resolved ?? {})}`);
    for (const r of g.rows) {
      const verdict = r.info ? 'INFO' : r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : 'UNMEASURED';
      console.log(`  ${verdict.padEnd(10)} ${r.name}: ${r.value ?? '—'} (limit ${r.limit ?? '—'})`);
    }
    console.log(`  ${g.pass ? 'WITHIN BUDGET' : 'NOT WITHIN BUDGET'}`);
    if (!g.pass) failed++;
  }
  console.log(`\n${files.length - failed} of ${files.length} report(s) within budget`);
  process.exit(failed ? 1 : 0);
}

// Self-test (no saved reports): the grader and the classifier.
console.log('No saved device reports — self-testing the grader (this is not a device verdict).');
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const cases = [
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 'high'],
  ['ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 'high'],
  ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 'high'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)', false, 'high'],
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 'medium'],
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 'medium'],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 'medium'],
  ['ANGLE (AMD, AMD Radeon 780M Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 'medium'],
  ['ANGLE (NVIDIA, NVIDIA GeForce MX450 (0x00001F97) Direct3D11 vs_5_0 ps_5_0, D3D11)', false, 'medium'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', false, 'medium'],
  ['Apple GPU', false, 'medium'],
  ['Apple GPU', true, 'phone'],
  ['Adreno (TM) 740', true, 'phone'],
  ['Mali-G715 MC7', true, 'phone'],
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', false, 'low'],
  ['', false, 'medium'],
];
const wrong = cases.filter(([r, coarse, want]) => gpuClass(r, { coarse }).cls !== want).map(([r, c, w]) => `${r || '(empty)'}${c ? ' [touch]' : ''} → ${gpuClass(r, { coarse: c }).cls}, want ${w}`);
check('(1) gpuClass sorts real renderer strings into the tier budgets', wrong.length === 0, wrong.join(' | '));

const MiB = 1048576;
const ok = gradeReport({ gpu: { class: 'phone' }, device: { phoneClass: true }, frame: { p95: 18, p99: 40, long100PerMin: 0, missed: { frac: 0.02, targetFps: 60 } }, renderer: { trianglesPeak: 1.0e6, callsPeak: 200, textureBytes: 200 * MiB } });
const over = gradeReport({ gpu: { class: 'high' }, frame: { p95: 13, p99: 19, long100PerMin: 0, missed: { frac: 0 } }, renderer: { trianglesPeak: 3e6, callsPeak: 300, textureBytes: 100 * MiB } });
const blind = gradeReport({ gpu: { class: 'medium' }, frame: {}, renderer: {} });
check(
  '(2) the grader passes in-budget, fails over-budget, and never passes unmeasured rows',
  ok.pass === true && ok.tier === 'phone' && over.pass === false && over.rows.find((r) => r.name === 'triangles (peak)').pass === false &&
    blind.pass === false && blind.rows.filter((r) => !r.info).every((r) => r.pass === null),
);
check(
  '(3) every budget row has missed-share, stall, triangle, draw and texture limits',
  Object.values(BUDGET_TABLE).every((b) => b.missedFrac > 0 && b.stallsPerMin >= 0 && b.triangles > 0 && b.draws > 0 && b.textureMiB > 0),
);
// FR-6: a 60 Hz session with no missed vblank (every interval 16.7 ms, i.e.
// p95 16.7 — which the pre-pass p95 ≤ 12 ms High budget failed) passes.
const sixty = Array.from({ length: 600 }, () => 16.7);
const clean = gradeReport({ gpu: { class: 'high' }, quality: { preset: 'high' }, frame: { p95: 16.7, p99: 16.7, long100PerMin: 0, missed: missedShare(sixty, 60) }, renderer: { trianglesPeak: 2e6, callsPeak: 360, textureBytes: 250 * MiB } });
check('(4) a synthetic 60 Hz report with no missed vblank grades as a pass (FR-6)', clean.pass === true && clean.rows[0].value === 0, JSON.stringify(clean.rows.map((r) => [r.name, r.pass])));
const dropped = missedShare([...sixty.slice(0, 590), ...Array(10).fill(33.4)], 60);
check('(5) a dropped vblank (33.4 ms at 60) counts as a miss; 30 Hz frames at 33.4 do not', dropped.over === 10 && missedShare(Array(10).fill(33.4), 30).over === 0);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

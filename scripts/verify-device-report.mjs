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
const { gradeReport, TIER_BUDGETS } = await import('../lib/fly/tier-budgets.js');
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
    console.log(`  ${report.gpu?.renderer ?? 'GPU unknown'} → ${report.gpu?.class} (${g.label})`);
    console.log(`  build ${report.build?.sha || '?'} · ${report.benchmark ? `benchmark ${report.benchmark.id}, reveal ${report.benchmark.revealMs} ms` : 'snapshot (no benchmark)'} · flags ${JSON.stringify(report.flags?.resolved ?? {})}`);
    for (const r of g.rows) {
      const verdict = r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : 'UNMEASURED';
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

const ok = gradeReport({ gpu: { class: 'phone' }, frame: { p95: 18, p99: 40, long100PerMin: 0 }, renderer: { trianglesPeak: 1.0e6, callsPeak: 200 } });
const over = gradeReport({ gpu: { class: 'high' }, frame: { p95: 13, p99: 19, long100PerMin: 0 }, renderer: { trianglesPeak: 3e6, callsPeak: 300 } });
const blind = gradeReport({ gpu: { class: 'medium' }, frame: {}, renderer: {} });
check(
  '(2) the grader passes in-budget, fails over-budget, and never passes unmeasured rows',
  ok.pass === true && ok.tier === 'phone' && over.pass === false && over.rows.find((r) => r.name === 'frame p95 (ms)').pass === false &&
    blind.pass === false && blind.rows.every((r) => r.pass === null),
);
check('(3) every tier has frame, long-frame, triangle and draw limits', Object.values(TIER_BUDGETS).every((b) => b.p95Ms > 0 && b.triangles > 0 && b.draws > 0 && b.long100PerMin >= 0));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

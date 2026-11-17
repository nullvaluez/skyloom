/** Combine serialized capture matrices without discarding invalid/outlier rows.
 * node scripts/world-pass-stall-report.cjs --out=<dir> <capture-dir> ...
 */
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const output = args.find(a => a.startsWith('--out='))?.slice(6);
if (!output) throw Error('--out=<directory> is required');
const sources = args.filter(a => !a.startsWith('--'));
if (!sources.length) throw Error('Supply at least one capture directory');
const out = path.resolve(output);
fs.mkdirSync(out, { recursive: true });
const rows = [], tasks = [];
for (const source of sources) {
  const dir = path.resolve(source), report = JSON.parse(fs.readFileSync(path.join(dir, 'stalls.json'), 'utf8'));
  for (const row of report.rows) {
    const s = row.summary ?? {}, cache = row.id.match(/-(fresh|warm)-page\d+$/)?.[1] ?? row.phase;
    const data = { dataset: path.basename(dir), serverRef: report.serverRef ?? '', version: report.version,
      mode: row.mode, quality: row.preset ?? row.quality, pose: row.pose, arm: row.arm, cache, page: row.page,
      firstWorldMs: s.firstWorldFrameMs, firstAnyCanvasMs: s.firstAnyCanvasDrawMs ?? row.monitor?.firstPresentedDrawMs,
      boot100Ms: s.boot100Ms, revealedMs: s.bootOverlayRemovedMs, worstTaskMs: s.worstLongTaskMs,
      postRevealTaskMs: s.postRevealWorstTaskMs, worstRafGapMs: s.worstFrameGapMs,
      worstWorldGapMs: s.worstWorldFrameGapMs, postRevealWorldGapMs: s.postRevealWorstWorldFrameGapMs,
      medianRafMs: s.medianFrame60to90Ms, medianWorldMs: s.medianWorldFrame60to90Ms,
      ringEngineSec: s.fullRingEngineSec, ringAfterWarpMs: s.fullRingObservedWarpMs,
      profiled: !!report.profiled, plain: !!report.plain, errors: row.errors.join('; '),
      record: path.relative(out, path.join(dir, `${row.id}.json`)).replaceAll('\\', '/'),
      screenshot: row.screenshot ? path.relative(out, path.join(dir, row.screenshot)).replaceAll('\\', '/') : '' };
    rows.push(data);
    for (const task of row.monitor?.longtasks ?? []) tasks.push({ dataset: data.dataset, id: row.id,
      cache, startMs: task.startMs, durationMs: task.durationMs,
      afterReveal: s.bootOverlayRemovedMs != null && task.startMs + task.durationMs > s.bootOverlayRemovedMs });
  }
}
function csv(values) {
  if (!values.length) return '';
  const keys = Object.keys(values[0]), cell = v => '"' + String(v ?? '').replaceAll('"', '""') + '"';
  return [keys, ...values.map(row => keys.map(key => row[key]))].map(row => row.map(cell).join(',')).join('\n') + '\n';
}
fs.writeFileSync(path.join(out, 'stall-table.csv'), csv(rows));
fs.writeFileSync(path.join(out, 'longtasks.csv'), csv(tasks));
const number = (value, scale = 1) => value == null ? '—' : (value / scale).toFixed(scale === 1000 ? 2 : 1);
const md = [
  '# World Pass stall measurements', '',
  'Each row is one 90-second capture. Profiled rows are causal evidence, not quiet timing. Errors and outliers remain visible. The JSON record contains every task and raw interval; longtasks.csv lists all tasks over 200 ms.', '',
  'Version 2/3 first-frame values are the first large canvas presentation and may include the temporary hangar. Version 4+ excludes that canvas. Earlier cache phases overwritten by the final flight phase are recovered from their immutable row IDs. World-frame intervals count completed main-composer draws on the candidate; old source uses its original frame pulse.', '',
  '| Dataset | Pose / flags | Cache / page | First world s | Reveal s | Max task ms | After reveal ms | Max world gap ms | After reveal world gap ms | Median rAF / world ms | Ring s | Status |',
  '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  ...rows.map(r => `| ${r.dataset} | ${r.pose} / ${r.arm} | ${r.cache} / ${r.page} | ${number(r.firstWorldMs, 1000)} | ${number(r.revealedMs, 1000)} | ${number(r.worstTaskMs)} | ${number(r.postRevealTaskMs)} | ${number(r.worstWorldGapMs)} | ${number(r.postRevealWorldGapMs)} | ${number(r.medianRafMs)} / ${number(r.medianWorldMs)} | ${number(r.ringEngineSec)} | [${r.errors ? 'INVALID: ' + r.errors.replaceAll('|', '/') : r.profiled ? 'profiled' : 'measured'}](${r.record}) |`),
  '', 'The ring column is the engine’s own time origin; ringAfterWarpMs and all absolute navigation timestamps are retained in stall-table.csv.', '',
];
fs.writeFileSync(path.join(out, 'stall-table.md'), md.join('\n'));
console.log(`${rows.length} rows, ${tasks.length} long tasks, ${rows.filter(r => r.errors).length} invalid rows retained`);

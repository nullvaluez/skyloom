/** Combine serialized capture matrices without discarding invalid/outlier rows.
 * node scripts/world-pass-stall-report.cjs --out=<dir> <capture-dir> ...
 * Optional matched comparison: --prior-ref=8c593924 --final-ref=<server-ref>
 * A verified legacy source without serverRef: --source-ref=<dataset>:<ref>
 */
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const output = args.find(a => a.startsWith('--out='))?.slice(6);
const option = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const priorRef = option('prior-ref'), finalRef = option('final-ref');
const suppliedRefs = new Map(args.filter(arg => arg.startsWith('--source-ref=')).map(arg => {
  const value = arg.slice('--source-ref='.length), separator = value.lastIndexOf(':');
  if (separator < 1 || separator === value.length - 1) throw Error('--source-ref requires <dataset>:<ref>');
  return [value.slice(0, separator), value.slice(separator + 1)];
}));
if (!output) throw Error('--out=<directory> is required');
if (!!priorRef !== !!finalRef) throw Error('Supply both --prior-ref and --final-ref for a matched comparison');
const sources = args.filter(a => !a.startsWith('--'));
if (!sources.length) throw Error('Supply at least one capture directory');
const out = path.resolve(output);
fs.mkdirSync(out, { recursive: true });
const rows = [], tasks = [], datasets = [], comparisons = [];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const largest = (values, fallback = null) => values.reduce((max, value) => finite(value) ? Math.max(max ?? value, value) : max, fallback);
const intervalsMax = values => largest(values.map(value => value.durationMs), 0);
const within = (values, limit) => values.filter(value => finite(value.startMs) && finite(value.durationMs) && value.startMs >= 0 && value.startMs < limit);
const cacheOf = row => row.id.match(/-(fresh|warm)-page\d+$/)?.[1] ?? row.phase;
const shotPolicy = (row, report) => typeof row.screenshotsEnabled === 'boolean' ? row.screenshotsEnabled
  : typeof report.screenshotsEnabled === 'boolean' ? report.screenshotsEnabled
  : row.screenshot || Object.hasOwn(row, 'screenshotError') || row.screenshotAttempted ? true : null;
const shotOutcome = (row, report) => !row ? 'unknown' : row.screenshot ? 'screenshot'
  : Object.hasOwn(row, 'screenshotError') ? 'screenshot-error'
  : shotPolicy(row, report) === false ? 'no-shot' : 'unknown';
function ringEvidence(row, durationMs) {
  const m = row.monitor ?? {}, s = row.summary ?? {};
  const sample = (m.samples ?? []).find(sample => sample.atMs >= (m.warpMs ?? 0) && sample.atMs <= durationMs && finite(sample.buildings?.fullRingSec) && sample.buildings.fullRingSec >= 0);
  const observation = m.fullRingObservation?.atMs <= durationMs ? m.fullRingObservation.buildings : null;
  const stats = observation?.stats ?? sample?.buildings ?? row.buildings;
  const census = observation?.ring ?? sample?.buildingRing ?? null;
  const settled = s.fullRingObservedWarpMs >= 0 && finite(s.fullRingObservedWarpMs) || s.fullRingEngineSec >= 0 && finite(s.fullRingEngineSec);
  const source = observation ? 'settled observation' : sample ? 'first settled sample' : stats ? 'end only' : 'unrecorded';
  const reasons = stats?.emptyByReason;
  const ready = census?.ready ?? stats?.ready, empty = census?.empty ?? stats?.empty;
  let complete = null, content = settled ? 'settled; content unknown' : 'not observed';
  if (settled && source !== 'end only' && stats) {
    if (census?.failedChunks > 0 || census?.staleChunks > 0) {
      complete = false; content = 'settled with failed content';
    } else if (census?.emptyAfterErrors > 0) {
      content = 'settled; empty after build errors, cause unverified';
    } else if (census?.unresolved > 0) {
      complete = false; content = 'settled stamp; observed ring unresolved';
    } else if (empty === 0 && ready > 0 && (census ? ready === census.desired : ready === stats.chunks)) {
      complete = true; content = 'settled; all ready';
    } else if (empty > 0) {
      const knownEmpty = census ? census.noData + census.zero === empty
        : reasons && reasons.noData + reasons.zero === empty && reasons.legacy === 0;
      // Legacy noData conflates 404/204 with exhausted errors. A cumulative
      // retry count cannot prove which empty tiles failed; keep it uncertain.
      if (!census && stats.errorRetries > 0 && !(reasons?.zero === empty)) content = 'settled; empty with retries, cause unverified';
      else if (knownEmpty && (!census || census.ready + empty === census.desired)) {
        complete = true; content = 'settled; valid empty results';
      } else content = 'settled; empty reasons unknown';
    }
  }
  return { ringContent: content, ringContentComplete: complete, ringCensusSource: source,
    ringReady: ready ?? null, ringEmpty: empty ?? null, ringErrorRetries: stats?.errorRetries ?? null,
    ringNoData: census?.noData ?? reasons?.noData ?? null, ringZero: census?.zero ?? reasons?.zero ?? null,
    ringUnknownEmpty: census?.unknown ?? reasons?.legacy ?? null,
    ringEmptyAfterErrors: census?.emptyAfterErrors ?? null, ringFailedChunks: census?.failedChunks ?? null,
    ringStaleChunks: census?.staleChunks ?? null, ringMaxEmptyAttempts: census?.maxEmptyAttempts ?? null };
}
function workerThrowCounts(monitor) {
  if (!Array.isArray(monitor.workerThrows)) return '';
  const counts = {};
  for (const error of monitor.workerThrows) {
    const message = error.message ?? '';
    const category = /^http-(?:\d{3}|timeout)$/.test(message) ? message
      : /failed to fetch|networkerror|load failed/i.test(message) ? 'fetch failure'
      : ['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'].includes(error.name) ? error.name : 'other throw';
    counts[category] = (counts[category] ?? 0) + (error.count ?? 1);
  }
  return JSON.stringify(counts); // No raw exception messages, URLs or tile keys.
}
for (const source of sources) {
  const dir = path.resolve(source), report = JSON.parse(fs.readFileSync(path.join(dir, 'stalls.json'), 'utf8'));
  if (dir === out) throw Error('The report output directory must differ from each capture directory');
  const dataset = path.basename(dir), firstRow = rows.length;
  const suppliedRef = suppliedRefs.get(dataset);
  if (report.serverRef && suppliedRef && report.serverRef !== suppliedRef) throw Error(`Supplied ref conflicts with recorded serverRef for ${dataset}`);
  const serverRef = report.serverRef ?? suppliedRef ?? '';
  const serverRefSource = report.serverRef ? 'capture' : suppliedRef ? 'explicit --source-ref' : 'unrecorded';
  for (const [index, row] of report.rows.entries()) {
    const s = row.summary ?? {}, cache = cacheOf(row);
    const donor = report.rows.slice(0, index).findLast(candidate => candidate.page === row.page - 1 && cacheOf(candidate) === cache
      && candidate.pose === row.pose && candidate.arm === row.arm && candidate.mode === row.mode && candidate.quality === row.quality);
    const transfer = row.page === 1 ? 'first-page' : shotOutcome(donor, report);
    const reveal = s.bootOverlayRemovedMs, monitor = row.monitor ?? {};
    // The observation window is the page's monotonic clock, never the runner's
    // wallMs (which also includes navigation, collection, and screenshots).
    // Keep an interval's full duration when it starts inside the window: a
    // freeze that crosses 90 s must not shrink into a passing measurement.
    const durationMs = finite(monitor.durationMs) ? monitor.durationMs : Number(report.seconds ?? 90) * 1000;
    const raf = within(monitor.raf ?? [], durationMs), world = within(monitor.worldFrames ?? [], durationMs);
    const longtasks = within(monitor.longtasks ?? [], durationMs).filter(task => task.durationMs > 200);
    const bootIntervals = raf.filter(frame => reveal == null || frame.startMs < reveal);
    const bootTasks = longtasks.filter(task => reveal == null || task.startMs < reveal);
    const firstRaf = finite(monitor.firstRafMs) ? monitor.firstRafMs : null;
    const bootGapMs = Array.isArray(monitor.raf) ? largest([firstRaf, intervalsMax(bootIntervals)], 0) : null;
    const bootTaskMs = Array.isArray(monitor.longtasks) ? intervalsMax(bootTasks) : null;
    const worstRafGapMs = largest([s.worstFrameGapMs, firstRaf, intervalsMax(raf)]);
    const postReveal = values => reveal == null ? null : intervalsMax(values.filter(value => value.startMs + value.durationMs > reveal));
    const postRevealRafGapMs = Array.isArray(monitor.raf) ? largest([postReveal(raf), firstRaf > reveal && reveal != null ? firstRaf : null]) : null;
    const postRevealTaskMs = largest([s.postRevealWorstTaskMs, Array.isArray(monitor.longtasks) ? postReveal(longtasks) : null]);
    const postRevealWorldGapMs = largest([world.length || s.postRevealWorstWorldFrameGapMs > 0 ? s.postRevealWorstWorldFrameGapMs : null,
      world.length ? postReveal(world) : null]);
    const misses = [];
    if (bootGapMs >= 2000) misses.push('startup frame gap');
    if (bootTaskMs >= 2000) misses.push('startup task');
    if (postRevealTaskMs > 1000) misses.push('post-reveal task');
    if (postRevealRafGapMs > 1000) misses.push('post-reveal rAF gap');
    if (postRevealWorldGapMs > 1000) misses.push('post-reveal world frame gap');
    const errors = [...(row.errors ?? [])];
    if (s.medianFrame60to90Ms > 200 && !errors.some(error => /[Aa]nomalous steady cadence/.test(error))) errors.push('Anomalous steady cadence; retake required');
    const coverage = [];
    if (!Array.isArray(monitor.raf) || !finite(firstRaf)) coverage.push('startup rAF coverage missing');
    if (!Array.isArray(monitor.longtasks)) coverage.push('task coverage missing');
    if (!finite(reveal)) coverage.push('reveal not observed');
    if (!finite(s.firstWorldFrameMs)) coverage.push('world presentation not observed');
    if (!world.length) coverage.push('world-frame interval coverage missing');
    if (durationMs < 90000) coverage.push('shorter than 90 s');
    if (durationMs >= 90000 && !finite(s.medianFrame60to90Ms)) coverage.push('60–90 s cadence missing');
    const data = { dataset, id: row.id, serverRef, serverRefSource, harnessRef: report.gitHead ?? '', version: report.version,
      mode: row.mode ?? report.mode, quality: row.preset ?? row.quality ?? report.quality, pose: row.pose, arm: row.arm, cache, page: row.page,
      screenshotsEnabled: shotPolicy(row, report), screenshotError: row.screenshotError ?? '',
      transfer, donorId: donor?.id ?? '', donorScreenshotError: donor?.screenshotError ?? '',
      durationMs, firstRafMs: firstRaf,
      firstWorldMs: s.firstWorldFrameMs, firstAnyCanvasMs: s.firstAnyCanvasDrawMs ?? row.monitor?.firstPresentedDrawMs,
      boot100Ms: s.boot100Ms, revealedMs: reveal, worstTaskMs: largest([s.worstLongTaskMs, intervalsMax(longtasks)]),
      postRevealTaskMs, worstRafGapMs, bootTaskMs, bootGapMs, postRevealRafGapMs,
      worstWorldGapMs: largest([world.length || s.worstWorldFrameGapMs > 0 ? s.worstWorldFrameGapMs : null, world.length ? intervalsMax(world) : null]), postRevealWorldGapMs,
      medianRafMs: s.medianFrame60to90Ms, medianWorldMs: s.medianWorldFrame60to90Ms,
      ringEngineSec: s.fullRingEngineSec, ringAfterWarpMs: s.fullRingObservedWarpMs,
      ...ringEvidence(row, durationMs), workerThrowCounts: workerThrowCounts(monitor), workerThrowsDropped: monitor.workerThrowsDropped ?? null,
      profiled: !!(report.profiled || row.profiled), exceptions: !!(report.exceptions || row.exceptions), plain: !!report.plain, review: !!report.review, automation: !!(report.automation || row.automation),
      errors: errors.join('; '), coverage: coverage.join('; '),
      performanceMisses: misses.join(', '),
      record: path.relative(out, path.join(dir, `${row.id}.json`)).replaceAll('\\', '/'),
      screenshot: row.screenshot ? path.relative(out, path.join(dir, row.screenshot)).replaceAll('\\', '/') : '' };
    rows.push(data);
    // Every supplied >200 ms task remains in the timeline, even if outside the
    // requested window. The explicit window column separates it from verdicts.
    for (const task of monitor.longtasks ?? []) if (task.durationMs > 200) tasks.push({ dataset, serverRef: data.serverRef, id: row.id,
      mode: data.mode, quality: data.quality, pose: row.pose, arm: row.arm, cache, page: row.page,
      startMs: task.startMs, durationMs: task.durationMs, endMs: task.startMs + task.durationMs,
      inMeasurementWindow: task.startMs >= 0 && task.startMs < durationMs,
      startsDuringBoot: reveal == null ? null : task.startMs < reveal,
      afterReveal: reveal == null ? null : task.startMs + task.durationMs > reveal,
      profiled: data.profiled, exceptions: data.exceptions, transfer, errors: data.errors, record: data.record });
  }
  const captured = rows.slice(firstRow);
  datasets.push({ dataset, serverRef, serverRefSource, harnessRef: report.gitHead ?? '', version: report.version,
    mode: report.mode, quality: report.quality, seconds: report.seconds, profiled: !!report.profiled,
    exceptions: captured.some(row => row.exceptions), screenshots: [...new Set(captured.map(row => row.screenshotsEnabled === null ? 'unknown' : row.screenshotsEnabled ? 'on' : 'off'))].join('/'),
    plain: !!report.plain, review: !!report.review, automation: !!report.automation,
    rows: captured.length, invalid: captured.filter(row => row.errors).length,
    timingMisses: captured.filter(row => row.performanceMisses).length,
    record: path.relative(out, path.join(dir, 'stalls.json')).replaceAll('\\', '/') });
}
function csv(values) {
  if (!values.length) return '';
  const keys = Object.keys(values[0]), cell = v => '"' + String(v ?? '').replaceAll('"', '""') + '"';
  return [keys, ...values.map(row => keys.map(key => row[key]))].map(row => row.map(cell).join(',')).join('\n') + '\n';
}
const number = (value, scale = 1) => !finite(value) ? '—' : (value / scale).toFixed(scale === 1000 ? 2 : 1);
const safe = value => String(value ?? '').replaceAll('|', '/').replace(/[\r\n]+/g, ' ');
const link = (label, target) => `[${safe(label)}](<${target}>)`;
const status = row => [row.errors ? `INVALID: ${row.errors}` : row.profiled || row.exceptions || row.automation ? 'DIAGNOSTIC' : 'MEASURED',
  row.profiled ? 'PROFILED' : '', row.exceptions ? 'EXCEPTION DIAGNOSTIC' : '', row.automation ? 'AUTOMATED DIAGNOSTIC' : '',
  row.performanceMisses ? `TIMING MISS: ${row.performanceMisses}` : 'no recorded timing miss',
  row.ringContentComplete !== true && row.ringContent !== 'not observed' ? `CONTENT UNVERIFIED: ${row.ringContent}` : '',
  row.coverage ? `INCOMPLETE: ${row.coverage}` : ''].filter(Boolean).join('; ');
const md = [
  '# World Pass stall measurements', '',
  'All supplied captures and anomalies are retained. INVALID identifies capture/runtime errors; TIMING MISS independently identifies a startup task or rAF gap ≥2,000 ms, or a post-reveal task/rAF/world gap >1,000 ms. Both labels can apply to one row. PROFILED, EXCEPTION DIAGNOSTIC and AUTOMATED DIAGNOSTIC rows are not quiet player timing. Missing coverage is INCOMPLETE; absence of a recorded miss is not certification.', '',
  'Screenshots run after a page’s timing window but may affect the next page. Transfer describes the preceding page’s actual readback: screenshot, screenshot-error, no-shot, or unknown. Legacy success/error evidence establishes an attempted readback; missing evidence does not establish no-shot. Unknown transfers are never paired across captures. First-page means no preceding page in that browser process. A first world presentation without collected world-frame intervals does not establish a zero world-frame gap.', '',
  'Times use the page’s monotonic navigation clock, limited by monitor.durationMs (or the capture duration), never the runner’s wallMs. Intervals crossing reveal or the capture boundary keep their full duration. Startup rAF includes navigation to the first rAF, exposing freezes before any world draw. Long Tasks API absence cannot establish smooth frames.', '',
  'Version 2/3 first-frame values are the first large canvas presentation and may include the temporary hangar. Version 4+ excludes that canvas. Earlier cache phases overwritten by the final flight phase are recovered from their immutable row IDs. World-frame intervals count completed main-composer draws on the candidate; old source uses its original frame pulse.', '',
  '| Dataset | Server ref | Harness ref / v | Mode / quality | Seconds | Context | Rows / invalid / timing misses |',
  '|---|---|---|---|---:|---|---:|',
  ...datasets.map(d => `| ${link(d.dataset, d.record)} | ${safe(d.serverRef || 'UNRECORDED')}${d.serverRefSource === 'explicit --source-ref' ? ' (supplied)' : ''} | ${safe(d.harnessRef.slice(0, 12))} / ${d.version ?? '—'} | ${safe(d.mode)} / ${safe(d.quality)} | ${d.seconds ?? '—'} | ${d.profiled ? 'profiled' : 'unprofiled'}${d.exceptions ? ', exceptions diagnostic' : ''}, ${d.plain ? 'plain URL' : d.review ? 'review pose' : 'fixed pose'}, ${d.automation ? 'automation' : 'player policy'}, shots ${d.screenshots} | ${d.rows} / ${d.invalid} / ${d.timingMisses} |`),
  '', '| Dataset | Pose / flags | Cache / page / transfer | First world / reveal s | Boot task / rAF ms | Max task / rAF ms | Post-reveal task / rAF / world ms | Median rAF / world ms | Ring settled s / content | Status |',
  '|---|---|---|---:|---:|---:|---:|---:|---:|---|',
  ...rows.map(r => `| ${safe(r.dataset)} | ${safe(r.pose)} / ${safe(r.arm)} | ${safe(r.cache)} / ${r.page} / ${r.transfer} | ${number(r.firstWorldMs, 1000)} / ${number(r.revealedMs, 1000)} | ${number(r.bootTaskMs)} / ${number(r.bootGapMs)} | ${number(r.worstTaskMs)} / ${number(r.worstRafGapMs)} | ${number(r.postRevealTaskMs)} / ${number(r.postRevealRafGapMs)} / ${number(r.postRevealWorldGapMs)} | ${number(r.medianRafMs)} / ${number(r.medianWorldMs)} | ${number(r.ringAfterWarpMs, 1000)} / ${r.ringContent} | ${link(status(r), r.record)} |`),
  '', 'Ring settled time preserves the engine’s ready-or-empty milestone, observed once per second after the fixed-pose warp; it is not automatically successful content arrival. Valid zero/no-data results remain valid. Retry-exhausted builds also become no-data, so new captures retain desired-ring failure/attempt counts at that milestone; legacy empty rows with retries remain unverified when the reason is missing or ambiguous. End-only evidence cannot certify the earlier milestone. The separate simulation clock can exclude clamped long-frame time. Both clocks, reason counts, coarse worker-error counts, boot-100 time, full-world maximum gaps, source refs and detailed status remain in [stall-table.csv](stall-table.csv). [longtasks.csv](longtasks.csv) lists every supplied task over 200 ms with start, end, duration, window membership, reveal overlap and source-row link.', '',
];
if (priorRef) {
  const matches = (actual, requested) => actual === requested || (/^[\da-f]{7,40}$/i.test(actual) && /^[\da-f]{7,40}$/i.test(requested) && actual.startsWith(requested));
  const prior = rows.filter(row => matches(row.serverRef, priorRef)), final = rows.filter(row => matches(row.serverRef, finalRef));
  if (!prior.length || !final.length) throw Error('Comparison refs must match recorded serverRef values; harness gitHead is not server provenance');
  if (prior.some(row => final.includes(row))) throw Error('Prior and final refs must select distinct source rows');
  const keyOf = row => JSON.stringify([row.mode, row.quality, row.pose, row.arm, row.cache, row.page, row.plain, row.review, row.profiled, row.exceptions, row.automation,
    row.transfer === 'unknown' ? `unknown:${row.record}` : row.transfer]);
  const keys = [...new Set([...prior, ...final].map(keyOf))];
  const range = (group, key, scale = 1) => { const values = group.map(row => row[key]).filter(finite); if (!values.length) return '—'; const lo = Math.min(...values), hi = Math.max(...values); return lo === hi ? number(lo, scale) : `${number(lo, scale)}–${number(hi, scale)}`; };
  const tally = group => `${group.length}/${group.filter(row => row.errors).length}/${group.filter(row => row.performanceMisses).length}`;
  md.push(`## Matched references: ${safe(priorRef)} → ${safe(finalRef)}`, '',
    'Each cell is prior → final. Repeated captures appear as ranges; none is selected away. Counts are rows/invalid/timing-miss rows. Contexts are matched by mode, quality, pose, flags, cache, page, URL type, review, profiling, exception diagnostics, automation and preceding-page screenshot outcome. A missing side is unmeasured; comparisons retain invalid rows and do not imply acceptance.', '',
    '| Context | Counts | Boot task / rAF ms | Max rAF ms | Post-reveal task / rAF / world ms | First world s | Median rAF ms | Ring settled s / content | Evidence |',
    '|---|---|---|---:|---|---:|---:|---:|---|');
  for (const key of keys) {
    const a = prior.filter(row => keyOf(row) === key), b = final.filter(row => keyOf(row) === key), r = a[0] ?? b[0];
    const pair = (field, scale = 1) => `${range(a, field, scale)} → ${range(b, field, scale)}`;
    const content = group => [...new Set(group.map(row => row.ringContent))].join('; ') || 'unmeasured';
    const context = `${r.mode}/${r.quality} ${r.pose}/${r.arm} ${r.cache}/p${r.page} ${r.plain ? 'plain' : r.review ? 'review' : 'pose'}${r.profiled ? ' profiled' : ''}${r.exceptions ? ' exceptions' : ''}${r.automation ? ' automated' : ''} transfer:${r.transfer}`;
    comparisons.push({ context, priorRef, finalRef, priorRows: a.length, finalRows: b.length,
      priorInvalid: a.filter(row => row.errors).length, finalInvalid: b.filter(row => row.errors).length,
      priorTimingMisses: a.filter(row => row.performanceMisses).length, finalTimingMisses: b.filter(row => row.performanceMisses).length,
      bootTaskMs: pair('bootTaskMs'), bootGapMs: pair('bootGapMs'), worstRafGapMs: pair('worstRafGapMs'),
      postRevealTaskMs: pair('postRevealTaskMs'), postRevealRafGapMs: pair('postRevealRafGapMs'), postRevealWorldGapMs: pair('postRevealWorldGapMs'),
      firstWorldMs: pair('firstWorldMs'), medianRafMs: pair('medianRafMs'), ringAfterWarpMs: pair('ringAfterWarpMs'),
      priorRingContent: content(a), finalRingContent: content(b),
      priorRecords: a.map(row => row.record).join('; '), finalRecords: b.map(row => row.record).join('; ') });
    md.push(`| ${safe(context)} | ${tally(a)} → ${tally(b)} | ${pair('bootTaskMs')} / ${pair('bootGapMs')} | ${pair('worstRafGapMs')} | ${pair('postRevealTaskMs')} / ${pair('postRevealRafGapMs')} / ${pair('postRevealWorldGapMs')} | ${pair('firstWorldMs', 1000)} | ${pair('medianRafMs')} | ${pair('ringAfterWarpMs', 1000)} / ${content(a)} → ${content(b)} | ${[...a.map((row, i) => link(`prior ${i + 1}`, row.record)), ...b.map((row, i) => link(`final ${i + 1}`, row.record))].join(', ')} |`);
  }
  md.push('');
}
fs.writeFileSync(path.join(out, 'stall-table.csv'), csv(rows));
fs.writeFileSync(path.join(out, 'longtasks.csv'), csv(tasks));
fs.writeFileSync(path.join(out, 'comparison.csv'), csv(comparisons));
fs.writeFileSync(path.join(out, 'stall-table.md'), md.join('\n'));
console.log(`${rows.length} rows, ${tasks.length} long tasks, ${rows.filter(r => r.errors).length} invalid rows and ${rows.filter(r => r.performanceMisses).length} timing-miss rows retained`);

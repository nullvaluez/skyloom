/**
 * SHIP PASS FRAME (FR-7) — classify one long interval (> 100 ms between two
 * presented frames) by the phase that most plausibly spent it.
 *
 * Pure (plain object in, plain object out), so scripts/verify-ship-frame.mjs
 * and scripts/analyze-beta-soak.mjs use the exact rule the app publishes.
 *
 * Input (every field optional):
 *   dtMs         the interval
 *   programMs    blocking first-use time of WebGL programs inside it
 *                (lib/fly/program-census.js)
 *   uploadMs     time inside long tex*Image* / bufferData calls
 *                (lib/fly/render-census.js)
 *   phases       markPhase() tags seen during the frame (lib/fly/frame-stats.js):
 *                'finalize:*', 'heal:*', 'drape:*' are a streaming engine
 *                assembling a worker result on the main thread
 *   heapDropMB   fall of the JS heap across the interval (Chrome
 *                performance.memory; quantized, so only large drops count)
 *   scripts      Long Animation Frame script attributions overlapping it:
 *                [{ invoker, invokerType, sourceURL, duration }]
 *
 * Phases: 'program-link' | 'tile-upload' | 'worker-finalize' | 'gc' |
 * 'react-commit' | 'unattributed'. The verdict is the phase with the largest
 * attributed milliseconds; a phase must explain at least `minShare` of the
 * interval (default 25%) to win, otherwise it is 'unattributed' — the record
 * must never invent a cause. Shares are returned so the soak report can say
 * "program link 70%, upload 20%".
 *
 * Heuristics, stated: a heap drop of at least `gcDropMB` (8 MB) books half the
 * interval to GC (the browser does not expose GC pause time to a page); a
 * finalize tag with no measured cost books what the measured phases leave
 * unexplained, at most 60%.
 */
export const STALL_PHASES = Object.freeze(['program-link', 'tile-upload', 'worker-finalize', 'gc', 'react-commit', 'unattributed']);

const REACT = /react|scheduler|MessagePort|message-channel/i;
const WORKER = /Worker|DedicatedWorker/i;

export function classifyInterval(iv = {}, { minShare = 0.25, gcDropMB = 8 } = {}) {
  const dt = Math.max(1e-6, Number(iv.dtMs) || 0);
  const ms = { 'program-link': 0, 'tile-upload': 0, 'worker-finalize': 0, gc: 0, 'react-commit': 0 };
  ms['program-link'] = Math.max(0, Number(iv.programMs) || 0);
  ms['tile-upload'] = Math.max(0, Number(iv.uploadMs) || 0);
  for (const s of iv.scripts ?? []) {
    const who = `${s.invoker ?? ''} ${s.invokerType ?? ''} ${s.sourceURL ?? ''}`;
    const d = Math.max(0, Number(s.duration) || 0);
    if (WORKER.test(who)) ms['worker-finalize'] += d;
    else if (REACT.test(who)) ms['react-commit'] += d;
  }
  if ((Number(iv.heapDropMB) || 0) >= gcDropMB) ms.gc += dt * 0.5;
  const finalizeTag = (iv.phases ?? []).some((t) => /^(finalize|heal|drape):/.test(String(t)));
  if (finalizeTag) {
    const explained = ms['program-link'] + ms['tile-upload'] + ms.gc + ms['react-commit'];
    ms['worker-finalize'] += Math.max(0, Math.min(dt * 0.6, dt - explained));
  }
  let phase = 'unattributed';
  let best = 0;
  for (const [k, v] of Object.entries(ms)) {
    if (v > best) {
      best = v;
      phase = k;
    }
  }
  if (best < minShare * dt) phase = 'unattributed';
  const shares = Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, Math.round(Math.min(1, v / dt) * 100) / 100]));
  return { phase, shares };
}

/** Tally a list of intervals: { count, byPhase: { phase: n }, worstMs }. */
export function tallyIntervals(intervals = [], opts) {
  const byPhase = Object.fromEntries(STALL_PHASES.map((p) => [p, 0]));
  let worstMs = 0;
  for (const iv of intervals) {
    const { phase } = iv.phase ? iv : classifyInterval(iv, opts);
    byPhase[phase] = (byPhase[phase] ?? 0) + 1;
    if (iv.dtMs > worstMs) worstMs = iv.dtMs;
  }
  return { count: intervals.length, byPhase, worstMs: Math.round(worstMs) };
}

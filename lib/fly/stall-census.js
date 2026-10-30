/**
 * SHIP PASS FRAME (FR-7) — the long-interval recorder.
 *
 * Every interval over 100 ms between two presented frames (FrameStatsRig's
 * dt) is recorded with the evidence lib/fly/stall-classify.mjs needs: the
 * program first-use ms and the long-upload ms that fell inside it (the
 * census rings), the markPhase() tags of that frame, the JS heap change
 * across it, and — joined lazily, because the browser delivers them after
 * the frame — the Long Animation Frame script attributions that overlap it.
 *
 * Published as `window.__flyStats.census.stalls`:
 *   { count, intervals: [...last 64], summary() → { count, byPhase, worstMs,
 *     perMin, recent: [{ dtMs, phase, shares, phases }] } }
 * beta-soak.cjs reads summary() at the end of a run and
 * analyze-beta-soak.mjs tallies it by phase (FLY_SHIP_PASS.md FR-7).
 *
 * Installed with the census (censusWanted()). Per frame it costs one heap
 * read (Chrome) in <CensusRig>; everything else runs only on a >100 ms frame.
 */
import { classifyInterval, tallyIntervals } from './stall-classify.mjs';
import { programMsBetween } from './program-census';
import { uploadMsBetween } from './render-census';

const LONG_MS = 100;
const RING = 64;
const LOAF_RING = 48;

let state = null;
let loaf = [];
let observer = null;
let heapPrev = null;
let heapNow = null;
let memoryOf = () => null;

/** Called once per frame by <CensusRig>, before FrameStatsRig reads dt. */
export function noteFrameHeap() {
  if (!state) return;
  const m = typeof performance !== 'undefined' ? performance.memory : null;
  heapPrev = heapNow;
  heapNow = m && Number.isFinite(m.usedJSHeapSize) ? m.usedJSHeapSize : null;
}

/** `getMemoryState` returns the memory census state (lib/fly/census.js). */
export function installStallCensus(getMemoryState) {
  if (typeof getMemoryState === 'function') memoryOf = getMemoryState;
  if (state || typeof window === 'undefined') return state;
  const startedAt = performance.now();
  state = {
    count: 0,
    intervals: [],
    summary() {
      const rows = state.intervals.map((iv) => {
        const scripts = [];
        for (const f of loaf) {
          if (f.end < iv.from || f.start > iv.to) continue;
          for (const s of f.scripts) scripts.push(s);
        }
        const c = classifyInterval({ ...iv, scripts });
        return { ...iv, ...c };
      });
      const t = tallyIntervals(rows);
      const minutes = Math.max(1 / 60, (performance.now() - startedAt) / 60000);
      return {
        ...t,
        total: state.count,
        perMin: Math.round((state.count / minutes) * 100) / 100,
        recent: rows.slice(-16).map((r) => ({ dtMs: Math.round(r.dtMs), phase: r.phase, shares: r.shares, phases: r.phases })),
      };
    },
  };
  ((window.__flyStats ??= {}).census ??= {}).stalls = state;
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        loaf.push({
          start: e.startTime,
          end: e.startTime + e.duration,
          scripts: (e.scripts ?? []).map((s) => ({ invoker: s.invoker, invokerType: s.invokerType, sourceURL: s.sourceURL, duration: s.duration })),
        });
        if (loaf.length > LOAF_RING) loaf.shift();
      }
    });
    observer.observe({ type: 'long-animation-frame', buffered: true });
  } catch {
    observer = null; // not supported (Safari, Firefox): scripts stay empty
  }
  return state;
}

/**
 * Record one interval [fromMs, toMs] (performance.now). Ignored below 100 ms
 * or when the census is not installed.
 */
export function noteLongInterval(fromMs, toMs, phases) {
  if (!state) return;
  const dtMs = toMs - fromMs;
  if (!(dtMs > LONG_MS)) return;
  state.count++;
  const heapDropMB = heapPrev != null && heapNow != null ? Math.max(0, (heapPrev - heapNow) / 1048576) : 0;
  state.intervals.push({
    from: fromMs,
    to: toMs,
    dtMs,
    programMs: programMsBetween(fromMs, toMs),
    uploadMs: uploadMsBetween(memoryOf(), fromMs, toMs),
    phases: phases ? phases.slice() : [],
    heapDropMB: Math.round(heapDropMB * 10) / 10,
  });
  if (state.intervals.length > RING) state.intervals.shift();
}

/** Test seam. */
export function resetStallCensus() {
  observer?.disconnect?.();
  observer = null;
  state = null;
  loaf = [];
  heapPrev = heapNow = null;
}

/**
 * SHIP PASS FRAME (FR-5, FR-9; PACE_ADAPT) — honest pacing on capped
 * displays, and the frame-rate modes.
 *
 * PF-05: iOS Low Power Mode, Chrome's Energy Saver and some Android battery
 * savers cap requestAnimationFrame at 30 Hz. The R21 governor snapped its
 * refresh estimate to [60, 90, 120, 144], so a 30 Hz page read as a 60 Hz
 * display running at half speed — overload — and walked the ladder to Low for
 * good. Two fixes, both behind PACE_ADAPT:
 *   1. the refresh snap gains 30, 48 and 50 (PACE_ADAPT.refreshSnap), so a
 *      page that BOOTS capped targets 30 and never steps;
 *   2. a CADENCE LOCK detector for a cap that starts mid-session: intervals
 *      sitting on 33.3 ms with low variance while the frame's own work (JS +
 *      submit, measured end-of-frame) stays well under the interval is a
 *      browser cap, not a slow GPU, so the governor's target becomes 30
 *      without stepping. A GPU-bound desktop also quantizes to 33.3 ms under
 *      vsync while its CPU work stays low, and this page cannot read GPU time
 *      on every browser — so the mid-session lock is accepted only where a
 *      cap is the likely story (touch devices, Battery saver on, a boot
 *      estimate that was already 30) unless PACE_ADAPT.lockDesktop.
 * A locked governor still steps when frames fall below the 30 Hz target
 * (the "synthetic overload at 30 Hz still steps" acceptance).
 *
 * Everything here is pure except estimateDisplayHz() (a one-second rAF probe).
 */

/** Nearest entry of `snap` to `hz`. */
export function snapRefresh(hz, snap) {
  let best = snap[0];
  for (const s of snap) if (Math.abs(s - hz) < Math.abs(best - hz)) best = s;
  return best;
}

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/**
 * The cadence-lock detector. step(dtMs, workMs, allowLock) once per frame;
 * returns the locked Hz (30) or null. A window of `windowFrames` intervals
 * decides; a lock releases when the mean interval falls clearly below the
 * 30 Hz period (the cap went away) — never because frames got slower.
 */
export function createCadenceLock(cfg = {}) {
  const c = { lockHz: 30, windowFrames: 90, tolMs: 2.5, maxStdMs: 2.5, workFrac: 0.6, ...cfg };
  const periodMs = 1000 / c.lockHz;
  const dts = [];
  const works = [];
  const st = { locked: null, windows: 0, lastMean: 0, lastStd: 0, lastWork: 0, run: 0, candidate: false };
  st.step = (dtMs, workMs, allowLock = true) => {
    if (!(dtMs > 0) || dtMs > 500) return st.locked; // a stall is not a cadence
    const work = Number.isFinite(workMs) ? workMs : dtMs;
    // A CANDIDATE: consecutive frames that each look capped. While one is
    // forming (and a lock is allowed here) the governor defers a down-step
    // until the window can decide — otherwise the detection lag itself
    // (up to two windows) costs a quality step. Bounded: a candidate that
    // has not become a lock after two windows stops deferring.
    st.run = Math.abs(dtMs - periodMs) <= 2 * c.tolMs && work <= c.workFrac * dtMs ? st.run + 1 : 0;
    st.candidate = allowLock && st.locked == null && st.run >= 10 && st.run <= 2 * c.windowFrames;
    dts.push(dtMs);
    works.push(work);
    if (dts.length < c.windowFrames) return st.locked;
    const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
    const std = Math.sqrt(dts.reduce((a, b) => a + (b - mean) ** 2, 0) / dts.length);
    const workMed = median(works);
    dts.length = 0;
    works.length = 0;
    st.windows++;
    st.lastMean = mean;
    st.lastStd = std;
    st.lastWork = workMed;
    const onCap = Math.abs(mean - periodMs) <= c.tolMs && std <= c.maxStdMs && workMed <= c.workFrac * mean;
    if (st.locked == null && onCap && allowLock) st.locked = c.lockHz;
    else if (st.locked != null && mean < periodMs - 3 * c.tolMs) st.locked = null;
    if (st.locked != null) st.candidate = false;
    return st.locked;
  };
  st.reset = () => {
    dts.length = 0;
    works.length = 0;
    st.locked = null;
    st.run = 0;
    st.candidate = false;
  };
  return st;
}

/**
 * The governor's target fps under PACE_ADAPT, or null for "today's rule".
 *   mode     '60' | 'display' | '30'   (lib/fly/frame-api.js)
 *   refresh  the governor's snapped refresh estimate
 *   locked   the cadence lock (30 | null)
 *   mobile   touch graphics class
 *   heavy    a heavy profile (Ultra): Match display governs to refresh / 2
 */
export function paceTarget({ mode = '60', refresh, locked = null, mobile = false, heavy = false } = {}) {
  if (!(refresh > 0)) return null;
  if (mode === '30') return Math.min(30, refresh);
  if (locked) return Math.min(locked, refresh);
  if (mode === 'display' && !mobile) return heavy && refresh >= 100 ? Math.round(refresh / 2) : refresh;
  return null;
}

/**
 * The presentation cadence FlyCanvas pumps, or null for an unbudgeted
 * frameloop ('always' at the display's rate). `legacy` is today's rule
 * (mobile flight or the seated lounge at 60), returned verbatim when
 * PACE_ADAPT is off.
 */
export function presentationFps({ paceOn = false, mode = '60', always = true, mobile = false, observing = false, displayHz = null, heavy = false } = {}) {
  const legacy = always && (mobile || observing) ? 60 : null;
  if (!paceOn || !always) return legacy;
  if (mode === '30') return 30;
  if (mobile || observing) return 60;
  if (!(displayHz > 0)) return null;
  if (mode === 'display') return heavy && displayHz >= 100 ? Math.round(displayHz / 2) : null;
  // '60' (D12's default): cap a high-refresh desktop at 60; a 60 Hz (or
  // capped) display keeps the unbudgeted frameloop it always had.
  return displayHz > 65 ? 60 : null;
}

/**
 * Probe the display's rAF rate for ~`ms` (default 1 s): median interval,
 * snapped. Resolves null without rAF (SSR, node) or on a hidden page.
 */
export function estimateDisplayHz(snap, ms = 1000) {
  if (typeof requestAnimationFrame !== 'function' || typeof document === 'undefined' || document.hidden) return Promise.resolve(null);
  return new Promise((resolve) => {
    const dts = [];
    let last = 0;
    const t0 = performance.now();
    const tick = (now) => {
      if (last) dts.push(now - last);
      last = now;
      if (now - t0 < ms || dts.length < 20) {
        if (document.hidden) return resolve(null);
        requestAnimationFrame(tick);
        return;
      }
      const m = median(dts);
      resolve(m > 0 ? snapRefresh(1000 / m, snap) : null);
    };
    requestAnimationFrame(tick);
  });
}

// --- the frame's own work (JS + GL submit), for the lock detector ----------
// The governor stamps the start at priority -100; <PaceClock> stamps the end
// after the composer has rendered (priority 1000). Their difference is the
// CPU side of the frame; a frame whose interval is 33 ms but whose work is
// 6 ms is waiting on a cap, not computing.
let frameStartAt = 0;
let workMs = undefined;
export function markFrameStart(now = performance.now()) {
  frameStartAt = now;
}
export function markFrameEnd(now = performance.now()) {
  if (frameStartAt > 0) workMs = now - frameStartAt;
}
export function lastWorkMs() {
  return workMs;
}

/** Vsync-driven presentation deadline. Carry fractional time across frames,
 * rather than resetting the clock on each draw and falling below the target.
 * A long gap schedules one frame, never a burst of catch-up renders. */
export function createFrameCadence(fps = 60) {
  const interval = 1000 / fps;
  let next = null;
  return {
    reset() { next = null; },
    due(now) {
      if (!Number.isFinite(now)) return false;
      if (next === null) { next = now + interval; return true; }
      if (now + .75 < next) return false;
      next += Math.max(1, Math.floor((now + .75 - next) / interval) + 1) * interval;
      return true;
    },
  };
}

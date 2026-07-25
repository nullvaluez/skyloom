/**
 * Round 17 "Your Wings" — ACTIVE contract progress across sessions.
 *
 * Through R16 the lifetime score persisted (`fly-contracts`) but the three
 * active contracts did not: every reload handed you the same starting trio at
 * 0/3 and threw away whatever you were halfway through. A "log 3 spots"
 * objective you can never carry across a refresh is not progression.
 *
 * SIBLING KEY, NOT AN EXTENSION. `fly-contracts` is a HARNESS CONTRACT —
 * scripts/verify-contracts.js regex-matches the persisted zustand envelope
 * (`"totalScore":N`) — so this state lives in its own key with its own shape
 * and the score envelope stays byte-identical.
 *
 * Everything here is defensive by design: a corrupt or hand-edited snapshot
 * must degrade to "fresh session", never to a crash on boot. Storage can also
 * be blocked outright (private mode, quota) — in that case the game simply
 * behaves like R16, which is a working game.
 *
 * SHAPE (v1)
 *   {
 *     v: 1,
 *     poolIdx: number,                       // rotation cursor
 *     active: [{ id, progress, hits: [] }],  // done entries are NEVER written
 *     daily:  { dayKey: 'YYYY-MM-DD',
 *               entries: [{ id, progress, done, hits: [] }] } | null
 *   }
 *
 * Note the asymmetry: a COMPLETED active contract is dropped (it has already
 * paid out and will rotate away), while a completed DAILY is kept so it stays
 * on screen, stamped, until UTC rollover.
 */

export const ACTIVE_PROGRESS_KEY = 'fly-contracts-active-v1';
const VERSION = 1;

/** Read the snapshot, or null for "no usable snapshot" (any reason at all). */
export function loadSnapshot() {
  if (typeof window === 'undefined') return null;
  let raw = null;
  try {
    raw = window.localStorage.getItem(ACTIVE_PROGRESS_KEY);
  } catch {
    return null; // storage blocked — start fresh, silently
  }
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || obj.v !== VERSION) return null;
    return obj;
  } catch {
    return null; // corrupt JSON — start fresh rather than throw during render
  }
}

/** Write the snapshot (version stamped here so callers can't forget). */
export function saveSnapshot(snap) {
  if (typeof window === 'undefined' || !snap) return;
  try {
    window.localStorage.setItem(
      ACTIVE_PROGRESS_KEY,
      JSON.stringify({ ...snap, v: VERSION })
    );
  } catch {
    // full/blocked — progress persistence is a nicety, not a requirement
  }
}

/** Live entry → plain JSON (Set → Array is the only real transformation). */
export function serializeEntry(entry) {
  return {
    id: entry.tpl.id,
    progress: entry.progress,
    done: !!entry.done,
    hits: [...entry.hits],
  };
}

/** Array → Set, tolerating anything that isn't an array. */
export function reviveHits(arr) {
  return new Set(Array.isArray(arr) ? arr : []);
}

/**
 * Rebuild one live entry from a persisted row against the CURRENT template
 * table. Returns null when the row can't be trusted:
 *   · the template id no longer exists (a future round removed it), or
 *   · `dropDone` is set and the row is already complete.
 * Progress is clamped into [0, target] — a template whose target SHRANK
 * between releases must not render "5/3".
 */
export function reviveEntry(row, tplById, { dropDone = false } = {}) {
  const tpl = tplById.get(row?.id);
  if (!tpl) return null;
  const raw = Number(row.progress);
  const progress = Math.max(0, Math.min(tpl.target, Number.isFinite(raw) ? raw : 0));
  const done = progress >= tpl.target;
  if (dropDone && done) return null;
  return { tpl, progress, done, hits: reviveHits(row.hits), stale: 0 };
}

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Persisted contract score (round 6, Phase F). Only the LIFETIME tallies
 * persist — the active contract set and session streak are session-scoped
 * (they live in the Contracts HUD component). Fly-specific on purpose:
 * kept out of the shared 2D stores.
 *
 * Round 17: `addCompletion` also publishes a TRANSIENT `lastCompleted`, which
 * SpotToast subscribes to for the completion toast (a contract finishing was
 * previously announced by nothing but a two-second strikethrough). Transient
 * means transient — `partialize` pins the persisted envelope to exactly the
 * two lifetime numbers it has always held, so `fly-contracts` in localStorage
 * stays byte-identical (verify-contracts regex-matches `"totalScore":N` in it)
 * and a reload can never replay a stale toast.
 */
export const useFlyContractsStore = create(
  persist(
    (set) => ({
      totalScore: 0,
      completedCount: 0,
      // { id, label, pts, at } — session-only; `at` is what makes two
      // completions of the same contract distinct events to a subscriber.
      lastCompleted: null,

      addCompletion: (pts, meta) =>
        set((state) => ({
          totalScore: state.totalScore + pts,
          completedCount: state.completedCount + 1,
          lastCompleted: {
            id: meta?.id ?? null,
            label: meta?.label ?? null,
            pts,
            daily: !!meta?.daily,
            // MONOTONIC, not merely "now": an active contract and a daily
            // drawing the same template complete on the SAME event, and two
            // Date.now() reads a few microseconds apart are equal. A
            // subscriber that compares `at` strictly would silently drop the
            // second completion's toast.
            at: Math.max(Date.now(), (state.lastCompleted?.at ?? 0) + 1),
          },
        })),
    }),
    {
      name: 'fly-contracts',
      partialize: (state) => ({
        totalScore: state.totalScore,
        completedCount: state.completedCount,
      }),
    }
  )
);

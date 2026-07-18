import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Persisted contract score (round 6, Phase F). Only the LIFETIME tallies
 * persist — the active contract set and session streak are session-scoped
 * (they live in the Contracts HUD component). Fly-specific on purpose:
 * kept out of the shared 2D stores.
 */
export const useFlyContractsStore = create(
  persist(
    (set) => ({
      totalScore: 0,
      completedCount: 0,

      addCompletion: (pts) =>
        set((state) => ({
          totalScore: state.totalScore + pts,
          completedCount: state.completedCount + 1,
        })),
    }),
    { name: 'fly-contracts' }
  )
);

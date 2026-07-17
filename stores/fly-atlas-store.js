import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX_RECENTS = 8;

/**
 * Persisted Atlas travel log (FLY_ATLAS_REWORK §4.1/§4.4b): recents,
 * favorites and per-destination visit counts. Fly-specific on purpose —
 * kept OUT of the shared 2D stores and out of fly-store (which resets on
 * every Fly-mode unmount). Keys are the atlas entry keys (`kind:name`).
 */
export const useFlyAtlasStore = create(
  persist(
    (set, get) => ({
      // [{ key, name, kind, at }] newest first
      recents: [],
      // [key]
      favorites: [],
      // key -> visit count
      visits: {},

      logVisit: (key, name, kind) =>
        set((state) => ({
          visits: { ...state.visits, [key]: (state.visits[key] ?? 0) + 1 },
          recents: [
            { key, name, kind, at: Date.now() },
            ...state.recents.filter((r) => r.key !== key),
          ].slice(0, MAX_RECENTS),
        })),

      toggleFavorite: (key) =>
        set((state) => ({
          favorites: state.favorites.includes(key)
            ? state.favorites.filter((k) => k !== key)
            : [...state.favorites, key],
        })),

      isFavorite: (key) => get().favorites.includes(key),
    }),
    { name: 'fly-atlas' }
  )
);

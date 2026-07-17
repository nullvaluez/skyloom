import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

const initialState = {
  // Lifecycle: 'boot' | 'loading-terrain' | 'flying' | 'paused'
  phase: 'boot',

  // Spawn point { lat, lon } resolved by FlyMode on mount
  spawn: null,

  // 'slow' | 'cruise' | 'boost'
  speedPreset: 'cruise',

  // 'high' | 'medium' | 'low' — drives DPR / bloom / cloud degradation
  qualityTier: 'high',

  // Targeting
  lockedHex: null,
  // 'none' | 'soft' | 'intercepting' | 'formation'
  lockState: 'none',
  infoCardHex: null,
  // Aircraft being inspected in the click-modal (input is neutralized while set)
  inspectHex: null,

  // Procedural audio on/off (WebAudio, no assets)
  soundOn: true,

  // Terrain imagery style: 'toy' (CARTO Voyager arcade diorama, default) |
  // 'satellite' (Esri) | 'night' (CARTO dark)
  mapStyle: 'toy',

  // Bumped on every warp — drives the DOM flash + lets overlays reset
  warpEpoch: 0,

  // Overlays
  creditsOpen: false,
  controlsHelpSeen: false,
  // The Atlas fast-travel screen (input is neutralized while open)
  atlasOpen: false,
  // Last atlas-warp arrival { name, kind, at } — drives the arrival banner
  arrival: null,

  // Telemetry (discrete, low-frequency — never per-frame)
  trafficCount: 0,
  lastPollAt: null,
  tileStats: { requested: 0, evicted: 0 },

  // Floating-origin rebase counter — bumped every ~10km for components with
  // rebased-frame history to reset via a React key. Currently unconsumed
  // (the contrail keeps absolute-frame points now) but kept: it's the
  // designed hook for any future world-frame-history component.
  rebaseEpoch: 0,
};

/**
 * Discrete Fly-mode state only. Per-frame data (positions, velocities,
 * camera) lives in the flyRuntime object shared via React context —
 * never in this store. Uses subscribeWithSelector so engine code can
 * make transient (non-render) subscriptions into refs.
 */
export const useFlyStore = create(
  subscribeWithSelector((set) => ({
    ...initialState,

    setPhase: (phase) => set({ phase }),

    setSpawn: (spawn) => set({ spawn }),

    setSpeedPreset: (speedPreset) => set({ speedPreset }),

    setQualityTier: (qualityTier) => set({ qualityTier }),

    setLock: (lockedHex, lockState) => set({ lockedHex, lockState }),

    clearLock: () => set({ lockedHex: null, lockState: 'none' }),

    setInfoCardHex: (infoCardHex) => set({ infoCardHex }),

    setInspectHex: (inspectHex) => set({ inspectHex }),

    toggleSound: () => set((state) => ({ soundOn: !state.soundOn })),

    setMapStyle: (mapStyle) => set({ mapStyle }),

    bumpWarpEpoch: () => set((state) => ({ warpEpoch: state.warpEpoch + 1 })),

    openCredits: () => set({ creditsOpen: true }),

    closeCredits: () => set({ creditsOpen: false }),

    setAtlasOpen: (atlasOpen) => set({ atlasOpen }),

    setArrival: (arrival) => set({ arrival }),

    markControlsHelpSeen: () => set({ controlsHelpSeen: true }),

    setTrafficStats: (trafficCount, lastPollAt) =>
      set({ trafficCount, lastPollAt }),

    bumpRebaseEpoch: () =>
      set((state) => ({ rebaseEpoch: state.rebaseEpoch + 1 })),

    addTileStats: (requested = 0, evicted = 0) =>
      set((state) => ({
        tileStats: {
          requested: state.tileStats.requested + requested,
          evicted: state.tileStats.evicted + evicted,
        },
      })),

    reset: () => set({ ...initialState }),
  }))
);

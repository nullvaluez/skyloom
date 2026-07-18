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

  // Round 8.5 (§B): true while FlyScene's action handles (warpTo/warpToGeo/
  // interceptHex) are registered on the runtime bus — overlays gate their
  // buttons on this instead of probing possibly-orphaned runtime captures.
  runtimeReady: false,

  // Procedural audio on/off (WebAudio, no assets)
  soundOn: true,

  // Terrain imagery style: 'toy' ("Neon" — OpenFreeMap vector world over a
  // solid ink tile) | 'satellite' ("Day", Esri). Round 7 retired 'night' (flat
  // CARTO raster) — setMapStyle migrates stale callers. This LITERAL is the
  // pre-hydration mount value only; the effective DEFAULT for a player with no
  // saved choice is 'satellite', resolved by lib/fly/map-style.js in FlyMode
  // BEFORE the canvas mounts (round 11 — no boot hot-swap). Kept 'toy' so
  // harnesses (which seed 'toy') mount without a style hot-swap.
  mapStyle: 'toy',

  // Bumped on every warp — drives the DOM flash + lets overlays reset
  warpEpoch: 0,
  // 'local' (target warp / short hop) or 'far' (cross-region atlas warp) —
  // far warps get the held streak→hold→reveal arrival treatment (round 6)
  warpKind: 'local',
  // 'chase' | 'cinema' — cinema is the wing view while intercept/formation
  // is flying (C toggles; FlyScene auto-reverts on lock loss)
  cameraMode: 'chase',

  // Overlays
  creditsOpen: false,
  controlsHelpSeen: false,
  // The Atlas fast-travel screen (input is neutralized while open)
  atlasOpen: false,
  // Last atlas-warp arrival { name, kind, at } — drives the arrival banner
  arrival: null,

  // Round 7: last airport-buzz event { airport, kind: 'buzz'|'touch-go',
  // pts, at } — drives the SpotToast arcade flavor (discrete, 1Hz source)
  buzz: null,

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

    setRuntimeReady: (runtimeReady) => set({ runtimeReady }),

    toggleSound: () => set((state) => ({ soundOn: !state.soundOn })),

    // Round 7: 'night' retired — stale callers (old harnesses, saved links)
    // deterministically land on Neon instead of exercising ?? fallbacks.
    setMapStyle: (mapStyle) => set({ mapStyle: mapStyle === 'night' ? 'toy' : mapStyle }),

    bumpWarpEpoch: (warpKind = 'local') =>
      set((state) => ({ warpEpoch: state.warpEpoch + 1, warpKind })),

    openCredits: () => set({ creditsOpen: true }),

    closeCredits: () => set({ creditsOpen: false }),

    setAtlasOpen: (atlasOpen) => set({ atlasOpen }),

    setArrival: (arrival) => set({ arrival }),

    setBuzz: (buzz) => set({ buzz }),

    setCameraMode: (cameraMode) => set({ cameraMode }),

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

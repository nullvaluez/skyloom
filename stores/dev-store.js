import { create } from 'zustand';

export const useDevStore = create((set) => ({
  metrics: {
    aircraftCount: 0,
    filteredCount: 0,
    filterTimeMs: 0,
    renderTimeMs: 0,
    lastPollMs: 0,
    pollLatencyMs: 0,
  },
  showHUD: process.env.NODE_ENV === 'development',

  setMetric: (key, value) => {
    set((state) => ({
      metrics: {
        ...state.metrics,
        [key]: value,
      },
    }));
  },

  setMetrics: (newMetrics) => {
    set((state) => ({
      metrics: {
        ...state.metrics,
        ...newMetrics,
      },
    }));
  },

  toggleHUD: () => {
    set((state) => ({ showHUD: !state.showHUD }));
  },
}));

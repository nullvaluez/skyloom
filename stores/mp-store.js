'use client';

import { create } from 'zustand';
import { MP_ACTIVE } from '@/lib/fly/mp/mp-flag';

/**
 * MULTIPLAYER UI state (MULTIPLAYER.md). Low-rate only (status, counts, the
 * player's own callsign); per-frame pilot data lives on runtime.traffic.
 * Deliberately NOT persisted: no storage key, nothing saved — the "Fly with
 * others" choice resets on every page load.
 */
const INITIAL = {
  status: 'off', // off | connecting | online | offline | full | outdated | replaced
  online: 0,
  nearby: 0,
  callsign: null,
  color: null,
  disclosedAt: 0,
  clusters: [],
  signalCooldownUntil: 0,
};

export const useMpStore = create((set) => ({
  enabled: MP_ACTIVE.defaultOn !== false,
  ...INITIAL,
  setEnabled: (enabled) => set({ enabled: !!enabled }),
  patch: (p) => set(p),
  resetSession: () => set(INITIAL),
}));

import { F35_COCKPIT } from './fly-constants.js';
import { pinned } from './fly-pins.js';

export const F35_VIEW_KEY = 'fly-f35-view';

// The rollout flag chooses the initial seat. Players can opt in from an
// ordinary flight. An explicit negative review pin disables the seat entirely.
export function initialPilotSeat() {
  const config = pinned(F35_COCKPIT, '__flyF35CockpitOverride');
  if (typeof globalThis.window?.__flyF35CockpitOverride?.enabled === 'boolean') return config.enabled;
  try {
    const view = globalThis.window?.localStorage?.getItem(F35_VIEW_KEY);
    if (view === 'cockpit' || view === 'outside') return view === 'cockpit';
  } catch { /* Private browsing can disable storage. */ }
  return config.enabled;
}

export function hasPilotSeat(state) {
  return state.aircraftId === 'f35' && globalThis.window?.__flyF35CockpitOverride?.enabled !== false;
}

export function pilotSeatSelected(state) {
  return hasPilotSeat(state) && state.f35PilotSeat && state.cameraMode === 'chase';
}

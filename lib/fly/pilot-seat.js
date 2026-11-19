import { F35_COCKPIT, FLEET_COCKPITS } from './fly-constants.js';
import { pinned } from './fly-pins.js';

export const F35_VIEW_KEY = 'fly-f35-view';

// Cockpit centres in the drawn aircraft's metre frame, +Y up, nose -Z.
// Side-by-side aircraft are flown from the left seat. Stations follow the
// glazing in the corresponding exterior builders, including the cargo hump.
export const PILOT_EYES = {
  fighter: [0, 1.04, -3.7], military: [0, .91, -3.74],
  'warbird-jet': [0, .63, -2.64], 'warbird-prop': [0, .62, -1],
  prop: [-.22, .52, -1.55], glider: [0, .28, -1.76],
  'flying-wing': [-.52, 1.08, -4.74], bizjet: [-.42, .58, -8.36],
  airliner: [-.65, 1.68, -23.9], cargo: [-.7, 3.4, -29.2],
  f35: [0, 1.08, -4.08], c17: [-.73, 2.56, -22.1], concorde: [-.50, .99, -21.5],
};

export const pilotSeatOverride = id => id === 'f35'
  ? globalThis.window?.__flyF35CockpitOverride?.enabled
  : globalThis.window?.__flyFleetCockpitsOverride?.enabled;
const config = id => id === 'f35'
  ? pinned(F35_COCKPIT, '__flyF35CockpitOverride')
  : pinned(FLEET_COCKPITS, '__flyFleetCockpitsOverride');

export function initialPilotSeat(id = 'f35') {
  const forced = pilotSeatOverride(id);
  if (typeof forced === 'boolean') return config(id).enabled;
  try {
    const view = globalThis.window?.localStorage?.getItem(F35_VIEW_KEY);
    if (view === 'cockpit' || view === 'outside') return view === 'cockpit';
  } catch { /* Private browsing can disable storage. */ }
  return config(id).enabled;
}

export function hasPilotSeat(state) {
  const id = state.aircraftId;
  return Object.hasOwn(PILOT_EYES, id) && (pilotSeatOverride(id) ?? (id === 'f35' || FLEET_COCKPITS.enabled));
}

export function pilotSeatSelected(state) {
  return hasPilotSeat(state) && state.f35PilotSeat && state.cameraMode === 'chase';
}

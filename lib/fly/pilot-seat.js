import { F35_COCKPIT } from './fly-constants.js';
import { pinned } from './fly-pins.js';

const cockpit = pinned(F35_COCKPIT, '__flyF35CockpitOverride');

export function hasPilotSeat(state) {
  return cockpit.enabled === true && state.aircraftId === 'f35';
}

export function pilotSeatSelected(state) {
  return hasPilotSeat(state) && state.f35PilotSeat && state.cameraMode === 'chase';
}

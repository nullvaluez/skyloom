import { FLIGHT_CLARITY, FLIGHT_RELIEF } from './fly-constants.js';
import { pinned } from './fly-pins.js';

export const FLIGHT_CLARITY_ON = pinned(FLIGHT_CLARITY, '__flyFlightClarityOverride').enabled === true;
export const FLIGHT_RELIEF_ON = pinned(FLIGHT_RELIEF, '__flyFlightReliefOverride').enabled === true;

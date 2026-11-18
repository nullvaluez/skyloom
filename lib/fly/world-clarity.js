import { FLIGHT_CLARITY } from './fly-constants';
import { pinned } from './fly-pins';

export const FLIGHT_CLARITY_ON = pinned(FLIGHT_CLARITY, '__flyFlightClarityOverride').enabled === true;

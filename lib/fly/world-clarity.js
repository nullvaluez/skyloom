import { CITY_CONTINUITY, FLIGHT_CLARITY, FLIGHT_RELIEF, SCENERY_COLOR } from './fly-constants.js';
import { pinned } from './fly-pins.js';

export const FLIGHT_CLARITY_ON = pinned(FLIGHT_CLARITY, '__flyFlightClarityOverride').enabled === true;
export const FLIGHT_RELIEF_ON = pinned(FLIGHT_RELIEF, '__flyFlightReliefOverride').enabled === true;
export const CITY_CONTINUITY_ON = pinned(CITY_CONTINUITY, '__flyCityContinuityOverride').enabled === true;
export const SCENERY_COLOR_ON = pinned(SCENERY_COLOR, '__flySceneryColorOverride').enabled === true;

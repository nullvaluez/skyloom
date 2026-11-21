import { BUILDING_APPROACH, CANOPY_VIEW_LOD, CITY_CONTINUITY, FLIGHT_CLARITY, FLIGHT_RELIEF, ROAD_LIGHT_FILTER, SCENERY_COLOR } from './fly-constants.js';
import { pinned } from './fly-pins.js';

export const FLIGHT_CLARITY_ON = pinned(FLIGHT_CLARITY, '__flyFlightClarityOverride').enabled === true;
export const FLIGHT_RELIEF_ON = pinned(FLIGHT_RELIEF, '__flyFlightReliefOverride').enabled === true;
export const CITY_CONTINUITY_ON = pinned(CITY_CONTINUITY, '__flyCityContinuityOverride').enabled === true;
export const BUILDING_APPROACH_ON = pinned(BUILDING_APPROACH, '__flyBuildingApproachOverride').enabled === true;
// Both previews use continuous footprint LOD. CITY_CONTINUITY separately
// controls the terrain height survey and its atlas.
export const CITY_GEOMETRY_LOD_ON = CITY_CONTINUITY_ON || BUILDING_APPROACH_ON;
export const SCENERY_COLOR_ON = pinned(SCENERY_COLOR, '__flySceneryColorOverride').enabled === true;
export const CANOPY_VIEW_LOD_ON = pinned(CANOPY_VIEW_LOD, '__flyCanopyViewLodOverride').enabled === true;
export const ROAD_LIGHT_FILTER_ON = pinned(ROAD_LIGHT_FILTER, '__flyRoadLightFilterOverride').enabled === true;

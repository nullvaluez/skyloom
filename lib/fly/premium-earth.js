import { MATERIAL_SCANS, SCENERY_FORMS, SHOWCASE_EARTH } from './fly-constants';
import { pinned } from './fly-pins';
import { cinemaOn } from './cinema-policy';

export const materialScansOn = () => cinemaOn() && pinned(MATERIAL_SCANS, '__flyMaterialScansOverride').enabled;
export const sceneryFormsOn = () => cinemaOn() && pinned(SCENERY_FORMS, '__flySceneryFormsOverride').enabled;
export const showcaseEarthOn = () => cinemaOn() && pinned(SHOWCASE_EARTH, '__flyShowcaseEarthOverride').enabled;

// Explicit worker message fields; workers must never import the store/pins.
export function premiumWorldRequest(){
 return {sceneryForms:sceneryFormsOn()===true,showcaseEarth:showcaseEarthOn()===true};
}

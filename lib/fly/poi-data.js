/**
 * Re-export shim: the POI database moved to lib/fly/poi/ when the Atlas
 * round expanded it (cities/landmarks/military/hotspots + atlas entries).
 * Kept so existing imports (PoiLetters, harnesses) stay untouched.
 */
export { buildPoiList, buildAtlasList } from './poi';

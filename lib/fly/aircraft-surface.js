/** New GLBs carry authored PBR finishes. Legacy assets keep their existing
 * rendering path. Shared by the flight grade and livery application. */
export function authoredAircraftSurface(material) {
  return material?.userData?.aircraftSurface === 2;
}

export function aircraftSurfaceParameters(source, isCanopy = false) {
  if (!authoredAircraftSurface(source)) return {};
  const exposed = source.metalness > .6;
  return {
    roughness: source.roughness,
    metalness: source.metalness,
    clearcoat: isCanopy ? .7 : exposed ? .04 : .07,
    clearcoatRoughness: isCanopy ? .15 : .5,
    envMapIntensity: isCanopy ? 1.05 : exposed ? .75 : .7,
  };
}

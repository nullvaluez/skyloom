import { MeshStandardMaterial } from 'three';
import { GLOBE, LANDMARKS_3D, NAV_LIGHTS } from './fly-constants';
import { applyBendAirAnchor, applyBendAnchor, applyNavLights } from './toy-world/world-bend';
import { applyDaylightSurface } from './daylight-depth';

// Shared constructors keep the measured warm inventory identical to live draws.
export function createEarthSceneryMaterial() {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: .97, metalness: 0, envMapIntensity: .3 });
  applyBendAnchor(material); applyDaylightSurface(material, 'clutter');
  return material;
}

export function createCinematicLandmarkMaterial() {
  const material = new MeshStandardMaterial({ vertexColors: true, color: LANDMARKS_3D.satStyle.color, roughness: .82, metalness: .05, envMapIntensity: .6 });
  applyBendAnchor(material);
  return material;
}

export function createTrafficNavMaterial(painted) {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: .35, metalness: .5, flatShading: true, vertexColors: painted });
  applyBendAirAnchor(material, GLOBE.trafficBend);
  applyNavLights(material, NAV_LIGHTS);
  return material;
}

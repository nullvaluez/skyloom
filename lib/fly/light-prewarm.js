/**
 * SHIP PASS LIGHT — the program variants this stream adds, as warm-scene
 * builders for lib/fly/prewarm-registry.js (FLY_SHIP_PASS.md 3.2 "Prewarm";
 * registered from the registry's LIGHT block). Each build() returns fresh
 * objects whose materials carry the live variant's exact program key; the
 * consumer (FRAME) compiles and disposes them. Nothing here touches the live
 * scene.
 *
 * AIRFRAME_SHADOW, SHADOW_REACH, PHOTO_HIRES and HANGAR_EXPOSURE add no
 * program (uniforms, render-target sizes and light intensities only).
 */
import { BufferAttribute, BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, Mesh, PlaneGeometry } from 'three';
import { buildR25TerrainTwin } from './r25-ground';
import { createTerrainShadowDepthMaterial } from './terrain-shadow';
import { createBlobMaterial } from './traffic-shadows';
import { FLEET_FAMILIES } from './fleet-types';
import { buildLiveAirframe } from './live-aircraft-geometry';
import { createFleetDepthMaterial, createFleetMaterial, createFleetShared } from './fleet-material';

const tri = () => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  return g;
};

/** The live terrain tile chain (TERRAIN_SHADOW's patched earth surface when on). */
export function buildShadowedTerrain() {
  const m = new Mesh(tri(), buildR25TerrainTwin());
  m.receiveShadow = true;
  return m;
}

/** The terrain shadow map's depth program (world-bend bent, packed depth). */
export function buildTerrainShadowDepth() {
  return new Mesh(tri(), createTerrainShadowDepthMaterial());
}

/**
 * A live-fleet caster: the family material on an instanced mesh shaped like
 * detailed-traffic's (aFleetA/aFleetB, instanceColor from birth), with the
 * fleet depth material the cascades draw it with.
 */
export function buildTrafficCaster() {
  const f = FLEET_FAMILIES[0];
  const built = buildLiveAirframe(f, 'mid');
  const material = createFleetMaterial(f, built.parts, createFleetShared(null));
  const g = built.hull;
  g.setAttribute('aFleetA', new InstancedBufferAttribute(new Float32Array(4), 4));
  g.setAttribute('aFleetB', new InstancedBufferAttribute(new Float32Array(4), 4));
  const mesh = new InstancedMesh(g, material, 1);
  mesh.setColorAt(0, new Color(1, 1, 1));
  mesh.castShadow = true;
  mesh.customDepthMaterial = createFleetDepthMaterial(material);
  // The depth program on its own mesh too, so a consumer that compiles only
  // `material` still meets it.
  const depthOnly = new InstancedMesh(g, mesh.customDepthMaterial, 1);
  depthOnly.setColorAt(0, new Color(1, 1, 1));
  return [mesh, depthOnly];
}

/** The contact blob (TRAFFIC_SHADOWS' Medium and touch path). */
export function buildTrafficBlob() {
  const g = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  g.setAttribute('aBlob', new InstancedBufferAttribute(new Float32Array(1), 1));
  return new InstancedMesh(g, createBlobMaterial(), 1);
}

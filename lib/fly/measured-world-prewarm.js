import { BatchedMesh, BufferAttribute, BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, Mesh, Scene } from 'three';
import { createSatelliteArchitectureMaterial } from './satellite-architecture-material';
import { createCinematicTreeMaterial, createCinematicHomeMaterial } from './cinematic-ground';
import { createCinematicModelMaterial } from './cinematic-models';
import { createLivingForestMaterial } from './living-forest';
import { createEarthSceneryMaterial, createCinematicLandmarkMaterial, createTrafficNavMaterial } from './world-material-factories';
import { createAirfieldUniforms, createGrassMaterial, createPaintMaterial, createPavementMaterial, createRunwayMaterial, patchAirfieldMaterial } from './airfield/airfield-materials';
import { createSetUniforms, createSetMaterial, createDecalMaterial } from './airport-set/materials';
import { createFleetMaterial, createFleetShared } from './fleet-material';
import { FLEET_FAMILIES } from './fleet-types';
import { PART_SLOTS } from './live-aircraft-geometry';
import { AIRFIELD } from './observation-config';
import { applyBendAnchor, applyBendAnchorMonument } from './toy-world/world-bend';
import { satelliteVisualsOn } from './satellite-visuals';
import { compileCinemaProfiles } from './cinema-profile-prewarm';
import { createTerrainProgramRetention } from './terrain-program-retention.mjs';

/** The 19 color variants observed in profile-warm-v1-correct-port. No depth,
 * effects or unidentified programs are added to this measured inventory. */
export const MEASURED_WORLD_VARIANTS = Object.freeze([
  'architecture-near', 'architecture-far', 'airfield-grass', 'airfield-pavement',
  'airfield-runway', 'airfield-paint', 'fleet', 'airport-set-batched',
  'airport-set-solid', 'airport-set-decal', 'forest', 'earth-scenery',
  'monument-merged', 'landmark', 'traffic-painted', 'traffic-unpainted',
  'traffic-painted-tinted', 'homes', 'canopy',
]);

function triangle(attributes) {
  const geometry = new BufferGeometry();
  // Attribute layouts, not production airport/airframe geometry, define keys.
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  for (const [name, size] of Object.entries(attributes)) {
    geometry.setAttribute(name, new BufferAttribute(new Float32Array(3 * size), size));
  }
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

export function createMeasuredWorldWarmScene() {
  const scene = new Scene(), geometries = new Set(), materials = new Set(), ownedTextures = new Set(), batches = [];
  let disposed = false;
  const add = (name, material, attributes, { instanced = false, tinted = false, batched = false, cast = false, receive = true } = {}) => {
    const geometry = triangle(attributes); geometries.add(geometry); materials.add(material);
    let mesh;
    if (batched) {
      mesh = new BatchedMesh(1, 3, 3, material);
      mesh.addInstance(mesh.addGeometry(geometry)); batches.push(mesh);
    } else mesh = instanced ? new InstancedMesh(geometry, material, 1) : new Mesh(geometry, material);
    if (tinted) mesh.setColorAt(0, new Color(1, 1, 1));
    mesh.name = name; mesh.castShadow = cast; mesh.receiveShadow = receive;
    scene.add(mesh); return mesh;
  };
  const dispose = () => {
    if (disposed) return; disposed = true;
    for (const mesh of batches) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    // Canopy owns a reference-counted shared alpha atlas via material.dispose.
    // Fleet palette is session-owned; only the newly built home atlas is ours.
    for (const material of materials) material.dispose();
    for (const texture of ownedTextures) texture.dispose();
    scene.clear();
  };
  try {
    for (const distant of [false, true]) {
      add(distant ? 'architecture-far' : 'architecture-near', createSatelliteArchitectureMaterial({ distant, lighting: satelliteVisualsOn('lighting') }),
        { normal: 3, color: 3, uv: 2, aBendAnchor: 2, aBuildingStyle: 3 }, { cast: !distant, receive: !distant });
    }
    const airfield = createAirfieldUniforms();
    for (const [layer, factory, attribute, size] of [
      ['grass', createGrassMaterial, 'aGrass', 2], ['pavement', createPavementMaterial, 'aSurf', 3],
      ['runway', createRunwayMaterial, 'aRwy', 3], ['paint', createPaintMaterial, 'aPaint', 4],
    ]) add(`airfield-${layer}`, patchAirfieldMaterial(factory(airfield, AIRFIELD.ground.lift[layer]), layer), { normal: 3, [attribute]: size });
    const parts = Object.fromEntries(['A', 'B', 'C'].map(key => [key, new Float32Array(PART_SLOTS * 4)]));
    const fleet = add('fleet', createFleetMaterial(FLEET_FAMILIES.find(family => family.id === 'md11'), parts, createFleetShared()),
      { normal: 3, aFleetUv: 2, aFleetPart: 4, aFleetFlex: 1 }, { instanced: true, tinted: true, cast: true });
    for (const name of ['aFleetA', 'aFleetB']) fleet.geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(4), 4));
    const set = createSetUniforms();
    for (const batched of [true, false]) add(batched ? 'airport-set-batched' : 'airport-set-solid', createSetMaterial(set),
      { normal: 3, color: 3, uv: 2, aSurf: 4 }, { batched, cast: true });
    add('airport-set-decal', createDecalMaterial(set), { normal: 3, color: 3, uv: 2, aDecal: 4 });
    add('forest', createLivingForestMaterial().material,
      { normal: 3, color: 3, uv: 2, aForestLeaf: 1, aForestCoarse: 3, aForestCoarseNormal: 3 }, { instanced: true, tinted: true });
    add('earth-scenery', createEarthSceneryMaterial(), { normal: 3, color: 3 }, { instanced: true, tinted: true });
    add('monument-merged', createCinematicModelMaterial(applyBendAnchorMonument, { merged: true }),
      { normal: 3, color: 3, aAnchor: 3, aModelSurface: 2, aModelLight: 3, aModelLocal: 4 });
    add('landmark', createCinematicLandmarkMaterial(), { normal: 3, color: 3 }, { instanced: true });
    for (const [name, painted, tinted] of [['traffic-painted', true, false], ['traffic-unpainted', false, false], ['traffic-painted-tinted', true, true]]) {
      add(name, createTrafficNavMaterial(painted), { normal: 3, aEmissive: 4, ...(painted ? { color: 3 } : {}) }, { instanced: true, tinted, receive: false });
    }
    const homes = createCinematicHomeMaterial(applyBendAnchor); ownedTextures.add(homes.emissiveMap);
    add('homes', homes, { normal: 3, color: 3, uv: 2, aHomeVariant: 1 }, { instanced: true, tinted: true, cast: true });
    add('canopy', createCinematicTreeMaterial(applyBendAnchor), { normal: 3, color: 3, uv: 2, aCanopyPhase: 1 }, { instanced: true, tinted: true, cast: true });
    return { scene, dispose };
  } catch (error) { dispose(); throw error; }
}

const caches = new WeakMap();

/** Retain exact program sets across environment rekeys. No live scene objects,
 * lights or materials are changed; pending jobs own twins until all settle. */
export async function warmMeasuredWorldProfiles({ gl, camera, scene, cascadeCounts, state = {} }) {
  Object.assign(state, { required: true, status: 'waiting', variants: MEASURED_WORLD_VARIANTS.length, cascadeCounts: [...cascadeCounts], ms: 0, error: null, reason: null });
  if (!gl.extensions?.has?.('KHR_parallel_shader_compile')) {
    state.required = false; state.status = 'unsupported'; state.reason = 'KHR_parallel_shader_compile unavailable'; return state;
  }
  const start = performance.now(); state.status = 'compiling'; state.startedAt = start;
  let record = caches.get(gl);
  if (!record) {
    record = { cache: createTerrainProgramRetention({ capacity: 4 }), generation: 0, state: null };
    caches.set(gl, record);
    const invalidate = reason => {
      record.generation++; record.cache.clear();
      if (record.state?.required) Object.assign(record.state, { status: 'invalidated', reason,
        readyAt: null, identityVerified: false, programKeys: 0, retainedSets: 0 });
    };
    gl.domElement?.addEventListener('webglcontextlost', () => invalidate('context-lost'));
    gl.domElement?.addEventListener('webglcontextrestored', () => invalidate('context-restored'));
  }
  record.state = state;
  const cache = record.cache, generation = record.generation;
  let job, retained = false;
  try {
    job = compileCinemaProfiles({ gl, camera, scene, createWarmScene: createMeasuredWorldWarmScene, cascadeCounts });
    const keys = []; let missing = false;
    for (const profile of job.profiles) profile.scene.traverse(object => {
      if (!object.material) return;
      const key = gl.properties.get(object.material).currentProgram?.cacheKey;
      if (typeof key === 'string') keys.push(key); else missing = true;
    });
    const key = keys.length && !missing ? JSON.stringify([...new Set(keys)].sort()) : Symbol('unverified-world-program');
    state.programKeys = new Set(keys).size; state.identityVerified = !missing && keys.length > 0;
    retained = true;
    await cache.retain(key, job);
    if (generation !== record.generation) return state;
    state.status = 'ready'; state.readyAt = performance.now(); state.retainedSets = cache.size;
    return state;
  } catch (error) {
    // Identity inspection can itself fail after dispatch (for example during
    // renderer teardown). Every dispatched profile must settle before release.
    if (job && !retained) { await Promise.allSettled([job.promise]); job.dispose(); }
    if (generation === record.generation) { state.status = 'failed'; state.error = String(error?.message ?? error); }
    throw error;
  } finally { if (generation === record.generation) state.ms = Math.round(performance.now() - start); }
}

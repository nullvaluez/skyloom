import { BufferAttribute, BufferGeometry, Mesh, Scene } from 'three';
import { compileCinemaProfiles } from '../cinema-profile-prewarm.js';
import { createRoomMaterials } from './room-shading.js';

// One retained set per actual room/shader context, bounded across room visits.
// These tiny scenes never draw: maps and uniform cells are shared, and the
// geometry holds only three vertices with the live attribute layout.
const caches = new WeakMap();
const observedRenderers = new WeakSet();
const MAX_SETS = 4;

/** Context restoration keeps the renderer identity but discards its programs.
 * Retire owners only after their cancellable polls have settled. */
export function invalidateRoomProfiles(gl) {
  const cache = caches.get(gl);
  if (!cache) return;
  caches.delete(gl);
  for (const entry of cache.values()) entry.promise.catch(() => {}).then(() => entry.dispose());
  cache.clear();
}

function contextKey(gl, scene, camera, resource, variant, cascades) {
  const lights = [];
  scene.traverseVisible((object) => {
    if (object.isLight && object.name !== 'cinema-cascade' && object.layers.test(camera.layers)) {
      lights.push(`${object.type}:${object.isDirectionalLight ? false : object.castShadow}`);
    }
  });
  const environment = scene.environment;
  const materials = Object.entries(resource.materials).map(([name, material]) => {
    const maps = ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].map((slot) => {
      const texture = material[slot];
      return texture ? `${slot}:${texture.channel}:${texture.colorSpace}:${texture.mapping}` : `${slot}:none`;
    });
    return [name, material.type, material.customProgramCacheKey().replace(/\|cinema-csm-\d+$/, ''), ...maps].join(':');
  }).join(';');
  return [variant, cascades.join(','), gl.shadowMap.type, environment?.mapping,
    environment?.image?.height, scene.fog?.type, lights.sort().join(','), materials].join('/');
}

export function warmRoomProfiles({ gl, camera, scene, resource, variant, cascadeCounts }) {
  // Programs can be lost while the lounge is unmounted. The retained cache
  // belongs to the renderer, so its invalidation must outlive a room visit.
  if (!observedRenderers.has(gl)) {
    const invalidate = () => invalidateRoomProfiles(gl);
    gl.domElement.addEventListener('webglcontextlost', invalidate);
    gl.domElement.addEventListener('webglcontextrestored', invalidate);
    observedRenderers.add(gl);
  }
  let cache = caches.get(gl);
  if (!cache) { cache = new Map(); caches.set(gl, cache); }
  const key = contextKey(gl, scene, camera, resource, variant, cascadeCounts);
  const existing = cache.get(key);
  if (existing) return existing;
  const maps = Object.fromEntries(Object.entries(resource.materials).map(([name, material]) => [name, material.map]));
  const job = compileCinemaProfiles({ gl, camera, scene, cascadeCounts,
    createWarmScene() {
      const warmScene = new Scene();
      const materials = createRoomMaterials(resource.uniforms, maps, variant);
      const geometries = [];
      for (const live of resource.meshes) {
        const geometry = new BufferGeometry();
        for (const [name, attribute] of Object.entries(live.geometry.attributes)) {
          const array = new attribute.array.constructor(3 * attribute.itemSize);
          geometry.setAttribute(name, new BufferAttribute(array, attribute.itemSize, attribute.normalized));
        }
        geometries.push(geometry);
        const mesh = new Mesh(geometry, materials[live.name.slice(7)]);
        mesh.castShadow = live.castShadow;
        mesh.receiveShadow = live.receiveShadow;
        warmScene.add(mesh);
      }
      return { scene: warmScene, dispose() {
        for (const material of Object.values(materials)) material.dispose();
        for (const geometry of geometries) geometry.dispose();
        warmScene.clear();
      } };
    },
  });
  const entry = { ...job, key, done: false, cached: false };
  cache.set(key, entry);
  entry.promise = job.promise.then((value) => {
    entry.done = true;
    for (const [oldKey, old] of cache) {
      if (cache.size <= MAX_SETS) break;
      if (old !== entry && old.done) { cache.delete(oldKey); old.dispose(); }
    }
    return value;
  }, (error) => {
    cache.delete(key);
    entry.dispose();
    throw error;
  });
  return entry;
}

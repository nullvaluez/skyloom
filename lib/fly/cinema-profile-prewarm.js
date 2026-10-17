import { Scene, WebGLRenderTarget } from 'three';
import { CinemaShadows } from './cinema-shadows.js';
import { CINEMA_PROFILES } from './cinema-profile.js';

/** Only shader-distinct profiles reachable under the current device/preset. */
export function reachableCinemaCascades({ preset = 'high', phone = false } = {}) {
  return phone ? [0, 1] : preset === 'ultra' ? [0, 1, 2, 3] : [0, 1, 2];
}

const PROFILES = [CINEMA_PROFILES.low, CINEMA_PROFILES.medium, CINEMA_PROFILES.high, CINEMA_PROFILES.ultra];

/**
 * Compile exact reachable lighting keys without changing the live scene.
 * The live rig adds N directional lights beside the original sun, even for
 * objects which do not receive shadows. Omitting CSM from a material therefore
 * cannot avoid the N+1 light-count permutations in Three's program key.
 *
 * createWarmScene must return fresh, unadopted material twins for each count,
 * plus their disposer. Textures/geometry may be shared, but their disposer must
 * not destroy resources belonging to the visible scene. The caller retains
 * this job until it is safe to release its program references.
 */
export function compileCinemaProfiles({ gl, camera, scene, createWarmScene, cascadeCounts }) {
  const profiles = [], target = new WebGLRenderTarget(1, 1);
  const jobs = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const entry of profiles) {
      entry.rig?.dispose();
      entry.dispose();
      for (const light of entry.lights) light.shadow?.dispose();
      entry.targetScene.clear();
    }
    target.dispose();
  };
  try {
    for (const cascades of [...new Set(cascadeCounts)]) {
      if (!Number.isInteger(cascades) || !PROFILES[cascades]) throw Error(`Unsupported cinematic cascade count: ${cascades}`);
      const warm = createWarmScene(cascades);
      const targetScene = new Scene();
      targetScene.environment = scene.environment;
      targetScene.environmentIntensity = scene.environmentIntensity;
      targetScene.environmentRotation.copy(scene.environmentRotation);
      targetScene.fog = scene.fog;
      const lights = [];
      scene.traverseVisible((object) => {
        if (!object.isLight || object.name === 'cinema-cascade') return;
        const light = object.clone(false);
        // CinemaShadowRig always retires the original directional shadow.
        if (light.isDirectionalLight) light.castShadow = false;
        lights.push(light);
        targetScene.add(light);
      });
      const rig = cascades ? new CinemaShadows(camera, targetScene, PROFILES[cascades]) : null;
      if (rig) warm.scene.traverse(rig.registerObject);
      const entry = { cascades, scene: warm.scene, targetScene, rig, lights, dispose: warm.dispose };
      profiles.push(entry);
      const previousTarget = gl.getRenderTarget(), previousShadows = gl.shadowMap.enabled;
      try {
        gl.setRenderTarget(target);
        // Low has no shadow-casting lights; its key remains shadow-free.
        gl.shadowMap.enabled = true;
        // Three dispatches synchronously, then polls parallel completion. All
        // renderer state is restored before the caller regains the frame loop.
        jobs.push(gl.compileAsync(warm.scene, camera, targetScene));
      } finally {
        gl.shadowMap.enabled = previousShadows;
        gl.setRenderTarget(previousTarget);
      }
    }
  } catch (error) {
    // A prior dispatch may still own these materials while its promise polls.
    const promise = Promise.allSettled(jobs).then(() => { dispose(); throw error; });
    return { promise, dispose, profiles };
  }
  const promise = Promise.allSettled(jobs).then((results) => {
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    return results.map((result) => result.value);
  });
  return { promise, dispose, profiles };
}

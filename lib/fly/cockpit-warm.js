import { Vector4 } from 'three';
import { compileSceneAsync } from './compile-scene-safe.js';

// A staged deck owns its resources before it has a flight camera. Bind the
// controller independently of the deck's lifetime so committing the same
// airframe reuses the staged scene. Only the bound controller can draw it.
export class CockpitPassOwner {
  ready = false;
  pilot = null;
  attach(pilot) {
    this.pilot = pilot;
    pilot?.setInteriorReady(this.ready);
    return () => {
      if (this.pilot !== pilot) return;
      pilot?.setInteriorReady(false);
      this.pilot = null;
    };
  }
  setReady(ready) {
    this.ready = ready;
    this.pilot?.setInteriorReady(ready);
  }
}

export function publishCockpitPreparation(runtime, prep) {
  const entries = runtime.cockpitPreparations ??= {};
  entries[prep.aircraftId] = prep;
  runtime.cockpitPreparation = prep;
  return () => {
    if (entries[prep.aircraftId] === prep) delete entries[prep.aircraftId];
    if (runtime.cockpitPreparation === prep) runtime.cockpitPreparation = Object.values(entries)[0] ?? null;
  };
}

// The deck is the one pass drawn directly over the composer's screen output.
// Compile with that target's output/tonemapping, then exercise the real
// shadow casters and upload the buffers with zero pixels writable on screen.
export async function prepareCockpitPass(gl, scene, camera, signal) {
  const previous = gl.getRenderTarget();
  const face = gl.getActiveCubeFace(), level = gl.getActiveMipmapLevel();
  let pending;
  try {
    gl.setRenderTarget(null);
    pending = compileSceneAsync(gl, scene, camera, scene, { signal });
  } finally {
    // Other passes may run for many frames while the driver compiles.
    gl.setRenderTarget(previous, face, level);
  }
  await pending;
  if (signal.aborted) return;

  const target = gl.getRenderTarget();
  const cubeFace = gl.getActiveCubeFace(), mip = gl.getActiveMipmapLevel();
  const scissor = gl.getScissor(new Vector4()), test = gl.getScissorTest();
  const auto = gl.autoClear, reset = gl.info.autoReset;
  const culled = [];
  try {
    gl.setRenderTarget(null);
    gl.setScissor(0, 0, 0, 0);
    gl.setScissorTest(true);
    gl.autoClear = false;
    gl.info.autoReset = false;
    // A later head turn can expose instruments beside the optical axis.
    scene.traverse(object => {
      if (object.isMesh && object.frustumCulled) {
        culled.push(object);
        object.frustumCulled = false;
      }
    });
    gl.render(scene, camera);
  } finally {
    for (const object of culled) object.frustumCulled = true;
    gl.autoClear = auto;
    gl.info.autoReset = reset;
    gl.setScissor(scissor);
    gl.setScissorTest(test);
    gl.setRenderTarget(target, cubeFace, mip);
  }
}

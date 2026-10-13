// Observation lounge — the interior reflection probe.
//
// At night the inside of the glass shows the room: the warm pools under the
// pendants, the backlit bar, the boards. The probe is a cube map of the ROOM
// ONLY, captured from the seated eye and oriented on the room's own axes, so
// the glass samples it with room-local reflection vectors (box-projected onto
// the room's walls for parallax).
//
// Capture = 6 renders of the room meshes (and the boards), done rarely: once
// the room's maps and AO are in, and again when the practical lights or the
// daylight change enough to show. Steady state costs nothing.
//
// The same idiom as the coastal reflection rig (lib/fly/coastal-reflection.js):
// the main scene is rendered with a dedicated layer, and the world's lights
// are enabled on that layer for the capture so the lighting state — and every
// program key — is the one the room was compiled with. TRUE_SCALE: each face
// camera is parentless and installs the anisotropic matrix; the cube faces
// look along room axes (horizontal or vertical), which S leaves unchanged.
import { Color, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, PerspectiveCamera, Vector3, WebGLCubeRenderTarget } from 'three';
import { installTrueScaleCamera } from '../true-scale.js';

/** GPU bytes of a probe of the given face size (six RGBA half-float faces with mips). */
export const probeBytes = (size) => size * size * 6 * 8 * (4 / 3);

/** 28 belongs to the coastal reflection, 29 to the sky overlays. */
export const LOUNGE_PROBE_LAYER = 27;

// three's CubeCamera faces (WebGL convention): [look, up]
const FACES = [
  [[1, 0, 0], [0, -1, 0]],
  [[-1, 0, 0], [0, -1, 0]],
  [[0, 1, 0], [0, 0, 1]],
  [[0, -1, 0], [0, 0, -1]],
  [[0, 0, 1], [0, -1, 0]],
  [[0, 0, -1], [0, -1, 0]],
];

export class InteriorProbe {
  constructor(size = 256) {
    this.size = size;
    this.target = null;
    this.cameras = FACES.map(() => {
      const c = new PerspectiveCamera(90, 1, 0.05, 60);
      installTrueScaleCamera(c);
      return c;
    });
    this.stats = { captures: 0, draws: 0, bytes: 0 };
    this.signature = null;
  }

  get texture() {
    return this.target?.texture ?? null;
  }

  /**
   * Capture the room. `objects` are the meshes to see (room buckets + boards),
   * `group` the room group (its matrixWorld maps room-local to scene), `eye`
   * the scene-space eye position.
   */
  capture(renderer, scene, group, objects, eye) {
    if (!this.target) {
      // Mipmapped: the glass reads a softened level, so the small bright
      // fixtures that box projection misplaces become soft glows, not specks.
      this.target = new WebGLCubeRenderTarget(this.size, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
      this.target.texture.name = 'lounge-interior-probe';
      this.stats.bytes = probeBytes(this.size);
    }
    group.updateMatrixWorld();
    const e = group.matrixWorld.elements;
    // Room axes in scene space (unit; the group carries the k scale).
    const ax = new Vector3(e[0], e[1], e[2]).normalize();
    const ay = new Vector3(e[4], e[5], e[6]).normalize();
    const az = new Vector3(e[8], e[9], e[10]).normalize();
    const toScene = (v) => new Vector3().addScaledVector(ax, v[0]).addScaledVector(ay, v[1]).addScaledVector(az, v[2]);
    const reversed = !!renderer.capabilities.reversedDepthBuffer;
    const changed = [];
    const enable = (o) => { changed.push([o, o.layers.mask]); o.layers.enable(LOUNGE_PROBE_LAYER); };
    for (const o of objects) enable(o);
    scene.traverse((o) => { if (o.isLight) enable(o); });
    const prev = {
      target: renderer.getRenderTarget(), auto: renderer.autoClear, xr: renderer.xr.enabled,
      shadow: renderer.shadowMap.autoUpdate, needs: renderer.shadowMap.needsUpdate, background: scene.background,
      alpha: renderer.getClearAlpha(),
    };
    const prevColor = renderer.getClearColor(new Color());
    const calls0 = renderer.info.render.calls;
    try {
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      scene.background = null;
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 1);
      FACES.forEach(([look, up], i) => {
        const cam = this.cameras[i];
        cam._reversedDepth = reversed;
        cam.position.copy(eye);
        cam.up.copy(toScene(up));
        cam.lookAt(eye.clone().add(toScene(look)));
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
        cam.layers.set(LOUNGE_PROBE_LAYER);
        renderer.setRenderTarget(this.target, i);
        renderer.render(scene, cam);
      });
      this.stats.captures += 1;
      this.stats.draws = renderer.info.render.calls - calls0;
    } finally {
      for (const [o, mask] of changed) o.layers.mask = mask;
      scene.background = prev.background;
      renderer.setRenderTarget(prev.target);
      renderer.setClearColor(prevColor, prev.alpha);
      renderer.autoClear = prev.auto;
      renderer.xr.enabled = prev.xr;
      renderer.shadowMap.autoUpdate = prev.shadow;
      renderer.shadowMap.needsUpdate = prev.needs;
    }
  }

  dispose() {
    this.target?.dispose();
    this.target = null;
  }
}

/**
 * TRUE EARTH Phase 2 — PHYS_SKY: the GPU tables' owner. Four full-screen
 * passes into half-float targets (WebGL2 core filters RGBA16F; float32 is not
 * filterable on Apple GPUs, the R16 lesson):
 *   transmittance 256x64 and multiple scattering 32x32 — once per medium;
 *   sky view 192x108 — when the eye altitude or the sun moves;
 *   the aerial atlas 512x256 (two attachments) — at the tier's rate.
 * The exact GLSL is glsl.js, which verify-phys-sky.mjs renders and checks.
 */
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import { ATMO_TABLES } from './model.js';
import { compileSceneAsync } from '../compile-scene-safe.js';
import {
  ATMO_AERIAL_FRAG,
  ATMO_MULTISCATTER_FRAG,
  ATMO_PASS_VERT,
  ATMO_SKYVIEW_FRAG,
  ATMO_TRANSMITTANCE_FRAG,
  atmoPassUniformValues,
} from './glsl.js';

const target = (w, h, count = 1) =>
  new WebGLRenderTarget(w, h, {
    type: HalfFloatType,
    format: RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    generateMipmaps: false,
    colorSpace: NoColorSpace,
    count,
  });

export class AtmosphereLuts {
  constructor(params) {
    const [tw, th] = ATMO_TABLES.transmittance;
    const [mw, mh] = ATMO_TABLES.multiScattering;
    const [sw, sh] = ATMO_TABLES.skyView;
    const [aw, ah] = ATMO_TABLES.aerial;
    const [ax, ay] = ATMO_TABLES.aerialAtlas;
    this.trans = target(tw, th);
    this.ms = target(mw, mh);
    this.sky = target(sw, sh);
    this.aerial = target(aw * ax, ah * ay, 2);
    this.trans.texture.name = 'atmo-transmittance';
    this.ms.texture.name = 'atmo-multiscatter';
    this.sky.texture.name = 'atmo-skyview';
    this.aerial.textures[0].name = 'atmo-aerial-inscatter';
    this.aerial.textures[1].name = 'atmo-aerial-transmittance';
    this.uniforms = {
      uAtmoRay: { value: new Vector4() },
      uAtmoMie: { value: new Vector4() },
      uAtmoOzone: { value: new Vector4() },
      uAtmoView: { value: new Vector4() },
      uAtmoTransLut: { value: this.trans.texture },
      uAtmoMsLut: { value: this.ms.texture },
    };
    const material = (fragmentShader) =>
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: ATMO_PASS_VERT,
        fragmentShader,
        uniforms: this.uniforms,
        depthTest: false,
        depthWrite: false,
      });
    this.materials = {
      trans: material(ATMO_TRANSMITTANCE_FRAG),
      ms: material(ATMO_MULTISCATTER_FRAG),
      sky: material(ATMO_SKYVIEW_FRAG),
      aerial: material(ATMO_AERIAL_FRAG),
    };
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new Mesh(this.geometry, this.materials.trans);
    this.mesh.frustumCulled = false;
    this.scene = new Scene();
    this.scene.add(this.mesh);
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // What each table currently holds (consumers must look up with these).
    this.skyState = { h: NaN, muS: NaN, at: -Infinity };
    this.aerialState = { h: NaN, muS: NaN, maxKm: NaN, at: -Infinity };
    this.stats = { staticRenders: 0, skyRenders: 0, aerialRenders: 0 };
    this.programWarm = { required: false, status: 'waiting', error: null };
    this.warmGeneration = 0;
    this.warmRenderer = null;
    this.warmAbort = null;
    this.disposed = false;
    this.setParams(params);
  }

  /** New medium (the grade): the static tables re-render on the next update. */
  setParams(p) {
    const v = atmoPassUniformValues(p);
    this.uniforms.uAtmoRay.value.fromArray(v.uAtmoRay);
    this.uniforms.uAtmoMie.value.fromArray(v.uAtmoMie);
    this.uniforms.uAtmoOzone.value.fromArray(v.uAtmoOzone);
    this.invalidate();
  }

  /** Context restored or medium changed: everything re-renders. */
  invalidate() {
    this.staticDirty = true;
    this.skyState.h = NaN;
    this.skyState.at = -Infinity;
    this.aerialState.h = NaN;
    this.aerialState.at = -Infinity;
  }

  /** Context restore invalidates programs as well as the table contents. */
  invalidatePrograms() {
    this.warmGeneration++;
    this.warmAbort?.abort(); this.warmAbort = null;
    this.warmRenderer = null;
    this.programWarm.status = 'waiting';
    this.invalidate();
  }

  /** Dispatch exact LUT programs without drawing any dependent table early. */
  prepare(renderer) {
    if (this.disposed) return false;
    if (!renderer.extensions?.has?.('KHR_parallel_shader_compile')) {
      this.programWarm.required = false; this.programWarm.status = 'unsupported'; return true;
    }
    if (this.warmRenderer === renderer) return ['ready', 'failed'].includes(this.programWarm.status);
    this.warmAbort?.abort();
    const controller = new AbortController(), generation = ++this.warmGeneration;
    this.warmAbort = controller; this.warmRenderer = renderer;
    Object.assign(this.programWarm, { required: true, status: 'compiling', error: null });
    const previous = renderer.getRenderTarget(), material = this.mesh.material, jobs = [];
    try {
      for (const name of ['trans', 'ms', 'sky', 'aerial']) {
        this.mesh.material = this.materials[name]; renderer.setRenderTarget(this[name]);
        jobs.push(compileSceneAsync(renderer, this.scene, this.camera, this.scene, { signal: controller.signal }));
      }
    } catch (error) { jobs.push(Promise.reject(error)); }
    finally { this.mesh.material = material; renderer.setRenderTarget(previous); }
    Promise.allSettled(jobs).then(results => {
      if (this.disposed || generation !== this.warmGeneration) return;
      const failed = results.find(result => result.status === 'rejected');
      this.programWarm.status = failed ? 'failed' : 'ready';
      this.programWarm.error = failed ? String(failed.reason?.message ?? failed.reason) : null;
    });
    return false;
  }

  _draw(renderer, material, rt) {
    this.mesh.material = material;
    renderer.setRenderTarget(rt);
    renderer.render(this.scene, this.camera);
  }

  /**
   * Render what changed. `eye` = { h (km), muS, maxKm, nowSec, aerialHz, skyHz }.
   * Returns true when any table was rendered this call.
   */
  update(renderer, eye) {
    // These four raw programs used to synchronously link on the first LUT
    // draw (several seconds on the desktop driver). The frame loop and network
    // keep progressing while they link; then all dependent tables publish in
    // their original order in one update, with their original shaders.
    if (!this.prepare(renderer)) return false;
    const sky = this.skyState;
    const ap = this.aerialState;
    const skyMoved = !(Math.abs(eye.h - sky.h) <= Math.max(0.002, eye.h * 0.002) && Math.abs(eye.muS - sky.muS) <= 1e-4);
    // PHYS_SKY's declared mobile skyHz was never consumed: a fast climb
    // rebuilt the 192x108 ray-marched view every frame. Keep the same table
    // and sampling, but honor its cadence. Boot, context restore, clock reset,
    // warps and large sun changes must refresh immediately, even inside a tick.
    const skyHz = Number.isFinite(eye.skyHz) ? Math.max(1, eye.skyHz) : Infinity;
    const skyUrgent = !Number.isFinite(sky.h) || eye.nowSec < sky.at
      || Math.abs(eye.h - sky.h) > .25 || Math.abs(eye.muS - sky.muS) > .02;
    const skyDue = skyUrgent || eye.nowSec - sky.at + 1e-7 >= 1 / skyHz;
    const drawSky = skyMoved && skyDue;
    const apDue = eye.nowSec - ap.at >= 1 / Math.max(1, eye.aerialHz);
    const apMoved = !(Math.abs(eye.h - ap.h) <= Math.max(0.002, eye.h * 0.002) && Math.abs(eye.muS - ap.muS) <= 1e-4 && eye.maxKm === ap.maxKm);
    if (!this.staticDirty && !drawSky && !(apDue && apMoved)) return false;
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      if (this.staticDirty) {
        this._draw(renderer, this.materials.trans, this.trans);
        this._draw(renderer, this.materials.ms, this.ms);
        this.staticDirty = false;
        this.stats.staticRenders++;
      }
      if (drawSky) {
        this.uniforms.uAtmoView.value.set(eye.h, eye.muS, eye.maxKm, 0);
        this._draw(renderer, this.materials.sky, this.sky);
        sky.h = eye.h;
        sky.muS = eye.muS;
        sky.at = eye.nowSec;
        this.stats.skyRenders++;
      }
      if ((apDue && apMoved) || Number.isNaN(ap.h)) {
        this.uniforms.uAtmoView.value.set(eye.h, eye.muS, eye.maxKm, 0);
        this._draw(renderer, this.materials.aerial, this.aerial);
        ap.h = eye.h;
        ap.muS = eye.muS;
        ap.maxKm = eye.maxKm;
        ap.at = eye.nowSec;
        this.stats.aerialRenders++;
      }
    } finally {
      renderer.setRenderTarget(previous);
      renderer.autoClear = autoClear;
    }
    return true;
  }

  dispose() {
    this.disposed = true; this.warmGeneration++; this.warmAbort?.abort();
    this.trans.dispose();
    this.ms.dispose();
    this.sky.dispose();
    this.aerial.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.geometry.dispose();
  }
}

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
    this.skyState = { h: NaN, muS: NaN };
    this.aerialState = { h: NaN, muS: NaN, maxKm: NaN, at: -Infinity };
    this.stats = { staticRenders: 0, skyRenders: 0, aerialRenders: 0 };
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
    this.aerialState.h = NaN;
  }

  _draw(renderer, material, rt) {
    this.mesh.material = material;
    renderer.setRenderTarget(rt);
    renderer.render(this.scene, this.camera);
  }

  /**
   * Render what changed. `eye` = { h (km), muS, maxKm, nowSec, aerialHz }.
   * Returns true when any table was rendered this call.
   */
  update(renderer, eye) {
    const sky = this.skyState;
    const ap = this.aerialState;
    const skyMoved = !(Math.abs(eye.h - sky.h) <= Math.max(0.002, eye.h * 0.002) && Math.abs(eye.muS - sky.muS) <= 1e-4);
    const apDue = eye.nowSec - ap.at >= 1 / Math.max(1, eye.aerialHz);
    const apMoved = !(Math.abs(eye.h - ap.h) <= Math.max(0.002, eye.h * 0.002) && Math.abs(eye.muS - ap.muS) <= 1e-4 && eye.maxKm === ap.maxKm);
    if (!this.staticDirty && !skyMoved && !(apDue && apMoved)) return false;
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
      if (skyMoved) {
        this.uniforms.uAtmoView.value.set(eye.h, eye.muS, eye.maxKm, 0);
        this._draw(renderer, this.materials.sky, this.sky);
        sky.h = eye.h;
        sky.muS = eye.muS;
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
    this.trans.dispose();
    this.ms.dispose();
    this.sky.dispose();
    this.aerial.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.geometry.dispose();
  }
}

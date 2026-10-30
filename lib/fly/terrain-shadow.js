/**
 * SHIP PASS LIGHT — TERRAIN_SHADOW (FLY_SHIP_PASS.md LT-2): mountains shadow
 * valleys.
 *
 * The cinema cascades reach a few kilometres and the terrain never casts into
 * them, so at golden hour a valley under a 3,000 m ridge is lit like the
 * ridge. This module adds the missing term and nothing else: a TERRAIN-ONLY
 * shadow sampled ONLY by the earth surface material, through an anchored patch
 * (applyTerrainShadowPatch) that removes direct light where the terrain
 * occludes the key light. Indirect light, buildings, trees and the cascades
 * are untouched.
 *
 * Two paths, chosen by the device policy (deviceFeature('TERRAIN_SHADOW')):
 *  - 'map' (desktop): an orthographic depth map of the rendered terrain tiles
 *    along the key light, texel-snapped so a moving aircraft does not make it
 *    shimmer, refreshed at the policy's rate (2 Hz) or at once on a warp or a
 *    jump of the light. Linear light-space depth is packed into RGBA8, so the
 *    renderer's depth convention (reversed or not) never reaches the compare.
 *    The tiles are drawn as they are drawn on screen (world bend included);
 *    leaf tiles parked off-frustum are drawn too, since the light may stand
 *    behind the camera.
 *  - 'horizon' (touch devices): a CPU height grid (gridN² cells around the
 *    aircraft) sampled from the rendered terrain through terrain-ground-query
 *    (read-only; wrapped here), marched toward the light into an R8 "lit"
 *    texture at <= 1 Hz, all time-sliced under a per-frame CPU budget.
 *
 * FLAG OFF: terrainShadowMode() is null, applyTerrainShadowPatch is never
 * called and the earth surface's shader text and program key are byte for
 * byte today's (scripts/verify-ship-light.mjs proves it against main).
 */
import {
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Matrix4,
  NearestFilter,
  OrthographicCamera,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import { cinemaOn } from './cinema-policy';
import { lightFeature, lightBlock, shipPassOn } from './ship-light';
import { applyBend } from './toy-world/world-bend';
import { TerrainGroundQuery } from './terrain-ground-query';

const WHITE = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
WHITE.needsUpdate = true;

/** The receiver uniforms, shared by every patched earth surface material. */
export const TERRAIN_SHADOW_UNIFORMS = {
  uTsMap: { value: WHITE },
  // scene position -> (u, v, linear light depth); the horizon path uses u, v.
  uTsMatrix: { value: new Matrix4() },
  // x strength (0 = no effect), y one texel in uv, z depth bias (normalised),
  // w normal offset (scene units).
  uTsParams: { value: new Vector4(0, 1 / 2048, 0, 0) },
  // Scene-space direction TOWARD the key light.
  uTsLight: { value: new Vector3(0, 1, 0) },
};

/** Replace exactly one occurrence of `from`; a miss or a repeat throws. */
export function once(src, from, to, where) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) {
    throw new Error(`TERRAIN_SHADOW: anchor ${at < 0 ? 'missing' : 'repeated'} in ${where}: ${from.slice(0, 60)}`);
  }
  return src.slice(0, at) + to + src.slice(at + from.length);
}

/**
 * The compile-time path: null (flag off, Classic, or a device the policy
 * refuses), 'map' or 'horizon'. It never depends on the live tier, so a
 * governor step never recompiles the terrain: the tier only moves the
 * strength uniform (terrainShadowRuntime).
 */
export function terrainShadowMode({ cls, cinema } = {}) {
  if (!shipPassOn('TERRAIN_SHADOW')) return null;
  if (!(cinema ?? cinemaOn())) return null;
  const f = lightFeature('TERRAIN_SHADOW', { tier: 'high', cls });
  if (!f.allowed) return null;
  return f.budget?.path === 'horizon' ? 'horizon' : 'map';
}

/** The live budget and gate at the current tier (strength goes to 0 when refused). */
export function terrainShadowRuntime({ tier, preset, cls } = {}) {
  const f = lightFeature('TERRAIN_SHADOW', { tier, preset, cls });
  return { allowed: shipPassOn('TERRAIN_SHADOW') && f.allowed, budget: f.budget ?? {} };
}

const EDGE = (edge) => `float tsEdge(vec2 uv){vec2 e=min(uv,1.-uv);return smoothstep(0.,${edge.toFixed(4)},min(e.x,e.y));}`;

/** The receiver GLSL for a path. */
export function terrainShadowGLSL(mode, block = lightBlock('TERRAIN_SHADOW')) {
  const head = `
// SHIP PASS LIGHT — TERRAIN_SHADOW (${mode})
uniform sampler2D uTsMap;
uniform mat4 uTsMatrix;
uniform vec4 uTsParams;
uniform vec3 uTsLight;
${EDGE(block.edgeFade ?? 0.08)}
`;
  if (mode === 'horizon') {
    return `${head}float terrainShadowLit(vec3 p,vec3 n){
  if(uTsParams.x<=0.)return 1.;
  vec4 c=uTsMatrix*vec4(p,1.);
  if(c.x<=0.||c.x>=1.||c.y<=0.||c.y>=1.)return 1.;
  return mix(1.,texture2D(uTsMap,c.xy).r,uTsParams.x*tsEdge(c.xy));
}
`;
  }
  return `${head}float tsDepthAt(vec2 uv){return dot(texture2D(uTsMap,uv).rgb,vec3(1.,1./255.,1./65025.));}
float terrainShadowLit(vec3 p,vec3 n){
  if(uTsParams.x<=0.)return 1.;
  // Offset the lookup along the normal as the slope turns from the light
  // (grazing light is where terrain acne lives), then a 2x2 bilinear PCF.
  float nl=clamp(dot(n,uTsLight),0.,1.);
  vec4 c=uTsMatrix*vec4(p+n*uTsParams.w*(1.-nl),1.);
  if(c.x<=0.||c.x>=1.||c.y<=0.||c.y>=1.)return 1.;
  float t=uTsParams.y;
  vec2 st=c.xy/t-.5,b=floor(st),f=st-b;
  vec2 uv=(b+.5)*t;
  // Slope-scaled bias: one light-space texel of height spans tan(angle)
  // texels of depth on a surface the light grazes (flat ground at a 5 deg
  // sun: x11).
  float z=c.z-uTsParams.z*(1.+min(20.,sqrt(max(0.,1.-nl*nl))/max(nl,.05)));
  float lit=mix(mix(step(z,tsDepthAt(uv)),step(z,tsDepthAt(uv+vec2(t,0.))),f.x),
                mix(step(z,tsDepthAt(uv+vec2(0.,t))),step(z,tsDepthAt(uv+vec2(t))),f.x),f.y);
  return mix(1.,lit,uTsParams.x*tsEdge(c.xy));
}
`;
}

/** The program-key token for a path ('' when off, so the key is today's). */
export function terrainShadowKey(mode) {
  return mode ? `|ts-${mode}-v1` : '';
}

/**
 * The anchored patch, run from applyEarthSurface's onBeforeCompile (after its
 * own text is in). Declarations follow the earth surface's own appearance
 * sampler; the light term follows lights_fragment_end (direct light only);
 * shadowed water loses most of its sun term (glint) too.
 */
export const TS_LIGHT_TERM = `
float earthTerrainLit=terrainShadowLit(vEarthWorld,normalize((vec4(normal,0.)*viewMatrix).xyz));
reflectedLight.directDiffuse*=earthTerrainLit;
reflectedLight.directSpecular*=earthTerrainLit;`;
export const TS_WATER_TERM = 'water*=mix(1.,mix(.62,1.,earthTerrainLit),day);\n  ';

export function applyTerrainShadowPatch(shader, mode) {
  if (!mode) return shader;
  Object.assign(shader.uniforms, TERRAIN_SHADOW_UNIFORMS);
  let f = shader.fragmentShader;
  f = once(f, 'uniform sampler2D uEarthAppearance;\n', `uniform sampler2D uEarthAppearance;\n${terrainShadowGLSL(mode)}`, 'earth fragment declarations');
  f = once(f, '#include <lights_fragment_end>', `#include <lights_fragment_end>${TS_LIGHT_TERM}`, 'earth fragment lights');
  f = once(f, 'float coastWeight=', `${TS_WATER_TERM}float coastWeight=`, 'earth fragment water');
  shader.fragmentShader = f;
  return shader;
}

// ---------------------------------------------------------------------------
// Pure geometry (node-gated): the light basis, texel snapping, the map frame.
// ---------------------------------------------------------------------------

/**
 * Light-space basis for a scene direction TOWARD the light `L`:
 * F (the way light travels), R (horizontal, across the light), U = R x F.
 */
export function lightBasis(L, out = { F: new Vector3(), R: new Vector3(), U: new Vector3() }) {
  out.F.copy(L).normalize().negate();
  out.R.set(out.F.z, 0, -out.F.x); // F x (0,1,0)
  if (out.R.lengthSq() < 1e-8) out.R.set(1, 0, 0);
  out.R.normalize();
  out.U.crossVectors(out.R, out.F).normalize();
  return out;
}

/**
 * Snap `P` (scene) so its light-space x/y land on the map's texel grid: a map
 * re-rendered at a moved centre then holds the same depths for the same
 * terrain (no shimmer). Only the R/U components move; F is free.
 */
export function snapToTexels(P, basis, texelX, texelY, out = new Vector3()) {
  const x = P.dot(basis.R), y = P.dot(basis.U);
  const sx = Math.round(x / texelX) * texelX - x, sy = Math.round(y / texelY) * texelY - y;
  return out.copy(P).addScaledVector(basis.R, sx).addScaledVector(basis.U, sy);
}

/**
 * The orthographic frame for a centre P (already snapped), light basis, reach
 * (scene units) and height span (metres = scene y): half extents, the light
 * camera position and the near/far range of linear light depth.
 */
export function mapFrame(P, basis, rangeS, spanM, pullBackS) {
  const fxz = Math.hypot(basis.F.x, basis.F.z), fy = Math.abs(basis.F.y);
  const hx = rangeS;
  const hy = fy * rangeS + fxz * spanM;
  const ext = fxz * rangeS + fy * spanM;
  const D = ext + pullBackS;
  const C = new Vector3().copy(P).addScaledVector(basis.F, -D);
  return { hx, hy, C, near: Math.max(1, pullBackS * 0.25), far: D + ext + pullBackS * 0.25 };
}

/**
 * scene p -> (u, v, linear depth in [0,1]) for a frame; the shader's
 * uTsMatrix before the per-frame rebase shift.
 */
export function mapMatrix(frame, basis, out = new Matrix4()) {
  const { hx, hy, C, near, far } = frame, { R, U, F } = basis;
  const ax = 1 / (2 * hx), ay = 1 / (2 * hy), az = 1 / (far - near);
  return out.set(
    R.x * ax, R.y * ax, R.z * ax, -C.dot(R) * ax + 0.5,
    U.x * ay, U.y * ay, U.z * ay, -C.dot(U) * ay + 0.5,
    F.x * az, F.y * az, F.z * az, (-C.dot(F) - near) * az,
    0, 0, 0, 1,
  );
}

/** JS twin of the depth material's packing (24 bits in RGB), for the gate. */
export function packDepth(v) {
  const x = Math.min(0.99999994, Math.max(0, v));
  const e = [x % 1, (x * 255) % 1, (x * 65025) % 1];
  e[0] -= e[1] / 255;
  e[1] -= e[2] / 255;
  return e.map((c) => Math.round(c * 255));
}
export function unpackDepth(rgb) {
  return rgb[0] / 255 + rgb[1] / 255 / 255 + rgb[2] / 255 / 65025;
}

// ---------------------------------------------------------------------------
// Desktop: the terrain depth map.
// ---------------------------------------------------------------------------

/** Linear light depth, packed, for the bent terrain (world-bend's own bend). */
export function createTerrainShadowDepthMaterial() {
  const m = new ShaderMaterial({
    name: 'terrain-shadow-depth',
    side: DoubleSide,
    uniforms: { uTsDepthRange: { value: new Vector2(0, 1) } },
    vertexShader: `#include <common>
varying float vTsDepth;
void main() {
#include <begin_vertex>
#include <project_vertex>
vTsDepth = -mvPosition.z;
}`,
    fragmentShader: `uniform vec2 uTsDepthRange;
varying float vTsDepth;
void main() {
float v = clamp((vTsDepth - uTsDepthRange.x) * uTsDepthRange.y, 0., .99999994);
vec3 e = fract(v * vec3(1., 255., 65025.));
e.xy -= e.yz / 255.;
gl_FragColor = vec4(e, 1.);
}`,
  });
  // The terrain draws bent (world-bend's 'world-bend' variant), so its shadow
  // must too: one shared program, keyed by world-bend.
  applyBend(m);
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${key}|terrain-shadow-depth-v1`;
  return m;
}

const _box = new Vector3();
const _corner = new Vector3();

/**
 * The tile meshes the shadow map should draw: what is drawn on screen, plus
 * loaded leaf tiles parked off-frustum (R24 PATCH 26). Returns
 * { meshes, parked }.
 */
export function gatherTerrainMeshes(map, out = { meshes: [], parked: [] }) {
  out.meshes.length = 0;
  out.parked.length = 0;
  const walk = (tile) => {
    if (!tile?.isTile) return;
    const m = tile.model;
    if (m?.isMesh && tile.loadState === 'loaded') {
      if (m.visible) out.meshes.push(m);
      else if (tile.isLeaf) {
        out.meshes.push(m);
        out.parked.push(m);
      }
    }
    for (const c of tile.children) if (c.isTile) walk(c);
  };
  walk(map?.rootTile);
  return out;
}

export class TerrainShadowMap {
  constructor(size) {
    this.size = size;
    this.target = new WebGLRenderTarget(size, size, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.target.texture.name = 'terrain-shadow-map';
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 1, 2);
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.material = createTerrainShadowDepthMaterial();
    this.scene = new Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.overrideMaterial = this.material;
    this.basis = { F: new Vector3(), R: new Vector3(), U: new Vector3() };
    this.matrix = new Matrix4();
    this.anchor = new Vector2();
    this.light = new Vector3(0, 1, 0);
    this.gathered = { meshes: [], parked: [] };
    this.valid = false;
    this.lastAt = -Infinity;
    this.epoch = null;
    this.stats = { renders: 0, draws: 0, tiles: 0, parked: 0, ms: 0, texelM: 0, spanM: 0 };
  }

  /**
   * Re-render when due. ctx: { renderer, map, worldRoot, player (abs x/y/z),
   * anchor (abs x/z now), L (scene dir to light), k (scene units per metre),
   * rangeM, hz, now, epoch, block }. Returns true when it rendered.
   */
  update(ctx) {
    const { renderer, map, L, k, rangeM, hz, now, epoch, block } = ctx;
    const jump = this.valid && this.light.angleTo(L) > 0.0175; // ~1 deg
    if (this.valid && epoch === this.epoch && !jump && now - this.lastAt < 1 / Math.max(0.1, hz)) return false;
    const t0 = performance.now();
    this.epoch = epoch;
    this.lastAt = now;
    this.light.copy(L);
    // The tiles carry worldRoot's CURRENT matrixWorld (the previous render's);
    // build the map in that frame and shift it per frame by the anchor delta.
    const w = ctx.worldRoot?.matrixWorld?.elements;
    const ox = w ? w[12] : -ctx.anchor.x, oz = w ? w[14] : -ctx.anchor.z;
    this.anchor.set(-ox, -oz);
    const P = _box.set(ctx.player.x + ox, ctx.player.y, ctx.player.z + oz);
    const basis = lightBasis(L, this.basis);
    const rangeS = rangeM * k;
    const g = gatherTerrainMeshes(map, this.gathered);
    // Height span from the gathered tiles' boxes (local z is elevation), the
    // block's span as the ceiling; plus the world bend at the reach.
    let lo = Infinity, hi = -Infinity;
    for (const m of g.meshes) {
      const bb = m.geometry?.boundingBox ?? (m.geometry?.computeBoundingBox(), m.geometry?.boundingBox);
      if (!bb) continue;
      for (let i = 0; i < 2; i++) {
        _corner.set(0, 0, i ? bb.max.z : bb.min.z).applyMatrix4(m.matrixWorld);
        if (Number.isFinite(_corner.y)) {
          lo = Math.min(lo, _corner.y);
          hi = Math.max(hi, _corner.y);
        }
      }
    }
    const cap = block.heightSpanM ?? 4500;
    const spanM = Math.min(cap, Math.max(300, Number.isFinite(lo) ? Math.max(P.y - lo, hi - P.y) : cap)) + 200;
    const fy = Math.abs(basis.F.y), fxz = Math.hypot(basis.F.x, basis.F.z);
    const tx = (2 * rangeS) / this.size, ty = (2 * (fy * rangeS + fxz * spanM)) / this.size;
    snapToTexels(P, basis, tx, ty, P);
    const frame = mapFrame(P, basis, rangeS, spanM, (block.pullBackM ?? 12000) * k);
    mapMatrix(frame, basis, this.matrix);
    const cam = this.camera;
    cam.left = -frame.hx;
    cam.right = frame.hx;
    cam.top = frame.hy;
    cam.bottom = -frame.hy;
    cam.near = frame.near;
    cam.far = frame.far;
    cam.matrixWorld.makeBasis(basis.R, basis.U, _corner.copy(basis.F).negate()).setPosition(frame.C);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.updateProjectionMatrix();
    this.material.uniforms.uTsDepthRange.value.set(frame.near, 1 / (frame.far - frame.near));
    // Draw the tiles (bounded, nearest first) and restore every flag touched.
    let list = g.meshes;
    const max = block.maxTiles ?? 400;
    if (list.length > max) {
      list = list.slice().sort((a, b) => dist2(a, P) - dist2(b, P)).slice(0, max);
    }
    for (const m of g.parked) m.visible = true;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevColor = renderer.getClearColor(_color);
    const prevAlpha = renderer.getClearAlpha();
    const before = renderer.info?.render?.calls ?? 0;
    this.scene.children = list;
    try {
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0xffffff, 1);
      renderer.autoClear = false;
      renderer.clear(true, true, false);
      renderer.render(this.scene, cam);
    } finally {
      this.scene.children = [];
      for (const m of g.parked) m.visible = false;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevColor, prevAlpha);
      renderer.autoClear = prevAuto;
    }
    const after = renderer.info?.render?.calls ?? before;
    this.valid = true;
    Object.assign(this.stats, {
      renders: this.stats.renders + 1,
      draws: Math.max(0, after - before),
      tiles: list.length,
      parked: g.parked.length,
      ms: performance.now() - t0,
      texelM: tx / k,
      spanM,
    });
    return true;
  }

  /** The shader uniforms for this frame (the map frame shifted by the rebase delta). */
  bind(uniforms, anchorNow, strength, block) {
    _shift.makeTranslation(anchorNow.x - this.anchor.x, 0, anchorNow.z - this.anchor.y);
    uniforms.uTsMatrix.value.multiplyMatrices(this.matrix, _shift);
    uniforms.uTsMap.value = this.target.texture;
    const texel = (2 * this.camera.right) / this.size;
    const texelY = (2 * this.camera.top) / this.size;
    const depthRange = this.camera.far - this.camera.near;
    uniforms.uTsParams.value.set(
      strength,
      1 / this.size,
      // Bias in light-space texels of height (the shader scales it by slope).
      ((block.depthBiasTexels ?? 1.5) * texelY) / depthRange,
      (block.normalOffsetTexels ?? 1.25) * texel,
    );
    uniforms.uTsLight.value.copy(this.light);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.scene.children = [];
  }
}
const _color = new Color();
const _shift = new Matrix4();
function dist2(mesh, P) {
  const e = mesh.matrixWorld.elements;
  return (e[12] - P.x) ** 2 + (e[14] - P.z) ** 2;
}

// ---------------------------------------------------------------------------
// Touch devices: the CPU horizon map.
// ---------------------------------------------------------------------------

/**
 * Lit factor (0..1) of a height-grid cell toward a light: march from the cell
 * along the light's horizontal direction; a ridge that rises above the ray by
 * more than `softM` shadows fully, a grazing one partially. Pure (node-gated).
 * heights: Float32Array n*n (NaN = unknown, never an occluder), metres;
 * cellS: cell size in scene units; tanEl: rise of the ray per scene unit;
 * dir: unit horizontal direction toward the light in grid axes (x = i, z = j).
 */
export function marchLit(heights, n, i, j, dirX, dirZ, cellS, tanEl, softM, maxH) {
  const h0 = heights[j * n + i];
  if (!Number.isFinite(h0)) return 1;
  let lit = 1;
  const step = 0.75;
  for (let s = step; ; s += step) {
    const x = i + dirX * s, z = j + dirZ * s;
    if (x < 0 || z < 0 || x > n - 1 || z > n - 1) break;
    const rise = s * cellS * tanEl;
    if (h0 + rise - maxH > softM) break; // nothing higher can rise above the ray
    const h = bilinear(heights, n, x, z);
    if (!Number.isFinite(h)) continue;
    const margin = h0 + rise - h; // >= 0: the ray clears the terrain
    const t = Math.min(1, Math.max(0, 1 + margin / softM));
    if (t < lit) lit = t;
    if (lit <= 0) break;
  }
  return lit;
}

function bilinear(h, n, x, z) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const i1 = Math.min(n - 1, i + 1), j1 = Math.min(n - 1, j + 1);
  const a = h[j * n + i], b = h[j * n + i1], c = h[j1 * n + i], d = h[j1 * n + i1];
  if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) {
    // Partially known neighbourhood: the nearest known corner, else unknown.
    const near = fx < 0.5 ? (fz < 0.5 ? a : c) : fz < 0.5 ? b : d;
    return near;
  }
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

const _abs = new Vector3();

export class HorizonShadowMap {
  constructor(n) {
    this.n = n;
    this.heights = new Float32Array(n * n).fill(NaN);
    this.lit = new Uint8Array(n * n).fill(255);
    this.next = new Uint8Array(n * n).fill(255);
    this.texture = new DataTexture(this.lit, n, n, RedFormat, UnsignedByteType);
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.name = 'terrain-horizon-map';
    this.texture.needsUpdate = true;
    this.origin = new Vector2(NaN, NaN); // abs x/z of the grid's (0,0) corner
    this.cellS = 1;
    // Where the uploaded lit texture lies (the grid at its march's start).
    this.litOrigin = new Vector2();
    this.litCell = 1;
    this.marchOrigin = new Vector2();
    this.marchCell = 1;
    this.query = null;
    this.queryMap = null;
    this.cursor = 0; // next cell to sample
    this.pass = 0; // cells visited in the current sampling pass
    this.nextPassAt = 0; // when the next pass starts once this one is done
    this.resampling = false; // this pass re-samples known cells too
    this.resampleNext = false;
    this.march = -1; // next row to march (-1 idle)
    this.light = new Vector3(0, 1, 0);
    this.lastMarchAt = -Infinity;
    this.epoch = null;
    this.valid = false;
    this.stats = { sampled: 0, queries: 0, marches: 0, ms: 0, cellM: 0 };
  }

  /** Recentre on `abs` (x/z), keeping every sample the old grid shares. */
  recenter(absX, absZ, cellS) {
    const n = this.n;
    const ox = Math.round(absX / cellS - n / 2) * cellS, oz = Math.round(absZ / cellS - n / 2) * cellS;
    if (cellS === this.cellS && ox === this.origin.x && oz === this.origin.y) return false;
    // Hysteresis: keep the grid until the aircraft is n/8 cells off centre, so
    // a march is not thrown away every cell crossing in flight.
    if (cellS === this.cellS && Number.isFinite(this.origin.x)
      && Math.abs(ox - this.origin.x) < (n / 8) * cellS && Math.abs(oz - this.origin.y) < (n / 8) * cellS) return false;
    const old = this.heights, fresh = new Float32Array(n * n).fill(NaN);
    if (cellS === this.cellS && Number.isFinite(this.origin.x)) {
      const di = Math.round((ox - this.origin.x) / cellS), dj = Math.round((oz - this.origin.y) / cellS);
      for (let j = 0; j < n; j++) {
        const sj = j + dj;
        if (sj < 0 || sj >= n) continue;
        for (let i = 0; i < n; i++) {
          const si = i + di;
          if (si >= 0 && si < n) fresh[j * n + i] = old[sj * n + si];
        }
      }
    }
    this.heights = fresh;
    this.origin.set(ox, oz);
    this.cellS = cellS;
    this.cursor = 0;
    this.pass = 0;
    this.resampling = false;
    return true;
  }

  /**
   * Spend at most `budgetMs` sampling unknown cells and marching rows.
   * ctx: { engine, player (abs), anchor, L (scene), k, rangeM, hz, now, epoch, block }.
   */
  update(ctx) {
    const { engine, L, k, rangeM, hz, now, epoch, block } = ctx;
    const t0 = performance.now(), budget = block.horizonBudgetMs ?? 0.3, n = this.n;
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.heights.fill(NaN);
      this.origin.set(NaN, NaN);
      this.valid = false;
      this.march = -1;
    }
    // The cell follows the mercator scale only past 2%: k drifts every frame
    // in north-south flight, and a new cell size discards every sample.
    let cellS = (2 * rangeM * k) / n;
    if (Number.isFinite(this.origin.x) && Math.abs(cellS - this.cellS) < this.cellS * 0.02) cellS = this.cellS;
    if (this.recenter(ctx.player.x, ctx.player.z, cellS)) {
      this.march = -1;
      this.lastMarchAt = -Infinity; // march the moved grid at once
    }
    const map = engine?.map;
    if (ctx.sampler) this.query = ctx.sampler; // node gate seam: { sample(lon, lat) }
    else if (map && this.queryMap !== map) {
      this.query = new TerrainGroundQuery(map);
      this.queryMap = map;
    }
    // 1. Sample cells (rendered terrain, exact triangles): unknown cells
    // first; every `resampleSec` one full pass again, as finer tiles land.
    let queries = 0;
    if (this.pass >= n * n && now >= this.nextPassAt) {
      this.pass = 0;
      this.resampling = this.resampleNext;
    }
    if (this.query && engine.worldToGeo && this.pass < n * n) {
      while (this.pass < n * n && performance.now() - t0 < budget) {
        const idx = this.cursor;
        this.cursor = (idx + 1) % (n * n);
        this.pass++;
        if (!this.resampling && Number.isFinite(this.heights[idx])) continue;
        const i = idx % n, j = (idx / n) | 0;
        _abs.set(this.origin.x + (i + 0.5) * cellS, 0, this.origin.y + (j + 0.5) * cellS);
        const geo = engine.worldToGeo(_abs);
        const s = geo ? this.query.sample(geo.x, geo.y) : null;
        queries++;
        if (s && Number.isFinite(s.elev)) this.heights[idx] = s.elev;
      }
      if (this.pass >= n * n) {
        // Pass done: unknown cells (tiles not loaded yet) get another pass in
        // a second; a complete grid is re-sampled every few seconds, since a
        // coarse tile may have answered first.
        const unknown = this.heights.some((h) => !Number.isFinite(h));
        this.resampleNext = !unknown;
        this.nextPassAt = now + (unknown ? 1 : (block.horizonResampleSec ?? 8));
      }
    }
    // 2. March toward the light at <= hz (or at once on a light jump).
    const jump = this.light.angleTo(L) > 0.0044; // ~0.25 deg
    if (this.march < 0 && (jump || now - this.lastMarchAt >= 1 / Math.max(0.1, hz))) {
      this.march = 0;
      this.light.copy(L);
      this.lastMarchAt = now;
      this.marchOrigin.copy(this.origin);
      this.marchCell = this.cellS;
    }
    if (this.march >= 0) {
      const lxz = Math.hypot(this.light.x, this.light.z);
      const tanEl = lxz > 1e-6 ? this.light.y / lxz : 1e6;
      const dx = lxz > 1e-6 ? this.light.x / lxz : 0, dz = lxz > 1e-6 ? this.light.z / lxz : 0;
      let maxH = -Infinity;
      for (const h of this.heights) if (h > maxH) maxH = h;
      const soft = block.horizonSoftM ?? 30;
      while (this.march < n && performance.now() - t0 < budget) {
        const j = this.march++;
        for (let i = 0; i < n; i++) this.next[j * n + i] = Math.round(255 * marchLit(this.heights, n, i, j, dx, dz, cellS, tanEl, soft, maxH));
      }
      if (this.march >= n) {
        this.lit.set(this.next);
        this.litOrigin.copy(this.marchOrigin);
        this.litCell = this.marchCell;
        this.texture.needsUpdate = true;
        this.march = -1;
        this.valid = true;
        this.stats.marches++;
      }
    }
    let sampled = 0;
    for (const h of this.heights) if (Number.isFinite(h)) sampled++;
    Object.assign(this.stats, { sampled, queries: this.stats.queries + queries, ms: performance.now() - t0, cellM: cellS / k });
    return this.valid;
  }

  bind(uniforms, anchorNow, strength) {
    const n = this.n, size = n * this.litCell;
    const x0 = this.litOrigin.x - anchorNow.x, z0 = this.litOrigin.y - anchorNow.z;
    uniforms.uTsMatrix.value.set(
      1 / size, 0, 0, -x0 / size,
      0, 0, 1 / size, -z0 / size,
      0, 0, 0, 0,
      0, 0, 0, 1,
    );
    uniforms.uTsMap.value = this.texture;
    uniforms.uTsParams.value.set(strength, 1 / n, 0, 0);
    uniforms.uTsLight.value.copy(this.light);
  }

  dispose() {
    this.texture.dispose();
    this.query = null;
  }
}

/** Reset the receiver to "no shadow" (rig unmount, flag off at runtime). */
export function clearTerrainShadowUniforms() {
  TERRAIN_SHADOW_UNIFORMS.uTsParams.value.x = 0;
  TERRAIN_SHADOW_UNIFORMS.uTsMap.value = WHITE;
}

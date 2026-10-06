/**
 * TRUE EARTH Phase 1 — TRUE_SCALE: true proportions through an anisotropic
 * camera.
 *
 * THE DEFECT. Scene X/Z are Web-Mercator units (true metres × k, k =
 * 1/cos(lat)) and Y is metres (lib/fly/render-scale.js). Rendered as-is,
 * everything is squashed vertically by cos(lat) — terrain relief, buildings,
 * and (through projectModelMatrix) the aircraft.
 *
 * THE FIX. Fold S = diag(1, k0, 1) into the camera ONLY. Its world matrix
 * becomes T(p)·S⁻¹·R′, where p is the rig's position (unchanged) and R′ is the
 * rig's orientation mapped into the true-proportioned frame (forward′ =
 * normalize(S·forward), roll kept). The view matrix R′ᵀ·S·T(−p) then renders
 * scene-unit geometry with true proportions, while everything that reads the
 * scene in its own units is untouched: physics, AGL, collision, three-tile LOD
 * and culling (frustum planes come from P·V in scene space), Raycaster,
 * Vector3.project, CSM fitting (corners unproject through matrixWorld) and the
 * HUD. One k0 per frame for the whole view, so no seams between tiles.
 * Flag off: nothing is installed, no shader text changes.
 *
 * THE THREE FRAMES a shader must keep apart once S is in the view:
 *  - SCENE: positions and normals as stored (Mercator X/Z, metre Y);
 *  - TRUE: what the eye sees — S-space, a uniform k0 scale of the real world,
 *    so its directions are real directions. Sun, moon, key light and every sky
 *    lookup live here;
 *  - VIEW: TRUE rotated into camera axes (view space is an isometry of TRUE).
 * Scene direction d → TRUE: normalize(S·d) (y × k0). Scene normal n → TRUE:
 * normalize(S⁻¹·n) (y ÷ k0). TRUE direction → scene: toSceneDir (y ÷ k0).
 *
 * ALL OR NOTHING. The feature is ready only if three's env-map chunks patch
 * cleanly (a three upgrade that moves an anchor turns the whole feature off,
 * visibly in the device report), and every app shader edit below is anchored
 * and falls back to its untouched text on a miss (TRUE_SCALE_SHADERS).
 */
import { Matrix4, ShaderChunk, Vector3 } from 'three';
import { pinned } from './fly-pins.js';
import { TRUE_SCALE } from './fly-constants.js';

/** The resolved TRUE_SCALE block (URL / console pins applied once, at load). */
export const TRUE_SCALE_ACTIVE = pinned(TRUE_SCALE, '__flyTrueScaleOverride');
const FLAG_ON = TRUE_SCALE_ACTIVE.enabled === true;

/*
 * three's environment lookups go back from view space to world space with
 * transpose(viewMatrix), which "assumes the upper 3x3 is orthogonal". Under S
 * it is R′ᵀ·S, so a view-space (TRUE) direction d comes back as S·R′·d: the
 * reflection and irradiance lookups would read the sky k0 times too steep.
 * The TRUE world direction is R′·d = S⁻¹·(that). The shadow-bias normal in
 * shadowmap_vertex is deliberately NOT patched: it offsets a SCENE position,
 * and transpose(viewMatrix) returns exactly the scene normal there.
 *
 * The helpers also serve the app's own shaders (any material that includes
 * <common>): k0 is recovered from the view matrix — its Y column has length k0
 * — so no new uniform exists anywhere.
 */
const ENV_HELPERS = `
vec3 tsTrueNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	vec3 w = ( vec4( normal, 0.0 ) * viewMatrix ).xyz;
	return normalize( vec3( w.x, w.y / length( viewMatrix[ 1 ].xyz ), w.z ) );
}
vec3 tsTrueRayFromScene( in vec3 sceneDir, in mat4 viewMatrix ) {
	return normalize( vec3( sceneDir.x, sceneDir.y * length( viewMatrix[ 1 ].xyz ), sceneDir.z ) );
}
vec3 tsSceneNormalToView( in vec3 n, in mat4 viewMatrix ) {
	float k = length( viewMatrix[ 1 ].xyz );
	return normalize( mat3( viewMatrix ) * vec3( n.x, n.y / ( k * k ), n.z ) );
}
`;
const COMMON_ANCHOR = 'bool isPerspectiveMatrix( mat4 m ) {';
const ENV_EDITS = [
  ['envmap_physical_pars_fragment', 'vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );', 'vec3 worldNormal = tsTrueNormalByInverseViewMatrix( normal, viewMatrix );'],
  ['envmap_physical_pars_fragment', 'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );', 'reflectVec = tsTrueNormalByInverseViewMatrix( reflectVec, viewMatrix );'],
  ['envmap_fragment', 'vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );', 'vec3 worldNormal = tsTrueNormalByInverseViewMatrix( normal, viewMatrix );'],
  ['envmap_fragment', 'cameraToFrag = normalize( vWorldPosition - cameraPosition );', 'cameraToFrag = tsTrueRayFromScene( vWorldPosition - cameraPosition, viewMatrix );'],
  ['envmap_vertex', 'vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );', 'vec3 worldNormal = tsTrueNormalByInverseViewMatrix( transformedNormal, viewMatrix );'],
  ['envmap_vertex', 'cameraToVertex = normalize( worldPosition.xyz - cameraPosition );', 'cameraToVertex = tsTrueRayFromScene( worldPosition.xyz - cameraPosition, viewMatrix );'],
  ['lights_pars_begin', 'vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );', 'vec3 worldNormal = tsTrueNormalByInverseViewMatrix( normal, viewMatrix );'],
];

/**
 * Patch three's ShaderChunk text for TRUE_SCALE. All-or-nothing: every anchor
 * is checked before anything is written, so a three upgrade that moves one
 * leaves every chunk untouched and the status names the miss. Pure over the
 * `chunks` object it is given (the gate passes a copy).
 */
export function patchEnvChunks(chunks) {
  if (typeof chunks.common !== 'string' || !chunks.common.includes(COMMON_ANCHOR)) return 'miss:common';
  if (chunks.common.includes('tsTrueNormalByInverseViewMatrix')) return 'already';
  const next = {};
  for (const [name, from, to] of ENV_EDITS) {
    const text = next[name] ?? chunks[name];
    if (typeof text !== 'string' || text.split(from).length !== 2) return `miss:${name}`;
    next[name] = text.replace(from, to);
  }
  chunks.common = chunks.common.replace(COMMON_ANCHOR, `${ENV_HELPERS}\n${COMMON_ANCHOR}`);
  Object.assign(chunks, next);
  return 'patched';
}

/** 'off' | 'patched' | 'already' | 'miss:<chunk>' — published in the device report. */
export const TRUE_SCALE_ENV_PATCH = FLAG_ON ? patchEnvChunks(ShaderChunk) : 'off';
const READY = FLAG_ON && (TRUE_SCALE_ENV_PATCH === 'patched' || TRUE_SCALE_ENV_PATCH === 'already');

/** The flag is on AND three's chunks took the patch. Everything keys off this. */
export function trueScaleOn() {
  return READY;
}

/** Per-shader edit status, `name -> 'patched' | 'miss:<n>'`, for the device report. */
export const TRUE_SCALE_SHADERS = {};

/**
 * Anchored text edits for an app shader, all-or-nothing. Each edit is
 * `[from, to]` (exactly one occurrence required), `[from, to, 'all']` (one or
 * more, every one replaced), `[from, to, 'optional']` (zero or one) or
 * `[from, to, 'any']` (zero or more). On any miss the ORIGINAL text is
 * returned and the miss recorded, so a drifted anchor costs the TRUE_SCALE
 * correction for that one shader, never a compile. Returns the input
 * untouched when the feature is off.
 */
export function trueScaleShader(name, src, edits) {
  if (!READY || typeof src !== 'string') return src;
  let out = src;
  for (let i = 0; i < edits.length; i++) {
    const [from, to, mode] = edits[i];
    const n = out.split(from).length - 1;
    const bad = mode === 'any' ? false : mode === 'optional' ? n > 1 : mode === 'all' ? n < 1 : n !== 1;
    if (bad) {
      TRUE_SCALE_SHADERS[name] = `miss:${i}`;
      return src;
    }
    if (n) out = out.split(from).join(to);
  }
  TRUE_SCALE_SHADERS[name] = 'patched';
  return out;
}

let k0 = 1;
/** Set the frame's vertical correction (k at the camera latitude). Ignored when off. */
export function setTrueScaleK(k) {
  k0 = READY && Number.isFinite(k) && k > 0 ? k : 1;
}
export function getTrueScaleK() {
  return k0;
}

// Read-only status for the owner's console and the fixture probe; only when
// the feature is live, so flag-off pages carry no new global.
if (READY && typeof window !== 'undefined') {
  window.__flyTrueScale = {
    envPatch: TRUE_SCALE_ENV_PATCH,
    shaders: TRUE_SCALE_SHADERS,
    get k0() {
      return k0;
    },
  };
}

const _f = new Vector3();
const _u = new Vector3();
const _r = new Vector3();
const _basis = new Matrix4();

/**
 * matrixWorld = T(p)·S⁻¹·R′ for a camera with no transformed parent, from its
 * local position/quaternion (what every rig writes). Pure: tests call it.
 */
export function composeTrueScaleMatrix(position, quaternion, k, out) {
  _f.set(0, 0, -1).applyQuaternion(quaternion);
  _u.set(0, 1, 0).applyQuaternion(quaternion);
  _f.y *= k;
  _f.normalize();
  _u.y *= k;
  _r.crossVectors(_f, _u).normalize();
  _u.crossVectors(_r, _f).normalize();
  _basis.makeBasis(_r, _u, _f.negate());
  const e = _basis.elements;
  // S⁻¹ scales the Y ROW of the linear part (columns 0..2, element 1/5/9).
  e[1] /= k;
  e[5] /= k;
  e[9] /= k;
  out.copy(_basis);
  out.elements[12] = position.x;
  out.elements[13] = position.y;
  out.elements[14] = position.z;
  return out;
}

/**
 * Make a camera render with true proportions. Wraps updateMatrixWorld and
 * updateWorldMatrix so the renderer's own per-render update, and every rig's
 * explicit update, compose the anisotropic matrix. No-op when the flag is off.
 */
export function installTrueScaleCamera(camera) {
  if (!READY || !camera || camera.__trueScale) return false;
  const apply = (cam) => {
    if (k0 === 1) return; // identical to three's own matrix
    if (cam.parent && !cam.parent.isScene) return; // only parentless (or scene-root) cameras
    composeTrueScaleMatrix(cam.position, cam.quaternion, k0, cam.matrixWorld);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    for (const child of cam.children) child.updateMatrixWorld(true);
  };
  const updateMatrixWorld = camera.updateMatrixWorld;
  camera.updateMatrixWorld = function trueScaleUpdateMatrixWorld(force) {
    updateMatrixWorld.call(this, force);
    apply(this);
  };
  const updateWorldMatrix = camera.updateWorldMatrix;
  camera.updateWorldMatrix = function trueScaleUpdateWorldMatrix(updateParents, updateChildren) {
    updateWorldMatrix.call(this, updateParents, updateChildren);
    apply(this);
  };
  camera.__trueScale = true;
  return true;
}

/**
 * A direction authored in TRUE space (sun, moon, key light) as the scene-space
 * direction that renders there: normalize(S⁻¹·d). Returns `out` set to the
 * input UNCHANGED when k0 is 1, so flag-off is bit-identical.
 */
export function toSceneDir(d, out = new Vector3()) {
  out.copy(d);
  if (k0 === 1) return out;
  out.y /= k0;
  return out.normalize();
}

/**
 * A camera-facing billboard under the anisotropic view. Copying the camera
 * QUATERNION (the rig's rigid scene-space pose) renders sheared once S is in
 * the view; the camera's own world basis S⁻¹·R′ (the linear part of its
 * matrixWorld) renders square and screen-aligned. Writes `matrix` and returns
 * true; returns false and writes nothing when k0 is 1, so callers keep their
 * quaternion path and flag-off output is untouched. The camera's matrixWorld
 * must be this frame's (call camera.updateMatrixWorld() first).
 */
export function faceCameraInto(matrix, camera, position, sx, sy = sx, sz = sx) {
  if (k0 === 1) return false;
  const c = camera.matrixWorld.elements;
  const e = matrix.elements;
  e[0] = c[0] * sx; e[1] = c[1] * sx; e[2] = c[2] * sx; e[3] = 0;
  e[4] = c[4] * sy; e[5] = c[5] * sy; e[6] = c[6] * sy; e[7] = 0;
  e[8] = c[8] * sz; e[9] = c[9] * sz; e[10] = c[10] * sz; e[11] = 0;
  e[12] = position.x; e[13] = position.y; e[14] = position.z; e[15] = 1;
  return true;
}

/**
 * The horizontal factor a METRE-authored object needs to render at true size
 * and proportion while the view carries S (render-scale.js's projectModelMatrix
 * convention: horizontal × k): `k` — the object's own Mercator scale, default
 * k0 — and EXACTLY 1 at k0 = 1, so callers multiply unconditionally and
 * flag-off output is bit-identical (x * 1 === x).
 */
export function trueHorizontalK(k = k0) {
  return k0 === 1 ? 1 : k;
}

const _rv = new Vector3();
const _rt = new Vector3();
/**
 * The scene-space side vector of a camera-facing RIBBON under the anisotropic
 * view: the ribbon must face the eye in TRUE space, so the side is
 * normalize((S·view) × (S·tangent)) mapped back by S⁻¹ — a vector whose scene
 * length is NOT 1 (do not re-normalise it). `view` and `tangent` are scene
 * vectors, the cross order is the caller's (view × tangent). Returns false and
 * writes nothing at k0 = 1, so callers keep their own path bit for bit.
 */
export function ribbonSideInto(out, view, tangent) {
  if (k0 === 1) return false;
  _rv.set(view.x, view.y * k0, view.z);
  _rt.set(tangent.x, tangent.y * k0, tangent.z);
  out.crossVectors(_rv, _rt).normalize();
  out.y /= k0;
  return true;
}

/**
 * GLSL for full-screen passes, which have no viewMatrix: k0 from the camera's
 * WORLD matrix M = S⁻¹·R′ (M·Mᵀ = S⁻², so its Y ROW has length 1/k0), and the
 * TRUE direction of a SCENE ray. `row1` is the GLSL vec3 expression of M's Y
 * row, e.g. `vec3(cameraWorld[0][1],cameraWorld[1][1],cameraWorld[2][1])`.
 */
export function trueRayGLSL(row1, prefix = 'ts') {
  return `
float ${prefix}K(){return 1./length(${row1});}
vec3 ${prefix}TrueRay(vec3 r){return normalize(vec3(r.x,r.y*${prefix}K(),r.z));}
`;
}

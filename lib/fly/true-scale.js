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
 * k0 = 1 (flag off) is never installed at all.
 *
 * WHAT MUST STILL CONVERT (the plan's touchpoint list, TRUE_EARTH_PASS.md):
 * light directions authored in TRUE space go through toSceneDir(); world-space
 * shader directions that look up the sky go through the GLSL helpers; three's
 * env-map world-direction reconstruction is patched (it assumes an
 * orthonormal view matrix); camera-facing billboards use faceCameraBasis().
 */
import { Matrix4, ShaderChunk, Vector3 } from 'three';
import { pinned } from './fly-pins';
import { TRUE_SCALE } from './fly-constants';

/** The resolved TRUE_SCALE block (URL / console pins applied once, at load). */
export const TRUE_SCALE_ACTIVE = pinned(TRUE_SCALE, '__flyTrueScaleOverride');
export function trueScaleOn() {
  return TRUE_SCALE_ACTIVE.enabled === true;
}

let k0 = 1;
/** Set the frame's vertical correction (k at the camera latitude). Ignored when off. */
export function setTrueScaleK(k) {
  k0 = trueScaleOn() && Number.isFinite(k) && k > 0 ? k : 1;
}
export function getTrueScaleK() {
  return k0;
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
  if (!trueScaleOn() || !camera || camera.__trueScale) return false;
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
 * GLSL for scene materials (viewMatrix is in scope in both stages). k0 is
 * recovered from the view matrix — the Y column of R′ᵀ·S has length k0 — so
 * no new uniform. tsDir maps a SCENE-space direction (a difference of scene
 * positions) to the TRUE direction it renders as: normalize(S·d). tsNormal
 * maps a SCENE-space normal to the TRUE normal: normalize(S⁻¹·n).
 */
export const TRUE_SCALE_GLSL = `
float tsK(){return length(viewMatrix[1].xyz);}
vec3 tsDir(vec3 d){return normalize(vec3(d.x,d.y*tsK(),d.z));}
vec3 tsNormal(vec3 n){return normalize(vec3(n.x,n.y/tsK(),n.z));}
`;

/*
 * three's environment lookups go back from view space to world space with
 * transpose(viewMatrix), which "assumes the upper 3x3 is orthogonal". Under S
 * it is R′ᵀ·S, so a view-space (TRUE) direction d comes back as S·R′·d: the
 * reflection and irradiance lookups would read the sky k0 times too steep.
 * The TRUE world direction is R′·d = S⁻¹·(that). The shadow-bias normal in
 * shadowmap_vertex is deliberately NOT patched: it offsets a SCENE position,
 * and transpose(viewMatrix) returns exactly the scene normal there.
 */
const ENV_HELPERS = `
vec3 tsTrueNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	vec3 w = ( vec4( normal, 0.0 ) * viewMatrix ).xyz;
	return normalize( vec3( w.x, w.y / length( viewMatrix[ 1 ].xyz ), w.z ) );
}
vec3 tsTrueRayFromScene( in vec3 sceneDir, in mat4 viewMatrix ) {
	return normalize( vec3( sceneDir.x, sceneDir.y * length( viewMatrix[ 1 ].xyz ), sceneDir.z ) );
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
export const TRUE_SCALE_ENV_PATCH = trueScaleOn() ? patchEnvChunks(ShaderChunk) : 'off';

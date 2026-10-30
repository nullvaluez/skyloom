// Legacy GLB / primitive contacts (notably fighters) use the same operator
// table and atlas as the detailed fleet. Dark glazing, tires and light lenses
// keep their baked colors. Paint is attached before the world-bend transform.
import { DynamicDrawUsage, InstancedBufferAttribute, Vector4 } from 'three';
import { buildPaletteData } from './fleet-material.js';
import { operatorLiveriesOn, retainOperatorResources, resolveTrackLivery, OPERATOR_VERT_DECL, OPERATOR_FRAG_DECL } from './operator-livery-render.js';

const PALETTE_CLASS = ['civil', 'ga', 'ga', 'heli', 'military', 'civil', 'ga', 'military', null, 'military', 'military', 'military', 'civil'];
function insert(source, anchor, code) {
  if (!source.includes(anchor)) throw Error(`operator paint: missing shader anchor ${anchor}`);
  return source.replace(anchor, `${anchor}\n${code}`);
}

export function createTrafficOperatorPaint() {
  return operatorLiveriesOn() ? retainOperatorResources(buildPaletteData()) : null;
}

/** Bind again after an asynchronous GLB replaces the primitive geometry. */
export function bindTrafficOperatorGeometry(mesh) {
  const livery = mesh.userData.operatorAttribute;
  if (!livery) return;
  mesh.geometry.setAttribute('aFleetLivery', livery);
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const length = Math.max(0.01, box.max.z - box.min.z), span = Math.max(0.01, box.max.x - box.min.x);
  mesh.userData.operatorBounds.value.set(box.min.z, length, box.max.y, span);
  // GLBs are centered on their whole bounding box (including the fin), not
  // on the fuselage. Measure the narrow mid-body before placing its titles.
  const p = mesh.geometry.attributes.position, glow = mesh.geometry.attributes.aEmissive;
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const s = (p.getZ(i) - box.min.z) / length;
    if (s < .35 || s > .62 || Math.abs(p.getX(i)) > span * .10 || (glow && glow.getX(i) + glow.getY(i) + glow.getZ(i) > .01)) continue;
    low = Math.min(low, p.getY(i)); high = Math.max(high, p.getY(i));
  }
  if (!(high > low)) { low = box.min.y; high = box.min.y + (box.max.y - box.min.y) * .5; }
  const radius = Math.max(.04, (high - low) / 2), center = (high + low) / 2;
  mesh.userData.operatorHull.value.set(center, radius, high, 0);
  mesh.userData.operatorTitle.value.set(.17, .54, center - radius * .15, radius * .85);
  let front = Infinity, back = -Infinity, top = high;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) < box.min.z + length * .62 || p.getY(i) < high + radius * .15 || (glow && glow.getX(i) + glow.getY(i) + glow.getZ(i) > .01)) continue;
    front = Math.min(front, p.getZ(i)); back = Math.max(back, p.getZ(i)); top = Math.max(top, p.getY(i));
  }
  if (!(back > front)) { front = box.min.z + length * .68; back = box.max.z; top = box.max.y; }
  const markW = Math.max(.1, (back - front) * .65);
  mesh.userData.operatorFin.value.set((front + back) / 2, (high + top) / 2, markW, markW * 76 / 124);
}

export function attachTrafficOperatorPaint(mesh, archetype, resources, capacity) {
  if (!resources || PALETTE_CLASS[archetype] == null) return;
  const m = mesh.material;
  const attr = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  const bounds = { value: new Vector4() };
  mesh.userData.operatorAttribute = attr;
  mesh.userData.operatorBounds = bounds;
  mesh.userData.operatorHull = { value: new Vector4() };
  mesh.userData.operatorTitle = { value: new Vector4() };
  mesh.userData.operatorFin = { value: new Vector4() };
  mesh.userData.operatorClass = PALETTE_CLASS[archetype];
  bindTrafficOperatorGeometry(mesh);
  const before = m.onBeforeCompile, key = m.customProgramCacheKey();
  mesh.userData.operatorRestore = { before, key: m.customProgramCacheKey };
  m.onBeforeCompile = (shader, renderer) => {
    before?.(shader, renderer);
    shader.uniforms.uFleetOperatorMarks = { value: resources.markings };
    shader.uniforms.uOperatorPalette = { value: resources.palette };
    shader.uniforms.uOperatorBounds = bounds;
    shader.uniforms.uOperatorHull = mesh.userData.operatorHull;
    shader.uniforms.uFleetTitleBox = mesh.userData.operatorTitle;
    shader.uniforms.uFleetFinBox = mesh.userData.operatorFin;
    shader.vertexShader = insert(shader.vertexShader, '#include <common>', `${OPERATOR_VERT_DECL}
varying vec3 vOperatorLocal, vOperatorNormal, vOperatorSource, vOperatorTint;`);
    shader.vertexShader = insert(shader.vertexShader, '#include <begin_vertex>', `
vFleetLivery = aFleetLivery;
vOperatorLocal = position; vOperatorNormal = normal;
vOperatorSource = vec3(1.); vOperatorTint = vec3(1.);
#ifdef USE_COLOR
vOperatorSource = color;
#endif
#ifdef USE_INSTANCING_COLOR
vOperatorTint = instanceColor;
#endif`);
    shader.fragmentShader = insert(shader.fragmentShader, '#include <common>', `${OPERATOR_FRAG_DECL}
uniform sampler2D uOperatorPalette;
uniform vec4 uOperatorBounds;
uniform vec4 uOperatorHull;
varying vec3 vOperatorLocal, vOperatorNormal, vOperatorSource, vOperatorTint;`);
    shader.fragmentShader = insert(shader.fragmentShader, '#include <color_fragment>', /* glsl */ `
if (vFleetLivery > .5) {
  int row = 256 + int(vFleetLivery - .5);
  vec3 body = texelFetch(uOperatorPalette, ivec2(0, row), 0).rgb;
  vec3 belly = texelFetch(uOperatorPalette, ivec2(1, row), 0).rgb;
  vec3 fin = texelFetch(uOperatorPalette, ivec2(2, row), 0).rgb;
  float bellyStyle = texelFetch(uOperatorPalette, ivec2(7, row), 0).r;
  vec3 p = vOperatorLocal;
  float s = (p.z - uOperatorBounds.x) / uOperatorBounds.y;
  float y = (p.y - uOperatorHull.x) / uOperatorBounds.y;
  vec3 n = normalize(vOperatorNormal);
  float side = smoothstep(.35, .7, abs(n.x));
  float tail = smoothstep(.62, .70, s) * smoothstep(uOperatorHull.z, uOperatorHull.z + uOperatorHull.y * .25, p.y);
  float lower = bellyStyle > .1 ? 1. - smoothstep(-.02, -.01, y) : 0.;
  vec3 paint = mix(mix(body, belly, lower), fin, tail);
  vec2 titleUV = vec2((s - uFleetTitleBox.x) / (uFleetTitleBox.y - uFleetTitleBox.x), (p.y - uFleetTitleBox.z) / uFleetTitleBox.w);
  if (p.x > 0.) titleUV.x = 1. - titleUV.x;
  vec4 title = fleetOperatorMark(titleUV, false);
  paint = mix(paint, title.rgb, title.a * side * (1. - tail));
  vec2 tailUV = (p.zy - uFleetFinBox.xy) / uFleetFinBox.zw + .5;
  if (p.x > 0.) tailUV.x = 1. - tailUV.x;
  vec4 mark = fleetOperatorMark(tailUV, true);
  paint = mix(paint, mark.rgb, mark.a * side * tail);
  float lum = dot(vOperatorSource, vec3(.2126, .7152, .0722));
  // Baked hull paint can be dark blue. Preserve actual black cutouts,
  // emissive lenses and the cyan canopy without retaining old blue paint.
  float glass = step(.02, lum) * step(vOperatorSource.r * 1.25, vOperatorSource.g) * step(vOperatorSource.g * .9, vOperatorSource.b) * (1. - smoothstep(.44, .5, s)) * smoothstep(0., .015, y);
  float lens = step(.01, dot(vEmissive.rgb, vec3(1.)));
  float hull = smoothstep(.004, .025, lum) * (1. - glass) * (1. - lens);
  diffuseColor.rgb = mix(diffuseColor.rgb, paint * vOperatorTint, hull);
}`);
  };
  m.customProgramCacheKey = () => `${key}|operator-archetype-v1`;
  m.needsUpdate = true;
}

/** Paired with effect cleanup; StrictMode can acquire and bind again safely. */
export function detachTrafficOperatorPaint(mesh) {
  const restore = mesh.userData.operatorRestore;
  if (!restore) return;
  mesh.material.onBeforeCompile = restore.before;
  mesh.material.customProgramCacheKey = restore.key;
  mesh.geometry.deleteAttribute('aFleetLivery');
  delete mesh.userData.operatorAttribute;
  delete mesh.userData.operatorBounds;
  delete mesh.userData.operatorHull;
  delete mesh.userData.operatorTitle;
  delete mesh.userData.operatorFin;
  delete mesh.userData.operatorClass;
  delete mesh.userData.operatorRestore;
  mesh.material.needsUpdate = true;
}

export function writeTrafficOperatorPaint(mesh, track, slot, enabled = true) {
  const attr = mesh.userData.operatorAttribute;
  if (!attr) return;
  const scheme = enabled ? resolveTrackLivery(track, mesh.userData.operatorClass) : null;
  attr.setX(slot, scheme ? scheme.index + 1 : 0);
}

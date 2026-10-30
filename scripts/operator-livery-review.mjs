// Browser entry for review-operator-liveries.cjs. Uses production geometry and
// materials, with synthetic callsigns and studio light, not a live feed.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FLEET_FAMILIES, FAMILY_INDEX, airframeSpec } from '../lib/fly/fleet-types.js';
import { buildLiveAirframe } from '../lib/fly/live-aircraft-geometry.js';
import { createFleetMaterial, createFleetShared, createFleetDepthMaterial, paletteRow, RegistrationAtlas } from '../lib/fly/fleet-material.js';
import { liveryForAircraft, OPERATOR_LIVERIES } from '../lib/fly/operator-liveries.mjs';
import { buildArchetypeGeometries } from '../lib/fly/traffic-geometries.js';
import { loadTrafficGeometries } from '../lib/fly/model-loader.js';
import { createTrafficNavMaterial } from '../lib/fly/world-material-factories.js';
import { createTrafficOperatorPaint, attachTrafficOperatorPaint, bindTrafficOperatorGeometry, writeTrafficOperatorPaint } from '../lib/fly/traffic-operator-paint.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(1500, 1080);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
const environment = pmrem.fromScene(room); room.dispose(); pmrem.dispose();
const scene = new THREE.Scene(); scene.background = new THREE.Color('#c4d3de'); scene.environment = environment.texture;
scene.add(new THREE.HemisphereLight('#f7fbff', '#758695', 1.7));
const sun = new THREE.DirectionalLight('#fff1de', 2.7); sun.position.set(-30, 65, -40); scene.add(sun);
sun.castShadow = true; Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, far: 200 });
const camera = new THREE.PerspectiveCamera(33, 500 / 310, 0.1, 1000);
const atlas = new RegistrationAtlas(), shared = createFleetShared(atlas);
const models = [], owned = [];
function meshFor(id, callsign, lod = 'hero') {
  const f = FLEET_FAMILIES[FAMILY_INDEX[id]], built = buildLiveAirframe(f, lod);
  const spec = airframeSpec(f.index, { flight: callsign }, 'a00001');
  const material = createFleetMaterial(f, built.parts, shared, { far: lod === 'far' });
  const mesh = new THREE.InstancedMesh(built.hull, material, 1);
  mesh.geometry.setAttribute('aFleetA', new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0, 0.7]), 4));
  mesh.geometry.setAttribute('aFleetB', new THREE.InstancedBufferAttribute(new Float32Array([paletteRow(f.palette, spec.seed) + 256 * spec.variant, 42, 0, 0]), 4));
  const scheme = liveryForAircraft({ flight: callsign }, f.palette);
  mesh.geometry.setAttribute('aFleetLivery', new THREE.InstancedBufferAttribute(new Float32Array([scheme ? scheme.index + 1 : 0]), 1));
  mesh.setMatrixAt(0, new THREE.Matrix4()); mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  mesh.customDepthMaterial = createFleetDepthMaterial(material); mesh.castShadow = true;
  mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh); owned.push(mesh);
  return { mesh, length: f.length, callsign, scheme: scheme?.name ?? 'Neutral / unknown', id, lod };
}
for (const [id, callsign] of [['b737', 'DAL123'], ['b737', 'SWA123'], ['b737', 'UAL123'], ['b777', 'AAL123'], ['b767', 'FDX123'], ['b767', 'UPS123'], ['c17', 'RCH123'], ['c130', 'RRR123'], ['a320', 'ZZZ123']]) models.push(meshFor(id, callsign));
const info = { flag: !!shared.uFleetOperatorMarks, cards: [], compiled: [], errors: [], drawCalls: 0 };
const debug = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
info.renderer = debug ? renderer.getContext().getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
function renderOne(item, x, y, w, h, reverse = false) {
  for (const mesh of owned) mesh.visible = mesh === item.mesh;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const L = item.length;
  camera.position.set((reverse ? 1 : -1) * L * 1.45, L * .25, -L * .34); camera.lookAt(0, L * .015, 0);
  renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h); renderer.setScissorTest(true);
  renderer.render(scene, camera); info.drawCalls += renderer.info.render.calls;
}
window.review = { info, models, async run() {
  for (const f of FLEET_FAMILIES) for (const lod of ['hero', 'mid', 'far']) {
    const m = meshFor(f.id, f.palette === 'military' ? 'RCH123' : 'UAL123', lod);
    renderOne(m, 0, 0, 500, 310);
    info.compiled.push(`${f.id}:${lod}`);
  }
  // Baked military GLB, including geometry replacement and nav-light hooks.
  const paint = createTrafficOperatorPaint();
  const primitives = buildArchetypeGeometries();
  const legacy = new THREE.InstancedMesh(primitives[4], createTrafficNavMaterial(true), 1);
  legacy.setMatrixAt(0, new THREE.Matrix4()); legacy.setColorAt(0, new THREE.Color(1, 1, 1));
  attachTrafficOperatorPaint(legacy, 4, paint, 1);
  writeTrafficOperatorPaint(legacy, { meta: { flight: 'CNV123', iconType: 'military' } }, 0);
  scene.add(legacy); owned.push(legacy);
  renderOne({ mesh: legacy, length: 18 }, 0, 0, 500, 310);
  const loaded = await loadTrafficGeometries();
  if (!loaded[4]) throw Error('Military GLB failed to load');
  legacy.geometry = loaded[4]; bindTrafficOperatorGeometry(legacy);
  renderOne({ mesh: legacy, length: 18 }, 0, 0, 500, 310);
  info.compiled.push('military:primitive', 'military:glb');
  const sample = new Uint8Array(4);
  renderer.getContext().readPixels(250, 155, 1, 1, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, sample);
  info.sample = [...sample];
  window.review.legacy = { mesh: legacy, length: 18, callsign: 'CNV123', scheme: 'U.S. Navy / legacy fighter', id: 'military' };
  window.review.paint = paint;
  this.gallery(false);
  info.programs = renderer.info.programs.map(p => ({ name: p.name, runnable: p.diagnostics?.runnable !== false }));
  return info;
}, gallery(reverse = false) {
  document.querySelectorAll('.caption').forEach(el => el.remove());
  const hashes = [];
  models.forEach((item, i) => {
    const x = i % 3 * 500, y = 1080 - (Math.floor(i / 3) + 1) * 360;
    renderOne(item, x, y + 42, 500, 310, reverse);
    const gl = renderer.getContext(), pixels = new Uint8Array(500 * 310 * 4);
    gl.readPixels(x, y + 42, 500, 310, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    hashes.push(hash);
    const caption = document.createElement('div'); caption.className = 'caption';
    caption.style.cssText = `position:absolute;left:${x + 18}px;top:${1080 - y - 38}px;font:16px Arial;color:#20324a`;
    caption.textContent = `${item.callsign} · ${item.scheme} · ${item.id}`; document.body.appendChild(caption);
  });
  return { hashes, cards: models.map(({ callsign, scheme, id }) => ({ callsign, scheme, id })) };
}, single(index = 0, reverse = false, night = false) {
  document.querySelectorAll('.caption').forEach(el => el.remove());
  const item = index === 'military' ? this.legacy : models[index];
  shared.uFleetNight.value.set(night ? .7 : 0, night ? .8 : 0, night ? .3 : 0, 0);
  sun.intensity = night ? .12 : 2.7;
  renderOne(item, 0, 0, 1500, 1080, reverse);
  return { scheme: item.scheme, lod: item.lod };
}, catalog() { return OPERATOR_LIVERIES.map(s => ({ id: s.id, index: s.index })); } };
window.reviewReady = true;

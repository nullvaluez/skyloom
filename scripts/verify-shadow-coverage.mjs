import assert from 'node:assert/strict';
import { BufferGeometry, Mesh, MeshBasicMaterial, Object3D, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Sphere, Vector3 } from 'three';
import { createShadowCoverageState, resolveShadowFocus, selectShadowReceivers } from '../lib/fly/shadow-coverage.js';

let passed = 0;
function check(name, test) { test(); passed++; console.log(`PASS ${name}`); }
function view(x = 0, y = 80, z = 150, target = new Vector3(0, 0, -200)) {
  const camera = new PerspectiveCamera(65, 1.6, .1, 10000);
  camera.position.set(x, y, z); camera.lookAt(target); camera.updateMatrixWorld(true);
  return camera;
}
const geometry = new PlaneGeometry(1, 1); geometry.computeBoundingBox();
const material = new MeshBasicMaterial();
function tile(x, z, id, size = 10, geo = geometry) {
  const t = new Object3D();
  t.isTile = t.isLeaf = true; t.x = id; t.y = 0; t.z = 18;
  t.position.set(x, 0, z); t.rotation.x = -Math.PI / 2; t.scale.set(size, size, 1);
  t.model = new Mesh(geo, material); t.add(t.model); return t;
}
const focus = {}, camera = view();
const focusArgs = { playerX: 0, playerZ: 0, groundY: 0, camera, radiusM: 350 };
check('ground intersection points toward visible ground while reserving player coverage', () => {
  const value = resolveShadowFocus(focus, focusArgs);
  assert.equal(value, focus); assert(value.valid); assert(value.dz < 0);
  assert(Math.hypot(value.dx, value.dz) <= 350 * .6 + 1e-9);
  assert(350 - Math.hypot(value.dx, value.dz) >= 350 * .4 - 1e-9);
});
check('desired focus is rebase invariant and has no stale warp position', () => {
  const expected = { ...resolveShadowFocus(focus, focusArgs) };
  camera.position.add(new Vector3(20000, 0, -30000)); camera.updateMatrixWorld(true);
  resolveShadowFocus(focus, { ...focusArgs, playerX: 20000, playerZ: -30000 });
  assert(Math.abs(focus.dx - expected.dx) < 1e-8); assert(Math.abs(focus.dz - expected.dz) < 1e-8);
  const warp = view(100000, 500, 40000, new Vector3(100400, 0, 40000));
  resolveShadowFocus(focus, { ...focusArgs, playerX: 100000, playerZ: 40000, camera: warp });
  assert(focus.dx > 0); assert(Math.abs(focus.dz) < 1e-8); assert(Math.hypot(focus.dx, focus.dz) <= 210 + 1e-8);
});
check('skyward, below-ground and invalid camera inputs clear old focus', () => {
  for (const cam of [view(0, 100, 0, new Vector3(0, 200, -100)), view(0, -1, 0), null]) {
    resolveShadowFocus(focus, { ...focusArgs, camera: cam });
    assert.equal(focus.valid, false); assert.equal(focus.dx, 0); assert.equal(focus.dz, 0);
  }
});
check('grazing intersection retires continuously at the horizon', () => {
  const down = .0051, cam = view(0, 100, 0, new Vector3(0, 100 - down, -Math.sqrt(1 - down * down)));
  resolveShadowFocus(focus, { ...focusArgs, camera: cam });
  assert(Math.hypot(focus.dx, focus.dz) < .002);
  cam.lookAt(0, 100, -1); cam.updateMatrixWorld(true);
  resolveShadowFocus(focus, { ...focusArgs, camera: cam }); assert.equal(focus.valid, false);
});

const root = new Object3D(), near = [], far = [], behind = [];
for (let i = 0; i < 20; i++) {
  behind.push(tile((i - 10) * 3, 450, i));
  far.push(tile((i - 10) * 3, -350, i + 20));
  near.push(tile((i - 10) * 3, -100, i + 40));
}
root.add(...behind, ...far, ...near); root.updateMatrixWorld(true);
const state = createShadowCoverageState(), cam = view();
const options = { camera: cam, focusX: 0, focusZ: 0, radiusM: 500, padM: 200, maxTiles: 12 };
check('late visible nearest leaves displace earlier DFS entries without hiding census overflow', () => {
  const result = selectShadowReceivers(state, root, options);
  assert.equal(result, state); assert.equal(result.selected.length, 12);
  assert(result.selected.every(m => near.some(t => t.model === m)));
  assert.equal(result.census.eligible, 60); assert(result.census.visibleEligible > 12);
  assert.equal(result.census.visibleSelected, 12); assert.equal(result.census.capped, true);
});
check('selection and tie order are independent of scene traversal order', () => {
  const expected = [...state.selected]; root.children.reverse();
  selectShadowReceivers(state, root, options); assert.deepEqual(state.selected, expected);
});
check('receiver selection is invariant under a world rebase', () => {
  const expected = [...state.selected];
  root.position.set(20000, 0, -30000); root.updateMatrixWorld(true);
  cam.position.add(root.position); cam.updateMatrixWorld(true);
  selectShadowReceivers(state, root, { ...options, focusX: 20000, focusZ: -30000 });
  assert.deepEqual(state.selected, expected);
  root.position.set(0, 0, 0); root.updateMatrixWorld(true); cam.position.set(0, 80, 150); cam.updateMatrixWorld(true);
});
check('48 remains a hard cap and scratch candidate storage is reused', () => {
  selectShadowReceivers(state, root, { ...options, maxTiles: 500 });
  assert.equal(state.selected.length, 48); assert.equal(state.pool.length, 48);
  const pool = [...state.pool], selected = state.selected, box = state.box;
  for (let i = 0; i < 20; i++) selectShadowReceivers(state, root, { ...options, maxTiles: 48 });
  assert.deepEqual(state.pool, pool); assert.equal(state.selected, selected); assert.equal(state.box, box);
});
check('actual shadow footprint outranks a nearer tile in the padded fringe', () => {
  const r = new Object3D(), inside = tile(0, 0, 1), outside = tile(80, 0, 2);
  r.add(outside, inside); r.updateMatrixWorld(true);
  const camera = view(80, 200, 0, new Vector3(80, 0, 0)); camera.fov = 100; camera.updateProjectionMatrix();
  const light = new OrthographicCamera(-30, 30, 30, -30, 1, 400);
  light.position.set(0, 200, 0); light.lookAt(0, 0, 0); light.updateMatrixWorld(true);
  selectShadowReceivers(state, r, { camera, shadowCamera: light, focusX: 0, focusZ: 0, radiusM: 300, maxTiles: 1 });
  assert.equal(state.census.visibleEligible, 2); assert.equal(state.census.footprintEligible, 1);
  assert.equal(state.selected[0], inside.model);
});
check('reversed-depth view frusta select the same terrain as standard depth', () => {
  selectShadowReceivers(state, root, options); const expected = [...state.selected];
  cam._reversedDepth = true; cam.updateProjectionMatrix();
  selectShadowReceivers(state, root, { ...options, reversedDepth: true });
  assert.deepEqual(state.selected, expected);
  cam._reversedDepth = false; cam.updateProjectionMatrix();
});
check('visible census uses bent bounds rather than the unbent ground plane', () => {
  const r = new Object3D(), t = tile(0, -1000, 1); r.add(t); r.updateMatrixWorld(true);
  const camera = view(0, -900, -800, new Vector3(0, -1000, -1000));
  const opts = { camera, focusX: 0, focusZ: -1000, radiusM: 200, maxTiles: 1 };
  selectShadowReceivers(state, r, opts); assert.equal(state.census.visibleEligible, 0);
  selectShadowReceivers(state, r, { ...opts, bend: { cx: 0, cz: 0, k: .001 } });
  assert.equal(state.census.visibleEligible, 1);
});
check('height-heavy bounds cannot inflate normalized tile footprint or trigger vertex scans', () => {
  const r = new Object3D(), g = new BufferGeometry(); g.boundingSphere = new Sphere(new Vector3(0, 0, 100), 50);
  g.computeBoundingBox = g.computeBoundingSphere = () => { throw Error('unexpected geometry scan'); };
  const t = tile(800, 0, 1, 100, g); r.add(t); r.updateMatrixWorld(true);
  selectShadowReceivers(state, r, { ...options, radiusM: 100, padM: 0 });
  assert.equal(state.census.eligible, 0); g.dispose();
});
check('hidden subtrees and warp teardown leave no stale selection or candidate references', () => {
  selectShadowReceivers(state, root, options); assert(state.selected.length);
  root.visible = false; selectShadowReceivers(state, root, options);
  assert.equal(state.census.leaves, 0); assert.equal(state.selected.length, 0);
  assert(state.pool.every(row => row.model === null)); root.visible = true;
  selectShadowReceivers(state, null, options); assert.equal(state.census.selected, 0);
});
geometry.dispose(); material.dispose();
console.log(`shadow coverage: ${passed}/${passed} passed; GPU cost and appearance require browser validation`);

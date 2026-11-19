import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DoubleSide, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Raycaster, Vector2 } from 'three';
register('./_node-resolve.mjs', import.meta.url);
const { canopyCellInView, canopyViewChanged, captureCanopyView } = await import('../lib/fly/canopy-view.js');
const { planCanopy } = await import('../lib/fly/ground-canopy-select.js');
const { buildImmersiveFoliage } = await import('../lib/fly/immersive-foliage.js');
const { buildCanopySeasonAtlas } = await import('../lib/fly/ground-canopy-material.js');
const { canopyPhotoMean } = await import('../lib/fly/ground-canopy-photo.js');

const anchor = { x: 450000, z: -513000 };
const camera = new PerspectiveCamera(60, 1.6, 1, 10000);
let terrain = 0;
function view() {
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  return captureCanopyView(camera, anchor, .6, () => terrain);
}
const level = view();
assert.equal(canopyViewChanged(camera, anchor, level, 35), false);
assert.equal(canopyCellInView(level, anchor.x, anchor.z + 2000, 60), false);
assert.equal(canopyCellInView(level, anchor.x, anchor.z - 2000, 60), true);
camera.rotation.x = -Math.PI / 2;
const down = view();
assert.equal(canopyViewChanged(camera, anchor, level, 35), true);
for (let a = 0; a < 2 * Math.PI; a += .1) {
  assert.ok(canopyCellInView(down, anchor.x + 2000 * Math.sin(a), anchor.z + 2000 * Math.cos(a), 45));
}
// Every projection corner remains eligible at intermediate pitches and rolls.
for (const pitch of [-1.3, -.6, 0, .3]) for (const roll of [-1.1, 0, .9]) {
  camera.rotation.set(pitch, .45, roll);
  const v = view(), p = camera.projectionMatrix.elements, e = camera.matrixWorld.elements;
  for (const h of [-1, 1]) for (const k of [-1, 1]) {
    const dx = v.fx + h * e[0] / p[0] + k * e[4] / p[5];
    const dz = v.fz + h * e[2] / p[0] + k * e[6] / p[5];
    assert.ok(canopyCellInView(v, v.x + dx * 1800, v.z + dz * 1800, 0));
  }
}
const canopy = { l0: new Float32Array(4 * 5), l1: [0,0,12,12,0,0,4], l2: [0,0,12,12,0,0,1], l3: [0,0,12,12,0,0,1] };
const chunk = { cx: anchor.x, cz: anchor.z - 60, canopy };
function plan(v) {
  return planCanopy([chunk], anchor.x, anchor.z,
    { k: 1, d0: 480, d1: 1100, d2: 2000, d3: 3200, nearCap: 10, farCap: 10, view: v }, {}).next().value;
}
camera.rotation.set(0, 0, 0);
camera.position.y = 750;
assert.equal(plan(null).near, 4);
assert.equal(plan(view()).near, 0);
assert.equal(plan(view()).far, 1);
terrain = 700;
assert.equal(plan(view()).near, 4, 'keep crowns on the hillside next to the aircraft');
terrain = NaN;
assert.equal(plan(view()).near, 4, 'an unresolved height cannot demote nearby trees');
terrain = 0;
camera.fov = 24;
assert.equal(plan(view()).near, 4, 'telephoto resolves more detail at the same distance');

// Use the real leaves, UVs and cutout. Count leaf-covered rays across a
// fixed orthographic frame. Exclude the solid trunk from the measurement.
const { texture } = buildCanopySeasonAtlas();
const material = new MeshBasicMaterial({side: DoubleSide});
function coverage(aerial, elevation) {
  const g = buildImmersiveFoliage(1, aerial), mesh = new Mesh(g, material);
  assert.equal(g.index.count / 3, 34);
  const cam = new OrthographicCamera(-1.25, 1.25, 1.25, -1.25, .1, 10);
  cam.position.set(0, .65 + 3 * Math.sin(elevation), 3 * Math.cos(elevation)); cam.lookAt(0, .65, 0);
  cam.updateMatrixWorld();
  const ray = new Raycaster(), xy = new Vector2(), hits = [], image = texture.image;
  let covered = 0;
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
    hits.length = 0;
    ray.setFromCamera(xy.set((x+.5)/40-1, (y+.5)/40-1), cam);
    ray.intersectObject(mesh, false, hits);
    if (hits.some(({uv}) => uv.x < .5 && image.data[(Math.min(127,Math.floor(uv.y*128))*128 + Math.floor(uv.x*128))*4+1] > 107)) covered++;
  }
  g.dispose(); return covered;
}
const above = [coverage(false, Math.PI/2), coverage(true, Math.PI/2)];
const side = [coverage(false, 0), coverage(true, 0)];
assert.ok(above[0] === 0 && above[1] > 650);
assert.ok(side[1] > side[0] * .75);
texture.dispose(); material.dispose();

// Both photo paths agree with direct linear averaging, including clipped
// 3x3 and 5x5 windows at every corner and a patch the size of the photo.
const size = 32, img = { size, rgb: Uint8Array.from({length:size*size*3}, (_,i) => (i*31 + (i>>>4)*7) & 255) };
const sparse = canopyPhotoMean(img, 1), dense = canopyPhotoMean(img, Infinity);
const toLinear = b => Math.fround(b <= 10 ? b/255/12.92 : ((b/255+.055)/1.055)**2.4);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (const r of [1,2,32]) {
  const a = sparse(x,y,r), b = dense(x,y,r), total = [0,0,0]; let n = 0;
  for (let j = Math.max(0,y-r); j <= Math.min(size-1,y+r); j++) for (let i = Math.max(0,x-r); i <= Math.min(size-1,x+r); i++) {
    n++; for(let c=0;c<3;c++) total[c] += toLinear(img.rgb[(j*size+i)*3+c]);
  }
  for(let c=0;c<3;c++) {
    assert.ok(Math.abs(a[c]-total[c]/n) < 1e-12);
    assert.ok(Math.abs(b[c]-total[c]/n) < 1e-12);
  }
}
console.log('PASS aerial canopy, zoom, ridge, banking, overhead masks and canopy photo equivalence', {above,side});

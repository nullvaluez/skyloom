import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = pathToFileURL(path.join(root, specifier.slice(2))).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });
const THREE = await import('three');
const constants = await import('../lib/fly/fly-constants.js');
const { SatVegEngine } = await import('../lib/fly/toy-world/sat-veg-engine.js');
// Execute the actual placement function and its module-local helpers without
// mounting React or a renderer. Imports/JSX are outside these two source slices.
const source = readFileSync(path.join(root, 'components/fly/SatVegLayer.jsx'), 'utf8');
const helpers = source.slice(0, source.indexOf('export function SatVegLayer('))
  .replace(/^import[\s\S]*?;\r?\n/gm, '');
const placement = source.slice(source.indexOf('function placeCanopy('));
const context = vm.createContext({ ...THREE, ...constants,
  getRimColor: out => Object.assign(out, { r: .5, g: .6, b: .7 }) });
vm.runInContext(`${helpers}\n${placement}\nObject.assign(globalThis,{placeCanopy,canopyPlacementSignature});`, context);
assert.match(source, /\? canopyPlacementSignature\(sg, st\.altK, density, engine\.nearSupport\.active\)/);
assert.match(source, /sig !== st\.sig \|\| moved2 >= U\.staticSkipM \*\* 2 \|\| st\.born\.ramping/);

let passed = 0;
const check = (name, test) => { test(); passed++; console.log(`PASS ${name}`); };
const engine = new SatVegEngine({ groundAt: () => null, maxChunks: 1 });
const n = (constants.SAT_VEG.gridSegments + 1) ** 2;
const chunk = { key: 'fixture', state: 'ready', cx: 0, cz: 0, span: 100,
  veg: new Float32Array([0, 0, 5, 0]), cls: new Uint8Array([2]),
  grid: new Float32Array(n).fill(120), coarse: true, readyAt: 1 };
engine.chunks.set(chunk.key, chunk);
const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
const mesh = new THREE.InstancedMesh(geometry, material, 8);
mesh.boundingSphere = new THREE.Sphere();
const flight = { pos: new THREE.Vector3() }, byClass = new Uint32Array(8), matrix = new THREE.Matrix4();
const place = (born = null, now = 10) => context.placeCanopy(mesh, engine, flight, 1, 8, 8,
  byClass, null, mesh.count, true, born, now, false);
const sig = () => context.canopyPlacementSignature(engine.stats, 1, 1);
const y = () => { mesh.getMatrixAt(0, matrix); return matrix.elements[13]; };
const original = sig();
const request = { key: chunk.key, chunk, regrid: true, grid: new Float32Array(n).fill(273), gi: 0, miss: 0, coarse: 0 };

check('fixture places a real instance at its initial coarse support height', () => {
  assert.equal(place(), 1); assert.equal(y(), 120); assert.equal(mesh.visible, true);
});
check('heal request and incomplete sampling cannot consume the future commit revision', () => {
  engine._stat.heals++; chunk.healing = true; engine.pendingSample.push(request);
  engine._commitPending(12);
  assert.equal(engine.stats.supportRevision, 0); assert.equal(sig(), original);
  assert.equal(y(), 120); assert.equal(engine.groundAtLocal(chunk, 0, 0), 120);
});
check('completed repair invalidates unchanged counts and moves the existing instance onto healed ground', () => {
  const counts = ['chunks', 'ready', 'empty', 'vegPts', 'clsChunks'].map(key => engine.stats[key]);
  request.gi = n; engine._commitPending(14);
  assert.deepEqual(['chunks', 'ready', 'empty', 'vegPts', 'clsChunks'].map(key => engine.stats[key]), counts);
  assert.equal(engine.stats.supportRevision, 1); assert.notEqual(sig(), original);
  assert.equal(y(), 120, 'the old held placement remains buried until invalidated');
  assert.equal(place(), 1); assert.equal(y(), 273); assert.equal(chunk.readyAt, 1);
});
check('quiescent frames retain the signature without recurring replacement work', () => {
  const stable = sig(); engine._commitPending(16); engine._commitPending(18);
  assert.equal(sig(), stable); assert.equal(engine.stats.supportRevision, 1);
});
check('late completion of an evicted record cannot advance support revision', () => {
  const stale = { ...chunk, key: 'evicted' };
  engine.pendingSample.push({ ...request, key: stale.key, chunk: stale });
  engine._commitPending(20); assert.equal(engine.stats.supportRevision, 1);
});
check('birth ramps and density/altitude signature changes retain their prior behavior', () => {
  const born = { m: new Map(), ramping: false }, ramp = constants.SETTLE_CALM.births.rampSec;
  assert(ramp > 0); assert.equal(place(born, 30), 0); assert.equal(born.ramping, true);
  assert.equal(place(born, 30 + ramp), 1); assert.equal(born.ramping, false); assert.equal(y(), 273);
  assert.notEqual(context.canopyPlacementSignature(engine.stats, .5, 1), sig());
  assert.notEqual(context.canopyPlacementSignature(engine.stats, 1, .5), sig());
  assert.notEqual(context.canopyPlacementSignature(engine.stats, 1, 1, true), sig());
  engine._parked = true; assert.equal(engine.stats.supportRevision, 1); assert.equal(place(), 0);
  engine._parked = false; assert.equal(place(), 1);
});
geometry.dispose(); material.dispose(); mesh.dispose();
console.log(`canopy support: ${passed}/${passed} passed; this reproduces stale support, not the uninstrumented GPU disappearance`);

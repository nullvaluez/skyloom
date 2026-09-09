// Real vendor Tile/TileLoader, deterministic time, delayed in-memory transport.
// No browser/network; successful assertions certify lifecycle behavior only.
import assert from 'node:assert/strict';
import { Group, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Texture } from 'three';
let now = 1000;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
globalThis.ImageBitmap ??= class ImageBitmap {};
const { Tile, TileMesh, TileLoader, TileMapLoader, LoaderFactory, setFlyPatch, flyTileHoldStats } = await import('../lib/fly/vendor/three-tile/index.js');
const pending = [];
const originalFactory = LoaderFactory.getMaterialLoader;
LoaderFactory.getMaterialLoader = () => ({ load: params => new Promise((resolve, reject) => pending.push({ resolve, reject, params })) });
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
function trackedMaterial() {
  const material = new MeshBasicMaterial({ map: new Texture() });
  const receipt = { material: 0, texture: 0 };
  material.addEventListener('dispose', () => receipt.material++);
  material.map.addEventListener('dispose', () => receipt.texture++);
  return { material, receipt };
}
function fixture(mapLoader = false) {
  const source = { minLevel: 0 }, error = new MeshBasicMaterial();
  error.userData = { source, flyError: 1 };
  const tile = new Tile(mapLoader ? 77174 : 7, mapLoader ? 98570 : 8, 18), group = new Group();
  group.add(tile);
  tile._model = new TileMesh(new PlaneGeometry(1, 1), [error]);
  tile.add(tile._model); tile._loadState = 'loaded'; tile._loadedEpoch = 0;
  tile._sizeInWorld = 100;
  let hooks = 0;
  tile.addEventListener('tile-loaded', () => { hooks++; tile.model.material.forEach(m => { m.userData.testBendInstalled = true; }); });
  const loader = mapLoader ? new TileMapLoader() : new TileLoader();
  loader.maxThreads = 32; loader.imgSource = [source];
  if (!mapLoader) { loader._checkBounds = () => true; loader._materialClip = () => {}; }
  return { tile, group, loader, error, hooks: () => hooks };
}
async function arm(f) { await f.tile._retryErrorMaterial(f.loader); now = f.tile._rasterRetryAt; }
async function finish(promise, fail = false) {
  const value = trackedMaterial(), request = pending.shift();
  if (!request) throw Error('Expected delayed request');
  fail ? request.reject(Error('simulated raster 503')) : request.resolve(value.material);
  await promise;
  return value;
}
try {
  setFlyPatch({ rasterMark: false, lodBailFix: true });
  const off = fixture();
  await off.tile._retryErrorMaterial(off.loader); now += 60000;
  await off.tile._retryErrorMaterial(off.loader);
  check('red control: flag-off resident error remains without scheduling', () => {
    assert.equal(pending.length, 0); assert.equal(off.tile.model.material[0], off.error);
  });

  setFlyPatch({ rasterMark: true });
  const projected = fixture(true);
  await assert.rejects(() => projected.loader.updateMaterial(projected.tile, projected.tile.model, () => true), TypeError);
  check('red control: raw Tile bypassing map preprocessing throws in real bounds check', () => assert.equal(pending.length, 0));
  await arm(projected);
  const projectedRetry = projected.tile._retryErrorMaterial(projected.loader);
  check('runtime TileMapLoader retry supplies ordinary projected bounds', () => {
    assert.equal(pending.length, 1);
    const received = pending[0].params, expected = projected.loader._getTileCoords(projected.tile);
    for (const key of ['x', 'y', 'z', 'bounds', 'lonLatBounds']) assert.deepEqual(received[key], expected[key]);
  });
  const projectedMaterial = await finish(projectedRetry);
  check('runtime map-loader path replaces marker and runs hooks', () => {
    assert.equal(projected.tile.model.material[0], projectedMaterial.material);
    assert.equal(projected.hooks(), 1); assert.equal(projectedMaterial.material.userData.testBendInstalled, true);
  });
  const f = fixture(), originalGeometry = f.tile.model.geometry;
  const camera = new PerspectiveCamera(60, 1, .1, 1000);
  camera.position.z = 10; camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  f.group.updateMatrixWorld(true);
  f.tile.update({ camera, loader: f.loader, minLevel: 0, maxLevel: 18, LODThreshold: .86 });
  check('ordinary tree update arms the retry', () => assert.equal(f.tile._rasterRetryAt, now + 1000));
  now = f.tile._rasterRetryAt;
  let disposed = 0; f.error.addEventListener('dispose', () => disposed++);
  const fresh = await finish(f.tile._retryErrorMaterial(f.loader));
  check('material recovers without geometry/tree/epoch changes', () => {
    assert.equal(f.tile.model.material[0], fresh.material); assert.equal(disposed, 1);
    assert.equal(f.tile.model.geometry, originalGeometry); assert.equal(f.tile._loadedEpoch, 0); assert.equal(f.tile._epoch, 0);
    assert.equal(f.tile.model.parent, f.tile);
  });
  check('normal tile-loaded material hook runs before completion', () => {
    assert.equal(f.hooks(), 1); assert.equal(fresh.material.userData.testBendInstalled, true);
  });
  await f.tile._retryErrorMaterial(f.loader);
  check('healthy material does not re-request', () => assert.equal(pending.length, 0));
  const retry = f.tile._retryErrorMaterial;
  let cleanCalls = 0;
  f.tile._retryErrorMaterial = () => { cleanCalls++; };
  f.tile.update({ camera, loader: f.loader, minLevel: 0, maxLevel: 18, LODThreshold: .86 });
  check('healthy tree walk never calls the async retry method', () => assert.equal(cleanCalls, 0));
  f.tile._retryErrorMaterial = retry;

  const bad = fixture(); await arm(bad);
  await finish(bad.tile._retryErrorMaterial(bad.loader), true);
  check('failed retry retains marked resident material and 2s backoff', () => {
    assert.equal(bad.tile.model.material[0].userData.flyError, 1); assert.equal(bad.tile._rasterRetryAt, now + 2000);
  });
  await bad.tile._retryErrorMaterial(bad.loader);
  check('backoff blocks early requests', () => assert.equal(pending.length, 0));
  now = bad.tile._rasterRetryAt;
  await finish(bad.tile._retryErrorMaterial(bad.loader), true);
  check('second failure backs off 4s', () => assert.equal(bad.tile._rasterRetryAt, now + 4000));
  now = bad.tile._rasterRetryAt; bad.tile._rasterRetryAttempts = 8;
  await finish(bad.tile._retryErrorMaterial(bad.loader), true);
  check('backoff caps at 30s', () => assert.equal(bad.tile._rasterRetryAt, now + 30000));

  const fleet = [fixture(), fixture(), fixture()];
  for (const item of fleet) await arm(item);
  const a = fleet[0].tile._retryErrorMaterial(fleet[0].loader), b = fleet[1].tile._retryErrorMaterial(fleet[1].loader);
  await fleet[2].tile._retryErrorMaterial(fleet[2].loader);
  check('global retry concurrency is capped at two', () => { assert.equal(pending.length, 2); assert.equal(flyTileHoldStats().rasterRetryActive, 2); });
  await finish(a); await finish(b);
  await finish(fleet[2].tile._retryErrorMaterial(fleet[2].loader));
  check('capacity is released after completion', () => assert.equal(flyTileHoldStats().rasterRetryActive, 0));

  const removed = fixture(); await arm(removed);
  const late = removed.tile._retryErrorMaterial(removed.loader);
  removed.tile.unloadModel(); removed.tile.removeFromParent();
  const orphan = await finish(late);
  check('late results for destroyed tiles dispose material and texture', () => {
    assert.equal(removed.tile.model, undefined); assert.equal(removed.hooks(), 0);
    assert.equal(orphan.receipt.material, 1); assert.equal(orphan.receipt.texture, 1);
  });
  await removed.tile._retryErrorMaterial(removed.loader);
  check('destroyed tiles do not start new requests', () => assert.equal(pending.length, 0));

  const epoch = fixture(); await arm(epoch);
  const stale = epoch.tile._retryErrorMaterial(epoch.loader); epoch.tile._epoch++;
  const discarded = await finish(stale);
  check('epoch change rejects late imagery without replacing current material', () => {
    assert.equal(epoch.tile.model.material[0], epoch.error); assert.equal(discarded.receipt.material, 1); assert.equal(epoch.hooks(), 0);
  });
  const shared = fixture(), kept = trackedMaterial(), source2 = {};
  kept.material.userData.source = source2;
  shared.tile.model.material.unshift(kept.material); shared.loader.imgSource.unshift(source2);
  await arm(shared);
  const mixed = shared.tile._retryErrorMaterial(shared.loader); shared.tile._epoch++;
  const rejected = await finish(mixed);
  check('discard disposes only new materials, never reused healthy ones', () => {
    assert.equal(rejected.receipt.material, 1); assert.equal(kept.receipt.material, 0); assert.equal(kept.receipt.texture, 0);
  });
  const clipped = fixture(); await arm(clipped);
  clipped.loader._materialClip = () => { throw Error('simulated clipping exception'); };
  const leaked = await finish(clipped.tile._retryErrorMaterial(clipped.loader));
  check('post-load exception disposes staged resources and releases slot', () => {
    assert.equal(leaked.receipt.texture, 1); assert.equal(leaked.receipt.material, 1);
    assert.equal(clipped.tile.model.material[0], clipped.error); assert.equal(flyTileHoldStats().rasterRetryActive, 0);
  });
  console.log(`Raster resident retry: ${passed} checks PASS; no browser imagery claim.`);
} finally {
  LoaderFactory.getMaterialLoader = originalFactory;
}

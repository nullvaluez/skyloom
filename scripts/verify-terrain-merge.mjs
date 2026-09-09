// Delayed loaders exercise the real Tile/camera/LOD path, without network or GPU.
// This certifies lifecycle invariants only; moving-world pixels remain a browser gate.
import assert from 'node:assert/strict';
import { Group, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Texture } from 'three';
import { Tile, TileMesh, R24_SWITCHES, setFlyPatch, setLodFadeHook } from '../lib/fly/vendor/three-tile/index.js';
import { LOD_CROSSFADE } from '../lib/fly/fly-constants.js';
import { attachLodFade, lodFadeHook, lodStats, resetLodFades, tickLodFades } from '../lib/fly/lod-crossfade.js';

// TileMesh's browser disposal branch checks this constructor. No bitmap is
// created by this fixture; the stand-in only makes its instanceof test legal.
globalThis.ImageBitmap ??= class ImageBitmap {};

let passed = 0;
let failed = 0;
function check(name, ok, receipt) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(receipt)}`);
  ok ? passed++ : failed++;
}

function fixture(enabled, visible, leaf = false) {
  setFlyPatch({ unlockOnReject: enabled, lodBailFix: true,
    mergeDwellMs: 0, frustumPenalty: 5, lodHysteresis: 1 });
  const tile = new Tile(0, 0, 13);
  tile._sizeInWorld = 1000;
  const group = new Group();
  group.add(tile);
  function attachModel(node) {
    node._model = new TileMesh(new PlaneGeometry(1, 1));
    node.add(node._model);
    node._loadState = 'loaded';
    node._loadedEpoch = 0;
  }
  if (leaf) attachModel(tile);
  else {
    const children = Array.from({ length: 4 }, (_, i) => {
      const child = new Tile(i % 2, Math.floor(i / 2), 14);
      child._sizeInWorld = 500;
      attachModel(child);
      return child;
    });
    tile.add(...children);
    tile._subTiles = children;
  }
  group.updateMatrixWorld(true);
  const camera = new PerspectiveCamera(60, 1, 0.1, 10000);
  camera.position.set(0, 0, 500);
  const face = (toward) => {
    camera.lookAt(0, 0, toward ? 0 : 1000);
    camera.updateMatrixWorld(true);
  };
  const pending = [];
  const loader = {
    maxThreads: 4, downloadingThreads: 0, calls: 0,
    update(node, model) {
      this.calls++;
      model.setGeometry(new PlaneGeometry(1, 1));
      return new Promise((resolve) => pending.push(resolve));
    },
  };
  const params = { camera, loader, minLevel: 2, maxLevel: 18, LODThreshold: 0.86 };
  face(visible);
  // Saturate only this initial tick: refresh real frustum without scheduling LOD.
  tile.update(params);
  assert.equal(tile.inFrustum, visible);
  loader.maxThreads = 100;
  const release = async () => {
    pending.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
  };
  return { tile, camera, face, loader, params, release };
}

function state(tile) {
  return {
    attachedChildren: tile.children.filter((child) => child instanceof Tile).length,
    trackedChildren: tile.subTiles?.length ?? 0,
    attachedParentModel: !!tile.model && tile.model.parent === tile,
    inFrustum: tile.inFrustum,
  };
}

async function returnDuringMerge(enabled) {
  const f = fixture(enabled, false);
  assert.equal(f.tile._LODEvaluate(2, 18, 0.86), 2);
  const merge = f.tile._removeSubTiles(f.params);
  const loading = state(f.tile);
  assert.equal(loading.attachedParentModel, false);
  assert.equal(loading.attachedChildren, 4);
  f.face(true);
  f.tile.update(f.params); // Updates shared camera/frustum while node is loading.
  await f.release();
  await merge;
  const result = state(f.tile);
  check(`return-to-view ${enabled ? 'ON preserves fine children' : 'OFF reproduces collapse'}`,
    enabled ? result.attachedChildren === 4 && result.trackedChildren === 4 &&
      !result.attachedParentModel && result.inFrustum :
      result.attachedChildren === 0 && result.attachedParentModel, result);
  f.tile.unload();
}

async function cancellationThenDeparture(enabled) {
  const f = fixture(enabled, true);
  // Isolate the child-index defect: remain visible while translating from
  // beyond the merge distance to inside it, so frustum refresh cannot help.
  f.camera.position.z = 1500;
  f.face(true);
  f.loader.maxThreads = 4;
  f.tile.update(f.params);
  f.loader.maxThreads = 100;
  assert.equal(f.tile._LODEvaluate(2, 18, 0.86), 2);
  const merge = f.tile._removeSubTiles(f.params);
  f.camera.position.z = 500;
  f.face(true);
  f.tile.update(f.params);
  await f.release();
  await merge;
  const canceled = state(f.tile);
  assert.equal(canceled.attachedChildren, 4);
  assert.equal(canceled.attachedParentModel, false);
  check(`canceled merge ${enabled ? 'ON restores child index' : 'OFF loses child index'}`,
    canceled.trackedChildren === (enabled ? 4 : 0), canceled);
  f.face(false);
  f.tile.update(f.params); // The public scheduler must be able to merge again.
  await f.release();
  const result = { ...state(f.tile), loaderCalls: f.loader.calls };
  check(`subsequent departure ${enabled ? 'ON merges normally' : 'OFF is stuck refined'}`,
    enabled ? result.loaderCalls === 2 && result.attachedParentModel &&
      result.attachedChildren === 0 :
      result.loaderCalls === 1 && result.attachedChildren === 4, result);
  f.tile.unload();
}

async function refineCompletion() {
  const f = fixture(true, true, true);
  const parentModel = f.tile.model;
  const refine = f.tile._loadSubTiles(f.params);
  assert.equal(f.tile.loadState, 'loaded');
  assert.equal(f.tile.model.parent, f.tile);
  assert.equal(f.tile.subTiles.every((child) => !child.parent), true);
  // Refine does not mark its parent loading, so even the busy walk refreshes it.
  f.loader.maxThreads = 4;
  f.face(false);
  f.tile.update(f.params);
  await f.release();
  await refine;
  const result = state(f.tile);
  check('refine completion already cancels after turn away', !result.inFrustum &&
    result.attachedParentModel && f.tile.model === parentModel &&
    result.trackedChildren === 0 && result.attachedChildren === 0, result);
  f.tile.unload();
}

async function returnDuringCrossfade(enabled) {
  const saved = { ...LOD_CROSSFADE };
  Object.assign(LOD_CROSSFADE, { enabled: true, mode: 'parentBlend', onMerge: true,
    skipBootMs: 0, skipOnWarp: false, fadeSec: 0.3, maxConcurrent: 16 });
  resetLodFades();
  const f = fixture(enabled, false);
  const materials = f.tile.subTiles.map((child) => {
    const m = new MeshBasicMaterial({ map: new Texture() });
    child.model.material = [m];
    attachLodFade(m);
    return m;
  });
  const parentTexture = new Texture();
  let disposed = false, cleanupBeforeDispose = false, cleanupCalls = 0, finishWait;
  parentTexture.addEventListener('dispose', () => {
    disposed = true;
    cleanupBeforeDispose = materials.every(m => m.userData.__lodFade.map.value !== parentTexture);
  });
  const update = f.loader.update;
  f.loader.update = function(node, model) {
    model.material = [new MeshBasicMaterial({ map: parentTexture })];
    return update.call(this, node, model);
  };
  setLodFadeHook({
    onMerge(node, model) {
      const actualWait = lodFadeHook.onMerge(node, model);
      assert.ok(actualWait, 'real child material blends are armed');
      // Exercise the real hook's timeout path without spending wall-clock time:
      // its awaited promise may complete while child slots still own the map.
      return Promise.race([actualWait, new Promise(resolve => { finishWait = resolve; })]);
    },
    onMergeEnd(node, model) { cleanupCalls++; lodFadeHook.onMergeEnd(node, model); },
  });
  try {
    const merge = f.tile._removeSubTiles(f.params);
    await f.release();
    assert.equal(f.tile.loadState, 'loading');
    assert.equal(lodStats.active, 4);
    tickLodFades(0.1);
    assert.ok(materials.every(m => m.userData.__lodFade.mix.value > 0));
    f.face(true);
    f.tile.update(f.params);
    finishWait();
    await merge;
    const result = state(f.tile);
    check(`crossfade turn ${enabled ? 'ON cancels merge with current camera' : 'OFF reproduces stale-view collapse'}`,
      enabled ? result.attachedChildren === 4 && result.trackedChildren === 4 &&
        !result.attachedParentModel && result.inFrustum :
        result.attachedChildren === 0 && result.attachedParentModel, result);
    check(`crossfade ${enabled ? 'ON' : 'OFF'} finishes temporary child sampling`,
      cleanupCalls === 1 && lodStats.active === 0 && materials.every(m =>
        m.userData.__lodFade.mix.value === 0 && m.userData.__lodFade.map.value !== parentTexture),
      { cleanupCalls, active: lodStats.active });
    if (enabled) check('canceled parent texture disposes after child references clear',
      disposed && cleanupBeforeDispose, { disposed, cleanupBeforeDispose });
  } finally {
    setLodFadeHook(null);
    resetLodFades();
    f.tile.unload();
    Object.assign(LOD_CROSSFADE, saved);
  }
}

async function residencyBudgetWithDwell() {
  const saved = { ...R24_SWITCHES };
  try {
    Object.assign(R24_SWITCHES, { keepResident: true, mergeHysteresis: true, mergeHysteresisK: 1.6 });
    const f = fixture(true, false);
    setFlyPatch({ mergeDwellMs: 60000 });
    assert.equal(f.tile._LODEvaluate(2, 18, 0.86), 0, 'nearby offscreen children remain resident');
    f.tile._r24Collapse = performance.now() + 10000;
    f.tile.update(f.params);
    assert.equal(f.loader.calls, 1, 'budget election bypasses long ordinary merge dwell');
    await f.release();
    check('main residency budget still merges with FLY dwell enabled',
      state(f.tile).attachedChildren === 0 && state(f.tile).attachedParentModel,
      { ...state(f.tile), loaderCalls: f.loader.calls });
    f.tile.unload();
    const visible = fixture(true, true);
    visible.tile._r24Collapse = performance.now() + 10000;
    check('resident budget mark cannot collapse a returned visible tile',
      visible.tile._LODEvaluate(2, 18, 0.86) !== 2, state(visible.tile));
    visible.tile.unload();
  } finally {
    Object.assign(R24_SWITCHES, saved);
    setFlyPatch({ mergeDwellMs: 0 });
  }
}

for (const enabled of [false, true]) {
  await returnDuringMerge(enabled);
  await cancellationThenDeparture(enabled);
}
await refineCompletion();
for (const enabled of [false, true]) await returnDuringCrossfade(enabled);
await residencyBudgetWithDwell();
console.log(`VERIFY: ${failed ? 'FAIL' : 'PASS'} (${passed} passed, ${failed} failed)`);
process.exitCode = failed ? 1 : 0;

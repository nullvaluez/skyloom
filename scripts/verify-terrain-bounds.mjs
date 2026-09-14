// Real vendored geometry, worker and visibility bounds; no network or GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Box3, Vector3 } from 'three';
import { Tile, TileMesh, TileGeometry, R24_SWITCHES } from '../lib/fly/vendor/three-tile/index.js';

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}
function raw(lo, hi) {
  return { attributes: {
    position: { value: new Float32Array([-.5,-.5,lo, .5,-.5,hi, -.5,.5,hi]), size:3 },
    texcoord: { value:new Float32Array([0,0,1,0,0,1]), size:2 },
    normal: { value:new Float32Array([0,0,1,0,0,1,0,0,1]), size:3 },
  }, indices:new Uint32Array([0,1,2]) };
}
function tile(lo, hi) {
  const t = new Tile(19293,24630,16);
  t._model = new TileMesh(new TileGeometry().setAttributes(raw(lo,hi),16));
  t.add(t._model); t._maxZ=t.model.maxHeight;
  t.position.set(18000,24000,700); t.updateMatrixWorld(true);
  return t;
}
for (const cache of [false,true]) {
  R24_SWITCHES.bboxCache=cache;
  check(`negative DEM bounds contain both surface extrema (cache=${cache})`,()=>{
    const t=tile(-12,-1.2), b=t.BBox;
    assert.equal(b.isEmpty(),false);
    assert.ok(b.containsPoint(new Vector3(18000,24000,688)));
    assert.ok(b.containsPoint(new Vector3(18000,24000,698.8)));
    assert.ok(b.min.z>680,'skirt depth must not expand surface visibility bounds');
  });
  check(`above-sea-level bounds preserve legacy geometry (cache=${cache})`,()=>{
    const t=tile(10,30);
    const expected=new Box3(new Vector3(-1,-1,0),new Vector3(1,1,30)).applyMatrix4(t.matrixWorld);
    assert.deepEqual(t.BBox,expected);
  });
  check(`mixed elevation and rebase invalidate bounds (cache=${cache})`,()=>{
    const t=tile(-12,30), before=t.BBox.clone();
    t.position.x-=10000;t.updateMatrixWorld(true);
    assert.equal(t.BBox.min.x,before.min.x-10000);
    assert.equal(t.BBox.min.z,688);
    t.model.geometry.userData.surfaceMinZ=-20;
    assert.equal(t.BBox.min.z,680);
  });
}
check('worker preserves pre-skirt minimum and main thread consumes it',()=>{
  let result;
  const source=readFileSync(new URL('../lib/fly/vendor/three-tile/workers/skirt-tail.src.js',import.meta.url),'utf8')
    .replaceAll('__DECODE__','decode').replaceAll('__R24_NORMALS__','false');
  const errors=[3,2,1];let decodedErrors;
  const context={decode:(_data,_z,_bounds,e)=>{decodedErrors=e;return raw(-12,-1.2);}, self:{postMessage:g=>{result=g;}}};
  vm.runInNewContext(source,context);context.self.onmessage({data:{z:16,errTable:errors}});
  assert.equal(decodedErrors,errors,'LERC error curve survives the worker tail');
  assert.equal(result.surfaceMinZ,-12);
  R24_SWITCHES.skirtWorker=true;
  const g=new TileGeometry().setAttributes(result,16);
  g.computeBoundingBox();assert.ok(g.boundingBox.min.z < -700);
  assert.equal(g.userData.surfaceMinZ,-12);
});
console.log(`${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;

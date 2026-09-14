import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Deliberately omit the removed constant: the controller must have a finite
// fallback even if a configuration cleanup removes that optional key again.
const source = readFileSync(new URL('../lib/fly/tile-residency.js', import.meta.url), 'utf8')
  .replace(/import \{ TILES, TERRA_PACE \} from '\.\/fly-constants';/, 'const TILES = {}, TERRA_PACE = {};');
const { TileResidency } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const pace = { enabled:true, keepResident:true, residency:{ passIntervalMs:0, maxResidentTiles:1000 } };
let failures = 0;
function check(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch(e) { failures++; console.error(`FAIL ${name}: ${e.message}`); } }
function leaf(inFrustum) {
  return { isTile:true, isLeaf:true, inFrustum, children:[], model:{ traverse(fn) {
    fn({ isMesh:true, material:{map:{image:{width:256,height:256}}} });
  } } };
}
function parent(inFrustum) {
  return { isTile:true, isLeaf:false, inFrustum, children:[], subTiles:Array.from({length:4},()=>leaf(inFrustum)),
    matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,100,0,100,1]} };
}
check('missing configuration keeps a finite 140 MB fallback',()=>{
  assert.equal(new TileResidency(null,{pace}).budgetBytes,140e6);
});
check('explicit terrain allowance is honored',()=>{
  assert.equal(new TileResidency(null,{pace,budgetBytes:120*1048576}).budgetBytes,120*1048576);
});
check('invalid allowances cannot silently disable the cap',()=>{
  for(const budgetBytes of [Infinity,NaN,0,-1]) assert.throws(()=>new TileResidency(null,{pace,budgetBytes}),RangeError);
});
check('over-budget offscreen descendants request a safe parent replacement',()=>{
  const root = parent(false), r = new TileResidency({rootTile:root},{pace,budgetBytes:1048576});
  r.update({x:0,y:0,z:0},1000);
  assert.equal(r.stats.lastElected,1); assert.ok(root._r24Collapse>1000);
  assert.ok(root.subTiles.every(t=>t.model),'coverage must remain until vendor replacement is ready');
  r.dispose(); assert.equal(root._r24Collapse,0);
});
check('visible descendants are retained even while over budget',()=>{
  const root = parent(true), r = new TileResidency({rootTile:root},{pace,budgetBytes:1048576});
  r.update({x:0,y:0,z:0},1000);
  assert.equal(r.stats.lastElected,0); assert.ok(!root._r24Collapse);
});
check('under-budget offscreen residency survives a revisit',()=>{
  const root = parent(false), r = new TileResidency({rootTile:root},{pace,budgetBytes:8*1048576});
  r.update({x:0,y:0,z:0},1000); assert.equal(r.stats.lastElected,0);
});
process.exitCode=failures?1:0;

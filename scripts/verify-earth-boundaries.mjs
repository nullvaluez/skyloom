import assert from 'node:assert/strict';
import { buildEarthSurfaceMask } from '../lib/fly/earth-surface-mask.js';

const ring=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1},{x:x0,y:y0}];
const feature=(cls,rings)=>({type:3,properties:{class:cls},loadGeometry:()=>rings});
const layer=(...features)=>({extent:4096,length:features.length,feature:i=>features[i]});
const mask=(cls,rings)=>buildEarthSurfaceMask({layers:{[cls==='lake'?'water':'landcover']:layer(feature(cls,rings))}},256);
let checks=0;
function check(name,fn){fn();checks++;console.log(`PASS ${name}`);}

check('natural boundaries taper inward without inventing coverage',()=>{
  const m=mask('wood',[ring(2048,-64,4160,4160)]),row=128*256;
  assert.equal(m.classes[row+127],0);assert.equal(m.blend[row+127],0);
  assert.equal(m.classes[row+128],2);assert.ok(m.blend[row+128]>0&&m.blend[row+128]<64);
  assert.ok(m.blend[row+129]>m.blend[row+128]);assert.ok(m.blend[row+130]>m.blend[row+129]);assert.equal(m.blend[row+131],255);
});
check('a complete buffered woodland tile does not fade at its tile edges',()=>{
  const m=mask('wood',[ring(-64,-64,4160,4160)]);
  assert.equal(m.classes.every(c=>c===2),true);assert.equal(m.blend.every(b=>b===255),true);
});
check('adjacent tiles agree with an unsplit polygon across a diagonal boundary',()=>{
  // A diagonal wood boundary crosses the shared x=4096 tile edge. Comparing
  // independently rasterized tiles with one large mask catches halo mistakes.
  const points=[{x:-64,y:1952},{x:8256,y:4032},{x:8256,y:4160},{x:-64,y:4160},{x:-64,y:1952}];
  const left=mask('wood',[points]),right=mask('wood',[points.map(p=>({x:p.x-4096,y:p.y}))]);
  for(let y=0;y<256;y++){
    // The same physical boundary shifts a quarter pixel per X sample; compare
    // common geometry after translating a whole tile in Y along its slope.
    if(y<192){assert.equal(left.blend[y*256],right.blend[(y+64)*256]);}
  }
  // Exact tile-edge confidence against an overlapping tile whose interior
  // contains the same pixels. No artificial fade or clipped-ring seam.
  const overlap=mask('wood',[points.map(p=>({x:p.x-2048,y:p.y}))]);
  for(let y=0;y<256;y++)for(let x=252;x<256;x++)assert.equal(left.blend[y*256+x],overlap.blend[y*256+x-128]);
  for(let y=0;y<256;y++)for(let x=0;x<4;x++)assert.equal(right.blend[y*256+x],overlap.blend[y*256+x+128]);
});
check('holes remain unclassified and keep the same fade in either winding',()=>{
  const rings=[ring(-64,-64,4160,4160),ring(1536,1536,2560,2560)];
  const a=mask('wood',rings),b=mask('wood',rings.map(r=>r.toReversed()));
  assert.deepEqual(a.blend,b.blend);assert.deepEqual(a.classes,b.classes);
  assert.equal(a.blend[128*256+128],0);assert.ok(a.blend[128*256+95]<255);
});
check('water, field and developed boundaries remain exact',()=>{
  for(const cls of ['lake','farmland']){
    const m=mask(cls,[ring(2048,-64,4160,4160)]);
    for(let i=0;i<m.classes.length;i++)assert.equal(m.blend[i],m.classes[i]?255:0);
  }
  const m=buildEarthSurfaceMask({layers:{landuse:layer(feature('residential',[ring(2048,-64,4160,4160)]))}},256);
  for(let i=0;i<m.classes.length;i++)assert.equal(m.blend[i],m.classes[i]?255:0);
});
check('the new payload adds one bounded byte per cell and retains exact exclusions',()=>{
  const m=buildEarthSurfaceMask({layers:{landcover:layer(feature('wood',[ring(-64,-64,4160,4160)])),transportation:layer({type:2,properties:{class:'primary'},loadGeometry:()=>[[{x:0,y:2048},{x:4096,y:2048}]]})}},256);
  // Revision 4 retains the revision-3 boundary and exclusion contract.
  assert.equal(m.revision,5);assert.equal(m.blend.byteLength,256*256);
  assert.equal(m.exclusion[128*256+50],255);assert.equal(m.exclusion[100*256+50],0);
});
console.log(`EARTH BOUNDARIES: PASS ${checks}/${checks}`);

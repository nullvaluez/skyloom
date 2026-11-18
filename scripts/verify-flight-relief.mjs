import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
register('./_node-resolve.mjs',import.meta.url);
const { footprintSections } = await import('../lib/fly/toy-world/worker/footprint-sections.js');
const { createStandInPreparation, advanceStandInPreparation } = await import('../lib/fly/toy-world/sat-stand-in-prep.js');
const { mergeStandInParts, drapeStandIns } = await import('../lib/fly/toy-world/sat-stand-ins.js');
const { steppedBuildingLevels } = await import('../lib/fly/living-architecture.js');
const ring = points => points.map(([x,y])=>({x,y}));
const square = (lo,hi) => ring([[lo,lo],[hi,lo],[hi,hi],[lo,hi]]);

test('upper storeys respect the measured roof height and leave courtyard volumes intact',() => {
  const polygon={outer:square(0,80),holes:[]};
  for (const seed of [4,5,8,11,14,79]) {
    const style={floor:3.65,family:4,seed};
    for (const h of [32,58,112,187]) {
      const levels=steppedBuildingLevels(polygon,h,style,true);
      assert.equal(levels[0].scale,1);
      assert.equal(levels.at(-1).top,h);
      for (let i=1;i<levels.length;i++) {
        assert.ok(levels[i].top>levels[i-1].top && levels[i].scale<levels[i-1].scale);
        assert.equal(levels[i].pivot,levels[0].pivot);
      }
    }
  }
  assert.equal(steppedBuildingLevels({...polygon,holes:[square(20,60)]},80,{floor:3.2,family:4,seed:5},true),null);
});

test('rectangular towers stay whole, mapped wings and courtyards keep their outlines',() => {
  assert.equal(footprintSections({outer:square(0,80),holes:[]},0,1),null);
  const block = {outer:square(0,80),holes:[square(20,60)]};
  const court = footprintSections(block,0,1);
  assert.equal(court.length,4);
  assert.ok(court.every(p => Math.abs(40-p.x)>p.hu || Math.abs(40-p.y)>p.hv));
  const l = {outer:ring([[0,0],[80,0],[80,20],[20,20],[20,80],[0,80]]),holes:[]};
  assert.equal(footprintSections(l,0,1).length,2);
});

test('sections share one roof elevation on sloping terrain across a finalize batch boundary',() => {
  const n=130, si={n,pos:new Float32Array(n*2),size:new Float32Array(n).fill(55),
    dim:new Float32Array(n*4).fill(15),col:new Uint8Array(n*8),parentOffsets:{128:1,129:2}};
  si.pos[127*2]=-20; si.pos[128*2]=25; si.pos[129*2]=35;
  const parts=[{si,dx:0,dz:0}], grid=Float32Array.from([10,70,20,80]);
  const synchronous=mergeStandInParts(parts);
  const ground=drapeStandIns(synchronous,grid,1,100,new Float32Array(n));
  const job=createStandInPreparation(parts,grid,1,100);
  advanceStandInPreparation(job,Infinity);
  assert.deepEqual(job.result.baseY,ground);
  assert.equal(ground[128],ground[127]);
  assert.equal(ground[129],ground[127]);
  assert.notEqual(ground[126],ground[127]);
});

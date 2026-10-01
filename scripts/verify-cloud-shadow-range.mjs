import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloudShadowVisibility } from '../lib/fly/cloud-shadow-range.mjs';

test('high-altitude distant casters cannot shadow beyond the rendered cloud field',()=>{
  const eye=[0,12891,0];
  for(const distance of [22000,30000,60000,120000])assert.equal(cloudShadowVisibility([distance,2300,0],eye,22000,16000,22000),0);
  assert.equal(cloudShadowVisibility([0,2300,0],eye,22000,16000,22000),1,'near clouds retain shadows');
});
test('caster range includes low-sun displacement, fades continuously and survives rebasing',()=>{
  const eye=[0,2000,0];
  let previous=1;
  for(let d=0;d<=24000;d+=10){const value=cloudShadowVisibility([d,2000,0],eye,22000,16000,22000);assert.ok(value<=previous&&value>=0);assert.ok(previous-value<.003);previous=value;}
  const p=[18000,2300,-400],offset=[231000,0,-441000];
  assert.equal(cloudShadowVisibility(p,eye,22000,16000,22000),cloudShadowVisibility(p.map((v,i)=>v+offset[i]),eye.map((v,i)=>v+offset[i]),22000,16000,22000));
  // A nearby surface can project to an out-of-range caster at low sun.
  assert.equal(cloudShadowVisibility([26000,2300,0],eye,22000),0);
});

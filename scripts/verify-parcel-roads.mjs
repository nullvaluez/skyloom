import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../lib/fly/parcel-roads.js',import.meta.url),'utf8');
const {parcelRoadScan,stepParcelRoadScan,parcelRoadDistance} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function chunks(cls=5) {return new Map([['tile',{state:'ready',coarse:false,mesh:{position:{x:0,z:0},geometry:{id:1,attributes:{position:{array:new Float32Array([0,0,1,0,0,-1,200,0,1,200,0,-1])},aRoadCls:{array:new Uint8Array([cls,cls,cls,cls])}}}}}]]);}
const scan=parcelRoadScan(chunks(),2);
assert.equal(stepParcelRoadScan(scan,1000,1),false,'Scan yields at its work cap');
assert.equal(stepParcelRoadScan(scan),true,'Resumes to completion');
assert.equal(parcelRoadDistance(scan,100,50),25,'True-metre setback is latitude independent');
assert.equal(parcelRoadDistance(scan,100,16),8,'Road-bed candidates remain distinguishable');
assert.equal(parcelRoadDistance(scan,100,120),60,'Field candidates remain distinguishable');
assert.equal(parcelRoadScan(chunks(),2,scan.signature),null,'Identical source is not rebuilt');
const motorway=parcelRoadScan(chunks(3),1);stepParcelRoadScan(motorway,1000);
assert.equal(parcelRoadDistance(motorway,100,20),Infinity,'A motorway cannot support inferred homes');
assert.equal(parcelRoadDistance(null,100,20),Infinity,'Unready road source cannot support inferred homes');
console.log('PARCEL ROADS: PASS (8 evidence, distance and work-budget cases)');

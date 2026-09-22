import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { OPERATIONS_AIRPORTS, airportFrame, airportLocal, airportSurface, airportTaxiExits, taxiRoute } from '../lib/fly/operations-airports.js';
import { operationsProfile } from '../lib/fly/operations-profiles.js';
import { approachPathPoint, departurePathPoint, operationsPathMode, roundedGroundRoute } from '../lib/fly/operations-paths.js';
import { refinePavement, pavementHeight, pavementSampleAccepted, PAVEMENT_CLEARANCE_M } from '../lib/fly/pavement-drape.js';

let checks=0;const test=(name,fn)=>{fn();checks++;console.log(`PASS ${name}`);};
test('rounded taxi routes and their full ribbon widths remain on pavement',()=>{
  for(const airport of OPERATIONS_AIRPORTS)for(const arrival of [false,true])for(const reverse of [false,true])for(const exit of airportTaxiExits(airport)) {
    const route=taxiRoute(airport,arrival,reverse,exit),points=roundedGroundRoute(route,airport.id==='KOSU'?7:16);
    assert.deepEqual(points[0],route[0]);assert.deepEqual(points.at(-1),route.at(-1));
    const frame=airportFrame(airport);
    for(const [s,c] of points)for(const ds of [-1.5,0,1.5])for(const dc of [-1.5,0,1.5]) {
      const x=frame.x+(frame.ux*(s+ds)-frame.uz*(c+dc))*frame.k,z=frame.z+(frame.uz*(s+ds)+frame.ux*(c+dc))*frame.k;
      assert.ok(airportSurface(airport,x,z),`${airport.id} ${arrival}/${reverse}: ${s},${c}`);
    }
    for(let i=1;i<points.length;i++)assert.ok(Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1])<=4.00001);
  }
});
test('approach guides match reciprocal displaced thresholds and touchdown aim',()=>{
  for(const a of OPERATIONS_AIRPORTS)for(const reverse of [false,true])for(const id of ['prop','fighter','airliner']) {
    const profile=operationsProfile(id),f=airportFrame(a);
    for(const d of [-250,0,120,1500,4200]) {
      const p=approachPathPoint(a,profile,reverse,d),l=airportLocal(a,p.x,p.z);
      const threshold=reverse?f.length-(a.thresholdB||0):(a.thresholdA||0);
      assert.ok(Math.abs(l.along-(threshold+(reverse?d:-d)))<1e-7);
      assert.ok(Math.abs(l.cross)<1e-7);assert.ok(Number.isFinite(p.y));
    }
  }
});
test('departure paths have a continuous roll-to-climb slope for every powered aircraft',()=>{
  const a=OPERATIONS_AIRPORTS[2];
  for(const reverse of [false,true])for(const id of ['prop','warbird-prop','fighter','military','warbird-jet','bizjet','airliner','cargo']) {
    const profile=operationsProfile(id),points=Array.from({length:4801},(_,i)=>departurePathPoint(a,profile,reverse,i));
    for(let i=2;i<points.length;i++)assert.ok(Math.abs(points[i].y-2*points[i-1].y+points[i-2].y)<.002,'No kink at rotation or transition');
    assert.ok(points.at(-1).y>points[0].y+250);
  }
});
test('guidance can be hidden and never stays active after a crash, completion, or a distant flight',()=>{
  const airport=OPERATIONS_AIRPORTS[0],profile=operationsProfile('prop'),p=departurePathPoint(airport,profile,false,0);
  const o={guidance:true,airport,profile,phase:'takeoffRoll',grounded:true},f={pos:p,agl:3};
  assert.equal(operationsPathMode(o,f),'departure');o.guidance=false;assert.equal(operationsPathMode(o,f),null);o.guidance=true;
  for(const phase of ['hangar','crashed','completed']){o.phase=phase;o.grounded=false;assert.equal(operationsPathMode(o,f),null);}
  o.phase='approach';assert.equal(operationsPathMode(o,f),'approach');
  o.phase='airborne';o.takeoffs=1;o.destination=airport.id;f.agl=900;assert.equal(operationsPathMode(o,f),null);
});
const payload={pos:new Float32Array([0,0,5,250,0,-5,0,0,-5,0,0,5,250,0,5,250,0,-5]),
  uv:new Float32Array([5,0,-5,250,-5,0,5,0,5,250,-5,250]),style:new Float32Array([2,10,2,10,2,10,2,10,2,10,2,10]),evidence:{roadSegments:1}};
test('cached airfield triangles refine with bounded edges and unchanged paint coordinates',()=>{
  const road=refinePavement(payload);
  assert.ok(road.pos.length>payload.pos.length);assert.equal(road.evidence,payload.evidence);
  for(let i=0;i<road.pos.length;i+=9)for(let j=0;j<3;j++){
    const a=i+j*3,b=i+((j+1)%3)*3;
    assert.ok(Math.hypot(road.pos[a]-road.pos[b],road.pos[a+2]-road.pos[b+2])<=24.0001);
  }
  for(let i=0;i<road.pos.length/3;i++){
    assert.equal(road.style[i*2],2);assert.equal(road.style[i*2+1],10);
    assert.equal(road.uv[i*2],road.pos[i*3+2]);assert.equal(road.uv[i*2+1],road.pos[i*3]);
  }
  assert.ok([...road.pos,...road.uv,...road.style].every(Number.isFinite));
});
test('satellite streets keep photographic ground and do not create duplicate opaque road meshes',()=>{
  const streets={...payload,style:Float32Array.from(payload.style,(v,i)=>i%2?v:4)};
  assert.equal(refinePavement(streets).pos.length,0);
  assert.ok(refinePavement(payload).pos.length>0,'Mapped airport pavement remains modeled');
});
test('airfield pavement clears rolling terrain that buried the original forty-metre chords',()=>{
  const terrain=x=>3*Math.sin(x*Math.PI/80),road=refinePavement(payload);
  assert.ok((terrain(20)+terrain(60))/2+.1<terrain(40),'Reproduce the old buried midpoint');
  for(let i=0;i<road.pos.length;i+=9){
    for(let a=0;a<=10;a++)for(let b=0;b<=10-a;b++){
      const weights=[a/10,b/10,1-(a+b)/10];let x=0,height=0;
      for(let j=0;j<3;j++){x+=weights[j]*road.pos[i+j*3];height+=weights[j]*pavementHeight(0,terrain(road.pos[i+j*3]),false);}
      assert.ok(height>=terrain(x),'No terrain penetration inside refined triangle');
    }
  }
});
test('height repairs clear arriving terrain immediately and reject missing/coarser support',()=>{
  const support={zoom:17,height:100};
  assert.equal(pavementHeight(80,103,true),103+PAVEMENT_CLEARANCE_M);
  assert.ok(pavementHeight(105,99,true)>99+PAVEMENT_CLEARANCE_M,'Downward correction eases without sinking');
  assert.equal(pavementSampleAccepted(support,{elev:0,tileZ:2}),false);
  assert.equal(pavementSampleAccepted(support,null),false);
  assert.equal(pavementSampleAccepted(support,{elev:99,tileZ:18}),true);
  assert.equal(pavementSampleAccepted(support,{elev:112,tileZ:16}),true,'Higher resident terrain must lift pavement even after a LOD merge');
  assert.equal(pavementSampleAccepted(support,{elev:80,tileZ:16}),false,'A lower coarse fallback cannot pull pavement under retained fine ground');
});
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@/'))specifier=new URL('../'+specifier.slice(2),import.meta.url).href;
  if(specifier.startsWith('.')||specifier.startsWith('file:')){
    const url=new URL(specifier,context.parentURL);
    if(fs.existsSync(fileURLToPath(url)+'.js'))return next(url.href+'.js',context);
  }return next(specifier,context);
}});
const {LivingAirports}=await import('../lib/fly/living-airports.js');
const {worldReadiness,SCENERY_HOLD_MS}=await import('../lib/fly/world-readiness.js');
test('unfinished scenery cannot trap loading, while missing flight surfaces still block entry',()=>{
  const rt={flight:{latDeg:0,pos:{x:0,y:100,z:0},groundElev:0},
    terraStats:{sharp:true,camTileZ:17,targetZ:18},
    earthSurface:{near:{ready:true},materials:{state:'ready'},commits:1,
      forest:{nearPending:10,sourceCommit:1},airports:{nearPending:50}},
    modelsReady:true,liveFleetReady:true,prewarm:{done:true}};
  assert.equal(worldReadiness(rt,SCENERY_HOLD_MS-1).ready,false);
  const entry=worldReadiness(rt,SCENERY_HOLD_MS);
  assert.equal(entry.ready,true);assert.equal(entry.detailReady,false);
  assert.deepEqual(entry.deferred,['buildings','roads','forest','airports']);
  assert.equal(entry.parts.airports,false,'Do not falsely report unfinished scenery as complete');
  for(const unset of [r=>r.terraStats.sharp=false,r=>r.earthSurface.near.ready=false,
    r=>r.earthSurface.materials.state='loading',r=>r.modelsReady=false,r=>r.prewarm.done=false]){
    const missing=structuredClone(rt);unset(missing);
    assert.equal(worldReadiness(missing,120000).ready,false,'Real flight prerequisites remain mandatory');
  }
});
test('drawn asphalt heals while unresolved parts of its tile remain pending',()=>{
  const span=40075016.68557849/16384;
  const surface={bands:[null,null,{span,slots:[{key:'14/8192/8192',state:'ready',mask:{airport:payload}}]}],stats:{commits:1}};
  let elevation=100,zoom=18;
  const rt={flight:{latDeg:0,pos:{x:0,y:110,z:0}},engine:{getGroundAt:lon=>lon*Math.PI/180*6378137<80?{elev:elevation,tileZ:zoom}:null}};
  const layer=new LivingAirports();
  for(let i=0;i<100;i++)layer.update(surface,rt);
  const tile=[...layer.tiles.values()][0],mesh=tile.mesh;
  assert.ok(tile.indices>0&&tile.pending.length>0,'Mix of supported and still-loading road sections');
  elevation=115;zoom=16;
  for(let i=0;i<120;i++)layer.update(surface,rt);
  assert.equal(tile.mesh,mesh,'Repair keeps the resident mesh');assert.ok(tile.pending.length>0);
  for(let i=0;i<tile.ready.length;i++)if(tile.ready[i])assert.ok(tile.mesh.geometry.attributes.position.getY(i)>=115.64,'No repair starvation behind pending off-screen terrain');
  layer.dispose();
});
console.log(`VERIFY: PASS (${checks} checks)`);

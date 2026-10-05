import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./_node-resolve.mjs',import.meta.url);
const {createCinemaEnvironment,evaluateCinemaEnvironment}=await import('../lib/fly/cinema-environment.js');
const {applyCinemaArt,updateCinemaCloudDatum}=await import('../lib/fly/cinema-art.js');
const {updateCinemaFrame,CINEMA_UNIFORMS}=await import('../lib/fly/cinema-frame.js');
const {useFlyStore}=await import('../stores/fly-store.js');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const environment=(deg,weather={})=>evaluateCinemaEnvironment(createCinemaEnvironment(),{sinEl:Math.sin(deg*Math.PI/180),az:1.2},weather);
check('art remains finite and continuous through weather and sunrise/sunset',()=>{
 for(const overcastT of [0,.5,1])for(const fogT of [0,.5,1]){
  let previous;
  for(let deg=-90;deg<=90;deg+=.25){
   const e=applyCinemaArt(environment(deg,{overcastT,fogT}));
   for(const value of Object.values(e))for(const n of Array.isArray(value)?value:[value])assert.ok(Number.isFinite(n));
   assert.ok(e.sun>=0&&e.fill>=0&&e.extinction>0&&e.heightM>0);
   if(previous)assert.ok(Math.abs(e.sun-previous.sun)<.22);
   previous=e;
  }
 }
});
check('night is unchanged, full fog keeps its color, overcast retains weaker sunlight',()=>{
 const night=environment(-20),original=structuredClone(night);applyCinemaArt(night);assert.deepEqual(night,original);
 const fog=environment(30,{fogT:1}),oldFog=structuredClone(fog);applyCinemaArt(fog);
 assert.deepEqual(fog.horizon,oldFog.horizon);assert.deepEqual(fog.zenith,oldFog.zenith);
 assert.ok(applyCinemaArt(environment(30,{overcastT:1})).sun<applyCinemaArt(environment(30)).sun*.25);
});
check('only Enhanced satellite receives art; review baseline reproduces original radiance',()=>{
 globalThis.window={location:{search:'?graphicsReview=1'},__flyCinemaArt:0};
 const runtime={sun:{sinEl:.5,az:1.2},weather:{wx:{}},flight:{latDeg:40,pos:{x:0,y:700,z:0}},origin:{anchor:{x:0,z:0}}};
 useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced'});
 const baseline=structuredClone(updateCinemaFrame(runtime,useFlyStore.getState()));
 const original=evaluateCinemaEnvironment(createCinemaEnvironment(),runtime.sun,{});
 delete baseline.frame;delete original.frame;assert.deepEqual(baseline,original);assert.equal(CINEMA_UNIFORMS.uCinemaArt.value,0);
 window.__flyCinemaArt=1;const art=updateCinemaFrame(runtime,useFlyStore.getState());assert.equal(CINEMA_UNIFORMS.uCinemaArt.value,1);
 assert.ok(art.zenith[2]<baseline.zenith[2]);assert.ok(art.keyColor[2]<baseline.keyColor[2]);
 for(const [mapStyle,visuals] of [['satellite','classic'],['toy','enhanced']]){
  useFlyStore.setState({mapStyle,visuals});assert.equal(updateCinemaFrame(runtime,useFlyStore.getState()),null);assert.equal(CINEMA_UNIFORMS.uCinemaArt.value,0);
 }
 delete globalThis.window;
});
check('cloud altitude follows settled regional ground, not aircraft altitude or rebases',()=>{
 const geo={groundM:1800,originX:40000,originZ:20000,x:200,z:100,worldUnitsPerMetre:1.3};
 assert.equal(updateCinemaCloudDatum(null,geo,1,true),null);
 const datum=updateCinemaCloudDatum(null,geo,1,false);assert.equal(datum.groundM,1800);
 updateCinemaCloudDatum(datum,{...geo,groundM:2200,altitudeM:7000},1,false,.1);assert.equal(datum.groundM,1800);
 updateCinemaCloudDatum(datum,{...geo,originX:41000,x:-800},1,false,.1);assert.equal(datum.groundM,1800);
 updateCinemaCloudDatum(datum,{...geo,x:40000,groundM:3000},1,false,.1);assert.ok(datum.groundM>1800&&datum.groundM<=1800.4);
 const coast=updateCinemaCloudDatum(datum,{...geo,groundM:-40},2,false);assert.equal(coast.groundM,0);
});
console.log(`${count} cinema art checks passed`);

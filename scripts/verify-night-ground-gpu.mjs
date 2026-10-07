// Actual production splat renderer: clearing one packed history must never
// erase the other, including an empty update. This is a GPU correctness test.
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
register('./_node-resolve.mjs',import.meta.url);
const {createNightGroundTarget,createNightGroundSplatMaterial}=await import('../lib/fly/night-ground.js');
const {GROUND_LIGHTING}=await import('../lib/fly/night-lighting-policy.js');
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage();
 await page.route('http://night-ground.test/**',route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  assert(['three.module.js','three.core.js'].includes(name));
  return route.fulfill({status:200,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:readFileSync(new URL('../node_modules/three/build/'+name,import.meta.url),'utf8')});
 });
 await page.setContent('<canvas width="64" height="64"></canvas>');
 const result=await page.evaluate(async ({targetSource,splatSource,policy})=>{
  const T=await import('http://night-ground.test/three.module.js');
  const make=new Function(...Object.keys(T),'GROUND_LIGHTING',`const createNightGroundSplatMaterial=${splatSource};return (${targetSource});`)(...Object.values(T),policy);
  const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),reversedDepthBuffer:true});
  const target=make(32,4),outside=new T.WebGLRenderTarget(8,8);
  renderer.setRenderTarget(outside);renderer.setClearColor(0x123456,.7);renderer.autoClear=false;
  const read=half=>{const bytes=new Uint8Array(32*32*4);renderer.readRenderTargetPixels(target.target,half*32,0,32,32,bytes);return bytes;};
  const same=(a,b)=>a.every((v,i)=>v===b[i]);
  const source=(x,color)=>({x,y:100,z:0,r:80,gain:.8,color});
  target.render(renderer,[source(0,[1,0,0])],[0,0],256,0);
  const first=read(target.current),firstHalf=target.current;
  target.render(renderer,[source(128,[0,0,1])],[128,0],256,0);
  const second=read(target.current),secondHalf=target.current;
  const preserved=same(first,read(firstHalf));
  target.render(renderer,[],[256,0],256,0);
  const cleared=read(target.current);
  const out={redVisible:first.some((v,i)=>i%4===0&&v>0),blueVisible:second.some((v,i)=>i%4===2&&v>0),
   firstPreserved:preserved,secondPreserved:same(second,read(secondHalf)),emptyClearsOnlyItsHalf:cleared.every(v=>v===0),
   separateOrigins:target.frames[secondHalf].x===128&&target.frames[target.current].x===256,
   stateRestored:renderer.getRenderTarget()===outside&&renderer.autoClear===false&&Math.abs(renderer.getClearAlpha()-.7)<1e-6&&renderer.getClearColor(new T.Color()).getHex()===0x123456,
   bytes:target.bytes,glError:renderer.getContext().getError()};
  target.dispose();outside.dispose();renderer.dispose();return out;
 },{targetSource:createNightGroundTarget.toString(),splatSource:createNightGroundSplatMaterial.toString(),policy:GROUND_LIGHTING});
 console.log(JSON.stringify(result));
 for(const [key,value] of Object.entries(result))assert.equal(value,key==='bytes'?32*32*8:key==='glError'?0:true,key);
 console.log('PASS packed night-light histories preserve both images, empty updates, origins, renderer state and memory budget');
}finally{await browser.close();}

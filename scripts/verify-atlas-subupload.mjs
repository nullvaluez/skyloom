// The packed surface atlases upload one slot rectangle per change instead of
// the whole 1024x1536 RGBA + R8 pair. Two halves:
//  1. In WebGL2 (Chrome, or the bundled Chromium/SwiftShader), the exact
//     mechanism the engine uses - a never-rendered staging DataTexture that
//     shares the atlas array, then renderer.copyTextureToTexture - must leave
//     every GPU texel identical to the CPU array, for both atlas formats.
//  2. In node, EarthSurfaceEngine.flushAtlases issues one copy per dirty slot,
//     with the right rectangle, and falls back to a full upload until the
//     atlas has a GPU copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
registerHooks({resolve(s,c,next){if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}return next(s,c);}});
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};

const threeDir=new URL('../node_modules/three/build/',import.meta.url);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']})
 .catch(()=>chromium.launch({headless:true,executablePath:process.env.FLY_CHROMIUM||undefined,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}));
try{
 const page=await browser.newPage();
 await page.route('http://atlas.test/**',route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  if(name==='index.html')return route.fulfill({contentType:'text/html',body:'<script type="importmap">{"imports":{"three":"/three.module.js"}}</script><canvas id=c width=4 height=4></canvas>'});
  return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL(name,threeDir))});
 });
 await page.goto('http://atlas.test/index.html');
 const result=await page.evaluate(async()=>{
  const THREE=await import('three');
  const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c')}),gl=renderer.getContext();
  let seed=11;const rnd=()=>(seed=(seed*16807)%2147483647)%256;
  const W=1024,H=1536,out={};
  for(const [label,format,channels] of [['rgba',THREE.RGBAFormat,4],['r8',THREE.RedFormat,1]]){
   const atlas=new THREE.DataTexture(new Uint8Array(W*H*channels),W,H,format);
   atlas.minFilter=atlas.magFilter=channels===1?THREE.NearestFilter:THREE.LinearFilter;atlas.generateMipmaps=false;atlas.needsUpdate=true;
   const data=atlas.image.data;for(let i=0;i<data.length;i++)data[i]=rnd();
   renderer.initTexture(atlas);
   const staging=new THREE.DataTexture(data,W,H,atlas.format,atlas.type);
   // Change three slot rectangles (the band layout's 128 and 256 px slots).
   const rects=[[512,256,256,256],[0,0,128,128],[896,1408,128,128]];
   for(const [x,y,w,h] of rects){
    for(let r=0;r<h;r++)for(let k=0;k<w*channels;k++)data[((y+r)*W+x)*channels+k]=rnd();
    renderer.copyTextureToTexture(staging,atlas,new THREE.Box2(new THREE.Vector2(x,y),new THREE.Vector2(x+w,y+h)),new THREE.Vector2(x,y));
   }
   const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,renderer.properties.get(atlas).__webglTexture,0);
   const pixels=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   let mismatched=0;for(let p=0;p<W*H;p++)for(let k=0;k<channels;k++)if(pixels[p*4+k]!==data[p*channels+k])mismatched++;
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(fb);
   out[label]={mismatched,stagingRegistered:renderer.properties.has(staging),error:gl.getError()};
  }
  const ext=gl.getExtension('WEBGL_debug_renderer_info');out.renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'';
  return out;
 });
 await check(`GPU texels equal the CPU array after slot copies (RGBA and R8, ${result.renderer})`,()=>{
  for(const k of ['rgba','r8']){assert.equal(result[k].error,0);assert.equal(result[k].mismatched,0,`${k}: ${result[k].mismatched} texels differ`);
   assert.equal(result[k].stagingRegistered,false,'staging must stay CPU-side (never a GPU texture)');}
 });
}finally{await browser.close();}

const {EarthSurfaceEngine}=await import('../lib/fly/earth-surface-engine.js');
const {EARTH_CLASS_LAYOUT,makeEarthAtlas,makeEarthClassAtlas}=await import('../lib/fly/earth-surface-material.js');
await check('flushAtlases: one copy per dirty slot after the first upload, full upload before it',()=>{
 const engine=Object.create(EarthSurfaceEngine.prototype);
 engine.classAtlas=makeEarthClassAtlas(EARTH_CLASS_LAYOUT.width,EARTH_CLASS_LAYOUT.height);
 engine.appearanceAtlas=makeEarthAtlas(EARTH_CLASS_LAYOUT.width,EARTH_CLASS_LAYOUT.height);
 const fresh=new EarthSurfaceEngine({init(){},buildTile(){return new Promise(()=>{});}});
 engine._atlasDirty=new Map([[engine.classAtlas,[]],[engine.appearanceAtlas,[]]]);
 engine._atlasStaging=new Map([[engine.classAtlas,{}],[engine.appearanceAtlas,{}]]);
 const band={i:2,size:256,classTexture:makeEarthClassAtlas(1024),texture:makeEarthAtlas(1024)};
 const known=new Set(),calls=[];
 const renderer={properties:{has:t=>known.has(t)},copyTextureToTexture:(src,dst,region,at)=>calls.push([dst===engine.classAtlas?'class':'appearance',region.min.x,region.min.y,region.max.x-region.min.x,region.max.y-region.min.y,at.x,at.y])};
 const v0=engine.appearanceAtlas.version;
 engine._packClassSlot(band,5);engine.flushAtlases(renderer);
 assert.equal(calls.length,0);assert.ok(engine.appearanceAtlas.version>v0,'no GPU copy yet: full upload');
 known.add(engine.classAtlas);known.add(engine.appearanceAtlas);
 const v1=engine.appearanceAtlas.version;
 engine._packClassSlot(band,5);engine._packClassSlot(band,10);engine.flushAtlases(renderer);
 const [ox,oy]=EARTH_CLASS_LAYOUT.bands[2];
 assert.equal(engine.appearanceAtlas.version,v1,'no full re-upload once resident');
 assert.deepEqual(calls,[['class',ox+256,oy+256,256,256,ox+256,oy+256],['class',ox+512,oy+512,256,256,ox+512,oy+512],
  ['appearance',ox+256,oy+256,256,256,ox+256,oy+256],['appearance',ox+512,oy+512,256,256,ox+512,oy+512]]);
 calls.length=0;engine.flushAtlases(renderer);assert.equal(calls.length,0,'dirty lists drain');
 assert.ok(fresh._atlasDirty instanceof Map&&fresh._atlasStaging.size===2,'the real constructor wires both atlases');
 fresh.dispose();band.texture.dispose();band.classTexture.dispose();
});
console.log(`ATLAS SUB-UPLOAD: ${checks}/${checks}`);

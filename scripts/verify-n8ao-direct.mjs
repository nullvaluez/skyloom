// lib/fly/n8ao-direct.js composites n8ao straight into the composer's output
// instead of into its own target followed by a copy. The pixels must be
// identical. Two fresh composers render the same frames (n8ao accumulates
// across frames), one through withDirectComposite and one through n8ao's own
// copy, and the canvases are compared byte for byte.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const root=new URL('../',import.meta.url);
const files={'/three.module.js':'node_modules/three/build/three.module.js','/three.core.js':'node_modules/three/build/three.core.js',
 '/Pass.js':'node_modules/three/examples/jsm/postprocessing/Pass.js','/postprocessing.js':'node_modules/postprocessing/build/index.js',
 '/n8ao.js':'node_modules/n8ao/dist/N8AO.js','/n8ao-direct.js':'lib/fly/n8ao-direct.js'};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']})
 .catch(()=>chromium.launch({headless:true,executablePath:process.env.FLY_CHROMIUM||undefined,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}));
try{
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('http://ao.test/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/index.html')return route.fulfill({contentType:'text/html',body:`<script type="importmap">{"imports":{"three":"/three.module.js","three/examples/jsm/postprocessing/Pass.js":"/Pass.js","postprocessing":"/postprocessing.js","n8ao":"/n8ao.js"}}</script>`});
  if(!files[path])return route.fulfill({status:404,body:''});
  return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL(files[path],root))});
 });
 await page.goto('http://ao.test/index.html');
 const result=await page.evaluate(async()=>{
  const THREE=await import('three'),PP=await import('postprocessing'),{N8AOPostPass}=await import('n8ao'),{withDirectComposite}=await import('/n8ao-direct.js');
  const W=320,H=180;
  const run=(direct)=>{
   const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
   const renderer=new THREE.WebGLRenderer({canvas,preserveDrawingBuffer:true,antialias:false});renderer.setSize(W,H,false);
   const scene=new THREE.Scene();scene.background=new THREE.Color('#8ab');
   const camera=new THREE.PerspectiveCamera(55,W/H,.5,500);camera.position.set(6,5,9);camera.lookAt(0,0,0);
   scene.add(new THREE.HemisphereLight('#fff','#432',1.2));const sun=new THREE.DirectionalLight('#fff',2.5);sun.position.set(3,8,2);scene.add(sun);
   const mat=new THREE.MeshStandardMaterial({color:'#ccc'});
   const ground=new THREE.Mesh(new THREE.PlaneGeometry(40,40),mat);ground.rotation.x=-Math.PI/2;scene.add(ground);
   for(let i=0;i<9;i++){const b=new THREE.Mesh(new THREE.BoxGeometry(1.2,1+i%4,1.2),mat);b.position.set((i%3-1)*2.2,(1+i%4)/2,(Math.floor(i/3)-1)*2.2);scene.add(b);}
   const composer=new PP.EffectComposer(renderer,{frameBufferType:THREE.HalfFloatType});
   composer.addPass(new PP.RenderPass(scene,camera));
   const ao=new N8AOPostPass(scene,camera,W,H);ao.configuration.aoRadius=2;ao.configuration.intensity=3;
   let used=null;
   if(direct){const base=ao.render.bind(ao);ao.render=(r,i,o,d,s)=>{used=withDirectComposite(ao,i,o,()=>base(r,i,o,d,s));};}
   composer.addPass(ao);
   composer.addPass(new PP.EffectPass(camera,new PP.BrightnessContrastEffect({brightness:0,contrast:0})));
   for(let f=0;f<6;f++)composer.render(1/60);
   const gl=renderer.getContext(),px=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
   const out={px,used,error:gl.getError()};composer.dispose();renderer.dispose();return out;
  };
  const copy=run(false),direct=run(true);
  let max=0,diff=0,lit=0;for(let i=0;i<copy.px.length;i++){const d=Math.abs(copy.px[i]-direct.px[i]);if(d){diff++;max=Math.max(max,d);}}
  for(let i=0;i<copy.px.length;i+=4)if(copy.px[i]+copy.px[i+1]+copy.px[i+2]>0)lit++;
  const ext=document.createElement('canvas').getContext('webgl2').getExtension('WEBGL_debug_renderer_info');
  return {diff,max,lit,pixels:copy.px.length/4,usedDirect:direct.used,errors:[copy.error,direct.error]};
 });
 assert.deepEqual(errors,[]);assert.deepEqual(result.errors,[0,0]);
 assert.equal(result.usedDirect,true,'the direct path must actually be taken in an ordinary composer');
 assert.ok(result.lit>result.pixels*.9,'the frame must contain the scene');
 assert.equal(result.diff,0,`${result.diff} bytes differ (max ${result.max})`);
 console.log(`PASS n8ao direct composite is byte-identical to the copy path (${result.pixels} px, direct path taken)`);
}finally{await browser.close();}

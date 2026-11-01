/** Bake CC0 source trees into a shared four-view foliage atlas. The large
 * authoring meshes stay in .graphics-review; runtime ships only KTX2 tiers.
 * Requires installed Chrome and toktx. No Blender, marketplace key or CDN at runtime.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import sharp from 'sharp';
const root='public/materials/forest-atlas-v1',cache='.graphics-review/premium-earth/forest-source';
const toktx=process.argv.find(v=>v.startsWith('--toktx='))?.slice(8)||process.env.TOKTX||'toktx';
await fs.mkdir(root,{recursive:true});await fs.mkdir(cache,{recursive:true});
const hash=(b,mode='sha256')=>crypto.createHash(mode).update(b).digest('hex');
const manifest={schema:'skyloom-foliage-atlas/1',license:'CC0-1.0',licenseUrl:'https://polyhaven.com/license',columns:4,rows:2,views:[0,45,90,135],sources:[],variants:{}};
const pinned=await fs.readFile(`${root}/manifest.json`,'utf8').then(JSON.parse).catch(()=>null);
for(const [row,id]of ['tree_small_02','fir_tree_01'].entries()){
 let lock;try{lock=JSON.parse(await fs.readFile(`${cache}/${id}/source.json`,'utf8'));}catch{
  const source=pinned?.sources.find(s=>s.id===id);
  if(source?.sourceFiles){const file=source.sourceFiles['source.gltf'];lock={id,name:source.name,author:source.author,url:source.url,file:{...file,include:Object.fromEntries(Object.entries(source.sourceFiles).filter(([name])=>name!=='source.gltf'))}};}
  else{
  const [files,info]=await Promise.all(['files','info'].map(async k=>{const r=await fetch(`https://api.polyhaven.com/${k}/${id}`);if(!r.ok)throw Error(r.status);return r.json();}));
  lock={id,name:info.name,author:Object.keys(info.authors).join(', '),url:`https://polyhaven.com/a/${id}`,file:files.gltf['1k'].gltf};
  }
 }
 await fs.mkdir(`${cache}/${id}/textures`,{recursive:true});await fs.writeFile(`${cache}/${id}/source.json`,JSON.stringify(lock,null,2));
 const entries=[['source.gltf',lock.file],...Object.entries(lock.file.include)];
 for(let start=0;start<entries.length;start+=3)await Promise.all(entries.slice(start,start+3).map(async([name,file])=>{
  const dest=`${cache}/${id}/${name}`;let bytes;try{bytes=await fs.readFile(dest);}catch{}
  if(!bytes||hash(bytes,'md5')!==file.md5){const r=await fetch(file.url);if(!r.ok)throw Error(`${id}: ${r.status}`);bytes=Buffer.from(await r.arrayBuffer());if(hash(bytes,'md5')!==file.md5)throw Error('Tree source checksum mismatch');await fs.writeFile(dest,bytes);}
 }));
 manifest.sources.push({...lock,row,file:undefined,selectedNode:id==='fir_tree_01'?'fir_tree_01_a_LOD0':null,sourceMd5:lock.file.md5,sourceFiles:Object.fromEntries(entries.map(([name,{url,md5,size}])=>[name,{url,md5,size}]))});console.log(`Downloaded verified ${id}`);
}
const html=`<!doctype html><style>html,body{margin:0;background:transparent}</style><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script><script type="module">
import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setSize(512,1024);renderer.setPixelRatio(1);renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;document.body.append(renderer.domElement);
window.bake=async({id,selectedNode})=>{
 const gltf=await new GLTFLoader().loadAsync('/source/'+id+'/source.gltf'),scene=new THREE.Scene();scene.add(gltf.scene);
 if(selectedNode)for(const child of gltf.scene.children)child.visible=child.name===selectedNode;
 if(selectedNode){const chosen=gltf.scene.getObjectByName(selectedNode);if(!chosen)throw Error('Missing selected tree '+selectedNode);gltf.scene.remove(...gltf.scene.children.filter(c=>c!==chosen));}
 const bounds=new THREE.Box3().setFromObject(gltf.scene),size=bounds.getSize(new THREE.Vector3()),centre=bounds.getCenter(new THREE.Vector3());
 gltf.scene.position.sub(new THREE.Vector3(centre.x,bounds.min.y,centre.z));
 gltf.scene.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.roughness=1;o.material.metalness=0;o.material.envMapIntensity=0;}});
 scene.add(new THREE.HemisphereLight(0xffffff,0x777777,2.0));const sun=new THREE.DirectionalLight(0xffffff,1.2);sun.position.set(-2,5,3);scene.add(sun);
 const height=size.y*1.08,width=Math.max(size.x,size.z)*1.12,camera=new THREE.OrthographicCamera(-width/2,width/2,height/2,-height/2,.01,size.y*10);
 const target=new THREE.Vector3(0,size.y*.5,0),views=[];
 for(const angle of [0,45,90,135]){const a=angle*Math.PI/180;camera.position.set(Math.sin(a)*size.y*3,size.y*.5,Math.cos(a)*size.y*3);camera.lookAt(target);renderer.render(scene,camera);views.push(renderer.domElement.toDataURL('image/png'));}
 gltf.scene.traverse(o=>{o.geometry?.dispose();for(const m of [o.material].flat().filter(Boolean)){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}});
 return {views,aspect:width/height,heightM:size.y};
};window.ready=true;</script>`;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const match=url.pathname.startsWith('/three/')?{base:'node_modules/three',suffix:url.pathname.slice(7)}:url.pathname.startsWith('/source/')?{base:cache,suffix:url.pathname.slice(8)}:null;
  if(!match){res.writeHead(404);res.end();return;}
  const base=path.resolve(match.base),file=path.resolve(base,decodeURIComponent(match.suffix));if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
  const type={'.js':'text/javascript','.gltf':'model/gltf+json','.jpg':'image/jpeg','.png':'image/png'}[path.extname(file)]||'application/octet-stream';res.setHeader('Content-Type',type);res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:512,height:1024},deviceScaleFactor:1});page.on('pageerror',e=>console.error(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
 const layers=[];
 for(const source of manifest.sources){
  const result=await page.evaluate(source=>window.bake(source),source);source.bakedAspect=result.aspect;source.sourceHeightM=result.heightM;
  for(let view=0;view<4;view++){const bytes=Buffer.from(result.views[view].split(',')[1],'base64');layers.push({input:bytes,left:view*512,top:source.row*1024});}
  console.log(`Rendered ${source.id}: ${result.heightM.toFixed(2)} m, four views`);
 }
 await sharp({create:{width:2048,height:2048,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(layers).png().toFile(`${cache}/atlas.png`);
 for(const size of [512,1024,2048]){
  const input=path.resolve(cache,`atlas-${size}.png`);await sharp(`${cache}/atlas.png`).resize(size,size).png().toFile(input);
  const file=`foliage-${size}.ktx2`;execFileSync(toktx,['--t2','--encode','uastc','--uastc_quality','2','--zcmp','10','--genmipmap','--assign_oetf','srgb','--target_type','RGBA',path.resolve(root,file),input],{stdio:'inherit'});
  const bytes=await fs.readFile(`${root}/${file}`);manifest.variants[size]={file,bytes:bytes.length,sha256:hash(bytes),width:size,height:size};
 }
 await fs.writeFile(`${root}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

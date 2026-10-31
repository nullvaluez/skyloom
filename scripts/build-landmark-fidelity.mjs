/** Offline, deterministic authored architecture; three LODs per marquee landmark.
 * node scripts/build-landmark-fidelity.mjs [--check] [--only=big-ben]
 * Eiffel retains the already credited Scott Marshall / CC BY 3.0 structure.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { T, Architecture, finishSurface } from './landmark-fidelity/geometry.mjs';
import { empire, willis, cn, spaceNeedle, burj } from './landmark-fidelity/towers.mjs';
import { taj, bigBen, gateway } from './landmark-fidelity/heritage.mjs';
import { opera } from './landmark-fidelity/opera-source.mjs';
import { colosseum } from './landmark-fidelity/colosseum.mjs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
registerHooks({resolve(s,c,n){if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return n(u.href+'.js',c);}return n(s,c);}});
const { MONUMENT_BUILDERS }=await import('../lib/fly/monument-builders.js');
globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(b=>{this.result=`data:${blob.type};base64,${Buffer.from(b).toString('base64')}`;this.onloadend?.();});}};

async function eiffel(level){
  const b=new Architecture(level);let g;
  if(level==='high'){
    const buf=fs.readFileSync('public/models/monument-eiffel-detail-v1.glb');
    const hash=createHash('sha256').update(buf).digest('hex');
    if(hash!=='c8dbd26591edaf826c2ae8dd3fa75a363fd2e237db050f37cc396172f663fddb')throw Error('Eiffel source hash changed');
    const gltf=await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength),'');
    g=gltf.scene.children[0].geometry.clone();g.scale(330,330,330);
    gltf.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  }else { g=MONUMENT_BUILDERS.eiffel(level==='medium').toNonIndexed();g.computeVertexNormals(); }
  b.parts.push(finishSurface(g,'iron',{keepColor:level==='high',emit:.13,roughness:.52,metalness:.57}));
  if(b.detail){
    for(const [y,half]of [[57,34],[115,18]]){
      for(let side=0;side<4;side++){
        const a=side*Math.PI/2,wp=(u,v,yy)=>[u*Math.cos(a)+v*Math.sin(a),yy,-u*Math.sin(a)+v*Math.cos(a)];
        for(const yy of [y+.4,y+1.5])b.beam(wp(-half,half,yy),wp(half,half,yy),.16,.16,'iron',{emit:.18});
        const spacing=level==='high'?5:7;
        for(let u=-half;u<=half;u+=spacing)b.beam(wp(u,half,y+.4),wp(u,half,y+1.5),.12,.12,'iron');
        const [x,,z]=wp(0,half-1,y+2);
        b.face(x,y+1.6,z,half*1.55,3.6,'darkGlass',a,{emit:.16,unlitMask:true});
      }
    }
    b.box(0,276,0,9,4,9,'darkGlass',{emit:.2,unlitMask:true});
  }
  return b.end();
}

const specs=[
  ['empire-state','Empire State Building',443,empire],['willis','Willis Tower',527,willis],
  ['cn-tower','CN Tower',553,cn],['space-needle','Space Needle',184,spaceNeedle],
  ['burj-khalifa','Burj Khalifa',828,burj],['taj-mahal','Taj Mahal',73,taj],
  ['big-ben','Big Ben',96,bigBen],['gateway-arch','Gateway Arch',192,gateway],
  ['opera-house','Sydney Opera House',65,opera],['colosseum','Colosseum',48,colosseum],
  ['eiffel','Eiffel Tower',330,eiffel],
];
const only=process.argv.find(s=>s.startsWith('--only='))?.slice(7),check=process.argv.includes('--check');
const records=[];
for(const [id,poi,height,build]of specs){
  if(only&&id!==only)continue;
  for(const level of ['far','medium','high']){
    const g=await build(level);g.computeBoundingBox();
    const bb=g.boundingBox.clone(),h=bb.max.y-bb.min.y;
    if(!Number.isFinite(h)||h<=0)throw Error(`${id}: invalid geometry`);
    // Height is normalized once; runtime applies the unchanged POI height and scale.
    g.translate(-(bb.min.x+bb.max.x)/2,-bb.min.y,-(bb.min.z+bb.max.z)/2);g.scale(1/h,1/h,1/h);g.computeBoundingBox();
    // All authored surface/light values are 0..1: normalized bytes preserve them
    // within 1/255 and keep the close models inside the existing download budget.
    for(const name of ['_model_surface','_model_light']){
      const attr=g.getAttribute(name),packed=new Uint8Array(attr.count*attr.itemSize);
      for(let i=0;i<attr.count;i++)for(let k=0;k<attr.itemSize;k++)packed[i*attr.itemSize+k]=Math.round(Math.max(0,Math.min(1,attr.getComponent(i,k)))*255);
      g.setAttribute(name,new T.BufferAttribute(packed,attr.itemSize,true));
    }
    const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.8});
    const mesh=new T.Mesh(g,material);mesh.name=poi;
    const source=id==='opera-house'?'Nick Reinhardt / CC BY 4.0; material treatment Skyloom / MIT':id==='eiffel'&&level==='high'?'Scott Marshall / CC BY 3.0; additions Skyloom / MIT':'Skyloom / MIT';
    const sourceUrl=id==='opera-house'?'https://sketchfab.com/3d-models/sydney-opera-house-317b2d540f0a4f7e8d87dd3b0372712d':id==='eiffel'&&level==='high'?'https://poly.pizza/m/aIpJchqtRTg':null;
    mesh.userData={poi,level,version:2,targetHeightM:height,authoring:source,sourceUrl,credits:'/licenses/landmark-fidelity.md'};
    const data=Buffer.from(await new GLTFExporter().parseAsync(mesh,{binary:true}));
    const file=`/models/landmark-${id}-${level}-v2.glb`,triangles=g.index.count/3;
    const record={poi,level,file,triangles,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),targetHeightM:height,
      source,sourceUrl,
      footprintM:[(bb.max.x-bb.min.x)*height/h,(bb.max.z-bb.min.z)*height/h]};
    const max=level==='high'?60000:level==='medium'?20000:10000;
    if(triangles>max||data.length>(level==='high'?4:2)*1024*1024)throw Error(`${id} ${level} exceeds budget: ${triangles} triangles / ${data.length} bytes`);
    if(check){if(!fs.readFileSync('public'+file).equals(data))throw Error(`${file}: nondeterministic`);}else fs.writeFileSync('public'+file,data);
    records.push(record);console.log(`${poi} ${level}: ${triangles} triangles / ${(data.length/1024).toFixed(0)} KiB`);
    g.dispose();material.dispose();
  }
}
if(!check){
  const dest='lib/fly/landmark-fidelity-assets.json';
  const previous=only&&fs.existsSync(dest)?JSON.parse(fs.readFileSync(dest)).filter(r=>!records.some(n=>n.poi===r.poi)):[];
  fs.writeFileSync(dest,JSON.stringify([...previous,...records],null,2)+'\n');
}else console.log(`DETERMINISTIC: ${records.length} assets byte-identical`);

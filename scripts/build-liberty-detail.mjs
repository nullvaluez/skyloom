/** Scanned Liberty + authored Hunt pedestal. Source is never downloaded at runtime.
 * node scripts/build-liberty-detail.mjs --source=<Objaverse GLB> [--check]
 * Sculpture: jerryfisher, CC BY 4.0. public/licenses/liberty-detail.md.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(b => { this.result=b; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(b => { this.result=`data:${blob.type};base64,${Buffer.from(b).toString('base64')}`; this.onloadend?.(); }); }
};
const source = process.argv.find(a=>a.startsWith('--source='))?.slice(9);
if (!source) throw Error('Pass --source=<liberty-source.glb>; see the license record for the exact source URL.');
const bytes=fs.readFileSync(source);
const sourceHash=createHash('sha256').update(bytes).digest('hex');
if(sourceHash!=='e9c789977604980d410e30b95e02208ca6e46d053f44bc0f5c5030877eaa5fe8')throw Error('Unexpected Liberty source; use the credited, hash-pinned Objaverse GLB.');
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
gltf.scene.updateMatrixWorld(true);
const scanned=[];
gltf.scene.traverse(o=>{if(o.isMesh){const g=o.geometry.clone().applyMatrix4(o.matrixWorld);for(const key of Object.keys(g.attributes))if(key!=='position')g.deleteAttribute(key);scanned.push(g);}});
const raw=mergeGeometries(scanned);const figure=mergeVertices(raw,1e-5);raw.dispose();scanned.forEach(g=>g.dispose());
figure.computeBoundingBox();
const bb=figure.boundingBox.clone(),scale=46.05/(bb.max.y-bb.min.y);
// Centre on the feet, not the torch's off-axis bounding box.
const feet=new T.Box3(),v=new T.Vector3(),p=figure.attributes.position;
for(let i=0;i<p.count;i++)if(p.getY(i)<bb.min.y+(bb.max.y-bb.min.y)*.06)feet.expandByPoint(v.fromBufferAttribute(p,i));
const center=feet.getCenter(new T.Vector3());
figure.translate(-center.x,-bb.min.y,-center.z);figure.scale(scale,scale,scale);figure.translate(0,46.95,0);
figure.computeVertexNormals();
await MeshoptSimplifier.ready;

function surface(g,hex,rough=.84,metal=0,kind='stone') {
  const base=new T.Color(hex),a=g.attributes.position,n=a.count,colors=new Uint8Array(n*3),surf=new Float32Array(n*2),light=new Float32Array(n*3);
  for(let i=0;i<n;i++){
    const x=a.getX(i),y=a.getY(i),z=a.getZ(i);
    const mottling=.95+.035*Math.sin(x*1.31+z*.7)*Math.sin(y*1.77-z*.8)+.025*Math.sin(x*4.7+y*3.1);
    const gold=kind==='copper'&&y>90.4;
    const c=gold?new T.Color('#dca846'):base;
    for(let k=0;k<3;k++)colors[i*3+k]=Math.round(Math.min(1,c.toArray()[k]*mottling)*255);
    surf.set(gold?[.28,.7]:[rough,metal],i*2);
    const wash=kind==='copper'?.16:.07;
    light.set(gold?[1.1,.62,.17]:[wash*.78,wash,wash*.86],i*3);
  }
  g.setAttribute('color',new T.BufferAttribute(colors,3,true));
  g.setAttribute('_model_surface',new T.BufferAttribute(surf,2));
  g.setAttribute('_model_light',new T.BufferAttribute(light,3));
  g.deleteAttribute('uv');return g;
}
function pedestal(detail){
  const pieces=[];
  const box=(x,y,z,w,h,d,col='#c2b49a')=>{const g=new T.BoxGeometry(w,h,d);g.translate(x,y+h/2,z);pieces.push(surface(g,col));};
  // Eleven-point Fort Wood. No terrain-sized slab or baked island.
  const outline=new T.Shape();
  for(let i=0;i<44;i++) {const a=i/44*Math.PI*2,r=i%4<2?32:24.5,x=Math.cos(a)*r,z=Math.sin(a)*r;i?outline.lineTo(x,z):outline.moveTo(x,z);}
  outline.closePath();const fort=new T.ExtrudeGeometry(outline,{depth:4.5,bevelEnabled:false,steps:1});fort.rotateX(-Math.PI/2);pieces.push(surface(fort,'#a69d85'));
  box(0,4.5,0,27.7,2.1,27.7,'#b9ac92');
  box(0,6.6,0,24.5,13.2,24.5,'#b7a88c');
  box(0,19.8,0,22.2,1.0,22.2,'#c9bda4');
  box(0,20.8,0,20.1,2.3,20.1);
  box(0,23.1,0,18.6,13.6,18.6,'#c4b79b');
  box(0,36.7,0,20.6,1.0,20.6,'#d4c8af');
  box(0,37.7,0,16.5,5.2,16.5,'#9e9279');
  box(0,42.9,0,21.0,.8,21.0,'#d3c8b0');
  box(0,43.7,0,19.1,1.1,19.1,'#c8baa1');
  box(0,44.8,0,15.4,1.3,15.4,'#b7aa8d');
  box(0,46.1,0,13.2,.85,13.2,'#c9bea4');
  if(detail){
    // Recessed loggia windows, pilasters and the observation parapet, all faces.
    for(let side=0;side<4;side++){
      const wall=(u,y,vv,w,h,d,col)=>side%2?box(vv*(side===1?1:-1),y,u,d,h,w,col):box(u,y,vv*(side===0?1:-1),w,h,d,col);
      for(let i=-3;i<=3;i++){
        wall(i*2.3,38.3,8.3,1.25,3.9,.12,'#474a40');
        wall(i*2.3-1.0,37.8,8.72,.48,4.9,.7,'#d2c5a9');
        wall(i*2.3+1.0,37.8,8.72,.48,4.9,.7,'#d2c5a9');
        wall(i*2.65,26.2,9.33,.72,8.5,.22,'#b1a387');
      }
      wall(0,8,12.29,3.5,8,.16,'#514e40');
      for(let i=-5;i<=5;i++)wall(i*1.85,43.7,9.65,.27,.9,.25,'#9c917c');
      // Fine masonry courses remain geometry only on medium/high.
      for(let j=1;j<9;j++)wall(0,7+j*1.35,12.26,24.4,.045,.035,'#8f856f');
      for(let j=0;j<8;j++)wall(0,24+j*1.5,9.32,18.5,.035,.03,'#a49880');
    }
  }
  for(const g of pieces)if(!g.index)g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));
  const out=mergeGeometries(pieces);
  pieces.forEach(g=>g.dispose());return out;
}
const records=[];
const locked=new Uint8Array(p.count);
let bottom=0,top=0;
for(let i=1;i<p.count;i++){if(p.getY(i)>p.getY(top))top=i;if(p.getY(i)<p.getY(bottom))bottom=i;}
locked[bottom]=locked[top]=1;
for(const [level,count]of [['far',4200],['medium',14000],['high',49000]]){
  const [idx,error]=MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(figure.index.array),figure.attributes.position.array,3,figure.attributes.normal.array,3,[0,0,0],locked,count*3,.02,['Prune']);
  // Compact explicitly: guarantees identical vertex order across optimizer versions.
  const remap=new Map(),positions=[],indices=[];
  for(const old of idx){if(!remap.has(old)){remap.set(old,remap.size);positions.push(p.getX(old),p.getY(old),p.getZ(old));}indices.push(remap.get(old));}
  const body=new T.BufferGeometry();body.setAttribute('position',new T.Float32BufferAttribute(positions,3));body.setIndex(indices);body.computeVertexNormals();
  surface(body,'#6caa99',.78,.18,'copper');
  const base=pedestal(level!=='far');
  // Extrusion is non-indexed; make all pieces indexed before merging.
  const ensureIndexed=g=>{if(!g.index)g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));return g;};
  const combined=mergeGeometries([ensureIndexed(body),ensureIndexed(base)]);
  combined.computeBoundingBox();
  if(Math.abs(combined.boundingBox.max.y-93)>.01)throw Error('Liberty height must stay 93 m');
  const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.8});
  const mesh=new T.Mesh(combined,material);mesh.name='Liberty — scanned copper and Hunt pedestal';
  mesh.userData={source:'jerryfisher / CC BY 4.0',sourceHash,figureHeightM:46.05,pedestalHeightM:46.95,level};
  const data=Buffer.from(await new GLTFExporter().parseAsync(mesh,{binary:true}));
  const file=`/models/monument-liberty-${level}-v2.glb`;
  if(process.argv.includes('--check')) {if(!fs.readFileSync(`public${file}`).equals(data))throw Error(`${level}: nondeterministic asset`);}
  else fs.writeFileSync(`public${file}`,data);
  const record={poi:'Statue of Liberty',level,file,triangles:combined.index.count/3,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),source:'jerryfisher / CC BY 4.0; pedestal Skyloom / MIT',sourceHash,simplificationError:error};
  if(record.triangles>(level==='high'?60000:level==='medium'?20000:6000))throw Error('Liberty triangle budget exceeded');
  if(record.bytes>(level==='high'?4:2)*1024*1024)throw Error('Liberty byte budget exceeded');
  records.push(record);console.log(record);
  body.dispose();base.dispose();combined.dispose();material.dispose();
}
if(!process.argv.includes('--check'))fs.writeFileSync('lib/fly/liberty-detail-assets.json',JSON.stringify(records,null,2)+'\n');

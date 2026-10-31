// Nick Reinhardt, CC BY 4.0. Restores the detailed original source already
// credited for the old simplified model; no external texture survives the bake.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { T, Architecture } from './geometry.mjs';
let sources;
export async function opera(level){
  if(!sources){
    const dir=process.argv.find(s=>s.startsWith('--opera-source='))?.slice(15) ?? '.graphics-review/landmark-fidelity/opera-source';
    const json=fs.readFileSync(path.join(dir,'scene.gltf')),j=JSON.parse(json),bin=fs.readFileSync(path.join(dir,'scene.bin'));
    if(createHash('sha256').update(json).digest('hex')!=='0d3b533d3dfd0c90a024d0b59121259fd4846b0a879d90f8a07a61ece38594fb')throw Error('Opera House source scene differs from the credited original');
    if(createHash('sha256').update(bin).digest('hex')!=='690fb7caffbe3e45e149a5aea82f267e97527ac234614b4f517437e722b74c9b')throw Error('Opera House source binary differs from the credited original');
    if(j.asset.extras?.author!=='Nick Reinhardt (https://sketchfab.com/Nickardiamond)' || !j.asset.extras.license.startsWith('CC-BY-4.0'))throw Error('Opera House provenance differs from the credited original');
    j.buffers[0].uri='data:application/octet-stream;base64,'+bin.toString('base64');
    j.materials=j.materials.map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}}));
    delete j.images;delete j.textures;delete j.samplers;
    globalThis.ProgressEvent ??= class {constructor(type,init){this.type=type;Object.assign(this,init);}};
    const gltf=await new GLTFLoader().parseAsync(JSON.stringify(j),'');gltf.scene.updateMatrixWorld(true);
    sources=[];
    gltf.scene.traverse(o=>{
      if(!o.isMesh||o.geometry.attributes.position.count<=4)return; // water, backdrop, ground planes
      const g=o.geometry.clone().applyMatrix4(o.matrixWorld);
      for(const key of Object.keys(g.attributes))if(!['position','normal'].includes(key))g.deleteAttribute(key);
      const welded=mergeVertices(g,1e-5);g.dispose();sources.push({g:welded,material:o.material.name});
    });
    gltf.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});await MeshoptSimplifier.ready;
  }
  const b=new Architecture(level),ratio=level==='high'?.88:level==='medium'?.22:.06;
  for(const {g,material}of sources){
    const p=g.attributes.position,n=g.attributes.normal;
    const [idx]=MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(g.index.array),p.array,3,n.array,3,[.03,.03,.03],null,Math.floor(g.index.count*ratio/3)*3,.025,['Prune']);
    const result=g.clone();result.setIndex(new T.BufferAttribute(idx,1));
    const spec={FINS:['ceramic',{color:'#dedbce',roughness:.42,emit:.035}],GLASS:['darkGlass',{color:'#3f5660',emit:.15,unlitMask:true}],BRONZE:['darkSteel',{color:'#574f3e',metalness:.64}],STONE:['limestone',{color:'#ac977a'}],LIGHTPOLE:['darkSteel',{}],LIGHT:['ceramic',{emit:.4,unlitMask:true}]}[material]??['limestone',{}];
    b.add(result,...spec);
  }
  return b.end();
}

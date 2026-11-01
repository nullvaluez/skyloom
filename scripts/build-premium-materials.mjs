/** Offline CC0 surface pipeline. Runtime never calls an asset marketplace.
 * node scripts/build-premium-materials.mjs --toktx=/path/to/toktx
 * Originals and intermediate PNGs are cached outside the shipped tree.
 * Source maps are checksum-locked in public/materials/earth-scans-v1/manifest.json.
 * Two arrays retain the existing eight-layer / two-sampler material contract.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import sources from '../lib/fly/premium-material-sources.json' with { type: 'json' };

const args=Object.fromEntries(process.argv.slice(2).map(s=>{const [k,...v]=s.replace(/^--/,'').split('=');return[k,v.join('=')];}));
const root='public/materials/earth-scans-v1',cache='.graphics-review/premium-earth/material-source';
const toktx=args.toktx||process.env.TOKTX||'toktx';
const hash=(data,algorithm='sha256')=>crypto.createHash(algorithm).update(data).digest('hex');
await fs.mkdir(root,{recursive:true});await fs.mkdir(cache,{recursive:true});
let previous=null;try{previous=JSON.parse(await fs.readFile(`${root}/manifest.json`,'utf8'));}catch{}
const manifest={schema:'skyloom-surface-arrays/1',version:1,license:'CC0-1.0',licenseUrl:'https://polyhaven.com/license',
 channels:{color:'sRGB albedo RGB, linear roughness A',detail:'linear OpenGL normal XY, height B, ambient occlusion A'},
 encoding:'KTX2 UASTC, full mip chain; transcodes to ASTC / BC7 / ETC2 at load',
 layers:[],variants:{}};
const types={color:'Diffuse',normal:'nor_gl',rough:'Rough',height:'Displacement',ao:'AO'};
const rgba=[];
for(const source of sources){
 const lock=previous?.layers.find(s=>s.id===source.id);
 let entry=lock?{...lock,...source}:null;
 if(!entry){
  const [info,files]=await Promise.all(['info','files'].map(async endpoint=>{
   const r=await fetch(`https://api.polyhaven.com/${endpoint}/${source.id}`);if(!r.ok)throw Error(`${source.id}: ${r.status}`);return r.json();
  }));
  entry={...source,name:info.name,author:Object.keys(info.authors).join(', '),url:`https://polyhaven.com/a/${source.id}`,maps:{}};
  for(const [kind,type]of Object.entries(types)){
   const formats=files[type]?.['1k'];const file=formats?.png??formats?.jpg;
   if(!file)throw Error(`${source.id}: missing ${type} 1k`);
   entry.maps[kind]={url:file.url,md5:file.md5,bytes:file.size};
  }
 }
 const maps={};
 // Sequential assets, at most three map downloads at once.
 for(let start=0;start<Object.entries(entry.maps).length;start+=3){
  await Promise.all(Object.entries(entry.maps).slice(start,start+3).map(async([kind,file])=>{
   const local=path.join(cache,`${source.id}-${kind}${path.extname(new URL(file.url).pathname)}`);
   let bytes;try{bytes=await fs.readFile(local);}catch{}
   if(!bytes||hash(bytes,'md5')!==file.md5){const r=await fetch(file.url);if(!r.ok)throw Error(`${file.url}: ${r.status}`);bytes=Buffer.from(await r.arrayBuffer());if(hash(bytes,'md5')!==file.md5)throw Error(`Source checksum: ${source.id}/${kind}`);await fs.writeFile(local,bytes);}
   maps[kind]=await sharp(bytes).resize(1024,1024,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
  }));
 }
 const color=Buffer.alloc(1024*1024*4),detail=Buffer.alloc(color.length);
 for(let i=0;i<1024*1024;i++){
  const s=i*3,d=i*4;color[d]=maps.color[s];color[d+1]=maps.color[s+1];color[d+2]=maps.color[s+2];color[d+3]=maps.rough[s];
  detail[d]=maps.normal[s];detail[d+1]=maps.normal[s+1];detail[d+2]=maps.height[s];detail[d+3]=maps.ao[s];
 }
 rgba.push({color,detail});manifest.layers.push(entry);console.log(`Prepared ${source.surface}: ${source.id}`);
}
for(const size of [128,256,512,1024]){
 const variant={size,layers:8,files:{}};
 for(const kind of ['color','detail']){
  const inputs=[];
  for(let i=0;i<8;i++){
   const file=path.resolve(cache,`${kind}-${size}-${i}.png`);inputs.push(file);
   // Gamma filtering only on RGB albedo. Packed scalar/normal channels remain linear.
   const raw={width:1024,height:1024,channels:4};
   const rgb=sharp(rgba[i][kind],{raw}).removeAlpha();
   const rgbBytes=await (kind==='color'?rgb.gamma():rgb).resize(size,size,{kernel:'lanczos3'}).raw().toBuffer();
   const alpha=await sharp(rgba[i][kind],{raw}).extractChannel(3).resize(size,size,{kernel:'lanczos3'}).raw().toBuffer();
   // Alpha is data, never coverage. Resize it separately to avoid premultiplying
   // albedo/normal XY by roughness/AO at every tier.
   const packed=Buffer.alloc(size*size*4);
   for(let p=0;p<size*size;p++){packed[p*4]=rgbBytes[p*3];packed[p*4+1]=rgbBytes[p*3+1];packed[p*4+2]=rgbBytes[p*3+2];packed[p*4+3]=alpha[p];}
   await sharp(packed,{raw:{width:size,height:size,channels:4}}).png().toFile(file);
  }
  const file=`${kind}-${size}.ktx2`,destination=path.resolve(root,file);
  execFileSync(toktx,['--t2','--encode','uastc','--uastc_quality','2','--zcmp','10','--threads','4','--genmipmap','--layers','8','--target_type','RGBA','--assign_oetf',kind==='color'?'srgb':'linear','--assign_primaries',kind==='color'?'bt709':'none',destination,...inputs],{stdio:'inherit'});
  const bytes=await fs.readFile(destination);variant.files[kind]={file,bytes:bytes.length,sha256:hash(bytes)};
 }
 manifest.variants[size]=variant;console.log(`Encoded ${size}px x 8 layers`);
}
await fs.writeFile(`${root}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
const decoder='public/decoders/basis';await fs.mkdir(decoder,{recursive:true});
for(const name of ['basis_transcoder.js','basis_transcoder.wasm'])await fs.copyFile(`node_modules/three/examples/jsm/libs/basis/${name}`,`${decoder}/${name}`);
await fs.copyFile('node_modules/three/LICENSE',`${decoder}/THREE-LICENSE.txt`);
await fs.writeFile(`${decoder}/README.md`,'Basis Universal transcoder distributed with Three.js r185. Apache-2.0 (Basis Universal); MIT (Three.js wrapper). Source: https://github.com/BinomialLLC/basis_universal\n');
// A small review contact sheet is a build artifact, not another runtime texture.
const tiles=await Promise.all(rgba.map(async(row,i)=>({input:await sharp(row.color,{raw:{width:1024,height:1024,channels:4}}).removeAlpha().resize(256,256).png().toBuffer(),left:(i%4)*256,top:Math.floor(i/4)*256})));
await sharp({create:{width:1024,height:512,channels:3,background:'#171b20'}}).composite(tiles).png().toFile(`${cache}/contact-sheet.png`);
console.log(`Wrote ${root}/manifest.json`);

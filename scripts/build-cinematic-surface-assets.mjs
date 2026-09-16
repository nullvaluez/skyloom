/** Pack downloaded CC0 source maps into the existing two 5.33 MiB arrays.
 * Run with --source=PATH containing Poly Haven /info and /files metadata plus
 * the four 1k PNG maps listed by each asset. The output manifest records hashes
 * and original download URLs, so the source can be recovered independently.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {buildMaterialArrays,MATERIAL_NAMES} from '../lib/fly/cinematic-material-data.js';
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const source=args.source??'.graphics-review/cinematic-flight/material-sources';
const directory='public/materials/cinematic-v2',size=256,data=buildMaterialArrays(size);
const entries=[['asphalt_04',0,4],['concrete_floor_02',1,2],['leafy_grass',4,2],['aerial_ground_rock',5,16],['aerial_sand',6,16]];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const srgb=v=>Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055));
const thirdPartyAssets=[];
for(const [id,layer,repeatM] of entries){
  const meta=JSON.parse(fs.readFileSync(path.join(source,`${id}.json`),'utf8'));
  const maps={},files=[];
  for(const name of ['Diffuse','nor_gl','Rough','Displacement']){
    const info=meta.files[name]['1k'].png??meta.files[name]['1k'].jpg;
    const original=fs.readFileSync(path.join(source,path.basename(info.url)));
    if(crypto.createHash('md5').update(original).digest('hex')!==info.md5)throw Error(`Source hash mismatch: ${id}/${name}`);
    // Data maps bypass ICC transforms; diffuse is resampled in linear light.
    const input=sharp(original,{ignoreIcc:name!=='Diffuse'}).removeAlpha();
    maps[name]=await (name==='Diffuse'?input.gamma().resize(size,size).gamma():input.resize(size,size)).toColourspace('srgb').raw().toBuffer();
    files.push({map:name,url:info.url,bytes:original.length,sha256:hash(original),md5:info.md5});
  }
  let mean=0;for(let i=0;i<size*size;i++){const d=maps.Diffuse;mean+=linear(d[i*3]/255)*.2126+linear(d[i*3+1]/255)*.7152+linear(d[i*3+2]/255)*.0722;}mean/=size*size;
  for(let i=0;i<size*size;i++){
    const at=(layer*size*size+i)*4,rgb=[0,1,2].map(c=>linear(maps.Diffuse[i*3+c]/255));
    const lum=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
    // Neutral relative albedo preserves geographic color instead of stamping
    // one photographed grass or rock hue over every biome in the world.
    const relative=.42*Math.pow(lum/Math.max(.001,mean),.8);
    for(let c=0;c<3;c++)data.color[at+c]=srgb(Math.max(.04,Math.min(.82,relative*(.85+.15*rgb[c]/Math.max(.001,lum)))));
    data.color[at+3]=maps.Rough[i*3];
    const n=[0,1,2].map(c=>maps.nor_gl[i*3+c]/127.5-1),length=Math.max(.001,Math.hypot(...n));
    data.detail[at]=Math.round((n[0]/length*.5+.5)*255);data.detail[at+1]=Math.round((n[1]/length*.5+.5)*255);
    data.detail[at+2]=maps.Displacement[i*3];data.detail[at+3]=Math.round(232+23*maps.Displacement[i*3]/255);
  }
  thirdPartyAssets.push({id,name:meta.info.name,authors:meta.info.authors,source:`https://polyhaven.com/a/${id}`,license:'CC0-1.0',licenseUrl:'https://polyhaven.com/license',sourceDimensionsMm:meta.info.dimensions,authoredRepeatM:repeatM,layer,files});
}
fs.mkdirSync(directory,{recursive:true});const assets=[];
for(const key of ['color','detail']){const bytes=data[key],file=`${key}.bin`;fs.writeFileSync(`${directory}/${file}`,bytes);assets.push({file,bytes:bytes.length,sha256:hash(bytes)});}
fs.writeFileSync(`${directory}/manifest.json`,JSON.stringify({revision:2,source:'Five CC0 Poly Haven surface sets with first-party masonry, roofing and snow',generator:'scripts/build-cinematic-surface-assets.mjs',license:'CC0-1.0 source maps; Project MIT license for first-party artwork',thirdPartyAssets,size,layers:MATERIAL_NAMES,format:'RGBA8 texture arrays; color RGB sRGB relative albedo, color alpha linear roughness; detail linear normal XY, height, occlusion',modifications:'Resampled to 256 square; diffuse normalized to relative linear luminance with restrained chroma; renormalized OpenGL normals; packed roughness and height; physical repeat authored at 2/4/16 metres to preserve origin continuity.',gpuBytesWithMips:Math.ceil(2*data.color.length*4/3),assets},null,2)+'\n');
console.log(`Packed ${thirdPartyAssets.length} licensed surfaces: ${(2*data.color.length*4/3/1048576).toFixed(2)} MiB with mipmaps`);

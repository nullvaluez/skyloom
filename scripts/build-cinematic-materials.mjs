import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildMaterialArrays, MATERIAL_NAMES } from '../lib/fly/cinematic-material-data.js';
const directory='public/materials/cinematic-v1';
fs.mkdirSync(directory,{recursive:true});
const data=buildMaterialArrays();
const assets=[];
for(const key of ['color','detail']){
  const bytes=data[key],file=`${key}.bin`;fs.writeFileSync(`${directory}/${file}`,bytes);
  assets.push({file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
fs.writeFileSync(`${directory}/manifest.json`,JSON.stringify({revision:1,source:'First-party procedural material artwork',generator:'scripts/build-cinematic-materials.mjs',thirdPartyAssets:[],license:'Project MIT license',size:data.size,layers:MATERIAL_NAMES,format:'RGBA8 texture arrays; color RGB sRGB, color alpha roughness; detail linear normal XY, height, occlusion',gpuBytesWithMips:Math.ceil(2*data.color.length*4/3),assets},null,2)+'\n');
console.log(`Built ${MATERIAL_NAMES.length} materials; ${(2*data.color.length*4/3/1048576).toFixed(2)} MiB including mipmaps`);

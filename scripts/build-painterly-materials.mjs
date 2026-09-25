import fs from 'node:fs';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,next){if(s.endsWith('/cinematic-material-data'))s+='.js';return next(s,c);}});
const {buildPainterlyArrays,MATERIAL_NAMES}=await import('../lib/fly/painterly-material-data.js');
const {PAINTERLY}=await import('../lib/fly/painterly-policy.js');
const directory=`public/materials/cinematic-v${PAINTERLY.assetVersion}`;
fs.mkdirSync(directory,{recursive:true});
const data=buildPainterlyArrays(PAINTERLY.size),assets=[];
for(const name of ['color','detail']){
  const file=`${name}.bin`,bytes=data[name];fs.writeFileSync(`${directory}/${file}`,bytes);
  assets.push({file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
fs.writeFileSync(`${directory}/manifest.json`,JSON.stringify({revision:PAINTERLY.revision,appearanceKey:PAINTERLY.appearanceKey,
  source:'First-party painted surface artwork',generator:'scripts/build-painterly-materials.mjs',license:'MIT',thirdPartyAssets:[],
  size:data.size,layers:MATERIAL_NAMES,format:'RGBA8 arrays: sRGB colour/roughness; linear normal XY/height/occlusion',
  gpuBytesWithMips:Math.ceil(2*data.color.length*4/3),assets},null,2)+'\n');
console.log(`Built ${PAINTERLY.appearanceKey}: ${(2*data.color.length*4/3/1048576).toFixed(2)} MiB with mipmaps`);

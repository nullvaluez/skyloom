import {CompressedArrayTexture,DataArrayTexture,LinearFilter,LinearMipmapLinearFilter,RepeatWrapping,SRGBColorSpace,NoColorSpace,RGBA_S3TC_DXT5_Format} from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { materialScansOn } from './premium-earth';
let bc3=false;
let compressedLoader=null,support=null,anisotropy=1,decoding=0,decoderIdle=null;
export function configureCinemaAssets(renderer){
 bc3=!!renderer.extensions.has('WEBGL_compressed_texture_s3tc')&&!!renderer.extensions.has('WEBGL_compressed_texture_s3tc_srgb');
 // Detection allocates no worker or WASM while the flag is off. Two decoder
 // workers bound transient memory on phones; files are served from our origin.
 // Never terminate a decoder underneath an in-flight pair (StrictMode/remount).
 // Retain only the feature booleans, not the renderer or its context.
 support=new KTX2Loader().detectSupport(renderer).workerConfig;
 anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
}
export const cinemaAssetStats={state:'idle',size:0,bytes:0,format:null};
function parseCompressedTexture(data){
 if(!support)return Promise.reject(Error('Surface decoder is not configured'));
 clearTimeout(decoderIdle);
 if(!compressedLoader){compressedLoader=new KTX2Loader().setTranscoderPath('/decoders/basis/').setWorkerLimit(2);compressedLoader.workerConfig=support;}
 const decoder=compressedLoader;decoding++;
 return new Promise((resolve,reject)=>decoder.parse(data,resolve,reject)).finally(()=>{
  if(--decoding===0){decoderIdle=setTimeout(()=>{decoder.dispose();if(compressedLoader===decoder)compressedLoader=null;},60000);decoderIdle.unref?.();}
 });
}
export async function loadCompressedSceneryTexture(url,signal){
 const r=await fetch(url,{signal});if(!r.ok)throw Error(`Scenery texture: ${r.status}`);
 const texture=await parseCompressedTexture(await r.arrayBuffer());
 if(signal?.aborted){texture.dispose();throw new DOMException('Scenery load aborted','AbortError');}
 texture.colorSpace=SRGBColorSpace;texture.minFilter=LinearMipmapLinearFilter;texture.magFilter=LinearFilter;texture.anisotropy=anisotropy;
 return texture;
}
export async function loadCinemaMaterials(size,signal){
 if(materialScansOn()){
  try{const result=await loadScannedMaterials(size,signal);cinemaAssetStats.fallbackReason=null;return result;}
  catch(error){if(signal?.aborted)throw error;cinemaAssetStats.fallbackReason=String(error.message).slice(0,180);}
 }
 return loadProceduralMaterials(size,signal);
}

/** Atomic pair publication: a failed decode, tier change or unmount disposes
 * every completed texture. Abort does not cancel a shared transcoder worker. */
export async function loadScannedMaterials(size,signal){
 if(!support)throw Error('Surface decoder is not configured');
 const root='/materials/earth-scans-v1';
 const response=await fetch(`${root}/manifest.json`,{signal});if(!response.ok)throw Error('Scanned surface manifest unavailable');
 const manifest=await response.json(),variant=manifest.variants?.[size];
 if(!variant||variant.layers!==8)throw Error('Unsupported scanned surface tier');
 const buffers=await Promise.all(['color','detail'].map(async name=>{
  const file=variant.files[name],r=await fetch(`${root}/${file.file}`,{signal});if(!r.ok)throw Error(`Scanned ${name}: ${r.status}`);
  const data=await r.arrayBuffer();if(data.byteLength!==file.bytes)throw Error(`Truncated scanned ${name}`);return data;
 }));
 // KTX2 transfers these buffers to its workers. Record bytes before detachment.
 const downloadBytes=buffers.reduce((n,b)=>n+b.byteLength,0);
 const decoded=await Promise.allSettled(buffers.map(parseCompressedTexture));
 const textures=decoded.filter(r=>r.status==='fulfilled').map(r=>r.value);
 try{
  if(signal?.aborted)throw new DOMException('Surface load aborted','AbortError');
  const failure=decoded.find(r=>r.status==='rejected');if(failure)throw failure.reason;
  for(const [i,texture]of textures.entries()){
   if(!texture.isCompressedArrayTexture||texture.image.width!==size||texture.image.height!==size||texture.image.depth!==8)throw Error('Invalid surface texture array');
   texture.colorSpace=i===0?SRGBColorSpace:NoColorSpace;
   texture.wrapS=texture.wrapT=RepeatWrapping;texture.minFilter=LinearMipmapLinearFilter;texture.magFilter=LinearFilter;
   texture.anisotropy=anisotropy;texture.name=`earth-scans-v1-${i?'detail':'color'}`;texture.needsUpdate=true;
  }
  const bytes=textures.reduce((sum,t)=>sum+t.mipmaps.reduce((n,m)=>n+m.data.byteLength,0),0);
  return {color:textures[0],detail:textures[1],size,format:`ktx2-${textures[0].format}`,assetSet:'earth-scans-v1',bytes,downloadBytes};
 }catch(error){textures.forEach(t=>t.dispose());throw error;}
}

async function loadProceduralMaterials(size,signal){
 const mode=bc3?'bc3':'rgba',root='/materials/cinema-v1';
 const response=await fetch(root+'/manifest.json',{signal});if(!response.ok)throw Error('Cinema material manifest unavailable');
 const manifest=await response.json(),variant=manifest.variants[size];
 if(!variant)throw Error('Unsupported cinema material size');
 const buffers=await Promise.all(['color','detail'].map(async name=>{
  const file=variant.files[name][mode],r=await fetch(root+'/'+file.file,{signal});if(!r.ok)throw Error('Cinema material unavailable: '+name);
  const data=new Uint8Array(await r.arrayBuffer());if(data.length!==file.bytes)throw Error('Truncated cinema material: '+name);
  return {name,file,data};
 }));
 // Allocate only after BOTH downloads validate, so failures cannot strand a texture.
 const textures=buffers.map(({name,file,data})=>{
  const texture=mode==='bc3'?new CompressedArrayTexture(file.levels.map(l=>({data:data.subarray(l.offset,l.offset+l.length),width:l.width,height:l.height})),size,size,8,RGBA_S3TC_DXT5_Format):new DataArrayTexture(data,size,size,8);
  texture.colorSpace=name==='color'?SRGBColorSpace:NoColorSpace;texture.wrapS=texture.wrapT=RepeatWrapping;
  texture.minFilter=LinearMipmapLinearFilter;texture.magFilter=LinearFilter;texture.generateMipmaps=mode!=='bc3';texture.needsUpdate=true;texture.name='cinema-material-'+name;
  return texture;
 });
 return {color:textures[0],detail:textures[1],size,format:mode,assetSet:'cinema-v1',bytes:Math.ceil(buffers.reduce((n,b)=>n+b.data.length,0)*(mode==='rgba'?4/3:1))};
}

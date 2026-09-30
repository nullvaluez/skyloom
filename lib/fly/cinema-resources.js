import {FloatType,HalfFloatType,RedFormat,RGFormat,RGBFormat,DepthStencilFormat,UnsignedShortType} from 'three';
const owners=new Map();
export function registerCinemaResources(name,read){owners.set(name,read);return()=>{if(owners.get(name)===read)owners.delete(name);};}
function textureBytes(t){
 const image=t.image;if(!image)return 0;
 if(t.isCompressedTexture)return t.mipmaps.reduce((n,m)=>n+(m.data?.byteLength??0),0);
 const images=Array.isArray(image)?image:[image];
 if(t.isDepthTexture){
   const bytes=t.format===DepthStencilFormat?(t.type===FloatType?8:4):t.type===UnsignedShortType?2:4;
   return images.reduce((n,i)=>n+(i.width??0)*(i.height??0)*(i.depth??1)*bytes,0);
 }
 const channels=t.format===RedFormat?1:t.format===RGFormat?2:t.format===RGBFormat?3:4;
 const component=t.type===FloatType?4:t.type===HalfFloatType?2:1;
 return Math.ceil(images.reduce((n,i)=>n+(i.width??0)*(i.height??0)*(i.depth??1)*channels*component,0)*(t.generateMipmaps?4/3:1));
}
/** Periodic ownership census. The separate GL allocation audit measures peaks. */
export function inspectCinemaResources(scene,composer){
 const seen=new Set(),textures=new Set(),targets=new Set(),buffers=new Set(),rows=[];
 let geometryBytes=0;
 function walk(value,depth=0){
  if(!value||typeof value!=='object'||seen.has(value)||depth>7)return;seen.add(value);
  if(value.isTexture){textures.add(value);return;}
  if(value.isWebGLRenderTarget){targets.add(value);for(const t of value.textures??[value.texture])textures.add(t);if(value.depthTexture)textures.add(value.depthTexture);return;}
  if(value.isBufferGeometry){
    for(const a of [...Object.values(value.attributes),value.index]){const data=a?.isInterleavedBufferAttribute?a.data.array:a?.array;if(data&&!buffers.has(data)){buffers.add(data);geometryBytes+=data.byteLength;}}
    return;
  }
  if(ArrayBuffer.isView(value)||value instanceof ArrayBuffer||value.isWebGLRenderer||value.isObject3D)return;
  if(value instanceof Map){for(const v of value.values())walk(v,depth+1);return;}
  for(const [k,v]of Object.entries(value))if(!['parent','renderer','gl','camera','runtime','source'].includes(k))walk(v,depth+1);
 }
 scene.traverse(o=>{
  walk(o.geometry);walk(o.material);
  if(o.isInstancedMesh)for(const a of [o.instanceMatrix,o.instanceColor])if(a&&!buffers.has(a.array)){buffers.add(a.array);geometryBytes+=a.array.byteLength;}
  if(o.isLight)walk(o.shadow?.map);
 });
 walk(scene.environment);walk(composer);
 for(const [name,read]of owners){const before=textures.size;walk(read());rows.push({name,textures:textures.size-before});}
 let textureStorage=0,renderbuffers=0;
 for(const t of textures)textureStorage+=textureBytes(t);
 for(const t of targets){
   const sample=Math.max(0,t.samples||0),area=t.width*t.height*(t.depth??1);
   // A depth texture replaces the single-sample depth renderbuffer. MSAA has
   // its own depth renderbuffer in addition to the resolve texture.
   if(t.depthBuffer)renderbuffers+=area*4*(sample+(t.depthTexture?0:1));
   if(sample)renderbuffers+=textureBytes(t.texture)*sample;
 }
 return {scope:'Attached scene geometry and owned targets/textures; logical bytes, periodic census, not driver residency or allocation peaks.',
   geometryBytes,textureBytes:textureStorage,renderbufferBytes:renderbuffers,combinedBytes:textureStorage+renderbuffers,targets:targets.size,textures:textures.size,owners:rows};
}

import {CompressedArrayTexture,DataArrayTexture,LinearFilter,LinearMipmapLinearFilter,RepeatWrapping,SRGBColorSpace,NoColorSpace,RGBA_S3TC_DXT5_Format} from 'three';
let bc3=false;
export function configureCinemaAssets(renderer){bc3=!!renderer.extensions.has('WEBGL_compressed_texture_s3tc')&&!!renderer.extensions.has('WEBGL_compressed_texture_s3tc_srgb');}
export const cinemaAssetStats={state:'idle',size:0,bytes:0,format:null};
export async function loadCinemaMaterials(size,signal){
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
 return {color:textures[0],detail:textures[1],size,format:mode,bytes:Math.ceil(buffers.reduce((n,b)=>n+b.data.length,0)*(mode==='rgba'?4/3:1))};
}

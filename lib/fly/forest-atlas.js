import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, DoubleSide } from 'three';
import { cinemaProfile } from './cinema-policy';
import { loadCompressedSceneryTexture } from './cinema-material-assets';

export const forestAtlasStats={state:'idle',size:0,bytes:0,users:0,error:null};
let fallback=null,texture=null,pending=null,controller=null,generation=0,retryAt=0,requestedSize=0;
const materials=new Set();
function placeholder(){
 if(fallback)return fallback;
 // A complete readable silhouette while the optional scan loads or is offline.
 const size=128,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const row=Math.floor(y/(size/2)),u=(x%(size/4))/(size/4)-.5,v=1-(y%(size/2))/(size/2);
  const crown=row?Math.abs(u)<.40*(1-v)&&v>.12:(u/.41)**2+((v-.66)/.31)**2<1;
  const trunk=Math.abs(u)<.024&&v<.72;
  if(!crown&&!trunk)continue;
  const i=(y*size+x)*4;data[i]=trunk?75:61;data[i+1]=trunk?58:88;data[i+2]=trunk?39:49;data[i+3]=255;
 }
 fallback=new DataTexture(data,size,size,RGBAFormat);fallback.colorSpace=SRGBColorSpace;fallback.magFilter=LinearFilter;fallback.minFilter=LinearMipmapLinearFilter;fallback.generateMipmaps=true;fallback.needsUpdate=true;return fallback;
}
function request(){
 const materialSize=cinemaProfile().materialSize,size=materialSize>=1024?2048:materialSize>=512?1024:512;
 if(pending||texture&&requestedSize===size||Date.now()<retryAt)return;
 requestedSize=size;const epoch=++generation;controller=new AbortController();forestAtlasStats.state='loading';
 pending=loadCompressedSceneryTexture(`/materials/forest-atlas-v1/foliage-${size}.ktx2`,controller.signal).then(result=>{
  if(epoch!==generation||!materials.size){result.dispose();return;}
  const previous=texture;texture=result;
  for(const material of materials)material.map=texture;
  previous?.dispose();
  Object.assign(forestAtlasStats,{state:'ready',size,bytes:result.mipmaps.reduce((n,m)=>n+m.data.byteLength,0),error:null});
 }).catch(error=>{if(epoch===generation){forestAtlasStats.state='fallback';forestAtlasStats.error=String(error.message);retryAt=Date.now()+30000;}}).finally(()=>{if(epoch===generation)pending=null;});
}
export function attachForestAtlas(material){
 material.map=texture??placeholder();material.alphaTest=.28;material.side=DoubleSide;material.shadowSide=DoubleSide;
 materials.add(material);forestAtlasStats.users=materials.size;request();
 const dispose=()=>{
  material.removeEventListener('dispose',dispose);materials.delete(material);forestAtlasStats.users=materials.size;
  if(!materials.size){generation++;controller?.abort();texture?.dispose();fallback?.dispose();texture=fallback=pending=null;retryAt=0;Object.assign(forestAtlasStats,{state:'idle',bytes:0,size:0});}
 };
 material.addEventListener('dispose',dispose);
}
export function updateForestAtlas(){if(materials.size)request();}

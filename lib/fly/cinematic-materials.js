import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, NoColorSpace } from 'three';
import { STYLIZED_EARTH, cinematicFlightOn } from './stylized-earth';
import { PAINTERLY } from './painterly-policy';
import { painterlyOn, PAINTERLY_UNIFORMS } from './painterly-flight';

function makeTexture(data,size,color=false){
  const t=new DataArrayTexture(data,size,size,8);t.colorSpace=color?SRGBColorSpace:NoColorSpace;
  t.wrapS=t.wrapT=RepeatWrapping;t.magFilter=LinearFilter;t.minFilter=LinearMipmapLinearFilter;
  t.generateMipmaps=true;t.needsUpdate=true;t.name=color?'cinematic-material-color':'cinematic-material-detail';return t;
}
const fallbackColor=makeTexture(new Uint8Array(32).fill(188),1,true),fallbackDetail=makeTexture(new Uint8Array(32).fill(128),1);
export const CINEMATIC_MATERIAL_UNIFORMS={uCinematicColor:{value:fallbackColor},uCinematicDetail:{value:fallbackDetail},uCinematicMaterials:{value:0},uCinematicMetres:{value:1}};
Object.assign(CINEMATIC_MATERIAL_UNIFORMS,PAINTERLY_UNIFORMS);
export const cinematicMaterialStats={state:'idle',bytes:0,users:0,error:null};
export const painterlyMaterialStats={state:'idle',bytes:0,error:null,appearanceKey:PAINTERLY.appearanceKey};
cinematicMaterialStats.painterly=painterlyMaterialStats;
let epoch=0,color=null,detail=null,abort=null;
let paintEpoch=0,paintColor=null,paintDetail=null,paintAbort=null,retryAt=0;
function releasePaint(){
  ++paintEpoch;paintAbort?.abort();paintAbort=null;paintColor?.dispose();paintDetail?.dispose();paintColor=paintDetail=null;
  CINEMATIC_MATERIAL_UNIFORMS.uCinematicColor.value=color??fallbackColor;
  CINEMATIC_MATERIAL_UNIFORMS.uCinematicDetail.value=detail??fallbackDetail;
  Object.assign(painterlyMaterialStats,{state:'idle',bytes:0,error:null});retryAt=0;
}
function updatePaint(){
  if(!painterlyOn()||!cinematicMaterialStats.users){if(painterlyMaterialStats.state!=='idle')releasePaint();return;}
  if(painterlyMaterialStats.state==='ready'){
    CINEMATIC_MATERIAL_UNIFORMS.uCinematicColor.value=paintColor;CINEMATIC_MATERIAL_UNIFORMS.uCinematicDetail.value=paintDetail;return;
  }
  if(painterlyMaterialStats.state==='loading'||Date.now()<retryAt)return;
  const generation=++paintEpoch;paintAbort=new AbortController();painterlyMaterialStats.state='loading';
  Promise.all(['color','detail'].map(async name=>{
    const response=await fetch(`/materials/cinematic-v${PAINTERLY.assetVersion}/${name}.bin`,{signal:paintAbort.signal});
    if(!response.ok)throw Error(`Painted material ${name}: ${response.status}`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==PAINTERLY.size**2*PAINTERLY.layers*4)throw Error(`Painted material ${name}: invalid byte length`);
    return bytes;
  })).then(([a,b])=>{
    if(generation!==paintEpoch)return;
    paintColor=makeTexture(a,PAINTERLY.size,true);paintDetail=makeTexture(b,PAINTERLY.size);
    paintColor.name=`${PAINTERLY.appearanceKey}-color`;paintDetail.name=`${PAINTERLY.appearanceKey}-detail`;
    Object.assign(painterlyMaterialStats,{state:'ready',bytes:Math.ceil((a.length+b.length)*4/3),error:null});
  }).catch(error=>{if(generation===paintEpoch){Object.assign(painterlyMaterialStats,{state:'fallback',error:error.message});retryAt=Date.now()+15000;}});
}
export function acquireCinematicMaterials(){
  cinematicMaterialStats.users++;
  if(cinematicMaterialStats.users!==1)return;
  const generation=++epoch;abort=new AbortController();cinematicMaterialStats.state='loading';
  Promise.all(['color','detail'].map(async name=>{
    const response=await fetch(`/materials/cinematic-v${STYLIZED_EARTH.materials.assetVersion}/${name}.bin`,{signal:abort.signal});
    if(!response.ok)throw Error(`Material ${name}: ${response.status}`);
    const data=new Uint8Array(await response.arrayBuffer());
    if(data.length!==STYLIZED_EARTH.materials.size**2*8*4)throw Error(`Material ${name}: invalid byte length`);
    return data;
  })).then(([a,b])=>{
    if(generation!==epoch)return;
    color=makeTexture(a,256,true);detail=makeTexture(b,256);
    CINEMATIC_MATERIAL_UNIFORMS.uCinematicColor.value=color;CINEMATIC_MATERIAL_UNIFORMS.uCinematicDetail.value=detail;
    Object.assign(cinematicMaterialStats,{state:'ready',bytes:Math.ceil((a.length+b.length)*4/3),error:null});
  }).catch(error=>{if(generation===epoch)Object.assign(cinematicMaterialStats,{state:'fallback',error:error.message});});
}
export function releaseCinematicMaterials(){
  if(cinematicMaterialStats.users===0||--cinematicMaterialStats.users)return;
  releasePaint();
  epoch++;abort?.abort();color?.dispose();detail?.dispose();color=detail=null;
  CINEMATIC_MATERIAL_UNIFORMS.uCinematicColor.value=fallbackColor;CINEMATIC_MATERIAL_UNIFORMS.uCinematicDetail.value=fallbackDetail;
  CINEMATIC_MATERIAL_UNIFORMS.uCinematicMaterials.value=0;
  Object.assign(cinematicMaterialStats,{state:'idle',bytes:0,error:null});
}
export function updateCinematicMaterials(dt=.016){
  updatePaint();
  const target=cinematicMaterialStats.state==='ready'&&cinematicFlightOn('materials')?1:0;
  const u=CINEMATIC_MATERIAL_UNIFORMS.uCinematicMaterials;
  u.value+=(target-u.value)*(1-Math.exp(-Math.min(.1,dt)*3));
}
export const CINEMATIC_MATERIAL_GLSL=`
uniform highp sampler2DArray uCinematicColor;
uniform highp sampler2DArray uCinematicDetail;
uniform float uCinematicMaterials;
uniform float uCinematicMetres;
uniform float uPainterly;
float cmLayer(float id) {
  if(id==12.0)return 0.0;if(id==13.0)return 1.0;
  if(id==1.0||id==2.0||id==3.0||id==9.0)return 4.0;
  if(id==4.0||id==14.0)return 5.0;if(id==5.0)return 6.0;if(id==6.0)return 7.0;
  return -1.0;
}
// Authored repeats divide the transported 4096 m phase: no seam on rebasing.
// Pavement 4/2 m, grass 2 m, broad mineral structure 16 m.
float cmUVScale(float layer){
  if(uPainterly>.5)return layer==4.0?.125:layer==5.0||layer==6.0?.0625:.5;
  return layer==1.0||layer==4.0?2.0:layer==5.0||layer==6.0?.25:1.0;
}
vec4 cmColor(vec2 uv,float layer){return texture(uCinematicColor,vec3(uv*cmUVScale(layer),layer));}
vec4 cmDetail(vec2 uv,float layer){return texture(uCinematicDetail,vec3(uv*cmUVScale(layer),layer));}
vec3 cmNormal(vec3 n,vec3 eye,vec2 uv,vec2 xy,float strength){
  vec3 q0=dFdx(eye),q1=dFdy(eye);vec2 s0=dFdx(uv),s1=dFdy(uv);
  vec3 t=q0*s1.y-q1*s0.y,b=-q0*s1.x+q1*s0.x;
  float d=s0.x*s1.y-s0.y*s1.x;
  if(abs(d)<1e-10)return n;
  t=normalize(t)*sign(d);b=normalize(b)*sign(d);
  vec2 v=(xy*2.0-1.0)*strength;
  return normalize(t*v.x+b*v.y+n*sqrt(max(.05,1.0-dot(v,v))));
}
`;

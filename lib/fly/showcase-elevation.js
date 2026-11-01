import { LoaderFactory, R24_SWITCHES } from './vendor/three-tile/index.js';
import { FlyCachedLercLoader } from './raster-cache';
import { elevationOverlap, elevationTileBounds } from './showcase-elevation-core';
import coverage from '../../public/regions/yosemite-v1/manifest.json' with {type:'json'};

export const SHOWCASE_DEM_TYPE='skyloom-regional-elevation-v1';
export const showcaseElevationStats={replaced:0,fallbacks:0,pending:0,fieldBytes:0,maxTriangles:0,error:null};
let registered=false,worker=null,serial=0,idle=null;
const pending=new Map();
function retire(){worker?.terminate();worker=null;showcaseElevationStats.fieldBytes=0;}
function requestPatch(payload){
 clearTimeout(idle);
 if(!worker){
  worker=new Worker(new URL('./showcase-elevation.worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
   const task=pending.get(data.id);if(!task)return;clearTimeout(task.timeout);pending.delete(data.id);showcaseElevationStats.pending=pending.size;
   if(data.error)task.reject(Error(data.error));else{showcaseElevationStats.fieldBytes=data.fieldBytes;task.resolve(data.result);}
   if(!pending.size)idle=setTimeout(retire,60000);
  };
  worker.onerror=event=>{
   for(const task of pending.values()){clearTimeout(task.timeout);task.reject(Error(event.message||'Regional worker failed'));}pending.clear();showcaseElevationStats.pending=0;retire();
  };
 }
 const id=++serial;
 return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{pending.delete(id);showcaseElevationStats.pending=pending.size;reject(Error('Regional elevation timeout'));if(!pending.size)retire();},20000);
  pending.set(id,{resolve,reject,timeout});showcaseElevationStats.pending=pending.size;
  worker.postMessage({...payload,id},[payload.position.buffer,payload.index.buffer]);
 });
}
class ShowcaseTerrainLoader extends FlyCachedLercLoader{
 constructor(){super();this.dataType=SHOWCASE_DEM_TYPE;}
 async doLoad(url,params){
  const base=await super.doLoad(url,params),{x,y,z,source}=params;
  if(z<12||!elevationOverlap(elevationTileBounds(x,y,z),coverage.bounds))return base;
  try{
   const result=await requestPatch({x,y,z,size:source.flyShowcaseSize??1024,maxTriangles:source.flyShowcaseSize>=2048?4096:2048,
    position:base.attributes.position.array.slice(),index:base.index.array.slice(),reliefPx:R24_SWITCHES.r25ReliefPx});
   const geometry=this.geometryFromData(result,z);geometry.userData.showcaseRegion='yosemite-v1';
   showcaseElevationStats.replaced++;showcaseElevationStats.maxTriangles=Math.max(showcaseElevationStats.maxTriangles,result.indices.length/3);
   base.dispose();return geometry;
  }catch(error){showcaseElevationStats.fallbacks++;showcaseElevationStats.error=String(error.message);return base;}
 }
}
export function registerShowcaseTerrain(){
 if(!registered){LoaderFactory.registerGeometryLoader(new ShowcaseTerrainLoader());registered=true;}
 return SHOWCASE_DEM_TYPE;
}

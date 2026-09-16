import { EARTH_SURFACE } from './stylized-earth.js';

/** ESA WorldCover 2021 v200, CC BY 4.0. Explicit published categorical codes,
 * not a classifier over satellite photography or the game's art palette.
 * Source/legend: https://esa-worldcover.org/en/data-access
 * The WMTS is a cartographic product: mixed/unknown RGB is deliberately rejected.
 */
export const WORLD_COVER = Object.freeze({ revision: 1, year: 2021, size: 256,
  minZoom: 6, maxZoom: 14, memoryTiles: 24, cacheTiles: 128, timeoutMs: 5000 });
const codes = [[0x006400,10],[0xffbb22,20],[0xffff4c,30],[0xf096ff,40],[0xfa0000,50],
  [0xb4b4b4,60],[0xf0f0f0,70],[0x0064c8,80],[0x0096a0,90],[0x00cf75,95],[0xfae6a0,100]];
const legend = new Map(codes);
export function decodeWorldCover(rgba, width=256, height=256) {
  if(width!==256||height!==256||rgba.length!==width*height*4)throw Error('Invalid WorldCover tile dimensions');
  const classes=new Uint8Array(width*height);
  for(let i=0;i<classes.length;i++)if(rgba[i*4+3]===255)classes[i]=legend.get((rgba[i*4]<<16)|(rgba[i*4+1]<<8)|rgba[i*4+2])??0;
  return classes;
}
export function worldCoverURL(z,x,y) {
  const n=2**z;
  if(!Number.isInteger(z)||z<6||z>14||!Number.isInteger(x)||!Number.isInteger(y)||y<0||y>=n)return null;
  const lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/n)))*180/Math.PI;
  if(lat < -60 || lat > 83)return null;
  const p=new URLSearchParams({SERVICE:'WMTS',REQUEST:'GetTile',VERSION:'1.0.0',
    LAYER:'esa-worldcover-map-10m-2021-v2_map',STYLE:'default',TILEMATRIXSET:'EPSG:3857',
    TILEMATRIX:String(z),TILECOL:String((x%n+n)%n),TILEROW:String(y),FORMAT:'image/png',TIME:'2021-01-01'});
  return `https://wmts.terrascope.be/?${p}`;
}
const memory=new Map(),pending=new Map();let active=0;const waiting=[];
async function permit(){if(active<2){active++;return;}await new Promise(resolve=>waiting.push(resolve));}
function release(){if(waiting.length)waiting.shift()();else active--;}
/** At most two small requests per worker; decode stays off the render thread.
 * Cache API shares compressed source tiles between the surface and canopy workers.
 * Missing provider data never prevents the existing vector/imagery fallback.
 */
export async function loadWorldCover(z,x,y) {
  if(typeof OffscreenCanvas==='undefined'||typeof createImageBitmap!=='function')return null;
  const url=worldCoverURL(z,x,y);if(!url)return null;
  const known=memory.get(url);
  if(known&&(known.data||known.retryAt>Date.now())){memory.delete(url);memory.set(url,known);return known.data;}
  if(pending.has(url))return pending.get(url);
  const request=(async()=>{
    await permit();let bitmap,cache,cached=false;
    try{
      cache=await globalThis.caches?.open('fly-worldcover-2021-v1').catch(()=>null);
      let response=await cache?.match(url),network=false;
      cached=!!response;
      if(!response){network=true;response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(WORLD_COVER.timeoutMs)});}
      if(!response?.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw Error('WorldCover unavailable');
      const blob=await response.blob();if(blob.size>512*1024)throw Error('WorldCover tile exceeds bound');
      bitmap=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
      if(bitmap.width!==256||bitmap.height!==256)throw Error('WorldCover tile has unexpected size');
      const canvas=new OffscreenCanvas(256,256),context=canvas.getContext('2d',{willReadFrequently:true});
      context.drawImage(bitmap,0,0);
      const data=decodeWorldCover(context.getImageData(0,0,256,256).data);
      memory.set(url,{data});
      if(network&&cache){
        try{
          await cache.put(url,new Response(blob,{headers:{'Content-Type':'image/png'}}));
          const keys=await cache.keys();for(const key of keys.slice(0,Math.max(0,keys.length-WORLD_COVER.cacheTiles)))await cache.delete(key);
        }catch{ /* Storage quotas cannot discard a successfully decoded tile. */ }
      }
      return data;
    }catch{
      // A corrupt persistent entry must not poison every future return visit.
      if(cached)try{await cache.delete(url);}catch{ /* Cache storage is optional. */ }
      memory.set(url,{data:null,retryAt:Date.now()+30000});return null;
    }
    finally{bitmap?.close();release();pending.delete(url);while(memory.size>WORLD_COVER.memoryTiles)memory.delete(memory.keys().next().value);}
  })();
  pending.set(url,request);return request;
}
export function worldCoverAt(cover,x,y,size=256) {
  if(!cover||x<0||y<0||x>=size||y>=size)return 0;
  return cover[Math.min(255,Math.floor(y/size*256))*256+Math.min(255,Math.floor(x/size*256))];
}
const surfaces={10:EARTH_SURFACE.wood,20:EARTH_SURFACE.scrub,30:EARTH_SURFACE.grass,40:EARTH_SURFACE.farmland,
  50:EARTH_SURFACE.developed,60:EARTH_SURFACE.bare,70:EARTH_SURFACE.snow,80:EARTH_SURFACE.water,
  90:EARTH_SURFACE.wetland,95:EARTH_SURFACE.wetland,100:EARTH_SURFACE.bare};
/** Fill missing or broad developed-area coverage. Precise vector surfaces and
 * all road/building/airport exclusions keep priority over the older raster map. */
export function combineWorldCover(mask,cover) {
  mask.worldCover={revision:1,available:!!cover,added:0};if(!cover)return mask;
  mask.settlement = new Uint8Array(mask.size*mask.size);
  const {size,classes,exclusion,blend}=mask;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*size+x,old=classes[i];
    if(exclusion[i]||old!==EARTH_SURFACE.unknown&&old!==EARTH_SURFACE.developed)continue;
    const code=worldCoverAt(cover,x+.5,y+.5,size),cls=surfaces[code];if(!cls)continue;
    classes[i]=cls;blend[i]=255;mask.worldCover.added++;
    if(code===50)mask.settlement[i]=2;
    if(code===50)exclusion[i]=128; // Scenery exclusion only: developed ground receives its material.
    else if(cls===EARTH_SURFACE.water)exclusion[i]=255;
    else if(cls===EARTH_SURFACE.wetland)exclusion[i]=128;
  }
  mask.classifiedCells=0;mask.waterCells=0;
  for(const c of classes){if(c)mask.classifiedCells++;if(c===EARTH_SURFACE.water)mask.waterCells++;}
  for(let i=0;i<size;i++){
    mask.waterEdges[i]=+(classes[i]===EARTH_SURFACE.water);
    mask.waterEdges[size+i]=+(classes[i*size+size-1]===EARTH_SURFACE.water);
    mask.waterEdges[2*size+i]=+(classes[(size-1)*size+i]===EARTH_SURFACE.water);
    mask.waterEdges[3*size+i]=+(classes[i*size]===EARTH_SURFACE.water);
  }
  return mask;
}

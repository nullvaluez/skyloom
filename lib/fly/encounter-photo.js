import { airDrop } from './toy-world/world-bend';
import { distanceM, interpolatePoint } from './adventure-geometry.mjs';

export function encounterSubject(runtime){
  const a=runtime?.encounters?.controller.active;if(!a)return null;
  if(a.kind==='traffic'){
    const track=runtime.traffic?.tracks.get(a.hex);if(!track||track.stale!==0)return null;
    const p=runtime.engine.worldToGeo({x:track.rx,y:track.ryd,z:track.rz});return {lat:p.y,lon:p.x,altM:p.z};
  }
  const target=a.course?.target;if(!target)return null;
  const ground=runtime.engine.getElevationAt?.(target.lon,target.lat);
  // Match adventure photography: authored panorama anchors must not sit below
  // refined live terrain. Missing terrain still fails the sightline gate below.
  return {...target,altM:Math.max(target.altM,Number.isFinite(ground)?ground+20:target.altM)};
}

/** Snapshot camera, position, token and terrain in the same frame as the pixels. */
export function encounterPhotoFrame(runtime,epoch) {
  const a=runtime?.encounters?.controller.active;
  if(!a||!runtime.camera||!runtime.engine||!runtime.origin)return null;
  const {engine,flight,camera,origin}=runtime;
  const geo=engine.worldToGeo(flight.pos),position={lat:geo.y,lon:geo.x,altM:geo.z};
  const subject=encounterSubject(runtime);
  if(!subject)return null;
  let knownTerrain=true,occluded=false;
  for(let i=0;i<=16;i++){
    const p=interpolatePoint(position,subject,i/16),ground=engine.getElevationAt?.(p.lon,p.lat);
    if(!Number.isFinite(ground))knownTerrain=false;
    else if(ground>p.altM+10)occluded=true;
  }
  const point=engine.geoToWorld(subject.lon,subject.lat,subject.altM).clone();
  point.y-=airDrop(Math.hypot(point.x-flight.pos.x,point.z-flight.pos.z),point.y);
  point.x-=origin.anchor.x;point.z-=origin.anchor.z;
  const view=point.clone().applyMatrix4(camera.matrixWorldInverse),ndc=point.project(camera);
  return {position,token:a.token,epoch,x:ndc.x,y:ndc.y,distanceM:distanceM(position,subject),knownTerrain,visible:view.z<0&&!occluded};
}

// Thumbnails are local binary data, never base64 in progress/backups. Bounded to
// 24 images; journal entries survive eviction or browsers without IndexedDB.
function openPhotos(){return new Promise((resolve,reject)=>{
  const request=indexedDB.open('skyloom-flight-memories',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('photos',{keyPath:'id'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
export async function saveMemoryPhoto(blob){
  let bitmap,db;
  try{
    bitmap=await createImageBitmap(blob);
    const canvas=document.createElement('canvas'),scale=Math.min(1,640/bitmap.width);
    canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const thumbnail=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.78));
    if(!thumbnail||thumbnail.size>250000)return null;
    db=await openPhotos();const id=`memory-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('photos','readwrite'),store=tx.objectStore('photos');
      store.put({id,at:Date.now(),blob:thumbnail});
      const read=store.getAll();read.onsuccess=()=>read.result.sort((a,b)=>b.at-a.at).slice(24).forEach(p=>store.delete(p.id));
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });return id;
  }catch{return null;}finally{bitmap?.close();db?.close();}
}
export async function readMemoryPhoto(id){
  let db;
  try{db=await openPhotos();return await new Promise((resolve,reject)=>{
    const r=db.transaction('photos').objectStore('photos').get(id);r.onsuccess=()=>resolve(r.result?.blob??null);r.onerror=()=>reject(r.error);
  });}catch{return null;}finally{db?.close();}
}

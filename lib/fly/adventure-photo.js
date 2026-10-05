import { airDrop } from './toy-world/world-bend';
import { adventureById } from './adventures.mjs';
import { interpolatePoint } from './adventure-geometry.mjs';

// Called in the capture frame, before async PNG encoding. Never sample the
// aircraft's later position in toBlob's callback.
export function adventurePhotoFrame(runtime,epoch) {
  const controller=runtime?.adventures?.controller,a=controller?.progress.active;
  const route=adventureById(a?.id),target=route?.activities.find(x=>x.kind==='photo');
  if(!target||!runtime.camera||!runtime.engine||!runtime.origin)return null;
  const geo=runtime.engine.worldToGeo(runtime.flight.pos),position={lat:geo.y,lon:geo.x,altM:geo.z};
  const ground=runtime.engine.getElevationAt?.(target.target.lon,target.target.lat);
  const subject={...target.target,altM:Math.max(target.target.altM,Number.isFinite(ground)?ground+20:0)};
  const point=runtime.engine.geoToWorld(subject.lon,subject.lat,subject.altM).clone();
  point.y-=airDrop(Math.hypot(point.x-runtime.flight.pos.x,point.z-runtime.flight.pos.z),point.y);
  point.x-=runtime.origin.anchor.x;point.z-=runtime.origin.anchor.z;
  const view=point.clone().applyMatrix4(runtime.camera.matrixWorldInverse),ndc=point.project(runtime.camera);
  // Sample known terrain along the sightline; never turn missing DEM into an occluder.
  let occluded=false;
  for(let i=1;i<8;i++){
    const p=interpolatePoint(position,subject,i/8),ground=runtime.engine.getElevationAt?.(p.lon,p.lat);
    if(Number.isFinite(ground)&&ground>p.altM+35){occluded=true;break;}
  }
  return {position,targetId:target.id,x:ndc.x,y:ndc.y,visible:view.z<0&&!occluded,runToken:controller.runToken,epoch};
}

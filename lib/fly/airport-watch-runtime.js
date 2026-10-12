import { Vector3 } from 'three';
import { useFlyStore } from '@/stores/fly-store';
import { airportFrame, airportPoint, airportRegistryRevision } from './operations-airports';
import { ensureAirport, loadNearbyRunways, setRunwayObservation } from './runway-catalog';
import { livingAirportsOn } from './airport-feature-policy';
import { airportActivity, joinBlocker, observationViews, discoveryNeedsSceneRefresh } from './airport-observation.mjs';
import { startEscort, releaseEscort } from './escort';
import { registerRuntimeActions } from './runtime-bus';

/** Owns the observation lifecycle. Camera vectors stay outside React. */
export function connectAirportWatch(runtime) {
  let disposed=false,request=0,seenRegistry=airportRegistryRevision(),cameraBefore=null,cameraUsed=null,nextGroundSample=0;
  const eye=new Vector3(),geo=new Vector3();
  const watch={active:false,airport:null,views:[],view:0,selected:null,tracking:false,yaw:0,pitch:0,zoom:1,snap:true,notice:'',validated:false,seat:new Vector3(),roomHeading:0};
  function publish(){useFlyStore.setState({airportWatch:watch.active?{id:watch.airport.id,view:watch.view,selected:watch.selected,tracking:watch.tracking,zoom:watch.zoom,notice:watch.notice,validated:watch.validated}:null});}
  function groundAt(point){geo.copy(runtime.engine.worldToGeo(point));const sample=runtime.engine.getGroundAt(geo.x,geo.y);return sample&&sample.tileZ>=12&&Number.isFinite(sample.elev)?sample.elev:null;}
  function chooseView(index){watch.view=Math.max(0,Math.min(watch.views.length-1,index));watch.yaw=0;watch.pitch=0;watch.zoom=1;watch.tracking=false;watch.snap=true;watch.validated=false;nextGroundSample=0;publish();}
  async function enter(id) {
    if(!livingAirportsOn()||!runtime.warpToGeo||!runtime.engine)return false;
    const token=++request;
    try {
      const airport=await ensureAirport(id);
      if(disposed||token!==request)return false;
      if(!airport)throw Error('This runway is not available in the catalog.');
      // Register before streaming so terrain and worker exclusions agree.
      await loadNearbyRunways(airport.a.lat,airport.a.lon).catch(()=>[]);
      if(disposed||token!==request)return false;
      setRunwayObservation(airport);
      const frame=airportFrame(airport),center=airportPoint(airport,frame.length*.5);
      const revision=airportRegistryRevision();
      const previous=runtime.flight?.pos;
      const previousLat=previous?runtime.engine.worldToGeo(previous).y:0;
      const refreshScale=Math.max(frame.k,1/Math.max(.09,Math.cos(previousLat*Math.PI/180)));
      const refresh=revision!==seenRegistry&&discoveryNeedsSceneRefresh(previous,center,refreshScale);
      const g=runtime.engine.worldToGeo(center);
      if(!runtime.warpToGeo(g.y,g.x,{altM:center.y+300,stage:true}))throw Error('The world is not ready for an airport transfer.');
      // Far transfers already retire old chunks through their bounded rings.
      // Keep shared materials/workers alive there; new requests carry the new
      // registry. Only overlapping discovery needs an explicit rebuild.
      if(refresh)useFlyStore.setState({airportContentEpoch:revision});
      seenRegistry=revision;
      releaseEscort(runtime);runtime.adventures?.suspend();
      runtime.input?.neutralize();runtime.input?.keys?.clear();
      Object.assign(watch,{active:true,airport,center,frame,views:observationViews(airport,frame.length),selected:null,notice:'Loading terrain and live activity…'});
      const s=useFlyStore.getState();s.setInspectHex(null);s.clearLock();s.setCameraMode('chase');s.setFlightMode('free');s.setHangarOpen(false);s.setAtlasOpen(false);s.setPhase('flying');
      useFlyStore.setState({airportBrowserOpen:false,airportReturn:null});chooseView(0);
      return true;
    }catch(error){if(token===request&&!disposed){setRunwayObservation(watch.active?watch.airport:null);watch.notice=error.message;publish();}throw error;}
  }
  function select(hex){if(!watch.active)return false;watch.selected=hex;watch.tracking=true;watch.notice='';useFlyStore.getState().setLock(hex,'soft');useFlyStore.getState().setInspectHex(null);publish();return true;}
  function leave(){request++;if(cameraBefore&&cameraUsed){cameraUsed.near=cameraBefore.near;cameraUsed.fov=cameraBefore.fov;cameraUsed.updateProjectionMatrix();cameraBefore=null;cameraUsed=null;}watch.active=false;watch.selected=null;setRunwayObservation(null);useFlyStore.getState().setInspectHex(null);if(runtime.autopilot?.mode==='off')useFlyStore.getState().clearLock();runtime.chaseRig?.snap?.();publish();}
  function join(hex=watch.selected){
    if(!watch.active)return {ok:false,message:'Open an airport observation first.'};
    const t=runtime.traffic?.tracks.get(hex),f=runtime.flight;
    if(!f)return {ok:false,message:'The flight controls are not ready.'};
    const k=1/Math.max(.1,Math.cos(runtime.engine.worldToGeo({x:t?.rx||0,y:t?.ry||0,z:t?.rz||0}).y*Math.PI/180));
    const yaw=t?.yaw??0;
    // Behind and offset from the contact, in true metres.
    const point=new Vector3((t?.rx||0)-Math.sin(yaw)*900*k+Math.cos(yaw)*180*k,t?.ry??NaN,(t?.rz||0)+Math.cos(yaw)*900*k+Math.sin(yaw)*180*k);
    const target=new Vector3(t?.rx||0,t?.ry||0,t?.rz||0);
    let corridor=groundAt(point);
    for(const fraction of [.25,.5,.75]){const sample=groundAt(new Vector3().lerpVectors(point,target,fraction));corridor=sample==null||corridor==null?null:Math.max(corridor,sample);}
    const message=joinBlocker({track:t,status:runtime.trafficStatus?.state,cfg:f.cfg,aircraftId:useFlyStore.getState().aircraftId,ground:corridor,targetGround:groundAt(target),altitude:point.y,ready:!runtime.worldLoading&&watch.validated});
    if(message){watch.notice=message;publish();return {ok:false,message};}
    const airportId=watch.airport.id,view=watch.view;
    const g=runtime.engine.worldToGeo(point);
    const ops=runtime.operations;
    const prior={...ops,events:ops.events?.slice()};
    const previousPosition=runtime.engine.worldToGeo(f.pos.clone());
    const previousFlight={heading:f.heading,speed:f.speed,pitch:f.pitch,bank:f.bank};
    ops.profile=null;ops.phase='airborne';
    if(!runtime.warpToGeo(g.y,g.x,{altM:point.y,headingRad:yaw})){Object.assign(ops,prior);watch.notice='The flight controls are busy. Try again.';publish();return {ok:false,message:watch.notice};}
    f.speed=Math.hypot(t.fix1.vE,t.fix1.vN);ops.warp(f);
    const result=startEscort(runtime,hex,{source:'airport'});
    if(!result.ok){runtime.warpToGeo(previousPosition.y,previousPosition.x,{altM:previousPosition.z,headingRad:previousFlight.heading,stage:true});Object.assign(ops,prior);Object.assign(f,previousFlight);watch.notice=result.message;publish();return result;}
    leave();useFlyStore.setState({airportReturn:{id:airportId,view}});return result;
  }
  Object.assign(watch,{
    cancelPending(){request++;},
    enter,leave,select,join,chooseView,
    track(force){if(watch.selected){watch.tracking=force??!watch.tracking;useFlyStore.getState().setInspectHex(null);publish();}},
    binoculars(){watch.zoom=watch.zoom<.99?1:.28;publish();},
    resetLook(){watch.yaw=0;watch.pitch=0;watch.zoom=1;watch.tracking=false;watch.notice='';publish();},
    clearSelection(){watch.selected=null;watch.tracking=false;watch.notice='';useFlyStore.getState().clearLock();publish();},
    move(dx,dy){if(watch.tracking){watch.tracking=false;publish();}watch.yaw=Math.max(-1.48,Math.min(1.48,watch.yaw-dx*.003));watch.pitch=Math.max(-.65,Math.min(.85,watch.pitch-dy*.002));},
    zoomBy(delta){watch.zoom=Math.max(.28,Math.min(1,watch.zoom*Math.exp(delta*.001)));},
    snapshot(){
      if(!watch.active)return [];
      return (runtime.traffic?.items||[]).map(t=>{
        const row=airportActivity(t,watch.seat,watch.frame.k,45000);if(!row)return null;
        const bearing=Math.atan2(-(t.rx-watch.seat.x),-(t.rz-watch.seat.z))-watch.roomHeading;
        row.inFront=Math.abs(Math.atan2(Math.sin(bearing),Math.cos(bearing)))<1.48;
        return row;
      }).filter(Boolean).sort((a,b)=>Number(b.inFront)-Number(a.inFront)||a.distance-b.distance).slice(0,60);
    },
    updateCamera(dt,camera){
      const v=watch.views[0],a=watch.airport;
      const p=airportPoint(a,v.along,v.cross),q=airportPoint(a,v.lookAlong,0);
      // A fixed seat; drag changes head orientation, never orbits/translates.
      // Cache the validated floor and revisit DEM twice per second. Streaming
      // refinements cannot move the room beneath the seated observer.
      const now=performance.now();
      if(!watch.validated&&now>=nextGroundSample){
        nextGroundSample=now+500;
        const ground=groundAt(p);
        if(Number.isFinite(ground)){watch.seat.set(p.x,Math.max(p.y,ground)+v.height,p.z);watch.validated=true;watch.notice='';publish();}
      }
      if(!watch.validated)watch.seat.set(p.x,p.y+1500,p.z);
      watch.roomHeading=Math.atan2(-(q.x-p.x),-(q.z-p.z));
      eye.copy(watch.seat);eye.y+=1.22;
      const t=watch.tracking&&runtime.traffic?.tracks.get(watch.selected);
      if(t&&t.stale!==2){
        const dx=(t.rx-eye.x)/watch.frame.k,dz=(t.rz-eye.z)/watch.frame.k;
        const targetYaw=Math.atan2(-dx,-dz)-watch.roomHeading;
        const wrapped=Math.atan2(Math.sin(targetYaw),Math.cos(targetYaw));
        if(Math.abs(wrapped)>1.48){watch.tracking=false;watch.notice='This aircraft is behind the lounge. Choose a contact on the runway side.';publish();}
        else {watch.yaw=wrapped;watch.pitch=Math.max(-.65,Math.min(.85,Math.atan2((t.ryd??t.ry)-eye.y,Math.hypot(dx,dz))));}
      } else if(watch.tracking){watch.tracking=false;watch.notice='Contact lost. Returned to the airport view.';publish();}
      if(!cameraBefore){cameraBefore={near:camera.near,fov:camera.fov};cameraUsed=camera;}
      camera.position.copy(eye);camera.rotation.order='YXZ';camera.rotation.set(watch.pitch,watch.roomHeading+watch.yaw,0);
      const fov=58*watch.zoom;
      if(camera.fov!==fov||camera.near!==.08){camera.fov=fov;camera.near=.08;camera.updateProjectionMatrix();}
      watch.snap=false;
    },
  });
  runtime.airportWatch=watch;
  const unsubscribe=useFlyStore.subscribe(s=>s.airportBrowserOpen,(open,previous)=>{if(previous&&!open)request++;});
  registerRuntimeActions({enterAirportObservation:enter,selectAirportContact:select,joinAirportContact:join,leaveAirportObservation:leave});
  return()=>{disposed=true;unsubscribe();leave();request++;watch.active=false;setRunwayObservation(null);useFlyStore.setState({airportWatch:null,airportReturn:null});delete runtime.airportWatch;registerRuntimeActions({enterAirportObservation:null,selectAirportContact:null,joinAirportContact:null,leaveAirportObservation:null});};
}

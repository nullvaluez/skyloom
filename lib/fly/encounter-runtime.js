import { EncounterController, liveCandidate, localCandidates } from './encounters.mjs';
import { useFlyStore } from '@/stores/fly-store';
import { useEncounterStore } from '@/stores/encounter-store';
import { saveMemoryPhoto, encounterSubject } from './encounter-photo';
import { bearingDeg, distanceM } from './adventure-geometry.mjs';
import { startEscort } from './escort';

/** Free Flight is not the mode (title, hangar, ops) or an Adventure is flying/finishing. Shared with MULTIPLAYER's session. */
export function freeFlightExclusive(runtime,state=useFlyStore.getState()){
  const adventure=runtime.adventures?.controller.progress.active;
  return state.screen!=='flight'||state.flightMode!=='free'||['flying','finish'].includes(adventure?.status);
}

export function encounterContext(runtime,state=useFlyStore.getState()){
  const flight=runtime.flight,exclusive=freeFlightExclusive(runtime,state);
  const geo=flight&&runtime.engine?.worldToGeo(flight.pos);
  const held=!!runtime.worldLoading||state.phase!=='flying'||state.cameraMode==='photo'||state.atlasOpen||state.logbookOpen||state.hangarOpen||state.inspectHex||state.adventureOpen||state.settingsOpen||
    (typeof document!=='undefined'&&document.hidden);
  const assisted=runtime.autopilot?.mode&&runtime.autopilot.mode!=='off';
  const active=runtime.encounters?.controller.active;
  return {exclusive,held,blocked:exclusive||held||assisted,epoch:state.warpEpoch,aircraftId:state.aircraftId,
    position:geo?{lat:geo.y,lon:geo.x,altM:geo.z}:null,altM:flight?.pos.y,agl:flight?.agl,speed:flight?.speed,heading:flight?.heading,
    track:active?.hex?runtime.traffic?.tracks.get(active.hex):null,crashed:state.crashEpoch!==runtime.encounters?.crashEpoch};
}

export function connectEncounters(runtime){
  const store=useEncounterStore;store.getState().hydrate();
  let previousOffer=null,scanSec=0,disposed=false,assistedHex=null,completed=false;
  const releaseAssist=()=>{
    if(assistedHex&&runtime.targeting?.lockedHex===assistedHex)runtime.autopilot?.disengage();
    assistedHex=null;
  };
  const controller=new EncounterController(snapshot=>{
    // A COMPLETED crossing keeps the escort flying — the player is mid-shot in
    // the cinematic and Release is theirs to press. Every other ending (Leave,
    // a lost contact, a warp, a crash) still hands the controls back.
    if(!snapshot.active){if(completed)assistedHex=null;else releaseAssist();completed=false;}
    store.setState(snapshot);
    if(snapshot.offer&&snapshot.offer.id!==previousOffer&&useFlyStore.getState().soundOn)runtime.audio?.adventureCue?.('adventure_checkpoint');
    previousOffer=snapshot.offer?.id??null;
  },memory=>{completed=true;store.getState().remember(memory);if(useFlyStore.getState().soundOn)runtime.audio?.adventureCue?.('activity_complete');});
  function scan(){
    const state=useFlyStore.getState(),context=encounterContext(runtime,state);
    if(!runtime.flight||!context.position)return;
    const blocked=context.blocked||!state.encountersEnabled;
    const traffic=blocked?[]:(runtime.traffic?.items??[]).map(t=>liveCandidate(t,runtime.flight)).filter(Boolean).map(c=>({...c,selected:c.hex===state.lockedHex}));
    const local=blocked?[]:localCandidates(context.position,state.aircraftId,(lon,lat)=>runtime.engine.getElevationAt?.(lon,lat));
    controller.scan([...traffic,...local],state.encountersEnabled,blocked);
    const point=runtime.encounters.waypoint();
    store.setState({guidance:point?{bearing:Math.round(bearingDeg(context.position,point)),distanceM:Math.round(distanceM(context.position,point)/100)*100,altM:Math.round(point.altM)}:null});
  }
  runtime.encounters={controller,crashEpoch:useFlyStore.getState().crashEpoch,
    waypoint(){
      const a=controller.active;return a?.kind==='course'?controller.waypoint():encounterSubject(runtime);
    },
    tick(dt){
      const context=encounterContext(runtime);
      if(!useFlyStore.getState().encountersEnabled&&(controller.active||controller.offer))controller.end();
      controller.tick(dt,context);this.crashEpoch=useFlyStore.getState().crashEpoch;
      scanSec+=Math.min(.5,dt);if(scanSec>=1){scanSec=0;scan();}
    },
    nearby(){scan();store.getState().setNearbyOpen(!store.getState().nearbyOpen);},
    accept(id){scan();const ok=controller.accept(id,encounterContext(runtime));if(ok)store.getState().setNearbyOpen(false);return ok;},
    dismiss:()=>controller.dismiss(),end:()=>controller.end(),
    /**
     * Fly alongside the active live-traffic encounter: the shared ESCORT
     * (intercept → formation autopilot + the cinematic camera). Explicit, so
     * it may replace whatever happened to be soft-locked ahead of the nose —
     * the old "never steal another selected target" rule disabled the button
     * whenever ANY aircraft sat in the lock cone, which read as a dead button.
     * Returns { ok, message } so the UI can say why it did not start.
     */
    escortActive(){
      const a=controller.active,context=encounterContext(runtime);
      if(!a||a.kind!=='traffic')return {ok:false,message:'Choose a live aircraft first.'};
      if(context.exclusive)return {ok:false,message:'Not available during this flight mode.'};
      if(context.held)return {ok:false,message:'Close what is on screen first, then try again.'};
      const res=startEscort(runtime,a.hex,{cinematic:true,source:'nearby'});
      if(res.ok){assistedHex=a.hex;store.getState().setNearbyOpen(false);}
      return res;
    },
    /** Legacy boolean form of escortActive(). */
    assist(){return this.escortActive().ok;},
    /**
     * One tap from Nearby or an invitation: accept the experience and, for
     * live traffic, start the escort at once. Discoveries only accept (their
     * guidance is the next step). Returns { ok, message }.
     */
    fly(id){
      scan();
      const c=controller.candidates.find(x=>x.id===id)||(controller.offer?.id===id?controller.offer:null);
      if(!controller.active||controller.active.id!==id){
        if(!c)return {ok:false,message:'That contact has moved out of reach.'};
        if(!this.accept(id))return {ok:false,message:encounterContext(runtime).blocked?'Finish your current escort or close what is on screen first.':'That contact is no longer available.'};
      }
      return controller.active?.kind==='traffic'?this.escortActive():{ok:true};
    },
    async photo(frame,blob){
      const a=controller.active,context=encounterContext(runtime);
      if(!blob?.size||!a)return false;
      if(!frame||![frame.x,frame.y,frame.distanceM].every(Number.isFinite)||frame.token!==a.token||frame.epoch!==context.epoch||!frame.visible||!frame.knownTerrain||Math.abs(frame.x)>.78||Math.abs(frame.y)>.72||
        frame.distanceM>(a.kind==='traffic'?1500:a.course.photoRangeM)||context.exclusive)return false;
      const photoRef=await saveMemoryPhoto(blob);
      if(disposed||controller.active!==a||encounterContext(runtime).epoch!==frame.epoch)return false;
      a.photoRef=photoRef;return controller.photo(frame,encounterContext(runtime));
    },
  };
  return()=>{disposed=true;releaseAssist();delete runtime.encounters;store.setState({offer:null,active:null,result:null,candidates:[],guidance:null,nearbyOpen:false});};
}

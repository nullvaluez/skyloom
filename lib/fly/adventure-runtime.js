import { AdventureController } from './adventure-controller.mjs';
import { adventureById, checkpointStart } from './adventures.mjs';
import { activityCourse } from './adventure-activities.mjs';
import { createAdventureEnvironment, adventureWeather } from './adventure-environment.mjs';
import { computeTargets, snapWeather } from './weather-model';
import { WEATHER } from './fly-constants';
import { validAircraft } from './adventure-geometry.mjs';
import { contentAccess } from './content-access.mjs';
import { useAdventureStore } from '@/stores/adventure-store';
import { useFlyStore } from '@/stores/fly-store';
import { trackAdventure } from './adventure-analytics';

// One controller, driven by the existing simulation. No second flight clock.
export function connectAdventures(runtime){
  useAdventureStore.getState().hydrate();
  const announce=(event,data)=>{
    const route=adventureById(data.adventureId);
    const activity=route?.activities.find(x=>x.id===data.activityId);
    const point=route?.checkpoints[data.checkpoint-1];
    const text=event==='adventure_checkpoint'?point?.name:event==='activity_complete'?activity?.name:event==='activity_missed'?'Keep exploring. You can try that activity again.':null;
    if(text)useAdventureStore.setState({notice:{text,detail:point?.description|| (event==='activity_complete'?'Activity complete':'Your discoveries are saved.'),at:Date.now(),kind:event}});
    if(['adventure_checkpoint','activity_complete','adventure_completed'].includes(event)&&useFlyStore.getState().soundOn&&useFlyStore.getState().phase!=='paused')runtime.audio?.adventureCue?.(event);
    trackAdventure(event,data);
  };
  const controller=new AdventureController(useAdventureStore.getState().progress,p=>{
    const state=useAdventureStore.getState();
    state.save({...p,liveries:state.progress.liveries,interest:state.progress.interest});
  },announce);
  const setEnvironment=(route)=>{
    // Historical saves can still say "curated"; that record must never
    // override the live conditions used for a new flight or a resumed one.
    const next=route?createAdventureEnvironment(route,'live'):null,old=runtime.adventureEnvironment;
    if(old?.routeId===next?.routeId&&old?.mode===next?.mode)return;
    runtime.adventureEnvironment=next;
    const w=runtime.weather;if(w){computeTargets(adventureWeather(next,w.data),WEATHER,w.targets);snapWeather(w.wx,w.targets);}
    useFlyStore.setState(s=>({adventureEnvironmentEpoch:s.adventureEnvironmentEpoch+1}));
  };
  const launch=(id,options={},resume=false,retryId=null)=>{
    const route=adventureById(id),state=useAdventureStore.getState();
    if(!route||!contentAccess(id,state.progress).allowed||!runtime.launchSetup)return false;
    const saved=state.progress.active;
    if(resume&&saved?.id!==id)return false;
    const aircraftId=resume?saved.aircraftId:validAircraft(options.aircraftId)?options.aircraftId:route.aircraftId;
    const mode='live';
    const index=resume?saved.index:0;
    if(retryId&&(!route.activities.some(x=>x.id===retryId)||saved.activities[retryId]==='complete'))return false;
    const course=retryId?activityCourse(route,aircraftId,retryId):null;
    const dest=course?{...checkpointStart(route,index,aircraftId),...course.approach,id:'poi:activity:'+retryId+':'+aircraftId}:checkpointStart(route,index,aircraftId);
    const oldEnvironment=runtime.adventureEnvironment;
    setEnvironment(route);
    if(!runtime.launchSetup({flightMode:'free',aircraftId,dest,adventureId:id})){setEnvironment(adventureById(oldEnvironment?.routeId));return false;}
    controller.progress=resume?{...state.progress,active:{...saved,conditions:mode}}:state.progress;
    if(resume)retryId?controller.retryActivity(retryId):controller.resume();else {controller.start(id,{aircraftId,conditions:mode});state.setPostcard(null);}
    controller.epoch=useFlyStore.getState().warpEpoch;
    useFlyStore.getState().markControlsHelpSeen();
    state.setSummary(null);state.setLibraryOpen(false);state.setPreflight(null);return true;
  };
  runtime.adventures={
    controller,
    prepare(id){
      const route=adventureById(id);if(!route||!contentAccess(id,useAdventureStore.getState().progress).allowed)return false;
      const state=useAdventureStore.getState(),active=state.progress.active;
      let aircraftId=active?.id===id?active.aircraftId:null;
      if(!aircraftId)try{const last=localStorage.getItem('fly-aircraft');if(validAircraft(last))aircraftId=last;}catch{}
      controller.pause();
      state.setPreflight({id,aircraftId:aircraftId||route.aircraftId,conditions:'live'});
      state.setSummary(null);state.setLibraryOpen(false);
      useFlyStore.getState().setFlightMode('free');useFlyStore.getState().setScreen('hangar');
      return true;
    },
    previewEnvironment(id){setEnvironment(adventureById(id));},
    start:(id,options)=>launch(id,options),
    resume:()=>{const a=useAdventureStore.getState().progress.active;return a&&launch(a.id,{},true);},
    retry:()=>{const a=useAdventureStore.getState().progress.active;return a&&launch(a.id,{},true);},
    retryActivity:id=>{const a=useAdventureStore.getState().progress.active;return a&&launch(a.id,{},true,id);},
    skipActivity:id=>controller.skipActivity(id),
    suspend:()=>{controller.pause();setEnvironment(null);},
    abandon:()=>{controller.abandon();setEnvironment(null);},
    photo:(frame,blob)=>{if(!blob?.size)return false;const ok=controller.photo(frame);if(ok)useAdventureStore.getState().setPostcard(URL.createObjectURL(blob));return ok;},
    complete:()=>{const summary=controller.complete();if(summary)useAdventureStore.getState().setSummary(summary);return summary;},
    leaveDebrief:()=>setEnvironment(null),
    tick(dt,geo,options){controller.tick(dt,{lat:geo.y,lon:geo.x,altM:geo.z},options);},
  };
  const unsubscribe=useFlyStore.subscribe((next,prev)=>{
    if(next.screen!=='flight'&&prev.screen==='flight')controller.pause();
    if(next.screen==='title'&&prev.screen!=='title'){
      setEnvironment(null);
      const state=useAdventureStore.getState(),draft=state.preflight;
      state.setPreflight(null);
      if(draft&&prev.screen==='hangar'){
        runtime.operations?.returnToHangar();
        useAdventureStore.setState({libraryOpen:true,selectedRouteId:draft.id});
      }
    }
  });
  const onPageHide=()=>controller.pause();
  if(typeof window!=='undefined')window.addEventListener?.('pagehide',onPageHide);
  return()=>{unsubscribe();if(typeof window!=='undefined')window.removeEventListener?.('pagehide',onPageHide);controller.pause();setEnvironment(null);useAdventureStore.getState().setPostcard(null);delete runtime.adventures;};
}

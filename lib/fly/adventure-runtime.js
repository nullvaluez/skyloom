import { AdventureController } from './adventure-controller.mjs';
import { adventureById, checkpointStart } from './adventures.mjs';
import { contentAccess } from './content-access.mjs';
import { useAdventureStore } from '@/stores/adventure-store';
import { useFlyStore } from '@/stores/fly-store';
import { trackAdventure } from './adventure-analytics';

// Connected by the existing FlightOperations lifetime; no timer advances flight.
export function connectAdventures(runtime){
  useAdventureStore.getState().hydrate();
  const controller=new AdventureController(useAdventureStore.getState().progress,p=>{
    const state=useAdventureStore.getState();
    state.save({...p,liveries:state.progress.liveries,interest:state.progress.interest});
  },trackAdventure);
  let checkpointPosition=null;
  const launch=(id,resume=false,retry=false)=>{
    const route=adventureById(id),state=useAdventureStore.getState();
    if(!route||!contentAccess(id,state.progress).allowed||!runtime.launchSetup)return false;
    controller.progress=state.progress;
    const index=resume&&controller.progress.active?.id===id?controller.progress.active.index:0;
    const dest=checkpointStart(route,index);
    if(!runtime.launchSetup({flightMode:'free',aircraftId:route.aircraftId,dest}))return false;
    if(resume)retry?controller.retry():controller.resume();else controller.start(id);
    controller.epoch=useFlyStore.getState().warpEpoch;
    checkpointPosition={lat:dest.lat,lon:dest.lon,altM:dest.altM};
    useFlyStore.getState().markControlsHelpSeen();
    state.setSummary(null);state.setLibraryOpen(false);return true;
  };
  runtime.adventures={controller,start:id=>launch(id),resume:()=>{const a=useAdventureStore.getState().progress.active;return a&&launch(a.id,true);},retry:()=>{const a=useAdventureStore.getState().progress.active;return a&&launch(a.id,true,true);},
    abandon:()=>controller.abandon(),photo:()=>controller.photo(checkpointPosition),
    complete:()=>{const summary=controller.complete();if(summary)useAdventureStore.getState().setSummary(summary);return summary;},
    tick(dt,geo,options){checkpointPosition={lat:geo.y,lon:geo.x,altM:geo.z};controller.tick(dt,checkpointPosition,options);},
  };
  const unsubscribe=useFlyStore.subscribe((next,prev)=>{
    if(next.screen!=='flight'&&prev.screen==='flight')controller.pause();
  });
  const onPageHide=()=>controller.pause();if(typeof window!=='undefined')window.addEventListener?.('pagehide',onPageHide);
  return()=>{unsubscribe();if(typeof window!=='undefined')window.removeEventListener?.('pagehide',onPageHide);controller.pause();delete runtime.adventures;};
}

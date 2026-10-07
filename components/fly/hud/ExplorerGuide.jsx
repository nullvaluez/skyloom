'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useFlyStore, inFlight } from '@/stores/fly-store';
import { useExplorationStore } from '@/stores/exploration-store';
import { explorerPreferences, subscribeExplorerPreferences, setExplorerPreferences, DEFAULT_PREFERENCES } from '@/lib/fly/explorer-preferences.mjs';
import { airportById } from '@/lib/fly/operations-airports';
import { ADVENTURES, distanceM } from '@/lib/fly/adventures.mjs';
import { useAdventureStore } from '@/stores/adventure-store';
import { anyOverlayOpen } from '@/hooks/use-overlay-back';

const STEPS=[
  ['Welcome to Skyloom','Steer gently with the mouse, arrow keys, or the touch stick. Return to the centre to level out.'],
  ['Take your time','Choose Slow for sightseeing or Cruise to cover ground. Near a runway, use the power slider or + / − instead.'],
  ['Choose a horizon','Open the Atlas with M or the compass. Pick a city, a scenic place, or a nearby airport.'],
  ['Keep a memory','Open Photo with P or the touch actions. Compose your view, then use the shutter to download it.'],
  ['Your travels live here','Open your Travel journal with L or from the pause menu. Guided journeys add discoveries and region stamps.'],
];
export function ExplorerGuide({runtime}){
  const [step,setStep]=useState(0);
  const prefs=useSyncExternalStore(subscribeExplorerPreferences,explorerPreferences,()=>DEFAULT_PREFERENCES);
  const flying=useFlyStore(s=>inFlight(s)&&!anyOverlayOpen(s));
  const photo=useFlyStore(s=>s.cameraMode==='photo');
  const guidedJourney=useAdventureStore(s=>s.libraryOpen||!!s.summary||s.progress.active?.status==='flying');
  const [status,setStatus]=useState(null);
  const [readyEpoch,setReadyEpoch]=useState(-1),[notice,setNotice]=useState(null);
  const epoch=useFlyStore(s=>s.warpEpoch);
  useEffect(()=>{
    useExplorationStore.getState().hydrate();
    let lastEvent=runtime.operations?.sequence||0,cell=null,dwell=0,lastAt=performance.now(),lastEpoch=-1,readyTicks=0;
    const id=setInterval(()=>{
      const now=performance.now(),delta=Math.min(1.5,(now-lastAt)/1000);lastAt=now;
      const s=useFlyStore.getState(),journey=useAdventureStore.getState();
      const ready=runtime.worldLoading!==true&&(!window.__flyBoot||window.__flyBoot.pct>=100);
      readyTicks=ready&&lastEpoch===s.warpEpoch?readyTicks+1:0;lastEpoch=s.warpEpoch;
      setReadyEpoch(readyTicks>=2?s.warpEpoch:-1);
      setNotice(n=>n&&n.until<now?null:n);
      const live=inFlight(s)&&!anyOverlayOpen(s)&&!journey.libraryOpen&&!journey.summary&&!document.hidden&&ready&&readyTicks>=2;
      const geo=runtime.geo;
      if(!live){dwell=0;return;}
      if(Number.isFinite(geo?.x)&&Number.isFinite(geo?.y)){
        const position={lat:geo.y,lon:geo.x};
        for(const region of ADVENTURES)for(const [index,point] of region.checkpoints.entries()){
          if(distanceM(position,point)<1000){
            const added=useExplorationStore.getState().record('place',{id:`discovery:${region.id}:${index}`,name:point.name,lat:point.lat,lon:point.lon,at:Date.now()});
            if(added&&journey.progress.active?.status!=='flying'){
              setNotice({text:`Discovered ${point.name} · saved in your journal`,until:now+5000});
              if(s.soundOn)runtime.audio?.adventureCue?.('adventure_checkpoint');
            }
          }
        }
        const key=`cell:${Math.round(geo.y*10)},${Math.round(geo.x*10)}`;
        if(cell!==key){cell=key;dwell=0;}dwell+=delta;
        if(dwell>=8){
          const dest=runtime.flightPlanDest;
          const near=dest&&Math.abs(dest.lat-geo.y)<.2&&Math.abs(dest.lon-geo.x)<.2;
          useExplorationStore.getState().record('place',{id:key,name:near?dest.name:`${geo.y.toFixed(2)}°, ${geo.x.toFixed(2)}°`,lat:geo.y,lon:geo.x,at:Date.now()});
        }
      }
      const ops=runtime.operations;
      for(const e of ops?.events||[]){
        if(e.id<=lastEvent)continue;
        lastEvent=e.id;
        if(e.type==='touchdown'){
          const a=airportById(e.airport);
          if(a){
            useExplorationStore.getState().record('landing',{id:`${a.id}:${Date.now()}:${e.id}`,name:a.name,lat:a.a.lat,lon:a.a.lon,at:Date.now(),quality:e.quality});
            useExplorationStore.getState().record('place',{id:`airport:${a.id}`,name:a.name,lat:a.a.lat,lon:a.a.lon,at:Date.now()});
          }
        }
      }
      const data=runtime.dataStatus;
      setStatus(data?.traffic?.state==='unavailable'?'Live traffic is unavailable. You can keep exploring.':data?.traffic?.state==='delayed'?'Traffic positions are delayed.':null);
    },1000);
    return()=>clearInterval(id);
  },[runtime]);
  if(!flying||photo||readyEpoch!==epoch)return null;
  return <>
    {prefs.tutorial==='new'&&!guidedJourney&&<aside className="explorer-guide" aria-label="First-flight tips" data-testid="explorer-guide">
      <p className="text-xs text-cyan-100/70">First flight · {step+1} of {STEPS.length}</p><strong>{STEPS[step][0]}</strong><p>{STEPS[step][1]}</p>
      <div><button onClick={()=>setExplorerPreferences({tutorial:'skipped'})}>Skip tips</button><button onClick={()=>step===STEPS.length-1?setExplorerPreferences({tutorial:'done'}):setStep(step+1)}>{step===STEPS.length-1?'Enjoy the flight':'Next'}</button></div>
    </aside>}
    {notice&&!guidedJourney&&prefs.tutorial!=='new'?<p className="explorer-data-status" role="status">{notice.text}</p>:status&&<p className="explorer-data-status" role="status">{status}</p>}
  </>;
}

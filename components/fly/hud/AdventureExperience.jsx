'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, ChevronDown, Compass, Navigation2, RotateCcw, Sparkles, X, Plane, Sun } from 'lucide-react';
import { ADVENTURES, adventureById, bearingDeg, distanceM, LIVERIES } from '@/lib/fly/adventures.mjs';
import { adventureMinutes } from '@/lib/fly/adventure-activities.mjs';
import { adventurePhotoFrame } from '@/lib/fly/adventure-photo';
import { contentAccess } from '@/lib/fly/content-access.mjs';
import { useAdventureStore } from '@/stores/adventure-store';
import { useFlyStore } from '@/stores/fly-store';
import { trackAdventure } from '@/lib/fly/adventure-analytics';
import { aircraftName, resolveAircraft } from '@/lib/fly/player-aircraft';
import { aircraftPresentation } from '@/lib/fly/cinematic-earth';
import { isPhoneClass } from '@/lib/fly/device-class';
import { RewardAircraftPreview } from './HangarScene';
import { adventureRecovery } from '@/lib/fly/adventure-guidance.mjs';
import './adventures.css';

const medals=['','Bronze','Silver','Gold'];
function Dialog({title,onClose,children}){
  const ref=useRef();
  useEffect(()=>{const previous=document.activeElement,dialog=ref.current;const siblings=[...(dialog?.parentElement?.children||[])].filter(e=>e!==dialog&&!e.contains(dialog));const flags=siblings.map(e=>e.inert);siblings.forEach(e=>{e.inert=true;});dialog?.focus();return()=>{siblings.forEach((e,i)=>{e.inert=flags[i];});previous?.focus?.();};},[]);
  const keys=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();onClose();}if(e.key==='Tab'){const all=[...ref.current.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"],a[href]')].filter(el=>el.getClientRects().length&&!el.closest('[inert]'));const first=all[0],last=all.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  return <section className="journey-dialog" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onKeyDown={keys}><header><div><Compass size={20}/><span>Skyloom journeys</span></div><button onClick={onClose} aria-label={'Close '+title}><X size={22}/></button></header>{children}</section>;
}
function usePauseForMenu(){
  useEffect(()=>{const old=useFlyStore.getState().phase;useFlyStore.getState().setPhase('paused');return()=>{const s=useFlyStore.getState();if(s.phase==='paused')s.setPhase(s.screen==='flight'?'flying':old);};},[]);
}
export function RouteTrace({route}){
  const points=[route.start,...route.checkpoints],k=Math.cos(route.start.lat*Math.PI/180),xs=points.map(p=>p.lon*k),ys=points.map(p=>-p.lat);
  const minX=Math.min(...xs),minY=Math.min(...ys),scale=190/Math.max(Math.max(...xs)-minX,Math.max(...ys)-minY,.001);
  const xy=points.map((_,i)=>[25+(xs[i]-minX)*scale,20+(ys[i]-minY)*scale]);
  return <svg className="journey-route-map" viewBox="0 0 240 235" role="img" aria-label={route.place+' flight route, '+route.checkpoints.length+' discoveries'}><polyline points={xy.map(p=>p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>{xy.slice(1).map(([x,y],i)=><g key={i}><circle cx={x} cy={y} r="10" fill="#102633" stroke="currentColor"/><text x={x} y={y+4} textAnchor="middle" fill="#edf6fa" fontSize="11">{i+1}</text></g>)}</svg>;
}
export function DestinationImage({route,className=''}) {
  const [failedId,setFailedId]=useState(null);
  return failedId===route.id?<div className={'journey-destination-fallback '+className}><Compass size={28}/><span>{route.place}</span></div>:<img className={'journey-destination-image '+className} src={route.artwork} alt={'In-game view of '+route.place} loading="lazy" onError={()=>setFailedId(route.id)}/>;
}
export function AdventureExperience({runtime}){
  const open=useAdventureStore(s=>s.libraryOpen),summary=useAdventureStore(s=>s.summary),assetWarning=useAdventureStore(s=>s.assetWarning),screen=useFlyStore(s=>s.screen);
  useEffect(()=>{useAdventureStore.getState().hydrate();},[]);
  useEffect(()=>{useFlyStore.setState({adventureOpen:open||!!summary,closeAdventureOverlay:()=>{const s=useAdventureStore.getState();if(s.libraryOpen)s.setLibraryOpen(false);else {runtime.adventures?.leaveDebrief();s.setSummary(null);}}});return()=>useFlyStore.setState({adventureOpen:false,closeAdventureOverlay:null});},[open,summary,runtime]);
  return <>{assetWarning&&screen==='flight'&&<div className="journey-asset-warning" role="status">Aircraft detail could not load. You can keep flying or retry from the hangar. <button onClick={()=>useAdventureStore.setState({assetWarning:false})}>Dismiss</button></div>}{open&&<AdventureLibrary runtime={runtime}/>} {!open&&summary&&screen==='flight'&&<AdventureSummary runtime={runtime} summary={summary}/>} {!open&&!summary&&<AdventureHUD runtime={runtime}/>}</>;
}
function AdventureLibrary({runtime}){
  usePauseForMenu();
  const progress=useAdventureStore(s=>s.progress),[id,setId]=useState(()=>useAdventureStore.getState().selectedRouteId||progress.active?.id||ADVENTURES.find(a=>!progress.completed[a.id])?.id||ADVENTURES[0].id),[replace,setReplace]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false);
  const route=adventureById(id)||ADVENTURES[0],access=contentAccess(route.id,progress),resuming=progress.active?.id===route.id;
  useEffect(()=>{const read=()=>setReady(!!runtime.adventures);read();const timer=setInterval(read,400);return()=>clearInterval(timer);},[runtime]);
  const close=()=>useAdventureStore.getState().setLibraryOpen(false);
  const launch=()=>{if(progress.active&&!resuming&&!replace){setReplace(true);return;}runtime.audio?.resume?.();if(!runtime.adventures?.prepare(route.id))setError('Flight is not ready yet. Please try again in a moment.');};
  return <Dialog title="Adventures" onClose={close}><div className="journey-library">
    <div className="journey-index"><h1>Find your<br/>next horizon.</h1><p>Six places to get lost in.<br/>Nine ways to fly there.</p>
      {['first-flights','wild-earth'].map(pack=><section key={pack}><h2>{pack==='first-flights'?'First Flights':'Wild Earth'} <small>{pack==='first-flights'?'Always free':'Free during preview'}</small></h2>
        {ADVENTURES.filter(a=>a.packId===pack).map(a=><button className="journey-route" key={a.id} aria-pressed={id===a.id} onClick={()=>{setReplace(false);setError('');setId(a.id);useAdventureStore.setState({selectedRouteId:a.id});}} data-testid={'adventure-'+a.id}><DestinationImage route={a}/><span><strong>{a.place}</strong><small>{a.name}</small></span><span>{progress.completed[a.id]?medals[progress.completed[a.id].medal]:adventureMinutes(a,a.aircraftId)+' min'}</span></button>)}
      </section>)}
    </div>
    <article className="journey-brief" style={{'--stamp':route.color}}><div className="journey-landscape"><DestinationImage route={route}/><div><span>{route.place}</span><p>{route.caption}</p></div></div><div className="journey-brief-body"><p className="journey-meta"><Sun size={14}/>{route.conditions.label}</p><h2>{route.name}</h2><p>{route.introduction}</p>
      <div className="journey-itinerary"><RouteTrace route={route}/><ol>{route.checkpoints.map((p,i)=><li key={p.id}><span>{i+1}</span>{p.name}</li>)}</ol></div>
      <div className="journey-activity-list"><h3>Take the scenic challenge</h3>{route.activities.map(a=><div key={a.id}>{a.kind==='photo'?<Camera size={16}/>:<Navigation2 size={16}/>}<span>{a.name}</span></div>)}<p>All activities are optional. Discoveries always count.</p></div>
      <p className="journey-meta"><Plane size={15}/>{aircraftName(route.aircraftId)} recommended · all nine aircraft available</p>
      {replace&&<p role="alert">Choose another journey? Your unfinished route is replaced only when you launch. Earned stamps and liveries stay yours.</p>}{error&&<p role="alert">{error}</p>}
      <button className="journey-primary" disabled={!ready||!access.allowed} onClick={launch} data-testid="adventure-launch">{!ready?'Preparing flight…':resuming?'Prepare to continue':replace?'Choose aircraft for this journey':'Choose your aircraft'}<ArrowRight size={20}/></button>
      {replace&&<button onClick={()=>setReplace(false)}>Keep current journey</button>}
      <small>Complete this journey to earn {LIVERIES[route.reward].name}. {access.reason==='preview'?'Free during preview.':''}</small>
    </div></article>
  </div><div className="journey-mobile-launch"><button className="journey-primary" disabled={!ready||!access.allowed} onClick={launch}>{!ready?'Preparing flight…':resuming?'Prepare to continue':'Choose your aircraft'}<ArrowRight size={18}/></button></div></Dialog>;
}
function AdventureHUD({runtime}){
  const active=useAdventureStore(s=>s.progress.active),notice=useAdventureStore(s=>s.notice),sessionOnly=useAdventureStore(s=>s.sessionOnly),screen=useFlyStore(s=>s.screen),phase=useFlyStore(s=>s.phase),camera=useFlyStore(s=>s.cameraMode),atlas=useFlyStore(s=>s.atlasOpen),logbook=useFlyStore(s=>s.logbookOpen);
  const environmentEpoch=useFlyStore(s=>s.adventureEnvironmentEpoch);
  const [reading,setReading]=useState(null),[confirm,setConfirm]=useState(false),[detailsOpen,setDetailsOpen]=useState(false);
  const activeId=active?.id,activeIndex=active?.index;
  useEffect(()=>{if(!activeId||!runtime.adventureEnvironment)return;const tick=()=>{const g=runtime.geo,route=adventureById(activeId),p=route?.checkpoints[Math.min(activeIndex,route.checkpoints.length-1)];if(g&&p){const bearing=bearingDeg({lat:g.y,lon:g.x},p),controller=runtime.adventures?.controller;setReading({distance:distanceM({lat:g.y,lon:g.x},p),bearing,turn:(bearing-(runtime.flight?.heading||0)*180/Math.PI+540)%360-180,altDelta:p.altM-g.z,offer:controller?.offer(),activity:controller?.reading?{...controller.reading}:null,photo:useFlyStore.getState().cameraMode==='photo'?adventurePhotoFrame(runtime,useFlyStore.getState().warpEpoch):null,now:Date.now()});}};tick();const t=setInterval(tick,250);return()=>clearInterval(t);},[runtime,activeId,activeIndex,environmentEpoch]);
  if(!active||!runtime.adventureEnvironment||screen!=='flight'||phase==='paused'||atlas||logbook)return null;
  const route=adventureById(active.id),target=route.checkpoints[Math.min(active.index,route.checkpoints.length-1)],recovery=adventureRecovery(active),finished=active.status==='finish',offer=reading?.offer;
  const completed=Object.values(active.activities).filter(x=>x==='complete').length;
  const photoUnlocked=!recovery&&(active.index>=route.activities.find(x=>x.kind==='photo').unlockIndex||runtime.adventures?.controller.replayId===route.activities.find(x=>x.kind==='photo').id);
  const photo=reading?.photo,photoDistance=photo?distanceM(photo.position,route.activities.find(x=>x.kind==='photo').target):Infinity,photoReady=photoUnlocked&&photo?.visible&&Math.abs(photo.x)<=.78&&Math.abs(photo.y)<=.72&&photoDistance>=100&&photoDistance<=Math.max(5500,(runtime.flight?.cfg?.speeds.cruise||60)*30);
  if(camera==='photo')return <aside className="journey-photo-guide"><Camera size={18}/><div><strong>{route.activities.find(x=>x.kind==='photo').name}</strong><p>{active.activities[route.activities.find(x=>x.kind==='photo').id]==='complete'?'Photograph captured. Your view will appear in the debrief.':!photoUnlocked?'Reach the nearby discovery first, or use Try activity from your flight details.':photoReady?'Landmark in frame. Capture to keep this view.':'Look toward the named landmark and place it near the center of your frame.'}</p></div></aside>;
  const range=reading?(reading.distance<1000?Math.round(reading.distance/10)*10+' m':(reading.distance/1000).toFixed(1)+' km'):'—';
  const direction=!reading?'Finding your course':Math.abs(reading.turn)<12?'On course':'Turn '+(reading.turn<0?'left':'right');
  return <><aside className="journey-hud" data-testid="adventure-hud" aria-label="Current adventure">
    <header className="journey-flight-header"><span><Compass size={15}/>{route.place}</span><span>{Math.min(active.index,route.checkpoints.length)} / {route.checkpoints.length}</span><button className="journey-dismiss" aria-label="Leave adventure" aria-expanded={confirm} onClick={()=>setConfirm(!confirm)}><X size={16}/></button></header>
    <ol className="journey-progress" aria-label="Discoveries">{route.checkpoints.map((p,i)=><li key={p.id} data-state={i<active.index?'done':i===active.index?'current':'upcoming'} aria-current={i===active.index?'step':undefined}><span className="journey-sr-only">{p.name}</span></li>)}</ol>
    <h2 aria-live="polite">{finished?'Your journey, discovered.':recovery?.heading||target.name}</h2>
    {!recovery&&!finished&&<div className="journey-navigation"><Navigation2 size={18} style={{transform:'rotate('+(reading?.turn||0)+'deg)'}}/><strong>{direction}</strong><span>{range}</span></div>}
    {!recovery&&!finished&&reading&&Math.abs(reading.altDelta)>180&&<p className="journey-flight-hint">{reading.altDelta>0?'Climb':'Descend'} gently about {Math.round(Math.abs(reading.altDelta)*3.28084/100)*100} ft toward the discovery.</p>}
    {!recovery&&active.index===0&&<p className="journey-flight-hint">{isPhoneClass()?'Use the left stick':'Use your mouse, WASD, or left stick'} to follow the blue beacon. Gold gates are optional.</p>}
    {recovery&&<p className="journey-recovery-copy">{recovery.description}</p>}
    {offer&&!recovery&&<div className="journey-live-activity"><span>{reading.activity?'Activity in progress':'Optional activity'}</span><strong>{offer.name}</strong><p>{offer.instruction}</p>{reading.activity&&<><progress max="1" value={reading.activity.progress}/><small>{reading.activity.inside?'Good line. Keep going.':'Ease back into the marked corridor.'}</small></>}<div>{offer.kind==='photo'&&<button onClick={()=>useFlyStore.getState().setCameraMode('photo')}>Frame your view</button>}<button onClick={()=>runtime.adventures?.skipActivity(offer.id)}>Skip activity</button></div></div>}
    {(finished||recovery)&&<button className="journey-recover" onClick={()=>finished?runtime.adventures?.complete():active.status==='paused'?runtime.adventures?.resume():runtime.adventures?.retry()}>{finished?<Sparkles size={16}/>:<RotateCcw size={16}/>} {finished?'Collect your stamp':recovery.label}</button>}
    <footer className="journey-flight-footer"><button className="journey-photo" onClick={()=>useFlyStore.getState().setCameraMode('photo')}><Camera size={15}/>Photo</button><button className="journey-flight-details" aria-label={`Flight details and activities: ${completed} of 3 complete`} aria-expanded={detailsOpen} onClick={()=>setDetailsOpen(!detailsOpen)}>{completed}/3 activities<ChevronDown size={14}/></button></footer>
    {detailsOpen&&<div className="journey-flight-detail-content"><p>{active.index>0?route.checkpoints[active.index-1].description:route.introduction}</p>{target.hint&&<p>{target.hint}</p>}<ul className="journey-retry-list">{route.activities.map(a=><li key={a.id}><span>{active.activities[a.id]==='complete'?<Check size={14}/>:<Compass size={14}/>} {a.name}</span>{active.activities[a.id]!=='complete'&&<button onClick={()=>runtime.adventures?.retryActivity(a.id)}>Try activity</button>}</li>)}</ul><p>Bronze: finish your journey. Silver: 2 activities. Gold: all 3.</p><button onClick={()=>runtime.adventures?.prepare(route.id)}>Change aircraft</button></div>}
    {sessionOnly&&<p className="journey-storage-note" role="status">Progress lasts for this visit. Export a backup in Pause.</p>}
    {confirm&&<div className="journey-leave-confirm"><p>Leave this journey? Earned rewards stay yours.</p><div><button onClick={()=>setConfirm(false)}>Keep flying</button><button onClick={()=>runtime.adventures?.abandon()}>Leave journey</button></div></div>}
  </aside>{notice&&reading?.now-notice.at<6500&&<div className="journey-discovery" role="status"><span>{notice.kind==='adventure_checkpoint'?'Discovered':notice.kind==='activity_complete'?'Nicely flown':'Another try, another time'}</span><strong>{notice.text}</strong><p>{notice.detail}</p></div>}</>;
}
function EarnedAircraft({id}) {
  const visuals=useFlyStore(s=>s.visuals),mapStyle=useFlyStore(s=>s.mapStyle),[failed,setFailed]=useState(false);
  const resolved=resolveAircraft(id),aircraft={...resolved,entry:aircraftPresentation(resolved,isPhoneClass(),{visuals,mapStyle})};
  return <div className="journey-earned-aircraft">{failed?<p>Preview unavailable. Your livery is saved in the hangar.</p>:<RewardAircraftPreview aircraft={aircraft} onError={()=>setFailed(true)}/>}</div>;
}
function AdventureSummary({runtime,summary}){
  usePauseForMenu();
  const progress=useAdventureStore(s=>s.progress),postcard=useAdventureStore(s=>s.postcard),route=adventureById(summary.id),next=ADVENTURES.find(a=>!progress.completed[a.id])||ADVENTURES[(ADVENTURES.indexOf(route)+1)%ADVENTURES.length];
  const close=()=>{runtime.adventures?.leaveDebrief();useAdventureStore.getState().setSummary(null);};
  const nextFlight=()=>{runtime.adventures?.leaveDebrief();useAdventureStore.setState({selectedRouteId:next.id,libraryOpen:true,summary:null});};
  return <Dialog title="Journey complete" onClose={close}><div className="journey-summary">
    <div className="journey-summary-photo">{postcard?<img src={postcard} alt={'Your journey through '+route.place} onError={()=>useAdventureStore.getState().setPostcard(null)}/>:<DestinationImage route={route}/>}<span>{route.place}</span></div>
    <div className="journey-summary-body"><p className="journey-medal"><Sparkles size={20}/>{medals[summary.medal]} discovery medal</p><h1>A journey<br/>to keep.</h1><p>{aircraftName(summary.aircraftId)} · {Math.round(summary.elapsed/60)} minutes · {summary.conditions==='live'?'Live conditions':route.conditions.label}</p>
    <details className="journey-summary-discoveries"><summary>{route.checkpoints.length} discoveries collected</summary><ol>{route.checkpoints.map(p=><li key={p.id}>{p.name}</li>)}</ol></details>
    {summary.rewards.length>0&&<EarnedAircraft id={summary.rewards[0]}/>}
    <ul className="journey-result-list">{route.activities.map(a=><li key={a.id}><span>{summary.activities[a.id]==='complete'?<Check size={17}/>:<Compass size={17}/>}</span><div><strong>{a.name}</strong><p>{summary.activities[a.id]==='complete'?'Completed':a.instruction}</p></div></li>)}</ul>
    {summary.rewards.map(id=><div key={id} className="journey-reward"><img src={'/models/player-'+({fighter:'vector-v2',military:'talon-v1','warbird-jet':'dart-v1','warbird-prop':'mustang-v1',prop:'skylark-v1',glider:'whisper-v1',bizjet:'meridian-v1',airliner:'stratoliner-v1',cargo:'leviathan-v1'}[id])+'.svg'} alt=""/><div><strong>{LIVERIES[id].name}</strong><p>New livery for {aircraftName(id)}</p><button onClick={()=>{useAdventureStore.getState().equip(id,true);runtime.adventures?.prepare(route.id);useAdventureStore.setState(s=>({preflight:{...s.preflight,aircraftId:id}}));}}>Try it in the hangar</button></div></div>)}
    <button className="journey-primary" onClick={nextFlight}>Next: {next.place}<ArrowRight size={20}/></button><div className="journey-actions"><button onClick={()=>runtime.adventures?.start(route.id,{aircraftId:summary.aircraftId,conditions:summary.conditions})}>Fly again</button><button onClick={()=>runtime.adventures?.prepare(route.id)}>Choose another aircraft</button><button onClick={close}>Keep exploring</button></div>
    </div>
  </div></Dialog>;
}
export function AdventureJournal(){
  const progress=useAdventureStore(s=>s.progress);
  const interest=answer=>{useAdventureStore.getState().save({...progress,interest:answer});trackAdventure('pack_interest',{packId:'wild-earth',answer});};
  return <div className="journey-journal"><h3>Your journeys</h3><p>{Object.keys(progress.completed).length} of {ADVENTURES.length} destination stamps · {progress.rewards.length} of 9 liveries</p>{ADVENTURES.map(a=><div className="journey-journal-row" key={a.id}><DestinationImage route={a}/><div><strong>{a.place}</strong><p>{progress.completed[a.id]?medals[progress.completed[a.id].medal]+' medal':progress.active?.id===a.id?progress.active.index+' / '+a.checkpoints.length+' discoveries':'Waiting to be discovered'}</p>{Object.entries(progress.records).filter(([k])=>k.startsWith(a.id+'|')).map(([key,r])=><p key={key}>{aircraftName(key.split('|')[1])} · {key.split('|')[2]} · {Object.values(r.activities).filter(s=>s==='complete').length}/3 activities</p>)}</div></div>)}<h3>Your liveries</h3>{Object.entries(LIVERIES).map(([id,l])=><p key={id}>{progress.rewards.includes(id)?'✓':'○'} {l.name} · {aircraftName(id)}</p>)}<button className="journey-primary" onClick={()=>{useFlyStore.getState().setLogbookOpen(false);useAdventureStore.getState().setLibraryOpen(true);}}>Choose a journey<ArrowRight size={18}/></button>
  {ADVENTURES.some(a=>a.packId==='wild-earth'&&progress.completed[a.id])&&<section className="journey-survey"><h3>Help shape the next journeys</h3><p>Would you buy three adventures like Wild Earth for $9.99 USD once? Research only; this preview remains free.</p><div className="journey-actions">{['yes','maybe','no'].map(a=><button key={a} aria-pressed={progress.interest===a} onClick={()=>interest(a)}>{a[0].toUpperCase()+a.slice(1)}</button>)}</div></section>}</div>;
}

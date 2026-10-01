'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, ChevronDown, Compass, MapPin, Navigation2, RotateCcw, Sparkles, Wind, X } from 'lucide-react';
import { ADVENTURES, adventureById, bearingDeg, checkpointStart, distanceM, LIVERIES } from '@/lib/fly/adventures.mjs';
import { contentAccess } from '@/lib/fly/content-access.mjs';
import { useAdventureStore } from '@/stores/adventure-store';
import { useFlyStore } from '@/stores/fly-store';
import { trackAdventure } from '@/lib/fly/adventure-analytics';
import { aircraftName } from '@/lib/fly/player-aircraft';
import { adventureRecovery } from '@/lib/fly/adventure-guidance.mjs';
import './adventures.css';

function Dialog({title,onClose,children}){
  const ref=useRef();
  useEffect(()=>{const previous=document.activeElement,dialog=ref.current;const siblings=[...(dialog?.parentElement?.children||[])].filter(e=>e!==dialog&&!e.contains(dialog));const flags=siblings.map(e=>e.inert);siblings.forEach(e=>{e.inert=true;});dialog?.focus();return()=>{siblings.forEach((e,i)=>{e.inert=flags[i];});previous?.focus?.();};},[]);
  const keys=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();onClose();}if(e.key==='Tab'){const all=[...ref.current.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.closest('[inert]'));const first=all[0],last=all.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  return <section className="journey-dialog" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onKeyDown={keys}><header><div><Compass size={20}/><span>Skyloom journeys</span></div><button onClick={onClose} aria-label={`Close ${title}`}><X size={22}/></button></header>{children}</section>;
}
export function AdventureExperience({runtime}){
  const open=useAdventureStore(s=>s.libraryOpen),summary=useAdventureStore(s=>s.summary),assetWarning=useAdventureStore(s=>s.assetWarning),screen=useFlyStore(s=>s.screen);
  useEffect(()=>{useAdventureStore.getState().hydrate();},[]);
  useEffect(()=>{useFlyStore.setState({adventureOpen:open||!!summary,closeAdventureOverlay:()=>{const s=useAdventureStore.getState();if(s.libraryOpen)s.setLibraryOpen(false);else s.setSummary(null);}});return()=>useFlyStore.setState({adventureOpen:false,closeAdventureOverlay:null});},[open,summary]);
  return <>{assetWarning&&screen==='flight'&&<div className="journey-asset-warning" role="status">Aircraft detail could not load. You can keep flying or retry from the hangar. <button onClick={()=>useAdventureStore.setState({assetWarning:false})}>Dismiss</button></div>}{open&&<AdventureLibrary runtime={runtime}/>} {!open&&summary&&screen==='flight'&&<AdventureSummary runtime={runtime} summary={summary}/>} {!open&&!summary&&<AdventureHUD runtime={runtime}/>}</>;
}
function AdventureLibrary({runtime}){
  useEffect(()=>{const old=useFlyStore.getState().phase;useFlyStore.getState().setPhase('paused');return()=>{if(useFlyStore.getState().phase==='paused')useFlyStore.getState().setPhase(old);};},[]);
  const progress=useAdventureStore(s=>s.progress),[id,setId]=useState(()=>progress.active?.id||ADVENTURES.find(a=>!progress.completed[a.id])?.id||ADVENTURES[0].id),[replace,setReplace]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false);
  const route=adventureById(id),access=contentAccess(id,progress),resuming=progress.active?.id===id;
  const checkpointIndex=resuming?progress.active.index:0;
  useEffect(()=>{const timer=setInterval(()=>{setReady(!!runtime.adventures);if(runtime.stageDestination&&useFlyStore.getState().screen!=='flight')runtime.stageDestination(checkpointStart(route,checkpointIndex));},400);return()=>clearInterval(timer);},[runtime,route,checkpointIndex]);
  const close=()=>useAdventureStore.getState().setLibraryOpen(false);
  const launch=()=>{if(progress.active&&!resuming&&!replace){setReplace(true);return;}runtime.audio?.resume?.();const ok=resuming?runtime.adventures?.resume():runtime.adventures?.start(id);if(!ok)setError('Flight is not ready yet. Please try again in a moment.');};
  return <Dialog title="Adventures" onClose={close}><div className="journey-library">
    <div className="journey-index"><h1>A little further<br/>from ordinary.</h1><p>Six short flights. A world of discoveries.</p>
      {['first-flights','wild-earth'].map(pack=><section key={pack}><h2>{pack==='first-flights'?'First Flights':'Wild Earth'} <small>{pack==='first-flights'?'Always free':'Free during preview'}</small></h2>
        {ADVENTURES.filter(a=>a.packId===pack).map(a=><button className="journey-route" key={a.id} aria-pressed={id===a.id} onClick={()=>{setReplace(false);setError('');setId(a.id);}} data-testid={`adventure-${a.id}`}><span className="journey-stamp" style={{'--stamp':a.color}}>{progress.completed[a.id]?<Check size={20}/>:<MapPin size={20}/>}</span><span><strong>{a.place}</strong><small>{a.name}</small></span><span>{progress.completed[a.id]?['','Bronze','Silver','Gold'][progress.completed[a.id].medal]:`${a.minutes} min`}</span></button>)}
      </section>)}
    </div>
    <article className="journey-brief" style={{'--stamp':route.color}}><div className="journey-landscape" data-place={route.destinationId}><Compass size={54}/><span>{route.place}</span></div><div className="journey-brief-body"><p className="journey-meta">{route.minutes} minutes · {aircraftName(route.aircraftId)} · Four discoveries</p><h2>{route.name}</h2><p>{route.introduction}</p>
      {replace&&<p role="alert">Starting this journey replaces the unfinished route. Your earned stamps and liveries stay yours.</p>}
      {error&&<p role="alert">{error}</p>}
      <button className="journey-primary" disabled={!ready||!access.allowed} onClick={launch} data-testid="adventure-launch">{!ready?'Preparing flight…':!access.allowed?'Unavailable':resuming?'Continue adventure':replace?'Replace and start':'Start adventure'}<ArrowRight size={20}/></button>
      {replace&&<button onClick={()=>setReplace(false)}>Keep current journey</button>}
      <small>{access.reason==='preview'?'Free during preview. No purchase or expiry.':'Included in First Flights, always free.'}</small>
      <ol>{route.checkpoints.map((p,i)=><li key={p.name}><span>{i+1}</span>{p.name}</li>)}</ol><p>Earn a destination stamp and the <strong>{LIVERIES[route.reward].name}</strong> livery.</p><p className="journey-meta">Optional: capture a photo and fly steadily for 30 seconds.</p>
    </div></article>
  </div><div className="journey-mobile-launch"><button className="journey-primary" disabled={!ready||!access.allowed} onClick={launch}>{!ready?'Preparing flight…':!access.allowed?'Unavailable':resuming?'Continue adventure':replace?'Replace and start':`Fly ${route.place}`}<ArrowRight size={18}/></button></div></Dialog>;
}
function AdventureHUD({runtime}){
  const active=useAdventureStore(s=>s.progress.active),sessionOnly=useAdventureStore(s=>s.sessionOnly),screen=useFlyStore(s=>s.screen),phase=useFlyStore(s=>s.phase),camera=useFlyStore(s=>s.cameraMode),atlas=useFlyStore(s=>s.atlasOpen),logbook=useFlyStore(s=>s.logbookOpen);
  const [reading,setReading]=useState(null),[confirm,setConfirm]=useState(false),[detailsOpen,setDetailsOpen]=useState(false);
  const activeId=active?.id,activeIndex=active?.index;
  useEffect(()=>{if(!activeId)return;const tick=()=>{const g=runtime.geo,route=adventureById(activeId),p=route?.checkpoints[Math.min(activeIndex,3)];if(g&&p){const bearing=bearingDeg({lat:g.y,lon:g.x},p);setReading({distance:distanceM({lat:g.y,lon:g.x},p),bearing,turn:(bearing-(runtime.flight?.heading||0)*180/Math.PI+540)%360-180,altDelta:p.altM-g.z});}};const t=setInterval(tick,250);return()=>clearInterval(t);},[runtime,activeId,activeIndex]);
  if(!active||screen!=='flight'||phase==='paused'||camera==='photo'||atlas||logbook)return null;
  const route=adventureById(active.id),target=route.checkpoints[Math.min(active.index,3)],recovery=adventureRecovery(active),finished=active.status==='finish';
  const hint=target.hint||(active.index===0?'Follow the beacon to your first discovery.':'');
  const range=reading?(reading.distance<1000?`${Math.round(reading.distance/10)*10} m`:`${(reading.distance/1000).toFixed(1)} km`):'—';
  const direction=!reading?'Finding your course':Math.abs(reading.turn)<12?'On course':`Turn ${reading.turn<0?'left':'right'}`;
  const vertical=reading&&Math.abs(reading.altDelta)>300?`${reading.altDelta>0?'Climb':'Descend'} gently`:reading&&Math.abs(reading.turn)>=12?'Ease into the turn':'Keep this heading';
  return <aside className="journey-hud" data-testid="adventure-hud" aria-label="Current adventure">
    <header className="journey-flight-header"><span><Compass size={15} strokeWidth={1.6} aria-hidden="true"/>{route.place}</span><span className="journey-flight-count">{finished?'Complete':`${Math.min(active.index+1,4)} of 4`}</span><button className="journey-dismiss" aria-label="Leave adventure" aria-expanded={confirm} onClick={()=>setConfirm(!confirm)}><X size={16}/></button></header>
    <ol className="journey-progress" aria-label={`${Math.min(active.index,4)} of 4 discoveries completed`}>
      {route.checkpoints.map((p,i)=><li key={p.name} data-state={i<active.index?'done':i===active.index?'current':'upcoming'} aria-current={i===active.index?'step':undefined}><span className="journey-sr-only">{p.name}: {i<active.index?'discovered':i===active.index?'next':'ahead'}</span></li>)}
    </ol>
    <h2 aria-live="polite">{finished?'A journey to remember.':recovery?.heading||target.name}</h2>
    {!recovery&&!finished&&<div className="journey-navigation">
      <span className="journey-course-icon"><Navigation2 size={21} strokeWidth={1.7} aria-hidden="true" style={{transform:`rotate(${reading?.turn||0}deg)`}}/></span>
      <div className="journey-course-copy"><strong>{direction}</strong><span>{vertical}</span></div>
      <div className="journey-distance"><strong>{range}</strong><span>to discovery</span></div>
    </div>}
    {recovery&&<p className="journey-recovery-copy">{recovery.description}</p>}
    {finished&&<p className="journey-recovery-copy">Four discoveries. A new destination stamp, just for you.</p>}
    {!recovery&&!finished&&hint&&<p className="journey-flight-hint">{hint}</p>}
    <div className="journey-bonuses" aria-label="Optional objectives">
      <span data-complete={active.photo} title="Capture a photo near a discovery">{active.photo?<Check size={13}/>:<Camera size={13}/>}<span>Photo{active.photo&&<span className="journey-sr-only"> completed</span>}</span></span>
      <span data-complete={active.steady} title="Fly steadily for 30 seconds">{active.steady?<Check size={13}/>:<Wind size={14}/>}<span>Steady flight{active.steady&&<span className="journey-sr-only"> completed</span>}</span></span>
      <span className="journey-bonus-label">Bonus</span>
    </div>
    {(finished||recovery)&&<button className="journey-recover" onClick={()=>finished?runtime.adventures?.complete():active.status==='paused'?runtime.adventures?.resume():runtime.adventures?.retry()}>{finished?<Sparkles size={16}/>:<RotateCcw size={16}/>} {finished?'Collect your stamp':recovery.label}</button>}
    <footer className="journey-flight-footer">
      <button className="journey-photo" onClick={()=>useFlyStore.getState().setCameraMode('photo')}><Camera size={16} strokeWidth={1.7}/>Photo mode</button>
      <button className="journey-flight-details" aria-expanded={detailsOpen} aria-controls="journey-flight-detail-content" onClick={()=>setDetailsOpen(!detailsOpen)}>Details <ChevronDown size={14}/></button>
    </footer>
    {detailsOpen&&<div id="journey-flight-detail-content" className="journey-flight-detail-content">
        <p>{active.index>0?route.checkpoints[Math.min(active.index-1,3)].description:route.introduction}</p>
        <dl><div><dt>Heading</dt><dd>{reading?`${String(Math.round(reading.bearing)%360).padStart(3,'0')}°`:'—'}</dd></div><div><dt>Altitude</dt><dd>{Math.round(target.altM*3.28084).toLocaleString()} ft MSL</dd></div></dl>
        <p className="journey-details-note">Bonus objectives: capture a photo near a discovery and fly steadily for 30 seconds.</p>
    </div>}
    {sessionOnly&&<p className="journey-storage-note" role="status">Progress lasts for this visit. Export a backup in Pause.</p>}
    {confirm&&<div className="journey-leave-confirm"><p>Leave this journey? Your earned rewards stay yours.</p><div><button onClick={()=>setConfirm(false)}>Keep flying</button><button onClick={()=>runtime.adventures?.abandon()}>Leave journey</button></div></div>}
  </aside>;
}
function AdventureSummary({runtime,summary}){
  const progress=useAdventureStore(s=>s.progress),route=adventureById(summary.id),next=ADVENTURES.find(a=>!progress.completed[a.id])||ADVENTURES[(ADVENTURES.indexOf(route)+1)%6];
  const close=()=>useAdventureStore.getState().setSummary(null);
  useEffect(()=>{useFlyStore.getState().setPhase('paused');return()=>useFlyStore.getState().setPhase('flying');},[]);
  const interest=answer=>{useAdventureStore.getState().save({...progress,interest:answer});trackAdventure('pack_interest',{packId:'wild-earth',answer});};
  return <Dialog title="Journey complete" onClose={close}><div className="journey-summary"><span className="journey-earned-stamp" style={{'--stamp':route.color}}><Check size={40}/></span><p>{['','Bronze','Silver','Gold'][summary.medal]} discovery medal</p><h1>{route.place},<br/>in your logbook.</h1><p>You discovered {route.checkpoints.map(p=>p.name).join(', ')}.</p>{summary.rewards.map(id=><p key={id} className="journey-reward">New livery · {LIVERIES[id].name} for {aircraftName(id)}</p>)}
    {route.packId==='wild-earth'&&!progress.interest&&<section className="journey-survey"><h2>Would you buy a pack like Wild Earth?</h2><p>Research only: $9.99 USD once for three adventures. This preview is free; nothing is for sale.</p><div className="journey-actions">{['yes','maybe','no'].map(a=><button key={a} onClick={()=>interest(a)}>{a[0].toUpperCase()+a.slice(1)}</button>)}</div></section>}
    {route.packId==='wild-earth'&&progress.interest&&<p>Thanks for sharing your preference.</p>}
    <button className="journey-primary" onClick={()=>{close();runtime.adventures?.start(next.id);}}>Next: {next.place}<ArrowRight size={20}/></button><div className="journey-actions"><button onClick={()=>{close();useFlyStore.getState().setCameraMode('photo');}}>Create a postcard</button><button onClick={()=>{close();useFlyStore.getState().setLogbookOpen(true);}}>Open logbook</button><button onClick={close}>Keep exploring</button></div>
  </div></Dialog>;
}
export function AdventureJournal(){
  const progress=useAdventureStore(s=>s.progress);
  return <div className="journey-journal"><h3>Your journeys</h3><p>{Object.keys(progress.completed).length} of 6 destination stamps · {progress.rewards.length} of 9 liveries</p>{ADVENTURES.map(a=><div className="journey-journal-row" key={a.id}><span className="journey-stamp" style={{'--stamp':a.color}}>{progress.completed[a.id]?<Check size={20}/>:<MapPin size={20}/>}</span><div><strong>{a.place}</strong><p>{progress.completed[a.id]?`${['','Bronze','Silver','Gold'][progress.completed[a.id].medal]} medal · ${new Date(progress.completed[a.id].at).toLocaleDateString()}`:progress.active?.id===a.id?`${progress.active.index} / 4 discoveries · unfinished`:'Waiting to be discovered'}</p></div></div>)}<h3>Your liveries</h3>{Object.entries(LIVERIES).map(([id,l])=><p key={id}>{progress.rewards.includes(id)?'✓':'○'} {l.name} · {aircraftName(id)}</p>)}<button className="journey-primary" onClick={()=>{useFlyStore.getState().setLogbookOpen(false);useAdventureStore.getState().setLibraryOpen(true);}}>Choose a journey<ArrowRight size={18}/></button></div>;
}

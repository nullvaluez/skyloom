'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, PlaneTakeoff, PlaneLanding, Navigation, MapPin, Check, Rotate3D, LoaderCircle, ChevronLeft, Search, Globe2, Mountain, MountainSnow, Building2, Waves, Sun, TreePine, Plane } from 'lucide-react';
import { CARD_THEME } from './inspect/inspect-tokens';
import { useGLTF } from '@react-three/drei';
import { useFlyStore } from '@/stores/fly-store';
import { PLAYER_AIRCRAFT,resolveAircraft,saveAircraft } from '@/lib/fly/player-aircraft';
import { OPERATIONS_AIRPORTS,airportEligible,airportById } from '@/lib/fly/operations-airports';
import { operationsProfile } from '@/lib/fly/operations-profiles';
import { HangarScene } from './HangarScene';
import { FLIGHT_PLAN, FRONT_DOOR } from '@/lib/fly/fly-constants';
import { FEATURED_DESTINATIONS, defaultDestination, flightPlanOn, saveLastSetup, searchDestinations } from '@/lib/fly/flight-plan';
import './operations.css';
const SERVICE_RETRY_MS=250;
export function GroundHangar({runtime}){
  const open=useFlyStore(s=>s.hangarOpen);
  return open?<HangarBody runtime={runtime}/>:null;
}
function HangarBody({runtime}){
  const root=useRef();
  const [id,setId]=useState(()=>{try{const saved=localStorage.getItem('fly-aircraft');return PLAYER_AIRCRAFT.some(a=>a.id===saved)?saved:'prop';}catch{return 'prop';}});
  const [airport,setAirport]=useState(()=>{try{const saved=localStorage.getItem('fly-departure'),aircraft=localStorage.getItem('fly-aircraft')||'prop';return airportEligible(airportById(saved),aircraft)?saved:aircraft==='prop'||aircraft==='warbird-prop'?'KOSU':'KCMH';}catch{return 'KOSU';}});
  const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[live,setLive]=useState(false),[retry,setRetry]=useState(0);
  const [exteriorReady,setExteriorReady]=useState(false);
  const exteriorLoaded=useCallback(()=>setExteriorReady(true),[]);
  const [startMode,setStartMode]=useState('apron'),[view,setView]=useState('quarter');
  const [confirmReturn,setConfirmReturn]=useState(()=>!!runtime.operations && !['hangar','completed'].includes(runtime.operations.phase));
  useEffect(()=>{useFlyStore.getState().setHangarDismissible(confirmReturn);},[confirmReturn]);
  // R25 B FLIGHT PLAN: the panel adapts to the title's choice. Flag-off (and
  // ops mode) renders today's dispatch panel; free mode is the destination
  // picker. `plan` false ⇒ nothing below changes a byte of today's hangar.
  const flightMode=useFlyStore(s=>s.flightMode);
  const plan=flightPlanOn(),free=plan&&flightMode==='free';
  // Default = where the flight already is (the title spot), so a first flight needs no staging.
  const fallbackDest=useMemo(()=>free?defaultDestination(runtime,useFlyStore.getState().spawn):null,[free,runtime]);
  const [picked,setDest]=useState(null),dest=free?picked??fallbackDest:null;
  const [query,setQuery]=useState(''),[cursor,setCursor]=useState(0),[stage,setStage]=useState({state:'idle',pct:0});
  const results=useMemo(()=>free?searchDestinations(query,6):[],[free,query]);
  // Debounced staging: pre-stream the pick behind the opaque hangar.
  // The hangar can open before FlyScene installs the runtime services (the
  // title is interactive at once; a phone mounts the world seconds later), so
  // staging waits for stageDestination instead of calling it once and giving up.
  useEffect(()=>{if(!free||!dest||confirmReturn)return undefined;let t;const go=()=>{if(typeof runtime.stageDestination!=='function'){t=setTimeout(go,SERVICE_RETRY_MS);return;}if(runtime.stageDestination(dest)===false)setStage({state:'unstaged',pct:0});};t=setTimeout(go,FLIGHT_PLAN.stage.debounceMs);return()=>clearTimeout(t);},[free,dest,runtime,confirmReturn]);
  useEffect(()=>{if(!free||!dest)return undefined;const put=next=>setStage(p=>p.state===next.state&&p.pct===next.pct?p:next);const read=()=>{const s=runtime.staging;if(!s||s.key!==dest.id)return setStage(p=>p.state==='unstaged'||p.state==='pending'?p:{state:'pending',pct:0});put(s.ready?{state:'ready',pct:100}:{state:'staging',pct:Math.round((s.progress||0)*100)});};read();const t=setInterval(read,250);return()=>clearInterval(t);},[free,dest,runtime]);
  const aircraft=resolveAircraft(id),profile=operationsProfile(aircraft.id);
  // Ops mode stages the departure airport too — a no-op unless the flight is
  // genuinely far from it (a title spot on another continent; see
  // OPS_STAGE_MIN_KM), so the Columbus-cluster flows never stage-warp.
  const opsStageId=aircraft.id==='glider'?'KOSU':airport;
  useEffect(()=>{if(!plan||free||confirmReturn)return undefined;let t;const go=()=>{if(typeof runtime.stageDestination!=='function'){t=setTimeout(go,SERVICE_RETRY_MS);return;}runtime.stageDestination(opsStageId);};t=setTimeout(go,FLIGHT_PLAN.stage.debounceMs);return()=>clearTimeout(t);},[plan,free,opsStageId,runtime,confirmReturn]);
  const compatible=airportEligible(airportById(airport),aircraft.id);
  const loaded=useCallback(selected=>{if(selected===id)setReady(true);},[id]),failure=useCallback(()=>setFailed(true),[]);
  useEffect(()=>{const t=setInterval(()=>setLive(!!runtime.beginDeparture),250);return()=>clearInterval(t);},[runtime]);
  const chooseDest=d=>{if(!d)return;setDest(d);setQuery('');setCursor(0);setStage({state:'pending',pct:0});};
  const searchKey=e=>{if(e.key==='ArrowDown'){e.preventDefault();setCursor(c=>Math.min(c+1,results.length-1));}else if(e.key==='ArrowUp'){e.preventDefault();setCursor(c=>Math.max(c-1,0));}else if(e.key==='Enter'&&results.length>0){e.preventDefault();chooseDest(results[Math.min(cursor,results.length-1)]);}else if(e.key==='Escape'&&query){e.preventDefault();setQuery('');}};
  useEffect(()=>{const previous=document.activeElement;root.current?.focus();return()=>previous?.focus?.();},[]);
  useEffect(()=>{const rail=root.current?.querySelector('.ops-fleet'),selected=rail?.querySelector('[aria-pressed="true"]');if(selected)rail.scrollTo({left:selected.offsetLeft-(rail.clientWidth-selected.offsetWidth)/2,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[id,confirmReturn]);
  // Every key stops here (today's hangar), and React stops the NATIVE event at
  // the root, so the window Esc chain never sees an Esc pressed inside the
  // hangar: the pre-flight Esc → title (FRONT_DOOR) is handled here, unless the
  // search box already used it to clear its query.
  const keyboard=e=>{e.stopPropagation();if(e.key==='Escape'&&!confirmReturn&&!e.isDefaultPrevented()&&toTitle())e.preventDefault();if(e.key==='Tab'){const items=[...e.currentTarget.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')];const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  const pick=next=>{if(next===id)return;setReady(false);setFailed(false);setId(next);if(!airportEligible(airportById(airport),next)&&next!=='glider')setAirport(next==='prop'||next==='warbird-prop'?'KOSU':'KCMH');};
  const start=()=>{
    const chosen=aircraft.id;if(!ready||!live)return;
    if(free){if(!dest||!runtime.launchSetup?.({flightMode:'free',aircraftId:chosen,dest}))return;try{localStorage.setItem('fly-departure',airport);}catch{}return;}
    if(chosen==='glider')runtime.launchGlider();else if(!runtime.beginDeparture(chosen,airport,startMode))return;
    saveAircraft(chosen);try{localStorage.setItem('fly-departure',airport);}catch{}
    if(plan)saveLastSetup(chosen==='glider'?{flightMode:'ops',aircraftId:chosen,start:'practice'}:{flightMode:'ops',aircraftId:chosen,airportId:airport,start:startMode});
    useFlyStore.getState().setHangarOpen(false);
  };
  const toTitle=()=>{const s=useFlyStore.getState();if(!FRONT_DOOR.enabled||s.hangarDismissible)return false;s.setScreen('title');return true;};
  if(confirmReturn)return <div ref={root} tabIndex={-1} onKeyDown={keyboard} onPointerDown={e=>e.stopPropagation()} data-overlay="hangar" className="ops-hangar ops-confirm" role="dialog" aria-modal="true" aria-label="Return to hangar">
    <div><h1>Return to the hangar?</h1><p>This ends your current flight. Choose another aircraft or departure airport in the hangar.</p>
      <button onClick={()=>{runtime.operations.returnToHangar();setConfirmReturn(false);}}>End flight and open hangar</button>
      <button onClick={()=>useFlyStore.getState().setHangarOpen(false)}>Continue flight</button></div>
  </div>;
  const categories={fighter:'Interceptor',military:'Tactical jet','warbird-jet':'Classic jet','warbird-prop':'Warbird',prop:'Light aircraft',glider:'Glider',bizjet:'Business jet',airliner:'Airliner',cargo:'Heavy transport'};
  const modes=[['apron','Apron',Navigation],['runway','Runway',PlaneTakeoff],['approach','Approach',PlaneLanding]];
  const modeHelp={apron:'The full flight. Taxi out from your parking stand.',runway:'Lined up and ready. You handle the takeoff.',approach:'Find your landing. Begin on a stable final approach.'};
  const theme={'--ops-ice':CARD_THEME.ice,'--ops-muted':CARD_THEME.iceDim,'--ops-edge':CARD_THEME.edgeSoft};
  return <section ref={root} tabIndex={-1} onKeyDown={keyboard} onPointerDown={e=>e.stopPropagation()} data-overlay="hangar" className="ops-hangar" style={theme} role="dialog" aria-modal="true" aria-labelledby="hangar-title" data-testid="hangar" data-exterior-ready={exteriorReady}>
    <div className="ops-bay" key={retry}><HangarScene aircraft={aircraft} airport={airportById(airport)||airportById('KOSU')} view={view} onReady={loaded} onError={failure} onExteriorReady={exteriorLoaded}/></div>
    <div className="ops-hangar-shade"/>
    <header className="ops-heading">{plan&&FRONT_DOOR.enabled&&<button type="button" className="ops-hangar-back" data-testid="hangar-back" onClick={toTitle}><ChevronLeft size={16}/>Title</button>}<div className="ops-wordmark"><Navigation size={22}/><span>Skyloom</span><span className="ops-location-divider"/><h1 id="hangar-title">Hangar</h1>{plan&&<span className="ops-mode-chip" data-testid="hangar-mode" data-mode={free?'free':'ops'}>{free?'Free Flight':'Takeoff & Landing'}</span>}</div>{free&&dest?<div className="ops-location"><MapPin size={14}/><span>{dest.name} <span className="ops-location-name">/ {dest.region}</span></span></div>:<div className="ops-location"><MapPin size={14}/><span>{airport} <span className="ops-location-name">/ {airportById(airport)?.name}</span></span></div>}</header>
    <div className="ops-aircraft-title"><span className="ops-aircraft-class">{categories[id]}</span><h2>{aircraft.entry.name}</h2><p>{aircraft.entry.blurb}</p>{profile&&<dl><div><dt>Rotation</dt><dd>{Math.round(profile.rotate*1.94384)}<span>kt</span></dd></div><div><dt>Approach</dt><dd>{Math.round(profile.approach*1.94384)}<span>kt</span></dd></div><div><dt>Airframe</dt><dd>{aircraft.entry.targetLenM}<span>m</span></dd></div></dl>}</div>
    <div className="ops-views" aria-label="Inspect aircraft"><Rotate3D size={16}/>{[['quarter','Overview'],['front','Front'],['side','Side'],['rear','Rear']].map(([key,label])=><button key={key} aria-pressed={view===key} onClick={()=>setView(key)}>{label}</button>)}</div>
    {!ready&&!failed&&<div className="ops-preview-loading" role="status"><LoaderCircle size={18}/>Preparing your aircraft</div>}
    {free?<FreeDispatch dest={dest} query={query} setQuery={v=>{setQuery(v);setCursor(0);}} results={results} cursor={cursor} onSearchKey={searchKey} choose={chooseDest} stage={stage} ready={ready} live={live} failed={failed} retryPreview={()=>{useGLTF.clear(aircraft.entry.url);setFailed(false);setRetry(v=>v+1);}} start={start}/>:<div className="ops-dispatch">
      <div className="ops-dispatch-scroll">
        <div className="ops-dispatch-heading"><PlaneTakeoff size={20}/><h3>Make it your flight</h3></div>
        <label htmlFor="departure-airport">Departure airport</label>
        <div className="ops-airport-select"><MapPin size={16}/><select id="departure-airport" value={airport} onChange={e=>{setAirport(e.target.value);setExteriorReady(false);}} disabled={!profile}>
          {OPERATIONS_AIRPORTS.map(a=><option key={a.id} value={a.id} disabled={!airportEligible(a,aircraft.id)}>{a.id} · {a.name}{!airportEligible(a,aircraft.id)?'  unavailable':''}</option>)}
        </select></div>
        {profile?<><fieldset className="ops-start-options"><legend>Choose your starting point</legend>{modes.map(([key,label,Icon])=><label key={key} className={startMode===key?'selected':''}><input type="radio" name="departure-mode" value={key} checked={startMode===key} onChange={()=>setStartMode(key)}/><Icon size={20}/><strong>{label}</strong>{startMode===key&&<Check className="ops-mode-check" size={12}/>}</label>)}</fieldset><p className="ops-mode-description">{modeHelp[startMode]}</p></>:<p className="ops-mode-description">A quiet start above Ohio State University. Find a thermal and explore.</p>}
      </div>
      <div className="ops-dispatch-action">
        <button data-testid="hangar-fly" className="ops-primary" disabled={!ready||!live||(!compatible&&!!profile)} onClick={start}><span>{!ready?'Loading aircraft…':!live?'Preparing flight…':!profile?'Start glider practice':({apron:'Start on apron',runway:'Start on runway',approach:'Practice landing'})[startMode]}</span><ArrowUpRight size={20}/></button>
        <p className="ops-help">{profile?(startMode==='apron'?'Parking brake set. The next move is yours.':'Assisted starting position. Manual flight.'): 'Airborne glider practice'}</p>
        {failed&&<p role="alert">Aircraft preview could not load. <button onClick={()=>{useGLTF.clear(aircraft.entry.url);setFailed(false);setRetry(v=>v+1);}}>Retry</button></p>}
      </div>
    </div>}
    <nav className="ops-fleet" aria-label="Choose aircraft">{PLAYER_AIRCRAFT.map(a=><button key={a.id} onClick={()=>pick(a.id)} aria-pressed={id===a.id} data-testid={`hangar-pick-${a.id}`}><AircraftGlyph id={a.id}/><span>{a.name}</span><small>{categories[a.id]}</small></button>)}</nav>
    <p className="ops-orbit-hint">Drag to orbit <span/> Scroll or pinch to zoom</p>
    <a className="ops-hangar-credit" href="https://www.esri.com/" target="_blank" rel="noreferrer">Airport imagery © Esri, Maxar, Earthstar Geographics</a>
  </section>;
}
const DEST_GLYPH={canyon:Mountain,peak:MountainSnow,valley:TreePine,fjord:Waves,coast:Waves,city:Building2,desert:Sun,field:Plane};
const KIND_LABEL={city:'City',airport:'Airport',landmark:'Landmark',military:'Military field',hotspot:'Spotting hotspot',featured:'Featured'};
const STAGE_TEXT={idle:'Choose a destination',pending:'Preparing the world…',staging:'Streaming the world',ready:'World ready — cleared for departure',unstaged:'The world streams in on arrival'};
/** R25 B: the Free Flight dispatch panel (destination search + featured grid). */
export function FreeDispatch({dest,query,setQuery,results,cursor,onSearchKey,choose,stage,ready,live,failed,retryPreview,start}){
  const ft=dest?Math.round(dest.altM*3.28084/100)*100:0;
  return <div className="ops-dispatch ops-free">
    <div className="ops-dispatch-scroll">
      <div className="ops-dispatch-heading"><Globe2 size={20}/><h3>Where to?</h3></div>
      <label htmlFor="free-flight-search">Search any city, airport or landmark</label>
      <div className="ops-free-search"><Search size={15}/><input id="free-flight-search" data-testid="hangar-dest-search" type="search" autoComplete="off" spellCheck={false} placeholder="Paris, Denver, JFK…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={onSearchKey} aria-controls="free-flight-results"/></div>
      {results.length>0&&<ul id="free-flight-results" className="ops-free-results" role="listbox" aria-label="Search results">{results.map((d,n)=><li key={d.id}><button type="button" role="option" aria-selected={n===cursor} data-testid={`hangar-dest-result-${n}`} onClick={()=>choose(d)}><strong>{d.name}</strong><small>{d.kind==='featured'?d.region:[KIND_LABEL[d.kind]??d.kind,d.region].filter(Boolean).join(' · ')}</small></button></li>)}</ul>}
      {query.trim()&&results.length===0&&<p className="ops-free-empty">No places match “{query.trim()}”.</p>}
      <div className="ops-free-grid" role="group" aria-label="Featured destinations">{FEATURED_DESTINATIONS.map(d=>{const Icon=DEST_GLYPH[d.glyph]??Globe2;return <button type="button" key={d.id} data-testid={`hangar-dest-${d.id}`} aria-pressed={dest?.id===d.id} onClick={()=>choose(d)} title={d.blurb}><Icon size={15}/><span>{d.name}</span><small>{d.region}</small></button>;})}</div>
    </div>
    <div className="ops-dispatch-action">
      {dest&&<div className="ops-free-selected" data-testid="hangar-dest-selected" data-dest={dest.id}><strong>{dest.name}</strong><span>{dest.region??KIND_LABEL[dest.kind]}</span><small>Airborne start · {ft.toLocaleString('en-US')} ft · heading {String(Math.round(dest.headingDeg)%360).padStart(3,'0')}°</small></div>}
      <p className="ops-free-stage" data-testid="hangar-stage-status" data-state={stage.state} role="status">{stage.state==='staging'?`${STAGE_TEXT.staging} · ${stage.pct}%`:STAGE_TEXT[stage.state]}</p>
      <button data-testid="hangar-fly" className="ops-primary" disabled={!ready||!live||!dest} onClick={start}><span>{!ready?'Loading aircraft…':!live?'Preparing flight…':`Fly to ${dest?.name??'…'}`}</span><ArrowUpRight size={20}/></button>
      {failed&&<p role="alert">Aircraft preview could not load. <button onClick={retryPreview}>Retry</button></p>}
    </div>
  </div>;
}
function AircraftGlyph({id}){
  const heavy=['airliner','cargo','bizjet'].includes(id),prop=['prop','warbird-prop','glider'].includes(id);
  return <svg viewBox="0 0 80 42" aria-hidden="true"><path d={heavy?'M39 2Q42 2 43 7L44 17 73 30V34L44 27 44 34 54 39V41L40 38 26 41V39L36 34 36 27 7 34V30L36 17 37 7Q38 2 39 2Z':prop?'M38 3H42L43 18 75 20V25L43 23 43 34 53 38V40L40 37 27 40V38L37 34 37 23 5 25V20L37 18Z':'M40 2 46 17 70 34 70 37 48 30 49 38 58 41 42 38 40 40 38 38 22 41 31 38 32 30 10 37 10 34 34 17Z'}/></svg>;
}

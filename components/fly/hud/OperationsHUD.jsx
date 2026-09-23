'use client';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { anyOverlayOpen } from '@/hooks/use-overlay-back';
import { MobileFlightDeck } from './MobileFlightDeck';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Navigation, PlaneTakeoff, PlaneLanding } from 'lucide-react';
import { CARD_THEME } from './inspect/inspect-tokens';
import { operationsContext,advanceOperationsDisclosure } from '@/lib/fly/operations-disclosure';
import { useFlyStore } from '@/stores/fly-store';
import { OPERATIONS_AIRPORTS,airportEligible } from '@/lib/fly/operations-airports';
const titles={parked:'Ready on the apron',taxiOut:'Taxi to the runway',takeoffRoll:'Takeoff',airborne:'In flight',approach:'Approach',landingRoll:'Touchdown',taxiIn:'Taxi to parking',completed:'Flight complete',crashed:'Try again'};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function shieldControlKeys(e){
  // Native UI navigation must not also pitch the plane or apply wheel brakes.
  // Other keys still fly normally after a pointer click leaves a button focused.
  if(e.target.closest('select')||([' ','Enter'].includes(e.key)&&e.target.closest('button,summary')))e.stopPropagation();
}
function BrakeButton({runtime}){
  const release=()=>runtime.input?.setBrake(false);
  useEffect(()=>()=>runtime.input?.setBrake(false),[runtime]);
  return <button className="ops-brake" style={{touchAction:'none'}}
    onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);runtime.input?.setBrake(true);}}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();runtime.input.setBrake(true);}}}
    onKeyUp={release} onBlur={release}>Hold brakes</button>;
}
function ApproachCue({path,flight,operations}){
  const p=operations.profile,flare=flight.agl<p.clearance+10&&path.distance<300&&path.distance>-450;
  const tooFast=flight.speed>p.approach*1.15,tooSlow=flight.speed<p.approach*.85;
  const missed=path.distance < -450 && flight.agl>p.clearance+15;
  const message=missed?'Runway behind you — go around':Math.abs(path.headingError)>.6?`Turn ${path.headingError>0?'right':'left'} toward the runway`:flare?'Idle power. Gently raise the nose.':tooFast?'Reduce power to approach speed':tooSlow?'Add power to maintain approach speed':Math.abs(path.vertical)>12?`${path.vertical>0?'Ease down':'Ease up'} to the glide path`:'Keep the runway centred';
  return <div className="ops-approach-cue">
    <div className="ops-path-display"><svg viewBox="0 0 160 84" role="img" aria-label={`Runway ${Math.round(Math.abs(path.lateral))} metres ${path.lateral>0?'left':'right'}; ${Math.round(Math.abs(path.vertical))} metres ${path.vertical>0?'below':'above'} your path`}>
      <path d="M20 42H140M80 12V72"/><circle cx="80" cy="42" r="17"/>
      <circle className="ops-path-dot" cx={80-clamp(path.lateral/Math.max(35,path.distance*.08),-1,1)*58} cy={42+clamp(path.vertical/40,-1,1)*29} r="5"/>
    </svg><span>{Math.max(0,path.distance/1000).toFixed(1)} km to threshold</span></div>
    <div><strong>{message}</strong><p>Centre the approach indicator.</p></div>
  </div>;
}
export function OperationsHUD({runtime}){
  const {isTouch}=useDeviceLayout();
  const covered=useFlyStore(anyOverlayOpen);
  const open=useFlyStore(s=>s.hangarOpen),phase=useFlyStore(s=>s.phase),photo=useFlyStore(s=>s.cameraMode==='photo');
  const [,tick]=useState(0),[disclosure,setDisclosure]=useState(null);
  const body=useRef(),toggle=useRef();
  const expanded=disclosure?.expanded??true;
  useEffect(()=>{if(!expanded){runtime.input?.setBrake(false);if(body.current?.contains(document.activeElement))toggle.current?.focus({preventScroll:true});}},[expanded,runtime]);
  useEffect(()=>{const timer=setInterval(()=>{tick(t=>t+1);const o=runtime.operations;
    if(o?.profile&&runtime.flight){const context=operationsContext(o,runtime.flight),typing=body.current?.contains(document.activeElement)&&document.activeElement?.matches('input,select,textarea');setDisclosure(s=>advanceOperationsDisclosure(s,context,performance.now(),typing));}if(o?.summary&&!o.saved){o.markSaved();try{let raw;try{raw=JSON.parse(localStorage.getItem('fly-flight-history')||'[]');}catch{raw=[];}const rows=Array.isArray(raw)?raw:[];localStorage.setItem('fly-flight-history',JSON.stringify([...rows,o.summary].slice(-100)));}catch{}}},100);return()=>clearInterval(timer);},[runtime]);
  const o=runtime.operations,f=runtime.flight;
  if(covered||open||phase==='paused'||photo||!o?.profile||o.phase==='hangar'||!f)return null;
  if(isTouch)return <MobileFlightDeck runtime={runtime} titles={titles} BrakeButton={BrakeButton} ApproachCue={ApproachCue}/>;
  const p=o.profile,approach=o.phase==='approach',path=approach?o.approachGuidance(f):null;
  const departure=['parked','taxiOut','takeoffRoll'].includes(o.phase),takeoff=departure?o.takeoffStatus(f):null;
  const stopped=['completed','crashed'].includes(o.phase),ground=o.grounded;
  const title=departure&&takeoff.aligned&&o.phase!=='takeoffRoll'?'Ready for takeoff':titles[o.phase];
  const rotation=o.phase==='takeoffRoll'&&takeoff.ready;
  const PhaseIcon=approach?PlaneLanding:departure?PlaneTakeoff:Navigation;
  const setExpanded=value=>setDisclosure(s=>({...s,context:s?.context||operationsContext(o,f),since:performance.now(),expanded:value,manual:true}));
  const theme={'--ops-ice':CARD_THEME.ice,'--ops-muted':CARD_THEME.iceDim,'--ops-edge':CARD_THEME.edgeSoft};
  return <aside className="ops-hud" style={theme} data-expanded={expanded} aria-label="Flight operations" data-overlay="operations" onKeyDown={shieldControlKeys} onPointerDown={e=>e.stopPropagation()} data-testid="operations-hud" data-phase={o.phase}>
    <header className="ops-flight-heading"><PhaseIcon className="ops-phase-icon" size={19}/><div className="ops-flight-title"><span>{o.airport.id} / {o.runwayName}</span><h2 aria-live="polite">{expanded?title:'Flight controls'}</h2></div><button ref={toggle} className="ops-collapse-toggle" aria-label={expanded?'Minimize flight controls':'Open flight controls'} aria-expanded={expanded} aria-controls="operations-content" onClick={()=>setExpanded(!expanded)}>{expanded?<ChevronUp size={17}/>:<ChevronDown size={17}/>}</button></header>
    <div className="ops-reveal" inert={!expanded} aria-hidden={!expanded}><div className="ops-reveal-clip"><div id="operations-content" ref={body} className="ops-hud-content">
    <div className="ops-instruments"><output><strong>{Math.round(f.speed*1.94384)}</strong><span>kt</span><small>{ground?`Rotate at ${Math.round(p.rotate*1.94384)} kt`:`Approach ${Math.round(p.approach*1.94384)} kt`}</small></output><output><strong>{Math.max(0,Math.round((f.agl-p.clearance)*3.28084))}</strong><span>ft</span><small>Above ground</small></output></div>
    {departure&&<>
      {o.phase==='takeoffRoll'?<><progress className="ops-speed-progress" value={Math.min(f.speed,p.rotate)} max={p.rotate} aria-label="Speed to rotation"/><p className={rotation?'ops-rotate':'ops-next-action'} role="status">{rotation?'Rotate now — pull up':'Build speed. Hold the centreline.'}</p><small className="ops-keyboard">Hold S or ↓ to raise the nose.</small></>:takeoff.aligned?<><p className="ops-next-action">Runway aligned. You control the takeoff.</p><button className="ops-primary" onClick={()=>o.startTakeoff(f)}>Begin takeoff</button></>:<><p className="ops-next-action">Follow the gold path to the runway.</p><div className="ops-action-row"><button className="ops-primary" onClick={()=>o.startTaxi()}>Taxi</button><button onClick={()=>runtime.lineUpRunway()}>Line up on runway</button></div><small>Line up skips taxiing; recorded as assisted.</small></>}
    </>}
    {approach&&<><ApproachCue path={path} flight={f} operations={o}/><div className="ops-action-row"><button className="ops-primary" onClick={()=>o.setApproachPower(f)}>Approach power</button><button onClick={()=>o.goAround(f)}>Go around</button></div></>}
    {o.phase==='airborne'&&<><p className="ops-next-action">Explore, or return for a landing.</p><button onClick={()=>o.guideApproach(f,runtime.weather?.wx)}>Guide approach</button></>}
    {o.phase==='landingRoll'&&<p className="ops-next-action">Idle power. Hold the brakes, then follow the taxi path.</p>}
    {o.phase==='taxiIn'&&<><p className="ops-next-action">Follow the gold path. Stop at the stand and set the parking brake.</p><button onClick={()=>o.startTaxi()}>Taxi to stand</button></>}
    {o.lastTouchdown&&<p className="ops-touchdown" role="status">{o.lastTouchdown.quality} touchdown <span>{o.lastTouchdown.sink.toFixed(1)} m/s</span></p>}
    {o.routeWarning&&<div className="ops-notice" role="status">{o.routeWarning}<button onClick={()=>runtime.beginDeparture(p.id,o.departure)}>Return to apron</button></div>}
    {o.phase==='crashed'&&<div className="ops-recovery"><p role="alert">{o.reason}</p><button className="ops-primary" onClick={()=>runtime.retryApproach()}>Retry approach</button><button onClick={()=>runtime.beginDeparture(p.id,o.departure)}>Return to apron</button></div>}
    {o.phase==='completed'&&<div className="ops-complete"><p>{o.summary.departure} → {o.summary.destination}</p><p>{Math.floor(o.summary.duration/60)} min {o.summary.duration%60} sec · {o.summary.assisted?'Assisted practice':'Unassisted flight'}</p><button className="ops-primary" onClick={()=>useFlyStore.getState().setHangarOpen(true)}>Choose next flight</button></div>}
    {!stopped&&<>
      {o.lowSpeed&&<div className="ops-power-controls"><div className="ops-power-label"><label htmlFor="flight-throttle">Power <strong>{Math.round(o.throttle*100)}%</strong></label><button onClick={()=>o.setPowerPreset(0)}>Idle</button></div><input id="flight-throttle" aria-label="Throttle" type="range" min="0" max="100" value={Math.round(o.throttle*100)} onChange={e=>o.setThrottle(Number(e.target.value)/100)}/>
        {ground&&<div className="ops-action-row"><button aria-pressed={o.parkingBrake} onClick={()=>o.toggleBrake()}>Parking brake {o.parkingBrake?'on':'off'}</button><BrakeButton runtime={runtime}/></div>}
      </div>}
      <details className="ops-options"><summary>Destination and guidance</summary><label htmlFor="arrival-airport">Arrival airport</label><select id="arrival-airport" value={o.destination} onChange={e=>o.selectDestination(e.target.value)}>{OPERATIONS_AIRPORTS.filter(a=>airportEligible(a,p.id)).map(a=><option key={a.id} value={a.id}>{a.id} · {a.name}</option>)}</select>
        {approach&&<><label htmlFor="approach-runway">Runway</label><select id="approach-runway" value={o.reverse?'reverse':'forward'} onChange={e=>o.setApproachRunway(e.target.value==='reverse')}><option value="forward">{o.airport.runway}</option><option value="reverse">{o.airport.reciprocal}</option></select></>}
        <button aria-pressed={o.guidance} onClick={()=>o.toggleGuidance()}>Guidance {o.guidance?'on':'off'}</button>
        {!ground&&<button onClick={()=>runtime.retryApproach()}>Practice landing</button>}
        <button onClick={()=>useFlyStore.getState().setHangarOpen(true)}>Return to hangar…</button>
        <small>Landing practice places you on final and marks the flight assisted.</small>
      </details><small className="ops-keyboard">A/D steer · W/S pitch · +/− power · Space brakes</small>
    </>}
    </div></div></div>
  </aside>;
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { Camera, Plane, X, ArrowUpRight, LocateFixed, RotateCcw, ChevronDown, Volume2, VolumeX, Binoculars } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { livingAirportsOn } from '@/lib/fly/airport-feature-policy';
import { FLAGSHIP_AIRPORTS } from '@/lib/fly/airport-observation.mjs';
import { searchRunways } from '@/lib/fly/runway-catalog';
import { airportEligible } from '@/lib/fly/operations-airports';
import { getRuntimeAction } from '@/lib/fly/runtime-bus';
import { exitToTitle } from '@/lib/fly/front-door';
import { airDrop } from '@/lib/fly/toy-world/world-bend';
import { loungeAperture } from '@/lib/fly/lounge-site';
import './airport-watch.css';

export function AirportEntry({className=''}) {
  if(!livingAirportsOn())return null;
  return <button className={className} onClick={()=>useFlyStore.setState({airportBrowserOpen:true})} data-testid="watch-airport">Watch an airport</button>;
}

// At most six hints, projected from the same bent positions as the aircraft.
// Imperative positions at 20 Hz; no per-frame React updates or canvas copies.
function AircraftHints({runtime,rows,selected}) {
  const root=useRef(null);
  const hints=rows.filter(r=>!(runtime.traffic?.tracks.get(r.hex)?.flags&1)).slice(0,6);
  const key=hints.map(r=>r.hex).join(',');
  useEffect(()=>{
    const point=new Vector3(),forward=new Vector3();
    const update=()=>{
      if(document.hidden)return;
      const {camera,origin,flight}=runtime;if(!camera||!origin||!root.current)return;
      camera.getWorldDirection(forward);
      for(const el of root.current.children){const t=runtime.traffic?.tracks.get(el.dataset.hex);if(!t){el.hidden=true;continue;}
        point.set(t.rx-origin.anchor.x,(t.ryd??t.ry)-airDrop(Math.hypot(t.rx-flight.pos.x,t.rz-flight.pos.z),t.ryd??t.ry),t.rz-origin.anchor.z);
        const dx=point.x-camera.position.x,dy=point.y-camera.position.y,dz=point.z-camera.position.z;
        const w=runtime.airportWatch,c=Math.cos(w.roomHeading),s=Math.sin(w.roomHeading);const lx=(dx*c-dz*s)/w.frame.k,lz=(dx*s+dz*c)/w.frame.k,len=Math.hypot(lx,dy,lz)||1;
        if(!loungeAperture(lx/len,dy/len,lz/len)||dx*forward.x+dy*forward.y+dz*forward.z<1||(t.horizonFade??1)<.05){el.hidden=true;continue;}
        point.project(camera);const inWindow=point.x>-.9&&point.x<.9&&point.y>-.48&&point.y<.78;
        el.hidden=!inWindow;if(inWindow){el.style.left=((point.x+1)*50)+'%';el.style.top=((1-point.y)*50)+'%';}
      }
    };update();const timer=setInterval(update,50);return()=>clearInterval(timer);
  },[runtime,key]);
  return <div className="airport-aircraft-hints" ref={root}>{hints.map(row=><button hidden data-hex={row.hex} key={row.hex} className="airport-aircraft-hint" aria-pressed={selected===row.hex} onClick={()=>runtime.airportWatch.select(row.hex)} aria-label={'Watch '+row.label}><span aria-hidden="true">⌖</span>{row.label}</button>)}</div>;
}

export function AirportExperience({runtime}) {
  const open=useFlyStore(s=>s.airportBrowserOpen),watch=useFlyStore(s=>s.airportWatch),back=useFlyStore(s=>s.airportReturn),sound=useFlyStore(s=>s.soundOn);
  const [rows,setRows]=useState([]),[filter,setFilter]=useState('nearby'),[status,setStatus]=useState({state:'unavailable'}),[notice,setNotice]=useState(''),[savingPhoto,setSavingPhoto]=useState(false),[drawer,setDrawer]=useState(false);
  const drag=useRef(null),pan=useRef(null);
  useEffect(()=>{setNotice('');setFilter('nearby');setDrawer(false);},[watch?.id]);
  useEffect(()=>{
    if(!watch)return;
    const update=()=>{setRows(runtime.airportWatch?.snapshot()||[]);setStatus({...runtime.trafficStatus||{state:'unavailable'}});};
    update();const timer=setInterval(update,1000);return()=>clearInterval(timer);
  },[runtime,!!watch]);
  if(!livingAirportsOn())return null;
  async function photo(){
    if(savingPhoto)return;
    setSavingPhoto(true);setNotice('Saving photograph…');
    try{const capture=getRuntimeAction('capturePhoto');if(!capture)throw Error('The camera is not ready.');const {blob,filename}=await capture();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setNotice('Photograph saved.');}catch(e){setNotice(e.message);}finally{setSavingPhoto(false);}
  }
  const leave=()=>{runtime.airportWatch?.leave();exitToTitle(runtime);};
  const visible=filter==='nearby'?rows:rows.filter(r=>r.category===filter);
  const state=status.state==='live'&&rows.length===0?'quiet':status.state;
  const selected=rows.find(r=>r.hex===watch?.selected);
  const airport=runtime.airportWatch?.airport;
  return <>
    {back&&!watch&&<button className="airport-return" data-overlay="airport-return" onClick={()=>runtime.airportWatch?.enter(back.id).catch(e=>setNotice(e.message))}>← Return to the lounge</button>}
    {watch&&<section className="airport-watch" aria-label="Airport lounge" data-overlay="airport-observation" data-testid="airport-observation" onKeyDown={e=>{if(e.key==='Escape'&&drawer){setDrawer(false);pan.current?.focus();e.preventDefault();e.stopPropagation();}else if(e.key!=='Escape')e.stopPropagation();}}>
      <div className="airport-pan" ref={pan} tabIndex={0} aria-label="Window seat. Drag to look around. Scroll to zoom. Arrow keys look; plus and minus zoom."
        onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY};e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);e.stopPropagation();}}
        onPointerMove={e=>{if(!drag.current)return;runtime.airportWatch.move(e.clientX-drag.current.x,e.clientY-drag.current.y);drag.current={x:e.clientX,y:e.clientY};}}
        onPointerUp={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
        onWheel={e=>{runtime.airportWatch.zoomBy(e.deltaY);e.stopPropagation();}}
        onKeyDown={e=>{const moves={ArrowLeft:[20,0],ArrowRight:[-20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};if(moves[e.key])runtime.airportWatch.move(...moves[e.key]);else if(e.key==='+'||e.key==='=')runtime.airportWatch.zoomBy(-100);else if(e.key==='-')runtime.airportWatch.zoomBy(100);else return;e.preventDefault();e.stopPropagation();}}/>
      <AircraftHints runtime={runtime} rows={rows} selected={watch.selected}/>
      <header className="airport-watch-header">
        <div className="airport-location"><span className="airport-code">{airport?.ident||watch.id}</span><div><h1>{airport?.name}</h1><p>Window lounge <span>·</span> {state==='live'?'Live aircraft':state==='quiet'?'Live · quiet skies':state==='delayed'?'Positions delayed':'Traffic connection unavailable'}</p></div></div>
        <button className="airport-exit" onClick={leave}><X size={16}/> Leave lounge</button>
      </header>
      {drawer&&<aside className="airport-activity" aria-label="Airport activity" id="airport-traffic-drawer">
        <header><div><h2>Outside your window</h2><p>{rows.length} contacts within 45 km</p></div><button aria-label="Close traffic" onClick={()=>{setDrawer(false);pan.current?.focus();}}><X size={18}/></button></header>
        <label className="airport-filter-label">Show <select value={filter} onChange={e=>setFilter(e.target.value)}>{[['nearby','All nearby aircraft'],['approach','Approaching'],['departure','Departing'],['ground','On ground']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <div className="airport-contacts">{visible.map(row=><button key={row.hex} className="airport-contact" aria-pressed={row.hex===watch.selected} onClick={()=>{runtime.airportWatch.select(row.hex);setDrawer(false);}}><Plane size={16}/><span><strong>{row.label}</strong><small>{row.stale?'Delayed':row.inFront?'Runway side':'Behind the lounge'} · {row.category==='ground'?'On ground':row.category==='approach'?'Approaching':row.category==='departure'?'Departing':'Airborne'}</small></span><span>{(row.distance/1000).toFixed(1)} km</span></button>)}
          {!visible.length&&<p className="airport-empty">{state==='unavailable'?'The live provider is unavailable. The room stays open; traffic will return when the feed recovers.':state==='delayed'?'Waiting for fresh aircraft positions.':'No aircraft match this filter right now. Live activity varies with the airport and time of day.'}</p>}
        </div><p className="airport-inference">Activity is inferred from movement, not a flight schedule.</p>
      </aside>}
      {selected&&<div className="airport-selected"><Plane size={17}/><div><strong>{selected.label}</strong><span>{(selected.distance/1000).toFixed(1)} km away{watch.tracking?' · Following from your seat':''}</span></div><button onClick={()=>useFlyStore.getState().setInspectHex(selected.hex)}>Details <ArrowUpRight size={13}/></button><button disabled={!watch.validated} onClick={()=>{const result=runtime.airportWatch.join();setNotice(result.message||'');}}>Join flight <ArrowUpRight size={13}/></button><button aria-label="Clear selected aircraft" onClick={()=>{runtime.airportWatch.clearSelection();}}><X size={15}/></button></div>}
      <footer className="airport-camera-bar">
        <button aria-expanded={drawer} aria-controls="airport-traffic-drawer" onClick={()=>setDrawer(v=>!v)}><Plane size={16}/><span>Traffic</span><span className="airport-count">{rows.length}</span><ChevronDown size={13}/></button>
        <button onClick={()=>{runtime.airportWatch.resetLook();}} title="Face the runway"><RotateCcw size={16}/><span>Reset view</span></button>
        <button aria-pressed={watch.zoom<.99} onClick={()=>runtime.airportWatch.binoculars()}><Binoculars size={16}/><span>Binoculars</span></button>
        <button disabled={savingPhoto||!watch.validated} aria-busy={savingPhoto} onClick={photo}><Camera size={16}/><span>Photo</span></button>
        <button onClick={()=>useFlyStore.getState().setSoundOn(!sound)} aria-label={sound?'Mute sound':'Enable sound'}>{sound?<Volume2 size={17}/>:<VolumeX size={17}/>}</button>
        <button onClick={()=>useFlyStore.setState({airportBrowserOpen:true})}><LocateFixed size={16}/><span>Airports</span></button>
      </footer>
      <p className="airport-camera-help">Drag to look around <span>·</span> Scroll to zoom</p>
      {(notice||watch.notice||!watch.validated)&&<p className="airport-status" role="status">{notice||watch.notice||'Preparing your window seat…'}</p>}
    </section>}
    {open&&<AirportBrowser runtime={runtime}/>}
    {!watch&&notice&&<p className="airport-return-notice" role="status">{notice}</p>}
  </>;
}

function AirportBrowser({runtime}) {
  const [query,setQuery]=useState(''),[results,setResults]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const ref=useRef(null),generation=useRef(0);
  const close=()=>{generation.current++;runtime.airportWatch?.cancelPending();useFlyStore.setState({airportBrowserOpen:false});};
  useEffect(()=>{const previous=document.activeElement;ref.current?.querySelector('input')?.focus();return()=>{generation.current++;previous?.focus?.();};},[]);
  useEffect(()=>{let cancelled=false;const timer=setTimeout(()=>{searchRunways(query,runtime.geo?{lat:runtime.geo.y,lon:runtime.geo.x}:null).then(rows=>{if(!cancelled)setResults(rows);}).catch(e=>{if(!cancelled)setError(e.message);});},180);return()=>{cancelled=true;clearTimeout(timer);};},[query,runtime]);
  async function choose(id,start=null){const token=++generation.current;setBusy(true);setError('');try{
    if(!runtime.airportWatch)throw Error('The world is still loading. Try again in a moment.');
    if(start){const {ensureAirport}=await import('@/lib/fly/runway-catalog');const a=await ensureAirport(id);if(token!==generation.current)return;const aircraftId=useFlyStore.getState().aircraftId;if(!airportEligible(a,aircraftId)||!runtime.launchSetup({flightMode:'ops',aircraftId,airportId:a.id,start}))throw Error('This aircraft cannot use this runway. Choose another aircraft in the hangar.');runtime.airportWatch.leave();close();}
    else await runtime.airportWatch.enter(id);
  }catch(e){if(token===generation.current)setError(e.message);}finally{if(token===generation.current)setBusy(false);}}
  return <div className="airport-browser-backdrop" data-overlay="airport-browser" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=[...ref.current.querySelectorAll('button:not(:disabled),input')];const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}}}>
    <section className="airport-browser" ref={ref} role="dialog" aria-modal="true" aria-labelledby="airport-browser-title">
      <header><div><small>LIVE AVIATION · WORLDWIDE</small><h1 id="airport-browser-title">Watch an airport</h1></div><button onClick={close} aria-label="Close airport search">✕</button></header>
      <p>Find a place to pause. Watch real aircraft come and go, frame a photograph, or join a flight nearby.</p>
      <label htmlFor="airport-search">Airport name or code</label><input id="airport-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Try Columbus, JFK, Innsbruck…" autoComplete="off"/>
      {!query&&<div className="airport-featured">{FLAGSHIP_AIRPORTS.map(a=><button key={a.id} disabled={busy} onClick={()=>choose(a.id)}><small>{a.id}</small><strong>{a.name}</strong><span>{a.tag}</span></button>)}</div>}
      <div className="airport-search-results">{results.map(a=><div key={a.id}><button disabled={busy} onClick={()=>choose(a.id)}><strong>{a.name}</strong><span>{a.ident} · Runway {a.runway}</span></button><button disabled={busy} onClick={()=>choose(a.id,'runway')}>Runway start</button><button disabled={busy} onClick={()=>choose(a.id,'approach')}>Approach</button></div>)}</div>
      <p className="airport-catalog-note">Every airport has a window lounge and live regional traffic. Runway and approach starts are also available; detailed taxi routes are limited to the authored Ohio airports.</p>
      <p role="status">{error||(busy?'Preparing the airport…':'')}</p>
    </section>
  </div>;
}

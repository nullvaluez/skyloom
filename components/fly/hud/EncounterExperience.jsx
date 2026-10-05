'use client';
import { useEffect, useState } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { useEncounterStore } from '@/stores/encounter-store';
import { useAdventureStore } from '@/stores/adventure-store';
import { readMemoryPhoto } from '@/lib/fly/encounter-photo';
import './encounters.css';

export function EncounterExperience({runtime}){
  const state=useFlyStore(),encounter=useEncounterStore();
  const adventure=useAdventureStore(s=>s.progress.active?.status);
  const blocked=state.screen!=='flight'||state.flightMode!=='free'||state.phase!=='flying'||state.cameraMode==='photo'||
    state.hangarOpen||state.atlasOpen||state.logbookOpen||state.inspectHex||state.adventureOpen||state.settingsOpen||['flying','finish'].includes(adventure);
  if(blocked||!state.encountersEnabled)return null;
  const {active,offer,result,candidates,nearbyOpen,guidance}=encounter;
  const visible=active||offer;
  return <aside className="encounters" aria-label="Nearby experiences" onPointerDown={e=>e.stopPropagation()}>
    {!active&&<button className="encounter-nearby" aria-expanded={nearbyOpen} onClick={()=>runtime.encounters?.nearby()}>Nearby</button>}
    {visible&&<section className="encounter-card" data-testid="encounter-card">
      <div className="encounter-source">{visible.source}</div>
      <strong>{visible.name}</strong>
      <p>{active?.stale?'Waiting for a fresh live position.':visible.description}</p>
      {active?.kind==='traffic'&&<p role="status">Alongside: {active.seconds||0} / 30 s</p>}
      {active?.kind==='course'&&<p>{active.approached?`Gate ${active.gate+1} of 5`:'Fly to the approach marker'}</p>}
      {active&&guidance&&<p className="encounter-navigation">{String(guidance.bearing).padStart(3,'0')}° · {(guidance.distanceM/1000).toFixed(1)} km · {guidance.altM.toLocaleString()} m MSL</p>}
      <div className="encounter-actions">
        {!active?<><button onClick={()=>runtime.encounters?.accept(offer.id)}>Explore</button><button onClick={()=>runtime.encounters?.dismiss()}>Dismiss</button></>:<>
          {active.kind==='traffic'&&<button disabled={!!state.lockedHex&&state.lockedHex!==active.hex} title={state.lockedHex&&state.lockedHex!==active.hex?'Another aircraft is selected. Fly manually or wait for that lock to release.':undefined} onClick={()=>runtime.encounters?.assist()}>Assist alongside</button>}
          {active.kind!=='course'&&<button onClick={()=>useFlyStore.getState().setCameraMode('photo')}>Photo</button>}
          <button onClick={()=>runtime.encounters?.end()}>Leave</button>
        </>}
      </div>
    </section>}
    {nearbyOpen&&!active&&<section className="encounter-card" aria-label="Nearby list">
      <strong>In this stretch of sky</strong>
      {!candidates.length&&<p>No encounters within reach right now. Keep exploring.</p>}
      {candidates.map(c=><button className="encounter-option" key={c.id} onClick={()=>runtime.encounters?.accept(c.id)}><span>{c.name}</span><small>{c.source} · {(c.distanceM/1000).toFixed(1)} km</small></button>)}
      <button onClick={()=>encounter.setNearbyOpen(false)}>Close</button>
    </section>}
    {result&&!active&&!offer&&<p className="encounter-result" role="status">{result}</p>}
  </aside>;
}

function MemoryPhoto({id}){
  const [url,setUrl]=useState(null);
  useEffect(()=>{
    let live=true,objectURL;
    readMemoryPhoto(id).then(blob=>{if(live&&blob){objectURL=URL.createObjectURL(blob);setUrl(objectURL);}});
    return()=>{live=false;if(objectURL)URL.revokeObjectURL(objectURL);};
  },[id]);
  // eslint-disable-next-line @next/next/no-img-element -- Locally stored bounded photo thumbnail.
  return url?<img src={url} alt="Your view during this encounter" loading="lazy"/>:<small>Photo is unavailable in this browser.</small>;
}

export function FlightMemories(){
  const memories=useEncounterStore(s=>s.memories),sessionOnly=useEncounterStore(s=>s.sessionOnly);
  const [limit,setLimit]=useState(12);
  useEffect(()=>useEncounterStore.getState().hydrate(),[]);
  return <section className="flight-memories" aria-label="Flight memories">
    <h3>Flight memories</h3>
    <p>A record of the places and real flights you crossed paths with.</p>
    {sessionOnly&&<p role="status">Saved for this visit only. Export a backup before leaving.</p>}
    {!memories.length&&<p>Your first memory starts with a Nearby experience in Free Flight.</p>}
    {memories.slice(0,limit).map(m=><article key={m.id}>
      <div><small>{m.kind==='traffic'?'Live traffic':'Skyloom discovery'} · {new Date(m.at).toLocaleDateString()}</small><h4>{m.name}</h4><p>{m.place} · {m.aircraftId}</p>
        <p>{m.position.lat.toFixed(3)}°, {m.position.lon.toFixed(3)}°</p>
        {m.traffic&&<p>{[m.traffic.flight,m.traffic.type,m.traffic.registration].filter(Boolean).join(' · ')||m.traffic.hex}</p>}
      </div>{m.photoRef&&<MemoryPhoto id={m.photoRef}/>}
    </article>)}
    {memories.length>limit&&<button onClick={()=>setLimit(limit+12)}>More memories</button>}
    <small>Photos stay in this browser; progress backups contain journal records only. The latest 200 memories and 24 photos are retained.</small>
  </section>;
}

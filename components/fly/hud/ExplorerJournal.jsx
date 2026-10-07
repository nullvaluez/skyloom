'use client';
import { useEffect, useMemo, useState } from 'react';
import { useExplorationStore } from '@/stores/exploration-store';
import { AdventureJournal } from './AdventureExperience';
import { FlightMemories } from './EncounterExperience';
import { useAdventureStore } from '@/stores/adventure-store';
import { useFlyStore } from '@/stores/fly-store';
import { regionalCollections } from '@/lib/fly/regional-collections.mjs';
import { loadCoastlines } from '@/lib/fly/atlas/coastlines';
import { readMemoryPhoto } from '@/lib/fly/encounter-photo';
import { useFlyAtlasStore } from '@/stores/fly-atlas-store';
import { buildAtlasList } from '@/lib/fly/poi-data';

function JournalPhoto({photo}){
  const [url,setUrl]=useState(null);
  useEffect(()=>{let active=true,objectUrl;readMemoryPhoto(photo.thumbnail).then(blob=>{if(blob&&active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}});return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[photo.thumbnail]);
  return <figure>{url?<img src={url} alt={photo.name}/>:<div className="explorer-photo-missing">Preview no longer cached</div>}<figcaption>{photo.name}<small>{new Date(photo.at).toLocaleDateString()}</small></figcaption></figure>;
}

export function ExplorerJournal(){
  const journal=useExplorationStore(s=>s.journal),sessionOnly=useExplorationStore(s=>s.sessionOnly);
  const progress=useAdventureStore(s=>s.progress),collections=regionalCollections(journal,progress);
  const historicalVisits=useFlyAtlasStore(s=>s.visits);
  const historicalPlaces=useMemo(()=>buildAtlasList().filter(p=>historicalVisits[p.key]>0),[historicalVisits]);
  // Compose historical stores without migrating or granting their rewards a
  // second time. Map coordinates are deduplicated across all three sources.
  const places=[...new Map([...journal.places,...collections.flatMap(c=>c.discoveries.filter(p=>p.visited)),...historicalPlaces].map(p=>[`${p.lat.toFixed(4)},${p.lon.toFixed(4)}`,p])).values()];
  const [coast,setCoast]=useState('');
  useEffect(()=>{let active=true;loadCoastlines().then(lines=>{if(active)setCoast(lines.map(line=>{let d='';for(let i=0;i<line.length;i+=4)d+=`${i?'L':'M'}${(360+line[i]*2).toFixed(1)},${(170-line[i+1]*2).toFixed(1)}`;return d;}).join(''));});return()=>{active=false;};},[]);
  useEffect(()=>useExplorationStore.getState().hydrate(),[]);
  return <section className="explorer-journal">
    <header><h2>Your world, one flight at a time</h2><p>{places.length} places explored · {new Set([...journal.places.filter(p=>p.id.startsWith('airport:')).map(p=>p.id.split(':')[1]),...journal.landings.map(l=>l.id.split(':')[0])]).size} airports landed at</p></header>
    {sessionOnly&&<p role="status">This visit could not be saved. Export your progress before leaving.</p>}
    <svg viewBox="0 0 720 340" role="img" aria-label="World coordinates of your explored places" className="explorer-visited-map">
      <rect width="720" height="340" rx="12" fill="#102b3a"/>
      {[-60,-30,0,30,60].map(lat=><g key={lat}><path d={`M0 ${170-lat*2}H720`} stroke="#254453"/><text x="8" y={165-lat*2} fill="#86a8b5" fontSize="10">{lat}°</text></g>)}
      {[-120,-60,0,60,120].map(lon=><path key={lon} d={`M${360+lon*2} 0V340`} stroke="#254453"/>)}
      <path d={coast} fill="none" stroke="#5b8290" strokeWidth=".7"/>
      {places.map(p=><circle key={`${p.lat},${p.lon}`} cx={360+p.lon*2} cy={170-p.lat*2} r="3" fill="#c8f0f1"><title>{p.name}</title></circle>)}
    </svg>
    {!places.length&&<p>Your map fills as you spend time flying over new places. There is no rush.</p>}
    <h3>Recent landings</h3>
    {!journal.landings.length?<p>Find an airport, make an approach, and your first landing will appear here.</p>:<ul>{journal.landings.slice(0,12).map(l=><li key={l.id}><strong>{l.name}</strong><span>{l.quality} · {new Date(l.at).toLocaleDateString()}</span></li>)}</ul>}
    <h3>Six regions to remember</h3><p>Find four places in a region to earn its stamp. Activities are optional.</p>
    <div className="explorer-collections">{collections.map(c=><article key={c.id} style={{borderColor:c.color}}><strong>{c.complete?'✦ ':''}{c.place}</strong><p>{c.complete?'Region stamp earned':`${c.discoveries.filter(p=>p.visited).length} / 4 discoveries`}</p><ul>{c.discoveries.map(p=><li key={p.id}>{p.visited?'✓':'○'} {p.name}</li>)}</ul><button onClick={()=>{useFlyStore.getState().setLogbookOpen(false);useAdventureStore.setState({selectedRouteId:c.id,libraryOpen:true});}}>{c.complete?'Visit again':'Explore this region'}</button></article>)}</div>
    <h3>Your photographs</h3><p>The shutter downloads a full image with attribution. These smaller previews are cached locally and are not included in backups.</p>
    {!journal.photos.length?<p>Your first photograph will appear here.</p>:<div className="explorer-photos">{journal.photos.slice(0,24).map(photo=><JournalPhoto key={photo.id} photo={photo}/>)}</div>}
    <details><summary>Adventure achievements and earned liveries</summary><AdventureJournal/></details>
    <h3>Flight memories</h3><p>Photos you download are yours to keep. Journal previews stay in this browser and may be cleared by its storage policy.</p><FlightMemories/>
  </section>;
}

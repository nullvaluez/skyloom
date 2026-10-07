'use client';
import { useEffect, useState } from 'react';
import { airportById, airportEligible } from '@/lib/fly/operations-airports';
import { searchRunways, ensureAirport } from '@/lib/fly/runway-catalog';
export function AirportPicker({value,onChange,aircraftId,runtime}){
  const [query,setQuery]=useState(''),[rows,setRows]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;
    const timer=setTimeout(()=>{const g=runtime.geo;searchRunways(query,g?{lat:g.y,lon:g.x}:null).then(rows=>{if(active){setRows(rows);setError('');}}).catch(e=>{if(active)setError(e.message);});},200);
    return()=>{active=false;clearTimeout(timer);};
  },[query,runtime,retry]);
  const pick=async id=>{setLoading(true);setError('');try{const airport=await ensureAirport(id);if(!airportEligible(airport,aircraftId))throw Error('This runway is too short or narrow for your aircraft. Choose a smaller aircraft or another runway.');onChange(id);}catch(e){setError(e.message);}finally{setLoading(false);}};
  return <section aria-label="Worldwide airports"><label htmlFor="airport-search">Find an airport or runway</label><input id="airport-search" type="search" placeholder="Airport name or code, e.g. EGLL" value={query} onChange={e=>setQuery(e.target.value)} className="min-h-11 w-full rounded bg-slate-800 px-3"/>
    <p className="my-2 text-sm">Selected: {airportById(value)?.name} · {airportById(value)?.runway}</p>
    <div className="max-h-40 overflow-y-auto">{rows.map(a=><button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-white/10 px-2 text-left text-sm" disabled={loading} aria-pressed={a.id===value} key={a.id} onClick={()=>pick(a.id)}><span>{a.name}</span><small>{a.ident} · {a.runway}</small></button>)}</div>
    {error&&<p role="alert">{error} <button type="button" className="min-h-11 underline" onClick={()=>setRetry(n=>n+1)}>Retry search</button></p>}{loading&&<p role="status">Preparing airport…</p>}
  </section>;
}

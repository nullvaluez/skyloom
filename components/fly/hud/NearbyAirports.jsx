'use client';
import {useEffect,useState} from 'react';
import {useFlyStore} from '@/stores/fly-store';
import {loadNearbyRunways} from '@/lib/fly/runway-catalog';
import {nearbyOperationsAirports,airportEligible,airportLocal,airportFrame} from '@/lib/fly/operations-airports';
export function NearbyAirports({runtime}){
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const aircraft=useFlyStore(s=>s.aircraftId);
  useEffect(()=>{let active=true;const g=runtime.geo,f=runtime.flight;if(!g||!f)return;
    loadNearbyRunways(g.y,g.x).then(()=>{if(!active)return;setRows(nearbyOperationsAirports(f.pos.x,f.pos.z,40000).map(a=>{const p=airportLocal(a,f.pos.x,f.pos.z);return {airport:a,distance:Math.hypot(p.cross,Math.max(0,-p.along,p.along-airportFrame(a).length))};}).sort((a,b)=>a.distance-b.distance).slice(0,6));setError('');}).catch(()=>{if(active)setError('Nearby airports could not load.');});return()=>{active=false;};
  },[runtime,attempt]);
  const guide=a=>{if(runtime.approachAirport?.(a.id)){useFlyStore.getState().setAtlasOpen(false);}else setError('Approach guidance is unavailable for this aircraft.');};
  return <details className="mt-3 rounded-md border border-white/15 p-3 text-sm text-slate-100"><summary className="min-h-8 cursor-pointer">Airports near your flight</summary><p className="mb-2 text-xs text-slate-400">Fly there at your own pace. Guidance keeps your current position.</p>
    {rows.map(({airport:a,distance})=><button key={a.id} disabled={!airportEligible(a,aircraft)} onClick={()=>guide(a)} className="flex min-h-11 w-full items-center justify-between gap-3 border-t border-white/10 text-left disabled:opacity-40"><span>{a.name} · {a.runway}/{a.reciprocal}<small className="block">{airportEligible(a,aircraft)?'Guide approach':'Choose a smaller powered aircraft for this runway'}</small></span><span>{(distance/1000).toFixed(1)} km</span></button>)}
    {!rows.length&&!error&&<p>No catalog runway is loaded within 40 km. You can choose a worldwide departure in the hangar.</p>}
    {error&&<p role="status">{error} <button onClick={()=>setAttempt(n=>n+1)}>Retry</button></p>}
  </details>;
}

'use client';
import {useState} from 'react';
import {CINEMA_REVIEW_SITES,stageCinemaReview} from '@/lib/fly/cinema-review';
export function CinemaReviewDock({runtime}){
 const [site,setSite]=useState('manhattan'),[condition,setCondition]=useState('day'),[open,setOpen]=useState(true);
 if(typeof window==='undefined')return null;
 const params=new URLSearchParams(window.location.search),look=params.get('earthLook');
 if(params.get('graphicsReview')!=='1'||!['current','cinematic'].includes(look))return null;
 const stage=(s,c)=>{setSite(s);setCondition(c);stageCinemaReview(runtime,s,c);};
 const compare=()=>{const url=new URL(window.location.href);url.searchParams.set('earthLook',look==='cinematic'?'current':'cinematic');window.location.assign(url.href);};
 return <aside className="cinema-review-dock" aria-label="Visual comparison">
  <button onClick={()=>setOpen(!open)} aria-expanded={open}>{look==='cinematic'?'Cinematic Earth':'Current look'} · review {open?'−':'+'}</button>
  {open&&<>
   <select aria-label="Review route" value={site} onChange={e=>stage(e.target.value,condition)}>{Object.entries(CINEMA_REVIEW_SITES).map(([key,s])=><option key={key} value={key}>{s.name}</option>)}</select>
   <select aria-label="Review lighting" value={condition} onChange={e=>stage(site,e.target.value)}><option value="day">Daylight</option><option value="golden">Golden hour</option><option value="overcast">Overcast</option><option value="night">Moonlight</option></select>
   <button onClick={()=>stage(site,condition)}>Restart route</button>
   <button onClick={compare}>Load {look==='cinematic'?'current':'cinematic'} look</button>
  </>}
 </aside>;
}

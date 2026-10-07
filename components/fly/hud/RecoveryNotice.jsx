'use client';
import {useEffect,useState} from 'react';
import {useFlyStore} from '@/stores/fly-store';
function acknowledgeRecovery(runtime){runtime.recoveryNotice=null;useFlyStore.getState().setPhase('flying');}
export function RecoveryNotice({runtime}){
  const [state,setState]=useState(null);
  useEffect(()=>{const timer=setInterval(()=>setState(runtime.contextLost?'lost':runtime.recoveryNotice?'restored':null),500);return()=>clearInterval(timer);},[runtime]);
  if(!state)return null;
  return <div className="pointer-events-auto absolute inset-0 z-[80] grid place-items-center bg-slate-950/85 p-6" role="alertdialog" aria-modal="true" aria-label="Graphics recovery"><section className="max-w-md rounded-xl border border-white/20 bg-slate-900 p-6 text-white"><h2 className="text-xl">{state==='lost'?'Graphics were interrupted':'Ready to fly again'}</h2><p className="my-4">{state==='lost'?'Your flight is paused while the browser restores graphics. If it cannot recover, restart Skyloom; saved progress stays in this browser.':'Graphics have returned. Your flight is still paused.'}</p>{state==='restored'&&<button className="mr-3 min-h-11" onClick={()=>{acknowledgeRecovery(runtime);setState(null);}}>Resume flight</button>}<button className="min-h-11 underline" onClick={()=>window.location.reload()}>Restart Skyloom</button></section></div>;
}

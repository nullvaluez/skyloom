'use client';
import { useEffect, useRef } from 'react';
import { Check, LockKeyhole, Paintbrush } from 'lucide-react';
import { PRESET_LIVERIES } from '@/lib/fly/aircraft-liveries.mjs';
import { LIVERIES, ADVENTURES, COLLECTION_REWARDS } from '@/lib/fly/adventures.mjs';
import { contentAccess } from '@/lib/fly/content-access.mjs';
import { useAdventureStore } from '@/stores/adventure-store';
import './aircraft-customization.css';

function PaintSwatch({skin}) {
  if (!skin) return <span className="skin-swatch skin-house" aria-hidden="true"><Paintbrush size={21}/></span>;
  return <svg className="skin-swatch" viewBox="0 0 76 48" aria-hidden="true">
    <rect width="76" height="48" rx="7" fill={skin.hull}/>
    {['camo','splinter'].includes(skin.pattern) ? <>
      <path d={skin.pattern==='camo'?'M-6 4Q18-5 31 13T54 11L83 18 79 42Q62 26 46 39T8 29Z':'M-4 10 29-6 41 15 25 26 37 45 4 55Z'} fill={skin.trim}/>
      <path d={skin.pattern==='camo'?'M36-5Q29 9 47 20T59 48L80 52 82-4Z':'M45-4 77 2 60 19 86 31 68 46 50 25 37 13Z'} fill={skin.accent}/>
    </> : <><path d="M0 35 76 5V48H0Z" fill={skin.trim}/><path d="M0 31 76 1V8L0 38Z" fill={skin.accent}/></>}
  </svg>;
}

export function AircraftCustomization({id, name, onClose}) {
  const panel = useRef();
  const progress = useAdventureStore(s=>s.progress), sessionOnly = useAdventureStore(s=>s.sessionOnly);
  const selected = progress.liveries[id] || 'standard', earned = LIVERIES[id];
  const unlocked = contentAccess(`livery:${id}`,progress).allowed;
  const route = ADVENTURES.find(a=>a.reward===id), collection = COLLECTION_REWARDS.find(r=>r.aircraftId===id);
  const rewardHint = route ? `Complete ${route.place}` : collection ? `Collect ${collection.count} destination stamps` : '';
  const choices = [
    {id:'standard',name:'House colors',description:'The original Skyloom finish',skin:null},
    ...(PRESET_LIVERIES[id]||[]).map(s=>({...s,skin:s})),
    ...(earned?[{id:'earned',name:earned.name,description:unlocked?'Your adventure reward':rewardHint,skin:{...earned,pattern:'airline'},locked:!unlocked}]:[]),
  ];
  useEffect(()=>{panel.current?.querySelector('[role="radio"][aria-checked="true"]')?.focus({preventScroll:true});},[id]);
  const choose=choice=>{if(!choice.locked)useAdventureStore.getState().equip(id,choice.id);};
  const keyDown=e=>{
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();
    const available=choices.filter(c=>!c.locked),at=Math.max(0,available.findIndex(c=>c.id===selected));
    const index=e.key==='Home'?0:e.key==='End'?available.length-1:(at+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)+available.length)%available.length;
    choose(available[index]);panel.current?.querySelector(`[data-skin="${available[index].id}"]`)?.focus({preventScroll:true});
  };
  return <section ref={panel} className="aircraft-customization" aria-label={`${name} liveries`} data-testid="aircraft-customization">
    <header><Paintbrush size={19}/><div><h3>Make it yours</h3><p>Choose a finish for {name}.</p></div></header>
    <div className="skin-choices" role="radiogroup" aria-label="Aircraft livery" onKeyDown={keyDown}>
      {choices.map(choice=><button type="button" role="radio" key={choice.id} data-skin={choice.id}
        data-testid={`skin-${choice.id}`} data-reward={choice.id==='earned'} aria-checked={selected===choice.id} disabled={choice.locked}
        tabIndex={selected===choice.id?0:-1} onClick={()=>choose(choice)}>
        <PaintSwatch skin={choice.skin}/><span className="skin-copy"><strong>{choice.name}</strong><small>{choice.description}</small></span>
        {choice.locked?<LockKeyhole size={14} aria-label="Locked"/>:selected===choice.id?<Check size={17} aria-hidden="true"/>:<span className="skin-radio" aria-hidden="true"/>}
      </button>)}
    </div>
    <footer><p role="status"><Check size={13}/>{sessionOnly?'Selected for this session':'Saved for this aircraft'}</p><button type="button" className="skin-done" onClick={onClose}>Done</button></footer>
  </section>;
}

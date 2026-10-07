'use client';
import { create } from 'zustand';
import { EXPLORATION_KEY, emptyExploration, validateExploration, rememberPlace, rememberLanding, rememberPhoto } from '@/lib/fly/exploration.mjs';

export const useExplorationStore=create((set,get)=>({
  journal:emptyExploration(),ready:false,sessionOnly:false,
  attachThumbnail(id,thumbnail){
    const next=validateExploration({...get().journal,photos:get().journal.photos.map(p=>p.id===id?{...p,thumbnail}:p)});let sessionOnly=false;
    try{localStorage.setItem(EXPLORATION_KEY,JSON.stringify(next));}catch{sessionOnly=true;}
    set({journal:next,sessionOnly});
  },
  hydrate(){
    if(get().ready)return;
    let journal=emptyExploration(),sessionOnly=false;
    try{const raw=localStorage.getItem(EXPLORATION_KEY);if(raw)journal=validateExploration(JSON.parse(raw));}catch{sessionOnly=true;}
    set({journal,ready:true,sessionOnly});
  },
  record(kind,entry){
    get().hydrate();
    const before=get().journal,next=kind==='landing'?rememberLanding(before,entry):kind==='photo'?rememberPhoto(before,entry):rememberPlace(before,entry);
    if(next===before)return false;
    let sessionOnly=false;
    try{localStorage.setItem(EXPLORATION_KEY,JSON.stringify(next));}catch{sessionOnly=true;}
    set({journal:next,sessionOnly});
    return true;
  },
}));

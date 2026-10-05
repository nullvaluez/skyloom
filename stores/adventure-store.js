'use client';
import { create } from 'zustand';
import { emptyProgress, validateProgress } from '@/lib/fly/adventure-controller.mjs';
import { contentAccess } from '@/lib/fly/content-access.mjs';
export const ADVENTURE_KEY='fly-adventures-v1';
export const useAdventureStore=create((set,get)=>({
  progress:emptyProgress(),ready:false,sessionOnly:false,libraryOpen:false,summary:null,preflight:null,selectedRouteId:null,postcard:null,notice:null,
  hydrate(){if(get().ready)return;let progress=emptyProgress(),sessionOnly=false;try{const saved=JSON.parse(localStorage.getItem(ADVENTURE_KEY)||'null');if([1,2].includes(saved?.version))progress=validateProgress(saved.progress);localStorage.setItem('fly-storage-probe','1');localStorage.removeItem('fly-storage-probe');}catch{sessionOnly=true;}set({progress,ready:true,sessionOnly});},
  save(progress){let sessionOnly=false;try{localStorage.setItem(ADVENTURE_KEY,JSON.stringify({version:2,progress}));}catch{sessionOnly=true;}set({progress:{...progress,active:progress.active?{...progress.active,activities:{...progress.active.activities}}:null},sessionOnly});},
  setPreflight:preflight=>set({preflight}),
  setPostcard(postcard){const old=get().postcard;if(old&&old!==postcard)URL.revokeObjectURL(old);set({postcard});},
  setLibraryOpen:libraryOpen=>set({libraryOpen}),setSummary:summary=>set({summary}),
  equip(id,earned){const p=get().progress;if(earned&&!contentAccess(`livery:${id}`,p).allowed)return false;get().save({...p,liveries:{...p.liveries,[id]:earned?'earned':'standard'}});return true;},
}));

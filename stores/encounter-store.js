'use client';
import { create } from 'zustand';
import { ENCOUNTER_KEY, ENCOUNTER_LIMITS, validateEncounterSave } from '@/lib/fly/encounters.mjs';

export const useEncounterStore=create((set,get)=>({
  memories:[],ready:false,sessionOnly:false,offer:null,active:null,result:null,candidates:[],nearbyOpen:false,guidance:null,
  hydrate(){
    if(get().ready)return;
    let memories=[],sessionOnly=false;
    try{const raw=localStorage.getItem(ENCOUNTER_KEY);if(raw)memories=validateEncounterSave(JSON.parse(raw)).memories;}catch{sessionOnly=true;}
    set({memories,ready:true,sessionOnly});
  },
  remember(memory){
    const memories=[memory,...get().memories].slice(0,ENCOUNTER_LIMITS.maxMemories);
    let sessionOnly=false;
    try{localStorage.setItem(ENCOUNTER_KEY,JSON.stringify(validateEncounterSave({version:1,memories})));}catch{sessionOnly=true;}
    set({memories,sessionOnly});
  },
  setNearbyOpen:nearbyOpen=>set({nearbyOpen}),
}));

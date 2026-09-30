'use client';
import {useFrame} from '@react-three/fiber';
import {useRef,useEffect} from 'react';
import {inspectCinemaResources,registerCinemaResources} from '@/lib/fly/cinema-resources';
import {EARTH_UNIFORMS} from '@/lib/fly/earth-surface-material';
import {CINEMATIC_MATERIAL_UNIFORMS} from '@/lib/fly/cinematic-materials';
export function CinemaResourceRig({runtime}){
 const next=useRef(0);
 useEffect(()=>registerCinemaResources('surface-materials',()=>({earth:EARTH_UNIFORMS,materials:CINEMATIC_MATERIAL_UNIFORMS})),[]);
 useFrame(({scene,clock})=>{
   if(!runtime.cinemaEnvironment||clock.elapsedTime<next.current)return;
   next.current=clock.elapsedTime+2;
   const composer=typeof window!=='undefined'?window.__flyComposer:null;
   runtime.cinemaResources=inspectCinemaResources(scene,composer);
 },2);
 return null;
}

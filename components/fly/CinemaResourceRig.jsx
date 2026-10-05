'use client';
import {useFrame} from '@react-three/fiber';
import {useRef,useEffect} from 'react';
import {inspectCinemaResources,registerCinemaResources} from '@/lib/fly/cinema-resources';
import {EARTH_UNIFORMS} from '@/lib/fly/earth-surface-material';
import {CINEMATIC_MATERIAL_UNIFORMS} from '@/lib/fly/cinematic-materials';
import {graphicsReviewOn} from '@/lib/fly/satellite-visuals';
export function CinemaResourceRig({runtime}){
 const next=useRef(0);
 useEffect(()=>registerCinemaResources('surface-materials',()=>({earth:EARTH_UNIFORMS,materials:CINEMATIC_MATERIAL_UNIFORMS})),[]);
 useFrame(({scene,clock})=>{
   // This recursively inventories every geometry/material/uniform and creates
   // thousands of temporary entries. It is diagnostic work, not a frame task.
   if(!graphicsReviewOn()||!runtime.cinemaEnvironment||clock.elapsedTime<next.current)return;
   next.current=clock.elapsedTime+2;
   const composer=typeof window!=='undefined'?window.__flyComposer:null;
   // eslint-disable-next-line react-hooks/immutability -- runtime is the imperative simulation/telemetry handle, not React state.
   runtime.cinemaResources=inspectCinemaResources(scene,composer);
 },2);
 return null;
}

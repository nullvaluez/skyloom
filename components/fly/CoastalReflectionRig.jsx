'use client';
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CoastalReflection, publishCoastalReflection, removeCoastalReflection } from '@/lib/fly/coastal-reflection';
import { WORLD_ART_UNIFORMS } from '@/lib/fly/world-art-direction';
import { useFlyStore } from '@/stores/fly-store';

export function CoastalReflectionRig({runtime}) {
  const rig=useRef(null);
  useEffect(()=>{
    const next=new CoastalReflection();rig.current=next;publishCoastalReflection(runtime,next.stats);
    return()=>{next.dispose();rig.current=null;removeCoastalReflection(runtime,next.stats);};
  },[runtime]);
  useFrame(({gl,scene,camera})=>{
    const state=useFlyStore.getState();
    rig.current?.update(gl,scene,camera,runtime,state.qualityTier,WORLD_ART_UNIFORMS.uUrbanArt.value>.5);
  },-.5);
  return null;
}

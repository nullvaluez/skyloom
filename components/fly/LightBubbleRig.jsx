'use client';
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useFlyStore } from '@/stores/fly-store';
import { nearGroundOn } from '@/lib/fly/near-ground';
import { createShadingState, restoreGroundShading, stepGroundShading } from '@/lib/fly/light-bubble';

export function LightBubbleRig({runtime}){
  const state=useRef(null),stats=useRef({});
  if(state.current == null)state.current=createShadingState();
  useEffect(()=>{
    if(process.env.NODE_ENV==='development')window.__flyGroundShading={read:()=>({...stats.current})};
    return()=>{restoreGroundShading(runtime,state.current);if(process.env.NODE_ENV==='development')delete window.__flyGroundShading;};
  },[runtime]);
  useFrame(()=>{
    const on=useFlyStore.getState().mapStyle==='satellite'&&nearGroundOn('shading');
    if(!on){restoreGroundShading(runtime,state.current);stats.current={active:false};return;}
    stats.current={active:true,...stepGroundShading(runtime,state.current)};
    // The height signal runs at -51. Select this frame's shadow bounds before
    // FlyScene snaps its light target to their texel grid at -50.
  },-50.5);
  return null;
}

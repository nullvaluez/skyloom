'use client';
import { useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useFlyStore, inFlight } from '@/stores/fly-store';
import { photoComposition } from '@/lib/fly/photo-composition';
export function SessionRecovery({runtime}){
  const canvas=useThree(s=>s.gl.domElement);
  useFrame(({gl})=>{gl.toneMappingExposure=useFlyStore.getState().cameraMode==='photo'?2**photoComposition().exposure:1;});
  useEffect(()=>{
    const pause=()=>{const s=useFlyStore.getState();if(inFlight(s)&&s.phase!=='paused')s.setPhase('paused');runtime.input?.keys?.clear();runtime.input?.clearTouchSteer?.();runtime.input?.setBrake?.(false);};
    const lost=e=>{e.preventDefault();runtime.contextLost=true;pause();};
    const restored=()=>{runtime.contextLost=false;runtime.recoveryNotice='Graphics restored. Resume when you are ready.';};
    const visibility=()=>{if(document.hidden)pause();};
    canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);document.addEventListener('visibilitychange',visibility);
    return()=>{canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);document.removeEventListener('visibilitychange',visibility);};
  },[canvas,runtime]);
  return null;
}

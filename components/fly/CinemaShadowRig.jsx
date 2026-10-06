'use client';
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CinemaShadows } from '@/lib/fly/cinema-shadows';
import { cinemaOn, cinemaProfile } from '@/lib/fly/cinema-policy';
import { compactDepthShadowTarget } from '@/lib/fly/compact-shadow-target';

export function CinemaShadowRig({runtime,sunRef}){
  const rig=useRef(null),legacyShadow=useRef(false);
  useEffect(()=>{
    const sun=sunRef.current,castShadow=sun?.castShadow;
    legacyShadow.current=!!castShadow;
    return ()=>{rig.current?.dispose();rig.current=null;delete runtime.cinemaShadows;if(sun)sun.castShadow=castShadow;};
  },[runtime,sunRef]);
  useFrame(({scene,camera,gl})=>{
    const e=runtime.cinemaEnvironment;
    // The store can switch styles before React removes this frame subscriber.
    // Retire its lights immediately: otherwise outgoing terrain compiles the
    // Classic samplers PLUS cinematic cascades and exceeds WebGL's 16 units.
    if(!e||!cinemaOn()){
      rig.current?.dispose();rig.current=null;delete runtime.cinemaShadows;
      if(sunRef.current)sunRef.current.castShadow=legacyShadow.current;
      return;
    }
    const profile=cinemaProfile(),key=`${profile.cascades}:${profile.shadowSize}`;
    if(rig.current?.profileKey!==key){
      rig.current?.dispose();rig.current=null;
      if(profile.cascades){rig.current=new CinemaShadows(camera,scene,profile);rig.current.profileKey=key;}
    }
    const r=rig.current;
    if(sunRef.current){sunRef.current.castShadow=false;sunRef.current.intensity=r?0:e.sun;}
    if(!r){runtime.cinemaShadows={cascades:0};return;}
    const range=profile.shadowRangeM*(runtime.cinemaGeography?.worldUnitsPerMetre??1);
    // Camera.reverseDepth becomes authoritative when the renderer initializes.
    if(r.fov!==camera.fov||r.aspect!==camera.aspect||r.reverse!==gl.capabilities.reversedDepthBuffer||Math.abs(r.maxFar-range)>5){
      r.maxFar=range;
      camera._reversedDepth=!!gl.capabilities.reversedDepthBuffer;
      r.fov=camera.fov;r.aspect=camera.aspect;r.reverse=camera.reversedDepth;r.updateFrustums();
    }
    r.lightDirection.fromArray(e.keyDir).negate();
    for(const light of r.lights){light.intensity=e.sun;light.color.fromArray(e.keyColor);compactDepthShadowTarget(light.shadow,gl.shadowMap.type);}
    // Register new streamed materials before their first color draw. A dispose
    // listener drops evicted materials, so the registry never pins the world.
    // TRUE EARTH: this walks the WHOLE scene every frame. Before replacing it
    // with event-driven registration (a missed producer = a recompile hitch),
    // measure it: objects scanned and an EMA of its cost reach the diagnostics
    // overlay via runtime.cinemaShadows.
    const scanStart=performance.now();r.scanObjects=0;
    r.countingRegister??=object=>{r.scanObjects++;r.registerObject(object);};
    scene.traverse(r.countingRegister);
    const scanMs=performance.now()-scanStart;r.scanMs=r.scanMs==null?scanMs:r.scanMs+(scanMs-r.scanMs)*.05;
    camera.updateMatrixWorld();r.update();
    runtime.shadowRadiusM=profile.shadowRangeM;
    Object.assign(runtime.cinemaShadows??={}, {cascades:r.cascades,size:profile.shadowSize,rangeM:profile.shadowRangeM,materials:r.owned.size,bytes:r.cascades*profile.shadowSize**2*5,scanObjects:r.scanObjects,scanMs:r.scanMs});
  },-.9);
  return null;
}

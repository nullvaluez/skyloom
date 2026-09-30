'use client';
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CinemaShadows } from '@/lib/fly/cinema-shadows';
import { cinemaProfile } from '@/lib/fly/cinema-policy';

export function CinemaShadowRig({runtime,sunRef}){
  const rig=useRef(null);
  useEffect(()=>{
    const sun=sunRef.current,castShadow=sun?.castShadow;
    return ()=>{rig.current?.dispose();rig.current=null;delete runtime.cinemaShadows;if(sun)sun.castShadow=castShadow;};
  },[runtime,sunRef]);
  useFrame(({scene,camera,gl})=>{
    const e=runtime.cinemaEnvironment;if(!e)return;
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
    for(const light of r.lights){light.intensity=e.sun;light.color.fromArray(e.keyColor);}
    // Register new streamed materials before their first color draw. A dispose
    // listener drops evicted materials, so the registry never pins the world.
    scene.traverse(object=>{
      if(object.material)for(const material of Array.isArray(object.material)?object.material:[object.material])r.setupMaterial(material);
    });
    camera.updateMatrixWorld();r.update();
    runtime.shadowRadiusM=profile.shadowRangeM;
    runtime.cinemaShadows={cascades:r.cascades,size:profile.shadowSize,rangeM:profile.shadowRangeM,materials:r.owned.size,bytes:r.cascades*profile.shadowSize**2*8};
  },-.9);
  return null;
}

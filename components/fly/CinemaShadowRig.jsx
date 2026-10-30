'use client';
/* eslint-disable react-hooks/immutability -- R3F frame callbacks update owned Three objects and shared runtime telemetry, not React state. */
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CinemaShadows, airframeRefit, airframeShadowBreak, airframeShadowOn, applyShadowCasterRequests, shadowReachConfig } from '@/lib/fly/cinema-shadows';
import { cameraModelSize } from '@/lib/fly/camera-framing';
import { lightBlock } from '@/lib/fly/ship-light';
import { cinemaOn, cinemaProfile } from '@/lib/fly/cinema-policy';
import { compactDepthShadowTarget } from '@/lib/fly/compact-shadow-target';
import { toSceneDir } from '@/lib/fly/true-scale';
import { mobileEnhancedOn, mobileShadowRange, resolveMobileEnhanced, stepMobileShadowRange } from '@/lib/fly/mobile-enhanced';
import { useFlyStore } from '@/stores/fly-store';

export function CinemaShadowRig({runtime,sunRef}){
  const rig=useRef(null),legacyShadow=useRef(false),mobileRange=useRef(null);
  useEffect(()=>{
    const sun=sunRef.current,castShadow=sun?.castShadow;
    legacyShadow.current=!!castShadow;
    return ()=>{rig.current?.dispose();rig.current=null;delete runtime.cinemaShadows;delete runtime.adoptCinematicWarmScene;if(sun)sun.castShadow=castShadow;};
  },[runtime,sunRef]);
  useFrame(({scene,camera,gl},dt)=>{
    const e=runtime.cinemaEnvironment;
    // The store can switch styles before React removes this frame subscriber.
    // Retire its lights immediately: otherwise outgoing terrain compiles the
    // Classic samplers PLUS cinematic cascades and exceeds WebGL's 16 units.
    if(!e||!cinemaOn()){
      rig.current?.dispose();rig.current=null;delete runtime.cinemaShadows;delete runtime.adoptCinematicWarmScene;
      if(sunRef.current)sunRef.current.castShadow=legacyShadow.current;
      return;
    }
    const profile=cinemaProfile(),key=profile.cascades;
    if(rig.current?.profileKey!==key){
      rig.current?.dispose();rig.current=null;
      if(profile.cascades){rig.current=new CinemaShadows(camera,scene,profile);rig.current.profileKey=key;}
    }
    const r=rig.current;
    r?.setMapSize(profile.shadowSize);
    if(sunRef.current){sunRef.current.castShadow=false;sunRef.current.intensity=r?0:e.sun;}
    if(!r){applyShadowCasterRequests(false);runtime.cinemaShadows={cascades:0};delete runtime.adoptCinematicWarmScene;return;}
    const state=useFlyStore.getState();
    let rangeM=profile.shadowRangeM;
    // SHIP PASS LIGHT (SHADOW_REACH, LT-5): Medium desktops reuse the phone
    // rule with their own tunables; flag off, `reach` is exactly the old
    // mobileEnhancedOn() branch.
    const mobileReach=mobileEnhancedOn(state);
    const reach=mobileReach?resolveMobileEnhanced():shadowReachConfig(state);
    if(reach){
      const config=reach;
      const ground=runtime.cinemaGeography?.groundVisualM;
      const agl=Number.isFinite(ground)?camera.position.y-ground:NaN;
      mobileRange.current=stepMobileShadowRange(mobileRange.current,
        mobileShadowRange(rangeM,agl,config),state.warpEpoch,dt,config.shadowResponseSec);
      rangeM=mobileRange.current.rangeM;
    }else mobileRange.current=null;
    const range=rangeM*(runtime.cinemaGeography?.worldUnitsPerMetre??1);
    // Camera.reverseDepth becomes authoritative when the renderer initializes.
    if(r.fov!==camera.fov||r.aspect!==camera.aspect||r.reverse!==gl.capabilities.reversedDepthBuffer||Math.abs(r.maxFar-range)>5){
      r.maxFar=range;
      camera._reversedDepth=!!gl.capabilities.reversedDepthBuffer;
      r.fov=camera.fov;r.aspect=camera.aspect;r.reverse=camera.reversedDepth;r.updateFrustums();
    }
    // TRUE_SCALE: the cascades fit and render in scene units, where the TRUE
    // key direction is S⁻¹·keyDir (identity at k0 = 1). A parallel projection
    // along it in scene space is exactly the true projection after S.
    toSceneDir(r.lightDirection.fromArray(e.keyDir),r.lightDirection).negate();
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
    // Prewarm's retained twins intentionally live outside the scene graph.
    // They still need this same material patch: matching lights without the
    // CSM defines/key compiles another program, leaving the real terrain cold.
    r.adoptWarmScene??=object=>object.traverse(r.registerObject);
    runtime.adoptCinematicWarmScene=r.adoptWarmScene;
    const scanMs=performance.now()-scanStart;r.scanMs=r.scanMs==null?scanMs:r.scanMs+(scanMs-r.scanMs)*.05;
    // SHIP PASS LIGHT (AIRFRAME_SHADOW, LT-4): in chase and photo views
    // cascade 0 ends just past the player's airframe, so the player's own
    // shadow (it receives on High/Ultra, PlayerPlane.jsx) gets cascade-0
    // texels sized to it. Flag off: airframeShadowOn() is false and the break
    // stays null, the practical split, exactly as before.
    let airframeBreak=null;
    if(airframeShadowOn(state)){
      const size=cameraModelSize(runtime.flight),p=runtime.flight?.renderPos??runtime.flight?.pos,a=runtime.origin?.anchor;
      const k=runtime.cinemaGeography?.worldUnitsPerMetre??1;
      const distM=p&&a?Math.hypot(camera.position.x-(p.x-a.x),camera.position.y-p.y,camera.position.z-(p.z-a.z)):NaN;
      airframeBreak=airframeShadowBreak({distM,lengthM:size?Math.max(size.length,size.width)*Math.max(1,k):NaN,rangeM:range,cameraMode:state.cameraMode,cascades:r.cascades});
    }
    if(airframeRefit(r.airframeBreakM,airframeBreak,lightBlock('AIRFRAME_SHADOW').refitFrac))r.setAirframeFit(airframeBreak,lightBlock('AIRFRAME_SHADOW'));
    // SHIP PASS LIGHT: other streams' casters (requestShadowCasters), bounded.
    const requestedCasters=applyShadowCasterRequests(true);
    camera.updateMatrixWorld();r.update();
    runtime.shadowRadiusM=rangeM;
    Object.assign(runtime.cinemaShadows??={}, {cascades:r.cascades,size:profile.shadowSize,rangeM,baseRangeM:profile.shadowRangeM,materials:r.owned.size,bytes:r.cascades*profile.shadowSize**2*5,scanObjects:r.scanObjects,scanMs:r.scanMs,
      airframeBreakM:r.airframeBreakM,reach:reach?(mobileReach?'mobile':'medium'):null,requestedCasters});
  },-.9);
  return null;
}

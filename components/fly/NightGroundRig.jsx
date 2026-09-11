'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useFlyStore } from '@/stores/fly-store';
import { nearGroundOn } from '@/lib/fly/near-ground';
import { graphicsReviewOn } from '@/lib/fly/satellite-visuals';
import { GROUND_LIGHTING, groundLightProfile, groundLightingStrength, nightWeight, snapLightCenter } from '@/lib/fly/night-lighting-policy';
import { clearNightGroundUniforms, createNightGroundTarget, nightGroundUniforms as U, publishGroundLighting, removeGroundLighting } from '@/lib/fly/night-ground';
import { createNightSourceCollector } from '@/lib/fly/night-ground-sources';

const initial=()=>({at:-Infinity,scanAt:-Infinity,x:Infinity,z:Infinity,signature:null,epoch:null,updates:0,sources:0,bytes:0,draws:0,night:0,counts:{},active:false,blend:1,
  map:null,samples:[],size:0,spanM:0,tier:null,sourceRevision:-1,scanPending:false,scanMs:0,scanWork:0,scanMaxMs:0,pools:false});
function resetTarget(target,st){target.current?.dispose();target.current=null;clearNightGroundUniforms();Object.assign(st,initial());}
function publishFrame(runtime,target,st,now){
  const t=target.current;if(!t)return;
  const current=t.frames[t.current],previous=t.frames[1-t.current];if(!current)return;
  const origin=runtime.origin?.anchor;
  const ox=origin?.x??0,oz=origin?.z??0;
  U.uNGMap.value=t.targets[t.current].texture;U.uNGPreviousMap.value=t.targets[previous?1-t.current:t.current].texture;
  U.uNGOrigin.value.set(current.x-ox,current.z-oz);U.uNGPreviousOrigin.value.set((previous?.x??current.x)-ox,(previous?.z??current.z)-oz);
  U.uNGInvSpan.value=1/current.span;U.uNGPreviousInvSpan.value=previous?1/previous.span:0;
  U.uNGHeightBase.value=current.baseY;U.uNGPreviousHeightBase.value=previous?.baseY??current.baseY;
  const blend=Math.max(0,Math.min(1,(now-st.at)/GROUND_LIGHTING.blendSec));
  U.uNGBlend.value=blend*blend*(3-2*blend);st.blend=U.uNGBlend.value;
  U.uNGGain.value=nearGroundOn('pools')?GROUND_LIGHTING.receiverGain:0;st.active=true;
  st.pools=nearGroundOn('pools');
  st.map={x:current.x,z:current.z,span:current.span,baseY:current.baseY,size:t.size};
}

/** A bounded offscreen splat update; no objects/lights added to the main scene. */
export function NightGroundRig({runtime}){
  const gl=useThree(s=>s.gl),scene=useThree(s=>s.scene);
  const target=useRef(null),state=useRef(initial());
  const collector=useRef(null);
  if(collector.current==null)collector.current=createNightSourceCollector();
  useEffect(()=>{
    const st=state.current;publishGroundLighting(runtime,st);
    const review=process.env.NODE_ENV==='development'||graphicsReviewOn();
    if(review)window.__flyGroundLighting={
      read:()=>({...st,counts:{...st.counts},samples:st.samples?.map(s=>({...s})),profile:groundLightProfile(useFlyStore.getState().qualityTier)}),
      force:()=>{st.signature=null;st.scanAt=-Infinity;},
      readPixels:()=>{
        const t=target.current;if(!t)return null;
        const pixels=new Uint8Array(t.size*t.size*4);gl.readRenderTargetPixels(t.targets[t.current],0,0,t.size,t.size,pixels);
        let nonzero=0,peak=0;for(let i=0;i<pixels.length;i+=4){const n=Math.max(pixels[i],pixels[i+1],pixels[i+2]);if(n)nonzero++;peak=Math.max(peak,n);}
        return {nonzero,peak,pixels:t.size*t.size};
      },
      sampleAt:(x,z)=>{
        const t=target.current,f=t?.frames[t.current];if(!f)return null;
        const px=Math.floor(((x-f.x)/f.span+.5)*t.size),pz=Math.floor(((z-f.z)/f.span+.5)*t.size);
        if(px<0||pz<0||px>=t.size||pz>=t.size)return null;
        const pixel=new Uint8Array(4);gl.readRenderTargetPixels(t.targets[t.current],px,pz,1,1,pixel);
        return {rgba:[...pixel],sourceY:f.baseY+pixel[3]/255*GROUND_LIGHTING.heightRangeM,pixel:[px,pz]};
      },
    };
    const sourceCollector=collector.current;
    return()=>{sourceCollector.reset();resetTarget(target,st);removeGroundLighting(runtime,st);if(review)delete window.__flyGroundLighting;};
  },[runtime,gl]);
  useFrame(()=>{
    const st=state.current,store=useFlyStore.getState(),now=performance.now()/1000;
    st.draws=0;
    const active=store.mapStyle==='satellite'&&nearGroundOn('lighting')&&runtime.flight;
    const night=active?nightWeight(runtime.sun?.frac)*groundLightingStrength(runtime.groundImmersion?.k):0;
    if(!active||night<=0.001){if(target.current||st.active||collector.current.pending){collector.current.reset();resetTarget(target,st);}U.uNGNight.value=0;return;}
    U.uNGNight.value=night;st.night=night;
    const cfg=groundLightProfile(store.qualityTier),flight=runtime.flight;
    const epoch=runtime.groundImmersion?.epoch??runtime._gvEpoch??runtime.origin?.epoch;
    if((st.tier&&st.tier!==store.qualityTier)||(st.epoch!==null&&st.epoch!==epoch)){
      collector.current.reset();resetTarget(target,st);U.uNGNight.value=night;st.night=night;
    }
    st.epoch=epoch;st.tier=store.qualityTier;
    publishFrame(runtime,target,st,now);
    const scale=1/Math.max(.25,Math.cos((flight.latDeg??0)*Math.PI/180));
    if(!collector.current.pending&&now-st.scanAt>=GROUND_LIGHTING.minUpdateSec){
      collector.current.start(runtime,scene,flight.pos.x,flight.pos.z,cfg.spanM*scale,cfg.sources);st.scanAt=now;
    }
    // Decode and select on a bounded frame budget. The previous completed map
    // stays alive throughout cold streaming and in-place DEM healing.
    const scan=collector.current.step();
    st.scanPending=scan.pending;st.scanMs=scan.ms;st.scanWork=scan.work;
    st.scanMaxMs=Math.max(st.scanMaxMs??0,scan.ms);
    if(scan.pending||scan.revision===st.sourceRevision)return;
    st.sourceRevision=scan.revision;
    const {sources,counts,signature,x,z,span}=scan.result;
    st.counts=counts;st.sources=sources.length;
    st.samples=sources.slice(0,16).map(({x,y,z,r,gain,id})=>({x,y,z,r,gain,id}));
    const moved=Math.hypot(x-st.x,z-st.z)>=GROUND_LIGHTING.moveM*scale;
    if(!target.current&&!sources.length)return; // desert never allocates or draws
    if(signature===st.signature&&!moved&&now-st.at<GROUND_LIGHTING.refreshSec)return;
    if(!target.current){target.current=createNightGroundTarget(cfg.size,cfg.sources);target.current.warm(gl);st.bytes=target.current.bytes;}
    const center=snapLightCenter(x,z,span,cfg.size);
    // Keep height quantization stable independently of horizontal texel snaps.
    const baseY=Math.floor((flight.groundElev??0)/16)*16-GROUND_LIGHTING.heightRangeM/2;
    const n=target.current.render(gl,sources,center,span,baseY);
    Object.assign(st,{at:now,x:center[0],z:center[1],signature,updates:st.updates+1,draws:n>0?1:0,size:cfg.size,spanM:cfg.spanM});
    publishFrame(runtime,target,st,now);
  },-1);
  return null;
}

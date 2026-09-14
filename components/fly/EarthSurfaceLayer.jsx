'use client';
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import { EarthSurfaceEngine, publishEarthSurface, removeEarthSurface } from '@/lib/fly/earth-surface-engine';
import { EarthScenery } from '@/lib/fly/earth-scenery';

export function EarthSurfaceLayer({ runtime }) {
  const ref=useRef(null);
  const group=useRef(null);
  useEffect(()=>{
    const worker=new Worker(new URL('../../lib/fly/toy-world/vector-tile.worker.js',import.meta.url),{type:'module'});
    const api=wrap(worker),engine=new EarthSurfaceEngine(api);
    engine.scenery=new EarthScenery();
    group.current?.add(engine.scenery.mesh);
    ref.current=engine;
    api.init().catch(()=>{engine.stats.failed++;});
    return()=>{ref.current=null;removeEarthSurface(runtime,engine.stats);engine.scenery.dispose();engine.dispose();worker.terminate();};
  },[runtime]);
  useFrame(()=>{
    const engine=ref.current;
    if(!engine)return;
    engine.update(runtime,performance.now()/1000);
    engine.scenery.update(engine,runtime,performance.now()/1000);
    engine.stats.scenery=engine.scenery.stats;
    publishEarthSurface(runtime,engine.stats);
    if(typeof window!=='undefined'&&window.__flyStats)window.__flyStats.earthSurface=engine.stats;
  },-44);
  return <group ref={group} />;
}

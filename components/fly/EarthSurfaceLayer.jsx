'use client';
/* eslint-disable react-hooks/immutability -- runtime is the shared imperative simulation bus, not React display state. */
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import { EarthSurfaceEngine, publishEarthSurface, removeEarthSurface } from '@/lib/fly/earth-surface-engine';
import { EarthScenery } from '@/lib/fly/earth-scenery';
import { LivingForest } from '@/lib/fly/living-forest';
import { LivingAirports } from '@/lib/fly/living-airports';

export function EarthSurfaceLayer({ runtime }) {
  const ref=useRef(null);
  const group=useRef(null);
  useEffect(()=>{
    const worker=new Worker(new URL('../../lib/fly/toy-world/vector-tile.worker.js',import.meta.url),{type:'module'});
    const api=wrap(worker),engine=new EarthSurfaceEngine(api);
    engine.scenery=new EarthScenery();
    engine.forest=new LivingForest();
    engine.airports=new LivingAirports();group.current?.add(engine.airports.group);
    group.current?.add(engine.forest.group);
    group.current?.add(engine.scenery.mesh);
    ref.current=engine;
    runtime.retryEarthSurface=()=>{for(const band of engine.bands)for(const slot of band.slots)if(['error','no-data'].includes(slot.state)){slot.state='error';slot.retryAt=0;}engine.lastUpdate=-Infinity;};
    api.init().catch(()=>{engine.stats.failed++;});
    return()=>{ref.current=null;delete runtime.retryEarthSurface;removeEarthSurface(runtime,engine.stats);engine.airports.dispose();engine.forest.dispose();engine.scenery.dispose();engine.dispose();worker.terminate();};
  },[runtime]);
  useFrame(()=>{
    const engine=ref.current;
    if(!engine)return;
    engine.update(runtime,performance.now()/1000);
    engine.scenery.update(engine,runtime,performance.now()/1000);
    engine.forest.update(engine,runtime,performance.now()/1000);
    engine.airports.update(engine,runtime);
    engine.stats.airports=engine.airports.stats;
    engine.stats.forest=engine.forest.stats;
    engine.stats.scenery=engine.scenery.stats;
    publishEarthSurface(runtime,engine.stats);
    if(typeof window!=='undefined'&&window.__flyStats)window.__flyStats.earthSurface=engine.stats;
  },-44);
  return <group ref={group} />;
}

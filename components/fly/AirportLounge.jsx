'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useFlyStore } from '@/stores/fly-store';
import { createAirportLounge } from '@/lib/fly/airport-lounge';

function Room({runtime}) {
  const group=useRef(null),resource=useMemo(()=>createAirportLounge(),[]);
  useEffect(()=>()=>resource.dispose(),[resource]);
  useFrame(()=>{
    const w=runtime.airportWatch,p=w?.seat;
    if(!group.current||!p)return;
    group.current.visible=w.active&&w.validated;
    group.current.position.set(p.x-runtime.origin.anchor.x,p.y,p.z-runtime.origin.anchor.z);
    group.current.rotation.y=w.roomHeading;
    group.current.scale.set(w.frame.k,1,w.frame.k);
  },-40);
  return <group ref={group} name="airport-lounge" visible={false} dispose={null}>
    {resource.meshes.map(m=><mesh key={m.name} name={`lounge:${m.name}`} geometry={m.geometry} material={m.material} frustumCulled={false}/>)}
  </group>;
}
export function AirportLounge({runtime}) {
  const active=useFlyStore(s=>!!s.airportWatch);
  return active?<Room runtime={runtime}/>:null;
}

'use client';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { operationsProfile } from '@/lib/fly/operations-profiles';
export function LandingGear({flight,aircraftId,preview=false}){
  const root=useRef(),wheels=useRef([]),legs=useRef([]),p=operationsProfile(aircraftId);
  useFrame((_,dt)=>{if(!p||!root.current)return;const deployed=preview?1:(flight.operations?.gear??0);
    root.current.visible=deployed>.01;
    const fold=1-deployed*deployed*(3-2*deployed);
    legs.current.forEach((leg,i)=>{if(leg)leg.rotation.set(i===2?-fold*1.35:0,0,i===2?0:(i===0?1:-1)*fold*1.35);});
    for(const wheel of wheels.current)if(wheel&&flight.operations?.grounded)wheel.rotation.x-=(flight.speed||0)*dt/p.wheelRadius;
  });
  if(!p||p.fixedGear)return null;
  return <group ref={root} name="player-landing-gear" visible={preview||(flight.operations?.gear??0)>.01}>{p.gearPoints.map(([x,y,z],i)=><group key={i} ref={node=>{legs.current[i]=node;}} position={[x,0,z]}><group position-y={y}>
    <mesh position={[0,(p.clearance-p.wheelRadius)/2,0]}><cylinderGeometry args={[p.wheelRadius*.18,p.wheelRadius*.18,p.clearance-p.wheelRadius,8]}/><meshStandardMaterial color="#b8bdbd" metalness={.6} roughness={.4}/></mesh>
    <group ref={node=>{wheels.current[i]=node;}}>
      <mesh rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[p.wheelRadius,p.wheelRadius,p.wheelRadius*.7,12]}/><meshStandardMaterial color="#222629" roughness={.92}/></mesh>
      <mesh rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[p.wheelRadius*.42,p.wheelRadius*.42,p.wheelRadius*.75,10]}/><meshStandardMaterial color="#979e9f" metalness={.6}/></mesh>
    </group>
  </group></group>)}</group>;
}

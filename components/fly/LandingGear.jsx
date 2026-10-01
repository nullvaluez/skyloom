'use client';
/* eslint-disable react-hooks/immutability -- Three.js transforms belong to the frame loop. */
import {useEffect,useMemo} from 'react';
import {useFrame} from '@react-three/fiber';
import {operationsProfile} from '@/lib/fly/operations-profiles';
import {buildFleetGear} from '@/lib/fly/fleet-gear.mjs';
export function LandingGear({flight,aircraftId,preview=false}){
  const gear=useMemo(()=>buildFleetGear(aircraftId,operationsProfile(aircraftId)),[aircraftId]);
  useEffect(()=>()=>gear.dispose(),[gear]);
  useFrame(()=>{const deployed=preview||aircraftId==='prop'||aircraftId==='glider'?1:(flight.operations?.gear??0);
    gear.root.visible=deployed>.01;const fold=1-deployed*deployed*(3-2*deployed);
    gear.legs.forEach((leg,i)=>{leg.rotation.set(i===2?-fold*1.4:0,0,i===2?0:(i===0?1:-1)*fold*1.4);});
  });
  return <primitive object={gear.root} dispose={null}/>;
}

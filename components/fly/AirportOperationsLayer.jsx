'use client';

import { applyBendFade } from '@/lib/fly/toy-world/world-bend';
import { useEffect, useMemo } from 'react';
import { OperationsGuidance } from './OperationsGuidance';
import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, MeshBasicMaterial, DoubleSide } from 'three';
import { OPERATIONS_AIRPORTS, airportFrame, airportPoint, airportTaxiExits, airportPavements } from '@/lib/fly/operations-airports';

const RUNWAY_GLYPHS={
  '0':['01110','11011','11011','11011','11011','11011','01110'],
  '1':['00110','01110','00110','00110','00110','00110','01111'],
  '2':['01110','11011','00011','00110','01100','11000','11111'],
  '3':['11110','00011','00011','01110','00011','00011','11110'],
  '5':['11111','11000','11000','11110','00011','00011','11110'],
  '7':['11111','00011','00110','00110','01100','01100','01100'],
  '8':['01110','11011','11011','01110','11011','11011','01110'],
  '9':['01110','11011','11011','01111','00011','00011','01110'],
  R:['11110','11011','11011','11110','11100','11010','11011'],
  L:['11000','11000','11000','11000','11000','11000','11111'],
};

// One mesh per airport. Pavement and paint use the exact same height profile as
// contact. Absolute Mercator coordinates live on the group, never in float32.
function Airport({ airport }) {
  const resource=useMemo(()=>{
    const origin=airportPoint(airport,0),f=airportFrame(airport),positions=[],colors=[];
    const rectangle=(s,t,w,l,color,lift=.025)=>{
      // Bend is evaluated at vertices. A kilometre-long quad interpolates a
      // chord below the curved terrain, leaving only the short paint visible.
      // Small cells keep that chord error below the pavement's surface lift.
      const rows=Math.ceil(l/5),cols=Math.ceil(w/5);
      for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
        const a0=s+l*row/rows,a1=s+l*(row+1)/rows,c0=t-w/2+w*col/cols,c1=t-w/2+w*(col+1)/cols;
        const points=[[a0,c0],[a1,c0],[a1,c1],[a0,c1]].map(([a,c])=>airportPoint(airport,a,c));
        for(const i of [0,2,1,0,3,2]){const p=points[i];positions.push(p.x-origin.x,p.y-origin.y+lift,p.z-origin.z);colors.push(...color);}
      }
    };
    const dark=[.13,.15,.16],concrete=[.30,.32,.33],white=[.85,.84,.78],yellow=[.8,.58,.08];
    const offset=airport.taxiOffset*airport.taxiSide, width=airport.id==='KOSU'?20:48;
    for(const r of airportPavements(airport))rectangle(r.s0,(r.c0+r.c1)/2,r.c1-r.c0,r.s1-r.s0,r.kind==='runway'?dark:concrete);
    for(let s=45;s<f.length-45;s+=60)rectangle(s,0,1.2,27,white,.055);
    for(const side of [-1,1])rectangle(0,side*(airport.width/2-1),.6,f.length,white,.055);
    for(const start of [8+(airport.thresholdA||0),f.length-30-(airport.thresholdB||0)])for(let c=-airport.width/2+4;c<airport.width/2-3;c+=4)rectangle(start,c,1.7,20,white,.055);
    // Authored stencil paint shares the runway mesh/material (no text draw).
    for(const reverse of [false,true]){
      const label=reverse?airport.reciprocal:airport.runway,direction=reverse?-1:1;
      const base=reverse?f.length-(airport.thresholdB||0)-44:(airport.thresholdA||0)+44;
      [...label].forEach((char,index)=>RUNWAY_GLYPHS[char].forEach((row,y)=>{
        for(let x=0;x<5;x++)if(row[x]==='1'){
          const s=base+direction*(6-y)*1.2,c=direction*((index-1)*4.2+(x-2)*.65);
          rectangle(s-(reverse?1.2:0),c,.65,1.2,white,.06);
        }
      }));
    }
    rectangle(40,offset,.45,f.length-80,yellow,.055);
    for(const s of airportTaxiExits(airport))rectangle(s-.25,offset/2,Math.abs(offset),.5,yellow,.055);
    rectangle(airport.standAlong-.25,offset+airport.taxiSide*40,80,.5,yellow,.055);
    // Paired hold-short lines across every connector, on the taxiway side.
    for(const exit of airportTaxiExits(airport))for(const delta of [0,1.4,3,4.4]){
      const cross=airport.taxiSide*(airport.width/2+12+delta);
      if(delta<2)rectangle(exit-width/2,cross,.5,width,yellow,.06);
      else for(let s=exit-width/2;s<exit+width/2;s+=4)rectangle(s,cross,.5,2,yellow,.06);
    }
    // Stand stop bar and a T at the parked aircraft's nose.
    rectangle(airport.standAlong-7,offset+airport.taxiSide*75,.7,14,yellow,.06);
    const paintCount=positions.length/3;
    for(let s=0;s<f.length;s+=60)for(const side of [-1,1])rectangle(s,side*(airport.width/2+1),1.5,1.5,[1,.9,.65],.12);
    for(let s=0;s<f.length;s+=45)rectangle(s,offset+width/2,1.4,1.4,[.2,.45,1],.12);
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
    geometry.addGroup(0,paintCount,0);geometry.addGroup(paintCount,positions.length/3-paintCount,1);
    const material=[new MeshStandardMaterial({vertexColors:true,roughness:.95,side:DoubleSide}),new MeshBasicMaterial({vertexColors:true,side:DoubleSide})];material.forEach(applyBendFade);return {origin,geometry,material};
  },[airport]);
  useEffect(()=>()=>{resource.geometry.dispose();resource.material.forEach(m=>m.dispose());},[resource]);
  const h=airportPoint(airport,airport.standAlong,airport.taxiSide*(airport.taxiOffset+180)),frame=airportFrame(airport);
  return <group>
    <mesh name="operations-pavement" position={[resource.origin.x,resource.origin.y,resource.origin.z]} geometry={resource.geometry} material={resource.material} dispose={null}/>
    <group name="operations-hangar" position={[h.x,h.y,h.z]} rotation-y={-frame.heading} scale={[frame.k,1,frame.k]}>
      <mesh position={[0,24,0]}><boxGeometry args={[80,1,125]}/><meshStandardMaterial color="#8a9398"/></mesh>
      <mesh position={[airport.taxiSide*39,12,0]}><boxGeometry args={[1,24,125]}/><meshStandardMaterial color="#777d80"/></mesh>
      {[-1,1].map(side=><mesh key={side} position={[0,12,side*62]}><boxGeometry args={[80,24,1]}/><meshStandardMaterial color="#777d80"/></mesh>)}
    </group>
  </group>;
}
export function AirportOperationsLayer({runtime}) {
  return <group>
    {OPERATIONS_AIRPORTS.map(a=><Airport key={a.id} airport={a}/>)}
    <OperationsGuidance runtime={runtime}/>
  </group>;
}

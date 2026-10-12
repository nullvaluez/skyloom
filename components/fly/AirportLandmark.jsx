'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Color, MeshStandardMaterial, Matrix4 } from 'three';
import { applyBendFade } from '@/lib/fly/toy-world/world-bend';
import { airportLandmark } from '@/lib/fly/airport-landmarks';
import { projectAirportPoint } from '@/lib/fly/operations-airports';

export function AirportLandmark({airport,runtime}) {
  const nextDetail=useRef(0),near=useRef(true);
  const resource=useMemo(()=>{
    const spec=airportLandmark(airport);if(!spec)return null;
    const origin=projectAirportPoint(...spec.terminal),k=1/Math.cos(spec.terminal[1]*Math.PI/180),positions=[],normals=[],colors=[],facades=[];
    const wall=new Color(spec.wall),roof=new Color(spec.roof),glass=new Color('#314d55');
    function box(x,z,w,d,h,y=0,tower=false,tilt=0){
      const geo=new BoxGeometry(w*k,h,d*k).toNonIndexed(),p=geo.attributes.position,n=geo.attributes.normal;
      // Metre coordinates survive rotation/rebasing; the facade pattern is
      // attached to each wing instead of swimming across an absolute grid.
      for(let i=0;i<p.count;i++){
        const wallFace=Math.abs(n.getY(i))<.5;
        facades.push(wallFace?(Math.abs(n.getX(i))>.5?p.getZ(i)/k+d/2:p.getX(i)/k+w/2):p.getX(i)/k,
          wallFace?p.getY(i)+h/2:p.getZ(i)/k,wallFace&&h>5?(tower?2:1):0);
      }
      const matrix=new Matrix4().makeRotationY(-spec.heading*Math.PI/180);
      geo.rotateZ(tilt);geo.translate(x*k,y+h/2,z*k);geo.applyMatrix4(matrix);
      for(let i=0;i<p.count;i++){positions.push(p.getX(i),p.getY(i),p.getZ(i));normals.push(n.getX(i),n.getY(i),n.getZ(i));const color=n.getY(i)>.5?roof:tower?glass:wall;colors.push(color.r,color.g,color.b);}geo.dispose();
    }
    for(const [x,z,w,d,h] of spec.wings)box(x,z,w,d,h);
    if((airport.ident||airport.id).startsWith('KJFK')){box(-35,-10,75,72,3,23,false,-.13);box(35,-10,75,72,3,23,false,.13);}
    const t=projectAirportPoint(...spec.tower),dx=(t.x-origin.x)/k,dz=(t.z-origin.z)/k,a=spec.heading*Math.PI/180;
    const tx=dx*Math.cos(a)+dz*Math.sin(a),tz=-dx*Math.sin(a)+dz*Math.cos(a);
    box(tx,tz,10,10,spec.towerHeight-10);box(tx,tz,21,21,7,spec.towerHeight-10,true);box(tx,tz,24,24,2,spec.towerHeight-3);
    const coreCount=positions.length/3;
    for(const [x,z,w,d,h] of spec.wings)box(x,z,w+3,d+3,1.1,h);
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.setAttribute('aTerminalFacade',new Float32BufferAttribute(facades,3));geometry.computeBoundingSphere();
    const material=new MeshStandardMaterial({vertexColors:true,roughness:.83,metalness:.06});applyBendFade(material);
    // One existing light pass, no texture/reflector/light source. Analytic
    // glazing is filtered to its area average when individual panes minify.
    const night={value:0},previous=material.onBeforeCompile,key=material.customProgramCacheKey();
    material.onBeforeCompile=(shader,renderer)=>{
      previous(shader,renderer);shader.uniforms.uTerminalNight=night;
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 aTerminalFacade;\nvarying vec3 vTerminalFacade;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nvTerminalFacade=aTerminalFacade;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying vec3 vTerminalFacade;
uniform float uTerminalNight;
float terminalPane(vec2 cell,vec2 opening){
 vec2 footprint=max(fwidth(cell),vec2(.001));
 vec2 pane=1.-smoothstep(opening*.5-footprint,opening*.5+footprint,abs(fract(cell)-.5));
 return mix(pane.x*pane.y,opening.x*opening.y,smoothstep(.25,1.,max(footprint.x,footprint.y)));
}`)
        .replace('#include <color_fragment>',`#include <color_fragment>
float terminalWall=step(.5,vTerminalFacade.z);
float terminalCab=step(1.5,vTerminalFacade.z);
vec2 terminalCell=vTerminalFacade.xy/vec2(5.,4.2);
float terminalGlazing=terminalPane(terminalCell,mix(vec2(.82,.56),vec2(.88,.86),terminalCab))*terminalWall;
terminalGlazing*=smoothstep(.6,1.5,vTerminalFacade.y);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.055,.115,.14),terminalGlazing*.83);
// Broad roof seams remain restrained; their contrast disappears at distance.
float terminalRoof=terminalPane(vTerminalFacade.xy/vec2(12.,6.),vec2(.96,.94));
diffuseColor.rgb*=1.-(1.-terminalWall)*(1.-terminalRoof)*.14;`)
        .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.30,terminalGlazing);')
        .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
totalEmissiveRadiance+=vec3(.72,.48,.25)*terminalGlazing*uTerminalNight*.65;`);
    };
    material.customProgramCacheKey=()=>`${key}|airport-terminal-v1`;
    return {geometry,material,origin,k,coreCount,night};
  },[airport]);
  useFrame(({clock,camera})=>{
    if(!resource||clock.elapsedTime<nextDetail.current)return;
    nextDetail.current=clock.elapsedTime+.25;
    resource.night.value=1-Math.max(0,Math.min(1,((runtime.sun?.sinEl??1)+.08)/.16));
    const anchor=runtime.origin?.anchor;
    const distance=Math.hypot(camera.position.x+(anchor?.x||0)-resource.origin.x,camera.position.z+(anchor?.z||0)-resource.origin.z)/resource.k;
    near.current=distance<(near.current?4000:3500);
    resource.geometry.setDrawRange(0,near.current?resource.geometry.attributes.position.count:resource.coreCount);
  });
  useEffect(()=>()=>{resource?.geometry.dispose();resource?.material.dispose();},[resource]);
  if(!resource)return null;
  return <mesh name={`airport-landmark:${airport.id}`} position={[resource.origin.x,airport.a.elevation,resource.origin.z]} geometry={resource.geometry} material={resource.material} dispose={null}/>;
}

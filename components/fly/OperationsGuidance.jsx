'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MeshBasicMaterial, Object3D } from 'three';
import { airportFrame, airportPoint } from '@/lib/fly/operations-airports';
import { approachPathPoint, departurePathPoint, operationsPathMode, roundedGroundRoute } from '@/lib/fly/operations-paths';
import { applyBend } from '@/lib/fly/toy-world/world-bend';

const AMBER = new Color('#efc365'), CYAN = new Color('#93e5e8');
const APPROACH_GATES = [4200,3500,2800,2200,1700,1250,900,600,350,120];
const DEPARTURE_GATES = [650,900,1200,1550,1950,2400,2900,3450,4050,4700];

function gateGeometry() {
  const positions = [];
  // Four rounded corner brackets leave the runway and horizon unobstructed.
  for (const sx of [-1,1]) for (const sy of [-1,1]) {
    const points = [[.5,.5],[.82,.5]];
    for(let i=1;i<=8;i++) { const t=Math.PI/2*(1-i/8); points.push([.82+.18*Math.cos(t),.32+.18*Math.sin(t)]); }
    points.push([1,.05]);
    for(let i=1;i<points.length;i++) {
      const [ax,ay]=points[i-1], [bx,by]=points[i], length=Math.hypot(bx-ax,by-ay);
      const nx=-(by-ay)/length*.012,ny=(bx-ax)/length*.012;
      const corners=[[ax+nx,ay+ny],[ax-nx,ay-ny],[bx+nx,by+ny],[bx-nx,by-ny]];
      for(const j of [0,2,1,1,2,3])positions.push(corners[j][0]*sx,corners[j][1]*sy,0);
    }
  }
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));return g;
}

function routeGeometry(points, origin, halfWidth, color, arrows=false) {
  const positions=[],colors=[];
  const vertex=(p,k=1)=>{positions.push(p.x-origin.x,p.y-origin.y,p.z-origin.z);colors.push(color.r*k,color.g*k,color.b*k);};
  let arc=0,nextArrow=12;
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<.001)continue;
    const nx=-dz/len*halfWidth,nz=dx/len*halfWidth;
    const corners=[{x:a.x+nx,y:a.y,z:a.z+nz},{x:a.x-nx,y:a.y,z:a.z-nz},{x:b.x+nx,y:b.y,z:b.z+nz},{x:b.x-nx,y:b.y,z:b.z-nz}];
    for(const j of [0,2,1,1,2,3])vertex(corners[j],arrows?.32:1);
    arc+=len;
    if(arrows&&arc>=nextArrow) {
      const ux=dx/len,uz=dz/len;
      for(const side of [-1,1]) {
        const tip={x:b.x+ux*2,y:b.y+.02,z:b.z+uz*2};
        const tail={x:b.x-ux*2+nx*side*2.1,y:b.y+.02,z:b.z-uz*2+nz*side*2.1};
        const inner={x:tail.x+ux*1.2,y:tail.y,z:tail.z+uz*1.2};
        vertex(tip);vertex(tail);vertex(inner);
      }
      nextArrow=arc+22;
    }
  }
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('color',new Float32BufferAttribute(colors,3));g.computeBoundingSphere();return g;
}

export function OperationsGuidance({runtime}) {
  const path=useRef(),gates=useRef(),state=useRef({key:'',gatePoints:[]});
  const resources=useMemo(()=>{
    const pathMaterial=new MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.68,side:DoubleSide,depthWrite:false,toneMapped:false});
    // Airborne brackets need to participate in scene depth: the cloud pass
    // replaces depth-empty sky pixels, including transparent marks that did
    // not write depth. Solid, narrow strokes survive that composition and
    // still receive correct cloud/terrain occlusion.
    const gateMaterial=new MeshBasicMaterial({side:DoubleSide,depthWrite:true,toneMapped:false});
    applyBend(pathMaterial);applyBend(gateMaterial);
    return {pathMaterial,gateMaterial,gate:gateGeometry(),empty:new BufferGeometry(),dummy:new Object3D(),color:new Color()};
  },[]);
  useEffect(()=>()=>{state.current.geometry?.dispose();resources.empty.dispose();resources.gate.dispose();resources.pathMaterial.dispose();resources.gateMaterial.dispose();},[resources]);
  useFrame(()=>{
    const o=runtime.operations,f=runtime.flight;if(!path.current||!gates.current||!f)return;
    const mode=operationsPathMode(o,f);
    path.current.visible=!!mode;gates.current.visible=mode==='approach'||mode==='departure';
    if(!mode){state.current.key='';return;}
    const a=o.airport,frame=airportFrame(a),origin=airportPoint(a,0);
    const key=`${a.id}/${o.profile.id}/${o.reverse}/${mode}/${mode==='ground'?o.routeIndex+'/'+o.arrivalExit+'/'+o.phase:''}`;
    if(state.current.key!==key) {
      state.current.key=key;state.current.geometry?.dispose();
      let points=[],gatePoints=[];
      if(mode==='ground') {
        const route=o.groundRoute().slice(Math.max(0,o.routeIndex-1));
        points=roundedGroundRoute(route,a.id==='KOSU'?7:16).map(([s,c])=>{const p=airportPoint(a,s,c);p.y+=.3;return p;});
      } else {
        const sample=d=>mode==='approach'?approachPathPoint(a,o.profile,o.reverse,d):departurePathPoint(a,o.profile,o.reverse,d);
        const start=mode==='approach'?4200:0,end=mode==='approach'?-250:4800;
        // Two slender rails show the continuous slope without filling the view.
        const geometryParts=[];
        for(const side of [-1,1]) {
          const rail=[];
          for(let i=0;i<=240;i++) {
            const d=start+(end-start)*i/240,p=sample(d);
            const width=Math.max(18,o.profile.length*.7)*(mode==='approach'?1+Math.max(0,d)/4200*.45:1);
            p.x-=frame.uz*width*frame.k*side;p.z+=frame.ux*width*frame.k*side;rail.push(p);
          }
          geometryParts.push(routeGeometry(rail,origin,.45*frame.k,mode==='approach'?AMBER:CYAN));
        }
        const merged=new BufferGeometry();
        for(const name of ['position','color']) {
          const arrays=geometryParts.map(g=>g.attributes[name].array),data=new Float32Array(arrays.reduce((n,v)=>n+v.length,0));let offset=0;
          for(const array of arrays){data.set(array,offset);offset+=array.length;}merged.setAttribute(name,new Float32BufferAttribute(data,3));
        }
        geometryParts.forEach(g=>g.dispose());state.current.geometry=merged;
        gatePoints=(mode==='approach'?APPROACH_GATES:DEPARTURE_GATES).map(d=>({p:sample(d),distance:d,
          width:Math.max(18,o.profile.length*.7)*(mode==='approach'?1+d/4200*.45:1),height:Math.max(8,o.profile.length*.22)}));
      }
      if(mode==='ground')state.current.geometry=routeGeometry(points,origin,.65*frame.k,AMBER,true);
      path.current.geometry=state.current.geometry;path.current.position.set(origin.x,origin.y,origin.z);
      gates.current.position.copy(path.current.position);state.current.gatePoints=gatePoints;
    }
    const {dummy,color}=resources;
    state.current.gatePoints.forEach(({p,width,height},i)=>{
      const dx=p.x-f.pos.x,dz=p.z-f.pos.z,distance=Math.hypot(dx,dz)/frame.k;
      const ahead=(dx*Math.sin(f.heading)-dz*Math.cos(f.heading))/frame.k;
      const fade=Math.min(1,Math.max(0,(distance-35)/100))*Math.min(1,Math.max(0,(ahead+20)/80));
      dummy.position.set(p.x-origin.x,p.y-origin.y,p.z-origin.z);dummy.rotation.set(0,-frame.heading,0);
      dummy.scale.set(width*frame.k,2*height,1).multiplyScalar(fade>0?1:0);dummy.updateMatrix();gates.current.setMatrixAt(i,dummy.matrix);
      color.copy(mode==='approach'?AMBER:CYAN).multiplyScalar(fade*(.95-.5*Math.min(1,distance/4500)));gates.current.setColorAt(i,color);
    });
    gates.current.count=state.current.gatePoints.length;gates.current.instanceMatrix.needsUpdate=true;
    if(gates.current.instanceColor)gates.current.instanceColor.needsUpdate=true;
  });
  return <>
    <mesh ref={path} name="operations-guidance-path" geometry={resources.empty} material={resources.pathMaterial} visible={false} frustumCulled={false} dispose={null}/>
    <instancedMesh ref={gates} name="operations-guidance-gates" args={[resources.gate,resources.gateMaterial,10]} visible={false} frustumCulled={false} dispose={null}/>
  </>;
}

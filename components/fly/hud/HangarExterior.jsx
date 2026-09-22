'use client';

import { useEffect, useMemo, useState } from 'react';
import { BufferGeometry, Float32BufferAttribute, SRGBColorSpace, TextureLoader } from 'three';
import { airportFrame, airportLocal, airportPoint } from '@/lib/fly/operations-airports';
import { createImagerySource } from '@/lib/fly/tile-sources';

// A bounded, geographic apron view, using the game's existing imagery provider.
// The preview owns a coarse horizon and a small sharp apron patch; no live-world
// objects are reparented, and every texture is disposed when leaving the hangar.
function ImageryTile({tile,onLoaded}){
  const [texture,setTexture]=useState(null);
  useEffect(()=>{
    let active=true,loaded;
    new TextureLoader().load(tile.url,t=>{
      loaded=t;t.colorSpace=SRGBColorSpace;t.anisotropy=8;
      if(active){setTexture(t);onLoaded();}else t.dispose();
    },undefined,()=>{});
    return()=>{active=false;loaded?.dispose();};
  },[tile,onLoaded]);
  const geometry=useMemo(()=>{
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(tile.vertices,3));
    // The apron-local transform reverses Z; keep the photographic surface facing up.
    g.setAttribute('uv',new Float32BufferAttribute([0,1,1,1,1,0,0,0],2));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();return g;
  },[tile]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  // A previously compiled material without a map needs a new shader variant.
  return <mesh geometry={geometry} visible={!tile.detail||!!texture}><meshBasicMaterial key={texture?.uuid||'loading'} map={texture} color={texture?'#ffffff':'#53645b'} toneMapped={false}/></mesh>;
}

export function HangarExterior({airport,onLoaded}){
  const layout=useMemo(()=>{
    const a=airport,f=airportFrame(a),stand=airportPoint(a,a.standAlong,a.taxiSide*(a.taxiOffset+75));
    const half=Math.PI*6378137;
    const source=createImagerySource('satellite','high');
    const toLocal=(x,z,y=-.12)=>{const p=airportLocal(a,x,z);return [(p.along-a.standAlong)*a.taxiSide,y,(a.taxiSide*(a.taxiOffset+75)-p.cross)*a.taxiSide];};
    const tiles=[];
    for(const [z,radius,y] of [[15,1,-.12],[Math.min(18,source.maxLevel),2,-.10]]){
      const span=half*2/2**z,tx=Math.floor((stand.x+half)/span),ty=Math.floor((stand.z+half)/span);
      for(let row=ty-radius;row<=ty+radius;row++)for(let col=tx-radius;col<=tx+radius;col++){
        const x=-half+col*span,north=-half+row*span;
        tiles.push({id:`${z}/${col}/${row}`,detail:radius===2,url:source.getUrl(col,row,z),vertices:[...toLocal(x,north,y),...toLocal(x+span,north,y),...toLocal(x+span,north+span,y),...toLocal(x,north+span,y)]});
      }
    }
    return {tiles,length:f.length,runwayZ:a.taxiOffset+75};
  },[airport]);
  return <group name="hangar-airport-exterior">
    <mesh rotation-x={-Math.PI/2} position-y={-.16}><planeGeometry args={[9000,9000]}/><meshStandardMaterial color="#45574d" roughness={1}/></mesh>
    {layout.tiles.map(tile=><ImageryTile key={airport.id+tile.id} tile={tile} onLoaded={onLoaded}/>)}
    {Array.from({length:Math.floor(layout.length/65)},(_,i)=>{
      const x=(i*65+30-airport.standAlong)*airport.taxiSide;
      return <group key={i} position={[x,-.055,layout.runwayZ]}>
        <mesh rotation-x={-Math.PI/2}><planeGeometry args={[28,1.1]}/><meshBasicMaterial color="#c5d1d2"/></mesh>
        {[-1,1].map(side=><mesh key={side} position={[0,.1,side*(airport.width/2+1)]}><sphereGeometry args={[.35,5,4]}/><meshBasicMaterial color="#fff0ce" toneMapped={false}/></mesh>)}
      </group>;
    })}
    {/* Distant airport structures give the open doorway a readable horizon. */}
    {[-1,0,1].map((side,i)=><group key={side} position={[side*115-70,0,layout.runwayZ+110+i*25]}>
      <mesh position={[0,7,0]}><boxGeometry args={[65,14,36]}/><meshStandardMaterial color="#6a7b83" roughness={.8}/></mesh>
      <mesh position={[0,14,0]}><boxGeometry args={[68,1,39]}/><meshStandardMaterial color="#b5c3c6" metalness={.25}/></mesh>
      <mesh position={[0,7,-18.1]} rotation-y={Math.PI}><planeGeometry args={[53,10]}/><meshStandardMaterial color="#334d5c" metalness={.3} roughness={.4}/></mesh>
      {side===1&&<group position={[65,0,0]}>
        <mesh position={[0,19,0]}><cylinderGeometry args={[3,5,38,8]}/><meshStandardMaterial color="#a6b7bf"/></mesh>
        <mesh position={[0,39,0]}><cylinderGeometry args={[8,6,5,8]}/><meshStandardMaterial color="#365763" metalness={.6} roughness={.2}/></mesh>
        <mesh position={[0,42,0]}><cylinderGeometry args={[9,9,1,8]}/><meshStandardMaterial color="#d0dee3"/></mesh>
      </group>}
    </group>)}
  </group>;
}

import { BufferGeometry, BufferAttribute, BoxGeometry, CylinderGeometry, SphereGeometry, OctahedronGeometry, Color } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const white=new Color('#d1d6d8'),grey=new Color('#929fa6'),dark=new Color('#192d37'),blue=new Color('#294956');

function paint(g,c=white,role=0){
  if(g.index)g=g.toNonIndexed();
  const n=g.attributes.position.count,colors=new Float32Array(n*3),roles=new Float32Array(n);
  for(let i=0;i<n;i++){colors.set([c.r,c.g,c.b],i*3);roles[i]=role;}
  g.setAttribute('color',new BufferAttribute(colors,3));g.setAttribute('aSurfaceRole',new BufferAttribute(roles,1));
  g.setAttribute('aEmissive',new BufferAttribute(new Float32Array(n*4),4));
  if(!g.attributes.uv)g.setAttribute('uv',new BufferAttribute(new Float32Array(n*2),2));
  return g;
}
function fuse(length,radius,yScale=1,detail=true){
  const p=[],uv=[],idx=[],rows=detail?24:12,sides=detail?20:8;
  for(let row=0;row<=rows;row++){
    const t=row/rows,z=(t-.5)*length;
    const r=t<.14?Math.sin(t/.14*Math.PI/2):t>.77?Math.max(.025,(1-t)/.23):1;
    for(let j=0;j<=sides;j++){
      const a=j/sides*Math.PI*2;
      p.push(Math.cos(a)*radius*r,Math.sin(a)*radius*r*yScale,z);uv.push(t,j/sides);
    }
  }
  for(let row=0;row<rows;row++)for(let j=0;j<sides;j++){const a=row*(sides+1)+j,b=a+sides+1;if(row)idx.push(a,b,a+1);idx.push(a+1,b,b+1);}
  const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array(p),3));g.setAttribute('uv',new BufferAttribute(new Float32Array(uv),2));g.setIndex(idx);g.computeVertexNormals();return g;
}
/** A swept tapered aerofoil with a rounded leading edge, not a box wing. */
function wing(span,chord,sweep,side=1,dihedral=.04,detail=true){
  const p=[],uv=[],idx=[],stations=detail?6:3,sections=detail?12:6;
  for(let s=0;s<=stations;s++){
    const t=s/stations,x=side*t*span,c=chord*(1-.73*t),z=t*span*sweep;
    for(let j=0;j<=sections;j++){
      const a=j/sections*Math.PI*2,u=(1-Math.cos(a))/2;
      p.push(x,t*span*dihedral+Math.sin(a)*c*.055,z+(u-.3)*c);uv.push(t,u);
    }
  }
  for(let s=0;s<stations;s++)for(let j=0;j<sections;j++){const a=s*(sections+1)+j,b=a+sections+1;idx.push(a,a+1,b,a+1,b+1,b);}
  const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array(p),3));g.setAttribute('uv',new BufferAttribute(new Float32Array(uv),2));g.setIndex(idx);g.computeVertexNormals();return g;
}
function box(x,y,z,px,py,pz,c=grey,role=0){return paint(new BoxGeometry(x,y,z).translate(px,py,pz),c,role);}
function merge(parts){const g=mergeGeometries(parts,false);for(const p of parts)p.dispose();g.computeBoundingBox();g.computeBoundingSphere();return g;}
function navLight(x,y,z,color,mode,size){
  const g=paint(new OctahedronGeometry(size).translate(x,y,z),new Color(color));
  const c=new Color(color).multiplyScalar(4),a=g.attributes.aEmissive;
  for(let i=0;i<a.count;i++)a.setXYZW(i,c.r,c.g,c.b,mode);return g;
}
export function buildLiveAirframe(f,detail=true){
  const L=f.length,R=f.radius,parts=[];
  if(f.helicopter){
    parts.push(paint(new SphereGeometry(1,20,12).scale(R*1.2,R*1.1,L*.2).translate(0,0,-L*.18)));
    parts.push(paint(fuse(L*.6,R*.23,1,detail).translate(0,.3,L*.22)));
    parts.push(paint(new SphereGeometry(1,16,10).scale(R*1.08,R*.82,L*.1).translate(0,.18,-L*.30),dark,1));
    parts.push(box(.14,1.5,1,0,1,L*.43,blue),box(.1,.1,5,-1.2,-1.45,-.7),box(.1,.1,5,1.2,-1.45,-.7));
  }else{
    parts.push(paint(fuse(L,R,f.doubleDeck?1.18:1,detail)));
    if(f.hump)parts.push(paint(fuse(L*.37,R*.74,1,detail).translate(0,R*.68,-L*.2)));
    for(const side of [-1,1]){
      parts.push(paint(wing(f.span*.5,L*.18,f.sweep,side,.04,detail).translate(0,f.highWing?R*.72:-R*.35,-L*.035),grey));
      parts.push(paint(wing(f.span*.19,L*.095,.38,side,.035,detail).translate(0,f.tTail?R*3.1:R*.48,L*.37),grey));
      if(f.winglets)parts.push(paint(wing(f.span*.048,L*.035,.45,1,0).rotateZ(side*Math.PI*.43).translate(side*f.span*.5,f.span*.5*.04-R*.35,f.span*.5*f.sweep-L*.035),blue));
      // Discrete cabin windows preserve count and spacing at close range.
      const count=Math.min(58,Math.max(3,Math.floor(L*.63/.86)));
      for(let i=0;detail&&i<count;i++){
        const z=-L*.30+i/(count-1)*L*.55;
        parts.push(box(.035,Math.min(.36,R*.45),.24,side*R*.985,R*.20,z,dark,1));
        if(f.doubleDeck)parts.push(box(.035,.32,.24,side*R*.91,R*.76,z,dark,1));
      }
      // Cockpit glazing follows the tapered nose instead of a solid dark cap.
      parts.push(paint(new SphereGeometry(1,10,6).scale(.065,R*.26,L*.025).rotateY(side*.42).translate(side*R*.63,R*.43,-L*.401),dark,1));
    }
    parts.push(paint(wing(R*3.3,L*.135,.45,1,0,detail).rotateZ(Math.PI/2).translate(0,R*.25,L*.29),blue));
    for(let e=0;e<f.engines;e++){
      const side=f.engines===1?0:e%2===0?-1:1,rank=Math.floor(e/2);
      const x=f.rearEngines?side*R*1.35:side*f.span*(rank?.32:.18),y=f.engines===1?0:f.rearEngines?R*.3:f.highWing?R*.5:-R*.95;
      const z=f.rearEngines?L*.29:f.engines===1?-L*.46:-L*.035+Math.abs(x)*f.sweep;
      const er=f.prop?R*.43:R*.63,el=f.prop?R*2.7:R*3.2;
      parts.push(paint(fuse(el,er,1,detail).translate(x,y,z)));
      if(!f.prop){
        parts.push(paint(new CylinderGeometry(er*.83,er*.83,.1,20).rotateX(Math.PI/2).translate(x,y,z-el*.37),dark,2));
        parts.push(paint(new CylinderGeometry(er*.91,er*.91,el*.09,20,1,true).rotateX(Math.PI/2).translate(x,y,z-el*.37),grey,2));
      }
    }
  }
  const tipY=f.highWing?R*.72:-R*.35;
  for(const side of [-1,1])parts.push(navLight(side*(f.helicopter?R*1.1:f.span*.5),f.helicopter?-.4:tipY+f.span*.02,f.helicopter?0:f.span*.5*f.sweep-L*.035,side<0?'#ff2520':'#24ff6b',0,Math.max(.08,R*.065)));
  parts.push(navLight(0,R,L*.40,'#ffffff',.22,Math.max(.10,R*.07)),navLight(0,R*1.08,0,'#ff3020',.73,Math.max(.08,R*.06)));
  const hull=merge(parts),gear=[];
  for(const [x,z]of [[-R*.8,L*.04],[R*.8,L*.04],[0,-L*.3]]){
    gear.push(box(.12,R*.9,.12,x,-R*1.1,z,grey,2));
    gear.push(paint(new CylinderGeometry(R*.19,R*.19,R*.19,12).rotateZ(Math.PI/2).translate(x,-R*1.55,z),dark,3));
  }
  return {hull,gear:merge(gear),groundOffset:f.helicopter?1.5:R*1.75,rotors:rotorOrigins(f)};
}
export function rotorOrigins(f){
  if(f.helicopter)return[{x:0,y:f.radius*1.4,z:-f.length*.12,radius:f.span*.5,axis:'y'}];
  if(!f.prop)return[];
  return Array.from({length:f.engines},(_,i)=>{
    const side=f.engines===1?0:i%2===0?-1:1,x=side*f.span*.18;
    return{x,y:f.engines===1?0:f.highWing?f.radius*.5:-f.radius*.95,z:f.engines===1?-f.length*.51:-f.length*.035+Math.abs(x)*f.sweep-f.radius*1.15,radius:f.radius*1.3,axis:'z'};
  });
}
export function buildRotor(){return merge([box(2,.035,.10,0,0,0,grey),box(.10,.035,2,0,0,0,grey)]);}

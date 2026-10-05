import {BufferGeometry,BufferAttribute,Group,Mesh} from 'three';
import {LIVERIES} from './adventures.mjs';

// Vector's source GLBs stay byte-for-byte intact. Partition the existing skins
// into hinges on the per-mount clone; the neutral pose has identical triangles.
export function attachVectorControls(root){
  if(root.userData.vectorControls)return;
  root.userData={...root.userData,vectorControls:true};
  const sources=[];root.traverse(o=>{if(o.isMesh)sources.push(o);});
  for(const o of sources){
    if(!['hull','trim','accent'].includes(o.name))continue;
    const temporary=!!o.geometry.index;
    const source=temporary?o.geometry.toNonIndexed():o.geometry;
    const p=source.attributes.position,lists={fixed:[],al:[],ar:[],el:[],er:[]};
    for(let i=0;i<p.count;i+=3){const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3,y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;
      const kind=Math.abs(x)>3.2&&z>4.35&&z<5.4&&Math.abs(y)<.3?(x<0?'al':'ar'):Math.abs(x)>2&&z>7.75&&y<.5?(x<0?'el':'er'):'fixed';lists[kind].push(i,i+1,i+2);
    }
    for(const [key,indices] of Object.entries(lists)){if(!indices.length)continue;
      const geo=new BufferGeometry();
      for(const [name,a] of Object.entries(source.attributes)){const data=new Float32Array(indices.length*a.itemSize);indices.forEach((index,j)=>{for(let k=0;k<a.itemSize;k++)data[j*a.itemSize+k]=a.array[index*a.itemSize+k];});geo.setAttribute(name,new BufferAttribute(data,a.itemSize));}
      geo.userData.fleetOwned=true;
      if(key==='fixed')o.geometry=geo;
      else{const group=new Group(),z=key.startsWith('a')?4.35:7.75;group.name=`vector-${key.startsWith('a')?'aileron':'elevator'}-${key.endsWith('l')?'left':'right'}`;group.position.z=z;geo.translate(0,0,-z);group.add(new Mesh(geo,o.material));o.parent.add(group);}
    }
    if(o.geometry===source)o.visible=false;
    if(temporary)source.dispose();
  }
}
export function fleetAnimator(root,parts={}){
  const find=name=>Array.isArray(name)?name.flatMap(find):name?root.getObjectsByProperty('name',name):[];
  const a=(parts.ailerons||[]).map(find),e=(parts.elevators||[]).flatMap(find),rudder=find(parts.rudder),props=find(parts.propeller);
  return (flight,dt,preview=false,reduced=false)=>{
    const bank=Math.max(-.38,Math.min(.38,flight?.bank||0)),pitch=Math.max(-.3,Math.min(.3,flight?.pitch||0));
    a.forEach((list,i)=>list.forEach(o=>{o.rotation.x=(i?1:-1)*bank*.7;}));e.forEach(o=>{o.rotation.x=-pitch;});rudder.forEach(o=>{o.rotation.y=bank*.3;});
    for(const p of props)if(!preview&&!reduced)p.rotation.z=(p.rotation.z+Math.min(dt,.1)*(28+Math.min(flight?.speed||0,120)*.24))%(Math.PI*2);
  };
}
export function applyFleetLivery(root,id,earned){
  const colors=earned?LIVERIES[id]:null;
  root.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
    if(!m?.color)continue;m.userData.fleetBaseColor??=m.color.clone();
    const name=(m.name||o.name).toLowerCase();const role=/hull|painted pearl/.test(name)?'hull':/trim|midnight wing/.test(name)?'trim':/accent|copper recognition/.test(name)?'accent':null;
    // Both hangar and flight use privately cloned materials. Distinguish paint,
    // glazing and metal without adding geometry, textures, or shader variants.
    if(role){m.roughness=role==='hull'?.34:role==='trim'?.46:.29;m.metalness=role==='accent'?.22:.12;}
    else if(/glass|canopy/.test(name)){m.roughness=.13;m.metalness=.25;m.envMapIntensity=1.15;}
    else if(name==='cabin'){m.roughness=.24;m.metalness=.12;}
    else if(name==='metal'){m.roughness=.3;m.metalness=.72;}
    if(role&&colors)m.color.set(colors[role]);else m.color.copy(m.userData.fleetBaseColor);
  }});
}
export function disposeFleetGeometry(root){root.traverse(o=>{if(o.geometry?.userData.fleetOwned)o.geometry.dispose();});}

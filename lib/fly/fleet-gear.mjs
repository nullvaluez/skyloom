import {Group,Mesh,MeshStandardMaterial,CylinderGeometry,BoxGeometry,Vector3,Quaternion} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
// The contact solver retains its dimensions. Only the presentation is authored here.
export function buildFleetGear(id,profile){
  const root=new Group();root.name='player-landing-gear';const legs=[];
  const p=profile||{length:8,clearance:.35,wheelRadius:.19,gearPoints:[[0,-.16,.28]]};
  const heavy=id==='airliner'||id==='cargo',prop=id==='prop',war=id==='warbird-prop',glider=id==='glider';
  const mats={metal:new MeshStandardMaterial({color:'#97a7ad',metalness:.7,roughness:.3}),rubber:new MeshStandardMaterial({color:'#172026',roughness:.91}),paint:new MeshStandardMaterial({color:'#394c56',metalness:.2,roughness:.42})};
  let triangles=0;
  p.gearPoints.forEach(([x,y,z],i)=>{
    if(war&&i===2)z=p.length*.43;
    const mountY=glider?-.13:(-.049*p.length+(p.modelOffsetY||0)),r=p.wheelRadius*(war&&i===2?.6:1);
    const leg=new Group();leg.name=`gear-${i===2?'nose':i===0?'left':'right'}`;leg.position.set(x,mountY,z);root.add(leg);legs.push(leg);
    const buckets={metal:[],rubber:[],paint:[]};
    const add=(g,role,pos=[0,0,0],rot=[0,0,0])=>{g.rotateX(rot[0]);g.rotateY(rot[1]);g.rotateZ(rot[2]);g.translate(...pos);const plain=g.index?g.toNonIndexed():g;plain.deleteAttribute('uv');buckets[role].push(plain);};
    const bar=(a,b,radius,role='metal')=>{const av=new Vector3(...a),bv=new Vector3(...b),g=new CylinderGeometry(radius,radius,av.distanceTo(bv),6);g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),bv.clone().sub(av).normalize()));add(g,role,av.add(bv).multiplyScalar(.5).toArray());};
    const floor=-p.clearance+r-mountY;
    bar([0,.03,0],[0,floor,0],r*.12);bar([0,.015,-r*.9],[0,floor*.72,0],r*.075,'paint');
    bar([0,floor*.42,0],[r*.4,floor*.58,-r*.22],r*.06);bar([r*.4,floor*.58,-r*.22],[0,floor*.76,0],r*.06);
    if(!prop&&!glider)add(new BoxGeometry(r*.8,Math.abs(floor)*.65,r*.10),'paint',[r*.34,floor*.34,r*.40]);
    const rows=heavy&&i<2?(id==='cargo'?3:2):1,twins=heavy||id==='bizjet'&&i===2;
    for(let row=0;row<rows;row++)for(const side of twins?[-1,1]:[1]){const wx=side*r*.48,wz=(row-(rows-1)/2)*r*1.65;
      add(new CylinderGeometry(r,r,r*.52,10),'rubber',[wx,floor,wz],[0,0,Math.PI/2]);add(new CylinderGeometry(r*.47,r*.47,r*.55,8),'metal',[wx,floor,wz],[0,0,Math.PI/2]);
      if(prop)add(new BoxGeometry(r*.64,r*.44,r*2.5),'paint',[wx,floor+r*.65,wz]);
    }
    if(rows>1)bar([0,floor,-r*(rows-1)],[0,floor,r*(rows-1)],r*.18);
    for(const [role,list]of Object.entries(buckets))if(list.length){const g=mergeGeometries(list);triangles+=g.attributes.position.count/3;const mesh=new Mesh(g,mats[role]);mesh.castShadow=true;leg.add(mesh);}
  });
  return {root,legs,triangles,dispose(){root.traverse(o=>o.geometry?.dispose());Object.values(mats).forEach(m=>m.dispose());}};
}

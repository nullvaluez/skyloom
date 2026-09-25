import { Color, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, MeshPhysicalMaterial, Object3D } from 'three';
import { LIVE_AIRCRAFT, liveGearDown, liveModelLod, resolveLiveAircraft } from './live-aircraft';
import { buildLiveAirframe, buildRotor } from './live-aircraft-geometry';
import { livingProfile } from './living-earth';
import { applyBendAirAnchor, applyNavLights, horizonFade } from './toy-world/world-bend';
import { GLOBE, NAV_LIGHTS, TRAFFIC_HORIZON, TRAFFIC } from './fly-constants';

const pose=new Object3D(),rotorPose=new Object3D(),tint=new Color();
const CAPACITY=48;
const FAR_CAPACITY=256;
export function createLiveAircraftMaterial(){
  const m=new MeshPhysicalMaterial({vertexColors:true,roughness:.36,metalness:.06,clearcoat:.34,clearcoatRoughness:.22,envMapIntensity:.85,side:DoubleSide});
  applyBendAirAnchor(m,GLOBE.trafficBend);
  applyNavLights(m,NAV_LIGHTS);
  const before=m.onBeforeCompile,key=m.customProgramCacheKey();
  m.onBeforeCompile=(s,r)=>{
    before(s,r);
    s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute float aSurfaceRole;\nvarying float vSurfaceRole;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSurfaceRole=aSurfaceRole;');
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying float vSurfaceRole;').replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
roughnessFactor=vSurfaceRole<.5?.36:vSurfaceRole<1.5?.12:vSurfaceRole<2.5?.27:.93;`).replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>
metalnessFactor=vSurfaceRole>1.5&&vSurfaceRole<2.5?.72:.04;`);
  };
  m.customProgramCacheKey=()=>`${key}-living-airframe-v2`;return m;
}
export class DetailedTraffic {
  constructor(){
    this.group=new Group();this.group.name='live-aircraft-detail';this.models=[];this.material=createLiveAircraftMaterial();this.rotorGeometry=buildRotor();this.preparing=0;
    this.stats={families:0,displayed:0,near:0,grounded:0,fallback:0,ready:false,triangles:0,geometryBytes:0};
    this.disposed=false;
  }
  prepare(){
    if(this.preparing>=LIVE_AIRCRAFT.length)return true;
    const family=LIVE_AIRCRAFT[this.preparing++],g=buildLiveAirframe(family),far=buildLiveAirframe(family,false);far.gear.dispose();
    const make=(geometry,name,n=CAPACITY)=>{const mesh=new InstancedMesh(geometry,this.material,n);mesh.name=name;mesh.instanceMatrix.setUsage(DynamicDrawUsage);mesh.count=0;mesh.frustumCulled=false;this.group.add(mesh);return mesh;};
    this.models.push({family,...g,farHull:far.hull,body:make(g.hull,`live:${family.id}`),far:make(far.hull,`live-mid:${family.id}`,FAR_CAPACITY),wheels:make(g.gear,`gear:${family.id}`,FAR_CAPACITY),rotor:make(this.rotorGeometry,`rotor:${family.id}`,FAR_CAPACITY*2),used:0,farUsed:0,gearUsed:0,rotorUsed:0});
    for(const geometry of [g.hull,g.gear,far.hull])this.stats.geometryBytes+=Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(geometry.index?.array.byteLength??0);
    this.stats.families=this.models.length;return this.preparing===LIVE_AIRCRAFT.length;
  }
  update(items,flight,origin,tier,selected,satellite,time){
    for(const it of items)it.livingDetailed=false;
    this.group.visible=satellite;this.stats.displayed=0;this.stats.near=0;this.stats.grounded=0;this.stats.triangles=0;
    if(!satellite)return;
    for(const m of this.models)m.used=m.farUsed=m.gearUsed=m.rotorUsed=0;
    const profile=livingProfile(tier);
    const candidates=items.filter(it=>it.opacity>.03&&it.distM<TRAFFIC.modelLodDistanceM).sort((a,b)=>(b.hex===selected)-(a.hex===selected)||a.distM-b.distM);
    for(const it of candidates){
      const index=resolveLiveAircraft(it.meta,it.archetype),m=index==null?null:this.models[index];
      if(!m)continue;
      const fix=it.fix1;if(!fix)continue;
      const horizon=horizonFade(Math.hypot(it.rx-flight.pos.x,it.rz-flight.pos.z),it.ryd,TRAFFIC_HORIZON);
      if(horizon<=.02)continue;
      const near=this.stats.near<profile.aircraft&&liveModelLod(it.distM,it.hex===selected,it.livingNear,profile.detailM);
      if(near&&m.used>=CAPACITY||!near&&m.farUsed>=FAR_CAPACITY)continue;
      it.livingNear=near;
      const grounded=liveGearDown(it),speed=Math.hypot(fix.vE,fix.vN),pitch=grounded?0:speed>20?Math.atan2(fix.vUp,speed):0;
      pose.position.set(it.rx-origin.anchor.x,it.ryd+(grounded?m.groundOffset-2:0),it.rz-origin.anchor.z);pose.rotation.order='YXZ';pose.rotation.set(pitch,-it.yaw,grounded?0:-it.bank);pose.scale.set(it.scaleK,1,it.scaleK);pose.updateMatrix();
      const body=near?m.body:m.far,slot=near?m.used++:m.farUsed++;
      body.setMatrixAt(slot,pose.matrix);const opacity=it.opacity*horizon;tint.setRGB(opacity,opacity,opacity);body.setColorAt(slot,tint);
      if(near)this.stats.near++;
      if(grounded&&!m.family.helicopter&&m.gearUsed<FAR_CAPACITY){m.wheels.setMatrixAt(m.gearUsed,pose.matrix);m.wheels.setColorAt(m.gearUsed++,tint);this.stats.grounded++;}
      for(const r of m.rotors){
        if(m.rotorUsed>=FAR_CAPACITY*2)break;
        rotorPose.position.set(r.x,r.y,r.z);rotorPose.rotation.set(r.axis==='z'?Math.PI/2:0,time*(grounded?18:48),0);rotorPose.scale.setScalar(r.radius);rotorPose.updateMatrix();rotorPose.matrix.premultiply(pose.matrix);m.rotor.setMatrixAt(m.rotorUsed,rotorPose.matrix);m.rotor.setColorAt(m.rotorUsed++,tint);
      }
      it.livingDetailed=true;this.stats.displayed++;
    }
    for(const m of this.models){
      for(const [mesh,count]of [[m.body,m.used],[m.far,m.farUsed],[m.wheels,m.gearUsed],[m.rotor,m.rotorUsed]]){
        mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
        this.stats.triangles+=count*(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
      }
    }
    this.stats.fallback=candidates.length-this.stats.displayed;
  }
  dispose(){
    this.disposed=true;
    for(const m of this.models){for(const mesh of [m.body,m.far,m.wheels,m.rotor]){mesh.removeFromParent();mesh.dispose();}m.hull.dispose();m.farHull.dispose();m.gear.dispose();}
    this.models=[];this.rotorGeometry.dispose();this.material.dispose();this.group.removeFromParent();
  }
}

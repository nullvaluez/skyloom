import { BufferGeometry,BufferAttribute,DoubleSide,DynamicDrawUsage,Group,Mesh,MeshStandardMaterial } from 'three';
import { applyBend,groundOverlayOffset } from './toy-world/world-bend';
import { applyDaylightSurface } from './daylight-depth';
import { applyNearGroundMaterial } from './near-ground-material';
import { GroundSupportView } from './ground-support-view';
const WORLD=40075016.68557849,R=6378137;
export class LivingAirports{
  constructor(){
    this.group=new Group();this.group.name='living-airports';this.tiles=new Map();this.turn=0;this.supportView=new GroundSupportView();this.nextCensus=-Infinity;
    this.material=new MeshStandardMaterial({color:'#777975',roughness:.86,metalness:0,side:DoubleSide,polygonOffset:true,...groundOverlayOffset(-1,-1)});
    applyBend(this.material);applyDaylightSurface(this.material);applyNearGroundMaterial(this.material);
    this.night={value:0};const previous=this.material.onBeforeCompile,key=this.material.customProgramCacheKey();
    this.material.onBeforeCompile=(s,r)=>{
      previous(s,r);s.uniforms.uAirportNight=this.night;
      s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nattribute vec2 aAirport;\nvarying vec4 vAirport;').replace('#include <begin_vertex>','#include <begin_vertex>\nvAirport=vec4(uv,aAirport);');
      s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec4 vAirport;\nuniform float uAirportNight;').replace('#include <color_fragment>',`#include <color_fragment>
float runway=1.0-step(1.5,vAirport.z),taxi=step(1.5,vAirport.z)*(1.0-step(2.5,vAirport.z)),street=step(3.5,vAirport.z);
float pixel=max(fwidth(vAirport.x),.03);
float centre=1.0-smoothstep(.16,.16+pixel,abs(vAirport.x));
float dash=1.0-step(30.0,mod(vAirport.y,60.0));
float sideLine=1.0-smoothstep(.18,.18+pixel,abs(abs(vAirport.x)-vAirport.w*.46));
float marks=runway*max(centre*dash,sideLine)+taxi*centre+street*step(9.,vAirport.w)*centre*dash;
vec3 paint=mix(vec3(.72),vec3(.72,.51,.075),taxi);
float seams=1.0-smoothstep(.03,.03+max(fwidth(vAirport.y),.03),min(mod(vAirport.y,7.0),7.0-mod(vAirport.y,7.0)));
diffuseColor.rgb*=mix(.46,.88,step(2.5,vAirport.z)*(1.0-street))*(1.0-seams*.07);
diffuseColor.rgb=mix(diffuseColor.rgb,paint,clamp(marks,0.,1.));`)
      .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
float edgeDot=(1.0-smoothstep(.20,.20+pixel,abs(abs(vAirport.x)-vAirport.w*.48)))*(1.0-smoothstep(.35,.35+max(fwidth(vAirport.y),.05),abs(mod(vAirport.y+30.,60.)-30.)));
totalEmissiveRadiance+=mix(vec3(.2,.4,2.2),vec3(2.,1.75,1.25),runway)*edgeDot*(runway+taxi)*uAirportNight;`);
    };
    this.material.customProgramCacheKey=()=>`${key}-living-airfield-v1`;
    this.stats={tiles:0,draws:0,triangles:0,nearPending:0,mappedPolygons:0,inferredWidths:0};
  }
  update(surface,runtime){
    const f=runtime.flight,k=1/Math.max(.1,Math.cos(f.latDeg*Math.PI/180)),keep=new Set();let changed=false;
    this.supportView.update(runtime);
    this.night.value=1-Math.max(0,Math.min(1,((runtime.sun?.sinEl??1)+.08)/.16));
    for(const slot of surface.bands[2].slots){
      const payload=slot.mask?.airport;if(slot.state!=='ready'||!payload)continue;
      keep.add(slot.key);if(!payload.pos.length||this.tiles.has(slot.key))continue;
      changed=true;
      const [,x,y]=slot.key.split('/').map(Number),span=surface.bands[2].span,geometry=new BufferGeometry();
      geometry.setAttribute('position',new BufferAttribute(payload.pos.slice(),3).setUsage(DynamicDrawUsage));geometry.setAttribute('uv',new BufferAttribute(payload.uv,2));geometry.setAttribute('aAirport',new BufferAttribute(payload.style,2));
      const normal=new Float32Array(payload.pos.length);for(let i=1;i<normal.length;i+=3)normal[i]=1;
      geometry.setAttribute('normal',new BufferAttribute(normal,3));geometry.setIndex(new BufferAttribute(new Uint32Array(payload.pos.length/3),1).setUsage(DynamicDrawUsage));geometry.setDrawRange(0,0);
      const mesh=new Mesh(geometry,this.material);mesh.name=`airport:${slot.key}`;mesh.position.set(x*span-WORLD/2,0,y*span-WORLD/2);mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.visible=false;mesh.renderOrder=1;this.group.add(mesh);
      // Adjacent triangles repeat their edge vertices. Query each exact XZ
      // once, retaining separate vertices for their UV/material boundaries.
      const supports=[],lookup=new Map();
      for(let i=0;i<payload.pos.length/3;i++){
        const x=payload.pos[i*3],z=payload.pos[i*3+2],key=`${x}/${z}`;
        let support=lookup.get(key);if(!support){support={x,z,vertices:[],height:NaN,zoom:0};lookup.set(key,support);supports.push(support);}support.vertices.push(i);
      }
      const pending=Array.from({length:supports.length},(_,i)=>i),distance=i=>(mesh.position.x+supports[i].x-f.pos.x)**2+(mesh.position.z+supports[i].z-f.pos.z)**2;
      pending.sort((a,b)=>distance(a)-distance(b));
      this.tiles.set(slot.key,{mesh,payload,supports,cursor:0,pending,ready:new Uint8Array(payload.pos.length/3),drawn:new Uint8Array(payload.pos.length/9),indices:0,heal:0});
    }
    for(const [key,t]of this.tiles)if(!keep.has(key)){t.mesh.removeFromParent();t.mesh.geometry.dispose();this.tiles.delete(key);changed=true;}
    const tiles=[...this.tiles.values()],start=performance.now();
    for(let n=0;tiles.length&&n<48&&performance.now()-start<.8;n++){
      const t=tiles[this.turn++%tiles.length],p=t.mesh.geometry.attributes.position;
      const at=t.pending.length?t.cursor++%t.pending.length:-1,i=at<0?t.heal++%t.supports.length:t.pending[at],support=t.supports[i];
      const x=t.mesh.position.x+support.x,z=t.mesh.position.z+support.z,g=runtime.engine.getGroundAt(x/R*180/Math.PI,(2*Math.atan(Math.exp(-z/R))-Math.PI/2)*180/Math.PI);
      if(Number.isFinite(g?.elev))support.height=g.elev;
      if(!g||g.tileZ<14||!Number.isFinite(g.elev))continue;
      support.zoom=g.tileZ;
      if(at>=0){t.pending.splice(at,1);t.cursor=at;}
      for(const vertex of support.vertices){
        const before=p.getY(vertex),height=at<0?before+(g.elev+.10-before)*.2:g.elev+.10;
        if(at>=0||Math.abs(height-before)>.002){p.setY(vertex,height);p.addUpdateRange(vertex*3+1,1);p.needsUpdate=true;}
        if(at>=0){
          t.ready[vertex]=1;const triangle=Math.floor(vertex/3),base=triangle*3;
          if(!t.drawn[triangle]&&t.ready[base]&&t.ready[base+1]&&t.ready[base+2]){
            t.drawn[triangle]=1;const index=t.mesh.geometry.index;index.array.set([base,base+1,base+2],t.indices);index.addUpdateRange(t.indices,3);t.indices+=3;index.needsUpdate=true;t.mesh.geometry.setDrawRange(0,t.indices);t.mesh.visible=true;
          }
        }
      }
    }
    // Readiness polls at 4 Hz and requires a 600 ms stable hold. Scanning all
    // unrefined off-screen supports every rendered frame adds no useful truth.
    // New/removed tiles invalidate immediately; moving-view census stays 10 Hz.
    const census=changed||start>=this.nextCensus;
    if(census){this.nextCensus=start+100;this.stats.nearPending=0;this.stats.nearHiddenPending=0;}
    Object.assign(this.stats,{tiles:tiles.length,draws:0,triangles:0,mappedPolygons:0,inferredWidths:0,sourceCommit:surface.stats.commits});
    for(const t of tiles){
      this.stats.mappedPolygons+=t.payload.evidence.mappedPolygons;this.stats.inferredWidths+=t.payload.evidence.inferredWidths;
      if(t.mesh.visible){this.stats.draws++;this.stats.triangles+=t.indices/3;}
      if(census)for(const i of t.pending){
        const support=t.supports[i],x=support.x+t.mesh.position.x,z=support.z+t.mesh.position.z;
        if(Math.hypot(x-f.pos.x,z-f.pos.z)/k<1000){
          const elevation=Number.isFinite(support.height)?support.height:f.groundElev;
          if(this.supportView.visible(x,z,elevation,100))this.stats.nearPending++;else this.stats.nearHiddenPending++;
        }
      }
    }
  }
  dispose(){for(const t of this.tiles.values()){t.mesh.removeFromParent();t.mesh.geometry.dispose();}this.tiles.clear();this.material.dispose();this.group.removeFromParent();}
}

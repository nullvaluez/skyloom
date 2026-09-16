import { Color, DynamicDrawUsage, InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import { buildGroundScrubGeometry } from './near-ground-detail';
import { applyBendAnchor } from './toy-world/world-bend';
import { applyDaylightSurface } from './daylight-depth';
import { MONUMENT_EXCLUSIONS } from './monument-models';
import { useFlyStore } from '../../stores/fly-store';
import { EARTH_SURFACE } from './stylized-earth';

const WORLD=40075016.68557849,R=6378137,capacity=160;
const hash=(x,z)=>{let v=Math.imul(x,374761393)^Math.imul(z,668265263);v=Math.imul(v^(v>>>13),1274126177);return((v^(v>>>16))>>>0)/4294967296;};

/** Shared 18-triangle silhouette: broad scrub and flatter stones, with no alpha overdraw. */
export class EarthScenery {
  constructor(){
    const geometry=buildGroundScrubGeometry(),material=new MeshStandardMaterial({vertexColors:true,roughness:.97,metalness:0,envMapIntensity:.3});
    applyBendAnchor(material);applyDaylightSurface(material,'clutter');
    this.mesh=new InstancedMesh(geometry,material,capacity);this.mesh.name='earth-scrub-and-stones';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);this.mesh.count=0;this.mesh.frustumCulled=false;
    this.mesh.receiveShadow=true;this.dummy=new Object3D();this.color=new Color();this.rows=[];this.born=new Map();this.lastScan=-Infinity;
    this.stats={instances:0,rocks:0,scrub:0,draws:0};
  }
  update(surface,runtime,now){
    const f=runtime.flight,k=1/Math.max(.1,Math.cos(f.latDeg*Math.PI/180));
    const agl=f.pos.y-(runtime.groundElevVis??f.groundElev),tier=useFlyStore.getState().qualityTier;
    const heightFade=1-Math.min(1,Math.max(0,(agl-300)/900));
    this.mesh.visible=heightFade>0;
    if(!this.mesh.visible){this.stats.draws=0;return;}
    if(now-this.lastScan>.75){
      this.lastScan=now;
      const b=surface.bands[2],step=8,rows=[],radius=900*k;
      for(const slot of b.slots){
        if(slot.state!=='ready'||!slot.mask)continue;
        const [,tx,ty]=slot.key.split('/').map(Number),ox=tx*b.span-WORLD/2,oz=ty*b.span-WORLD/2;
        if(ox>f.pos.x+radius||ox+b.span<f.pos.x-radius||oz>f.pos.z+radius||oz+b.span<f.pos.z-radius)continue;
        const mask=slot.mask;
        for(let z=step/2;z<b.size;z+=step)for(let x=step/2;x<b.size;x+=step){
          const i=z*b.size+x,cls=mask.classes[i];
          if(![EARTH_SURFACE.wood,EARTH_SURFACE.rock,EARTH_SURFACE.sand,EARTH_SURFACE.scrub].includes(cls)||mask.exclusion[i])continue;
          // Four surrounding cells keep the whole prop away from thin roads/coasts.
          if([i-1,i+1,i-b.size,i+b.size].some(j=>mask.exclusion[j]||mask.classes[j]!==cls))continue;
          const wx=ox+(x+.5)*b.span/b.size,wz=oz+(z+.5)*b.span/b.size;
          if(Math.hypot(wx-f.pos.x,wz-f.pos.z)>radius)continue;
          if(MONUMENT_EXCLUSIONS.some(p=>Math.hypot(p.wx-wx,p.wz-wz)<(p.radiusM+5)*k))continue;
          if(runtime.satBuildings?.queryColumns?.(wx,wz,5*k)?.length)continue;
          const seed=hash(tx*b.size+x,ty*b.size+z),id=`${slot.key}:${x}:${z}`;
          rows.push({wx,wz,seed,id,cls,rock:cls===EARTH_SURFACE.rock||cls===EARTH_SURFACE.sand});
        }
      }
      // Retain selected actors, then favor the foreground. A pure hash ordering
      // spent the pool on remote scrub while nearby surfaces looked empty.
      const resident=new Set(this.rows.map(row=>row.id));
      for(const row of rows)row.priority=Math.hypot(row.wx-f.pos.x,row.wz-f.pos.z)/k-(resident.has(row.id)?160:0)+row.seed*45;
      rows.sort((a,b)=>a.priority-b.priority);
      const previous=new Map(this.rows.map(row=>[row.id,row]));
      this.rows=rows.slice(0,tier==='high'?160:tier==='medium'?96:48).map(row=>({...previous.get(row.id),...row}));
      this.born=new Map(this.rows.map(row=>[row.id,this.born.get(row.id)??now]));
    }
    const ox=Math.round(f.pos.x/1024)*1024,oz=Math.round(f.pos.z/1024)*1024;
    this.mesh.position.set(ox,0,oz);let count=0,rocks=0,supportChecks=0;
    for(const row of this.rows){
      const distance=Math.hypot(row.wx-f.pos.x,row.wz-f.pos.z)/k;
      const fade=heightFade*Math.min(1,(now-this.born.get(row.id))/.8)*(1-Math.min(1,Math.max(0,(distance-600)/300)));
      if(fade<=.001)continue;
      if(supportChecks<16 && now-(row.supportAt??-Infinity)>.5){
        supportChecks++;
        const lon=row.wx/R*180/Math.PI,lat=(2*Math.atan(Math.exp(-row.wz/R))-Math.PI/2)*180/Math.PI;
        const g=runtime.engine.getGroundAt(lon,lat);
        row.supportAt=now;
        if(g&&g.tileZ>=14&&Number.isFinite(g.elev))row.ground=runtime.satVeg?.groundAtNear?.(row.wx,row.wz,g.elev)??g.elev;
      }
      if(!Number.isFinite(row.ground))continue;
      const ground=row.ground;
      const width=(row.rock?1.7:2.4)+row.seed*1.8,height=(row.rock ? 0.6 : 1.1)+row.seed*.6;
      this.dummy.position.set(row.wx-ox,ground-.04,row.wz-oz);this.dummy.rotation.set(0,row.seed*Math.PI*2,0);
      this.dummy.scale.set(width*k*fade,height*fade,width*k*(.7+row.seed*.3)*fade);this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count,this.dummy.matrix);this.color.set(row.rock?'#a09b83':row.cls===EARTH_SURFACE.scrub?'#8d9061':'#668246').multiplyScalar(.87+row.seed*.24);
      this.mesh.setColorAt(count,this.color);count++;if(row.rock)rocks++;
    }
    this.mesh.count=count;this.mesh.instanceMatrix.needsUpdate=true;if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;
    Object.assign(this.stats,{instances:count,rocks,scrub:count-rocks,draws:count?1:0});
  }
  dispose(){this.mesh.removeFromParent();this.mesh.dispose();this.mesh.geometry.dispose();this.mesh.material.dispose();this.rows=[];this.born.clear();}
}

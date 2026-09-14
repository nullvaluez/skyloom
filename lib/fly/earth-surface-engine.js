import { Color } from 'three';
import { EARTH_PALETTE, EARTH_SURFACE, STYLIZED_EARTH, earthPatternPhase } from './stylized-earth';
import { EARTH_UNIFORMS, clearEarthUniforms, makeEarthAtlas } from './earth-surface-material';

const WORLD = 40075016.68557849, mod = (n,d) => ((n%d)+d)%d;
const colors = EARTH_PALETTE.map(hex => { const c = new Color(hex); return [c.r,c.g,c.b].map(v=>Math.round(v*255)); });

/** The runtime is the existing imperative scene bus, not React display state. */
export function publishEarthSurface(runtime, stats) { runtime.earthSurface = stats; }
export function removeEarthSurface(runtime, stats) { if (runtime.earthSurface === stats) runtime.earthSurface = null; }

/** Three independently streamed, toroidal mask bands: 48 slots / 6 MiB / zero draws. */
export class EarthSurfaceEngine {
  constructor(api) {
    this.api=api;this.disposed=false;this.inFlight=0;this.queue=[];this.pending=[];this.lastUpdate=-Infinity;
    this.bands=STYLIZED_EARTH.bands.map((b,i)=>({ ...b, i, span:WORLD/2**b.z, texture:makeEarthAtlas(b.size*4),
      minX:Infinity,minY:Infinity,slots:Array.from({length:16},()=>({key:null,generation:0,state:'empty',retryAt:0})), born:new Float32Array(16).fill(-100) }));
    this.stats={revision:STYLIZED_EARTH.surfaceRevision,ready:0,pending:0,failed:0,noData:0,staleDropped:0,commits:0,waterCells:0,maskBytes:this.bands.reduce((n,b)=>n+b.texture.image.data.byteLength,0),draws:0};
    for(const b of this.bands){EARTH_UNIFORMS[`uEarthMap${b.i}`].value=b.texture;EARTH_UNIFORMS[`uEarthBorn${b.i}`].value=b.born;}
  }

  update(runtime, now) {
    if(this.disposed)return;
    const f=runtime.flight,anchor=runtime.origin?.anchor??{x:0,z:0};
    const u=EARTH_UNIFORMS;
    u.uEarthOn.value=1;u.uEarthTime.value=now;
    const k=1/Math.max(.09,Math.cos((f.latDeg??0)*Math.PI/180));
    u.uEarthPattern.value.set(earthPatternPhase(anchor.x),earthPatternPhase(anchor.z),k);
    const s=Math.max(-1,Math.min(1,runtime.sun?.sinEl??1)),az=runtime.sun?.az??0,c=Math.sqrt(1-s*s);
    u.uEarthSun.value.set(-Math.sin(az)*c,s,Math.cos(az)*c);
    const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
    u.uEarthLight.value.set(smooth(-.1,.3,s),1-smooth(-.2,-.02,s),runtime.weather?.wx?.overcastT??0,k);
    for(const b of this.bands){
      const x=Math.floor((f.pos.x+WORLD/2)/b.span)-1,y=Math.floor((f.pos.z+WORLD/2)/b.span)-1;
      if(x!==b.minX||y!==b.minY){b.minX=x;b.minY=y;this.lastUpdate=-Infinity;}
      u[`uEarthBounds${b.i}`].value.set(x*b.span-WORLD/2-anchor.x,y*b.span-WORLD/2-anchor.z,b.span,b.size);
      u[`uEarthSlots${b.i}`].value.set(mod(x,4),mod(y,4));
    }
    if(now-this.lastUpdate>.25){this.lastUpdate=now;this._select(now);}
    // One bounded atlas slot commit per frame; parsing/rasterization stays in the worker.
    const job=this.pending.shift();
    if(job)this._commit(job,now);
    this._pump();
    this.stats.ready=this.bands.reduce((n,b)=>n+b.slots.filter(s=>s.state==='ready').length,0);
    this.stats.pending=this.queue.length+this.pending.length+this.inFlight;
  }

  _select(now) {
    const queue=[];
    for(const b of this.bands)for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++){
      const x=b.minX+dx,y=b.minY+dy,index=mod(y,4)*4+mod(x,4),slot=b.slots[index];
      const key=`${b.z}/${x}/${y}`;
      if(slot.key!==key){
        slot.key=key;slot.generation++;slot.state='empty';slot.retryAt=0;slot.mask=null;
        this._clearSlot(b,index);b.born[index]=now;
      }
      if(slot.state==='empty'||(slot.state==='error'&&now>=slot.retryAt))
        queue.push({b,index,key,x,y,generation:slot.generation,priority:b.i*8+Math.hypot(dx-1.5,dy-1.5)});
    }
    this.queue=queue.sort((a,b)=>a.priority-b.priority);
  }

  _clearSlot(b,index) {
    const data=b.texture.image.data,width=b.size*4,sx=(index%4)*b.size,sy=Math.floor(index/4)*b.size;
    for(let y=0;y<b.size;y++)data.fill(0,((sy+y)*width+sx)*4,((sy+y)*width+sx+b.size)*4);
    b.texture.needsUpdate=true;
  }

  _pump() {
    while(!this.disposed&&this.inFlight<STYLIZED_EARTH.maxRequests&&this.queue.length){
      const job=this.queue.shift(),{b,index,x,y}=job,slot=b.slots[index];
      if(slot.key!==job.key||slot.generation!==job.generation||slot.state==='loading'||slot.state==='ready'||slot.state==='no-data')continue;
      if(y<0||y>=2**b.z){slot.state='no-data';continue;}
      slot.state='loading';this.inFlight++;
      this.api.buildTile(b.z,mod(x,2**b.z),y,'earth-surface',{size:b.size}).then(result=>{
        if(this.disposed)return;
        if(result.v!==STYLIZED_EARTH.protocol)throw new Error(`Surface worker protocol ${result.v}`);
        if(result.surface && result.surface.revision!==STYLIZED_EARTH.surfaceRevision)throw new Error(`Surface mask revision ${result.surface.revision}`);
        this.pending.push({...job,result});
      }).catch(()=>{
        if(!this.disposed&&slot.key===job.key&&slot.generation===job.generation){slot.state='error';slot.retryAt=performance.now()/1000+10;this.stats.failed++;}
      }).finally(()=>{this.inFlight--;});
    }
  }

  _commit(job,now) {
    const {b,index,result}=job,slot=b.slots[index];
    if(slot.key!==job.key||slot.generation!==job.generation){this.stats.staleDropped++;return;}
    const mask=result.surface;
    if(!mask){slot.state='no-data';this.stats.noData++;return;}
    const data=b.texture.image.data,width=b.size*4,sx=(index%4)*b.size,sy=Math.floor(index/4)*b.size;
    for(let y=0;y<b.size;y++)for(let x=0;x<b.size;x++){
      const j=y*b.size+x,cls=mask.classes[j],p=((sy+y)*width+sx+x)*4;
      // A successfully parsed finer tile can retire a coarse water silhouette
      // even where no landcover is tagged. 64 means photographic fallback,
      // never an invented land classification. Unloaded/error slots remain 0.
      data[p+3]=64;
      if(!cls)continue;
      const rgb=colors[cls]??colors[0];
      // Keep thin roads and actual footprints photographic; water still shades continuously.
      if(mask.exclusion[j]===255&&cls!==EARTH_SURFACE.water)continue;
      data[p]=rgb[0];data[p+1]=rgb[1];data[p+2]=rgb[2];
      // Hydrology alone does not establish vegetation: retain mostly imagery
      // in wetland/salt-pan areas. Alpha is the shader's classification weight.
      data[p+3]=cls===EARTH_SURFACE.water?255:cls===EARTH_SURFACE.wetland||cls===EARTH_SURFACE.tidal?90:128;
    }
    slot.state='ready';slot.mask=mask;slot.retryAt=0;b.born[index]=now;b.texture.needsUpdate=true;
    this.stats.commits++;this.stats.waterCells+=mask.waterCells;
  }

  dispose(){this.disposed=true;this.queue=[];this.pending=[];for(const b of this.bands)b.texture.dispose();clearEarthUniforms();}
}

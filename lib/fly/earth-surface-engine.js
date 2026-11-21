import { Box2, Color, DataTexture, Vector2 } from 'three';
import { noDataCountsReady } from './load-guard';
import { EARTH_PALETTE, EARTH_SURFACE, STYLIZED_EARTH, earthPatternPhase } from './stylized-earth';
import { EARTH_UNIFORMS, EARTH_CLASS_LAYOUT, EARTH_APPEARANCE_LAYOUT, clearEarthUniforms, makeEarthAtlas, makeEarthClassAtlas } from './earth-surface-material';
import { acquireCinematicMaterials, releaseCinematicMaterials, updateCinematicMaterials, cinematicMaterialStats, CINEMATIC_MATERIAL_UNIFORMS } from './cinematic-materials';
import { advanceMaterialFrame } from './cinematic-material-frame';
import { painterlyOn } from './painterly-flight';
import { FEATHER_RADIUS, painterlyMaskBlend } from './painterly-mask';
import { cinemaOn } from './cinema-policy';
import { cinemaEnvironment } from './cinema-frame';
import { updateSeaState } from './coastal-water';
import { showcaseEarthOn } from './premium-earth';
import { worldPassRequest, worldPassMatch } from './world-pass'; // WORLD PASS W0
import { SHOWCASE_REGIONS, showcaseRegionAt } from './showcase-policy';
import { showcaseElevationStats } from './showcase-elevation';

const graniteMasks=SHOWCASE_REGIONS.find(r=>r.id==='yosemite-v1').mineralMasks.map(m=>{
 const k=1/Math.cos(m.lat*Math.PI/180);
 return {x:m.lon*Math.PI/180*6378137,z:-6378137*Math.log(Math.tan(Math.PI/4+m.lat*Math.PI/360)),rx:m.radiusXM*k,rz:m.radiusZM*k};
});

const WORLD = 40075016.68557849, mod = (n,d) => ((n%d)+d)%d;

// Sub-rectangle uploads for the packed surface atlases. A slot commit used to
// flag the whole 1024x1536 RGBA + R8 pair (~7.5 MiB) for re-upload, several
// times per band crossing in flight. Each change is now one texSubImage2D of
// its own 128/256 px slot, uploaded from the same CPU array (identical texels).
// Until the renderer has a GPU copy of an atlas, the full upload stands.
const _region = new Box2(), _at = new Vector2();
function markAtlasRect(engine, atlas, x, y, w, h) {
  const dirty = engine._atlasDirty?.get(atlas);
  if (!dirty) { atlas.needsUpdate = true; return; }
  dirty.push(x, y, w, h);
}
function stagingFor(atlas) {
  // Shares the atlas array and is never rendered, so three copies its CPU data
  // (WebGLRenderer.copyTextureToTexture's texSubImage2D branch).
  const image = atlas.image;
  const staging = new DataTexture(image.data, image.width, image.height, atlas.format, atlas.type);
  staging.name = `${atlas.name}-staging`;
  return staging;
}
const colors = EARTH_PALETTE.map(hex => { const c = new Color(hex); return [c.r,c.g,c.b].map(v=>Math.round(v*255)); });
// Write all four appearance bytes as one native word. The byte view defines
// the memory order and uses the same linear palette and rounding as the atlas.
const ink = colors.map((rgb,cls)=>{
  const words=new Uint32Array(256), bytes=new Uint8Array(words.buffer);
  const maxAlpha=cls===EARTH_SURFACE.wetland||cls===EARTH_SURFACE.tidal?90:128;
  for(let v=0;v<256;v++){
    const alpha=cls===EARTH_SURFACE.water?255:64+Math.round((maxAlpha-64)*v/255);
    const weight=Math.min(1,(alpha-64)/64);
    for(let c=0;c<3;c++)bytes[v*4+c]=Math.round(rgb[c]*weight);
    bytes[v*4+3]=alpha;
  }
  return words;
});
const surfaceIds=new WeakMap();
let nextSurfaceId=0;
function surfaceId(mask){
  if(!mask)return 0;
  if(!surfaceIds.has(mask))surfaceIds.set(mask,++nextSurfaceId);
  return surfaceIds.get(mask);
}

// Atlas slots wrap in memory, geography does not. At the residency boundary
// the opposite slot can contain a tile three columns away, not a neighbour.
export function adjacentSurfaceSlot(b,index,dx,dy) {
  const key=b.slots[index].key;
  if(!key)return null;
  const [z,x,y]=key.split('/').map(Number);
  const next=mod(Math.floor(index/4)+dy,4)*4+mod(index%4+dx,4);
  return b.slots[next].key===`${z}/${x+dx}/${y+dy}` ? next : null;
}

/** The runtime is the existing imperative scene bus, not React display state. */
export function publishEarthSurface(runtime, stats) { runtime.earthSurface = stats; }
export function removeEarthSurface(runtime, stats) { if (runtime.earthSurface === stats) runtime.earthSurface = null; }

/** Three independently streamed, toroidal mask bands: 48 slots / 6 MiB / zero draws. */
export class EarthSurfaceEngine {
  constructor(api) {
    this.api=api;this.disposed=false;this.inFlight=0;this.queue=[];this.pending=[];this.lastUpdate=-Infinity;
    this.materialFrame=null;this.materialAt=0;acquireCinematicMaterials();
    this.paint=false;this.repaint=new Set();
    this.classAtlas=makeEarthClassAtlas(EARTH_CLASS_LAYOUT.width,EARTH_CLASS_LAYOUT.height);
    this.appearanceAtlas=makeEarthAtlas(EARTH_APPEARANCE_LAYOUT.width,EARTH_APPEARANCE_LAYOUT.height);
    EARTH_UNIFORMS.uEarthAppearance.value=this.appearanceAtlas;
    EARTH_UNIFORMS.uEarthClasses.value=this.classAtlas;
    this._atlasDirty=new Map([[this.classAtlas,[]],[this.appearanceAtlas,[]]]);
    this._atlasStaging=new Map([[this.classAtlas,stagingFor(this.classAtlas)],[this.appearanceAtlas,stagingFor(this.appearanceAtlas)]]);
    this.bands=STYLIZED_EARTH.bands.map((b,i)=>({ ...b, i, span:WORLD/2**b.z, texture:makeEarthAtlas(b.size*4), classTexture:makeEarthClassAtlas(b.size*4),
      minX:Infinity,minY:Infinity,slots:Array.from({length:16},()=>({key:null,generation:0,state:'empty',retryAt:0})), born:new Float32Array(16).fill(-100) }));
    this.stats={revision:STYLIZED_EARTH.surfaceRevision,ready:0,pending:0,failed:0,noData:0,staleDropped:0,commits:0,waterCells:0,maskBytes:this.bands.reduce((n,b)=>n+b.texture.image.data.byteLength,0),draws:0};
    this.stats.identityBytes=this.bands.reduce((n,b)=>n+b.classTexture.image.data.byteLength,0);this.stats.materials=cinematicMaterialStats;
    this.stats.showcase={region:null,elevation:showcaseElevationStats};
    for(const b of this.bands){EARTH_UNIFORMS[`uEarthMap${b.i}`].value=b.texture;EARTH_UNIFORMS[`uEarthClass${b.i}`].value=b.classTexture;EARTH_UNIFORMS[`uEarthBorn${b.i}`].value=b.born;}
  }

  update(runtime, now) {
    if(this.disposed||!runtime?.flight?.pos)return;
    const f=runtime.flight,anchor=runtime.origin?.anchor??{x:0,z:0};
    const u=EARTH_UNIFORMS;
    u.uEarthOn.value=1;u.uEarthTime.value=now;
    const k=1/Math.max(.09,Math.cos((f.latDeg??0)*Math.PI/180));
    this.materialFrame=advanceMaterialFrame(this.materialFrame,anchor,k,f.pos);
    CINEMATIC_MATERIAL_UNIFORMS.uCinematicMetres.value=1/k;
    u.uEarthMaterialPhase.value.set(this.materialFrame.x,this.materialFrame.z);
    const regional=showcaseEarthOn()?showcaseRegionAt(f.pos.x/6378137*180/Math.PI,f.latDeg):null;
    u.uShowcaseGranite.value=regional?.id==='yosemite-v1'?1:0;
    if(u.uShowcaseGranite.value)for(let i=0;i<4;i++){
      const m=graniteMasks[i];u.uShowcaseCliffs.value[i].set(m.x-anchor.x,m.z-anchor.z,m.rx,m.rz);
    }
    this.stats.showcase.region=regional?.id??null;
    updateCinematicMaterials(now-this.materialAt);this.materialAt=now;
    const paint=painterlyOn();
    if(paint!==this.paint){
      this.paint=paint;
      for(const b of this.bands)for(let i=0;i<16;i++)if(b.slots[i].mask)this.repaint.add(b.i*16+i);
    }
    u.uEarthPattern.value.set(earthPatternPhase(anchor.x),earthPatternPhase(anchor.z),k);
    const s=Math.max(-1,Math.min(1,runtime.sun?.sinEl??1)),az=runtime.sun?.az??0,c=Math.sqrt(1-s*s);
    u.uEarthSun.value.set(-Math.sin(az)*c,s,Math.cos(az)*c);
    const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
    u.uEarthLight.value.set(smooth(-.1,.3,s),1-smooth(-.2,-.02,s),runtime.weather?.wx?.overcastT??0,k);
    if(cinemaOn()){u.uEarthLight.value.set(cinemaEnvironment.day,cinemaEnvironment.night,cinemaEnvironment.overcast,k);u.uEarthSun.value.fromArray(cinemaEnvironment.sunDir);}
    updateSeaState(runtime.weather?.wx);
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
    else if(this.repaint.size){
      const key=this.repaint.values().next().value;this.repaint.delete(key);
      const b=this.bands[Math.floor(key/16)],index=key%16;
      if(b.slots[index].mask)this._writeSlot(b,index,b.slots[index].mask);
    }
    this._pump();
    let ready=0;for(const b of this.bands)for(const slot of b.slots)if(slot.state==='ready')ready++;
    this.stats.ready=ready;
    this.stats.pending=this.queue.length+this.pending.length+this.inFlight;
    const near={total:0,done:0,unavailable:0,ready:false};
    // LOAD_GUARD: OpenFreeMap 404s open ocean; such a slot can never become
    // 'ready', so it counts as done instead of holding the arrival forever.
    const noDataDone=noDataCountsReady();
    const fine=this.bands[2];
    this.stats.nearWaterCells=fine.slots.reduce((n,s)=>n+(s.state==='ready'?(s.mask?.waterCells??0):0),0);
    for(const slot of fine.slots){
      if(!slot.key)continue;
      // Numeric tile coordinates, parsed once per key (not per frame).
      if(slot.coordKey!==slot.key){const [,tx,ty]=slot.key.split('/').map(Number);slot.tx=tx;slot.ty=ty;slot.coordKey=slot.key;}
      const x=slot.tx*fine.span-WORLD/2,z=slot.ty*fine.span-WORLD/2;
      const d=Math.hypot(Math.max(x-f.pos.x,0,f.pos.x-x-fine.span),Math.max(z-f.pos.z,0,f.pos.z-z-fine.span))/k;
      if(d>1000)continue;
      near.total++;if(slot.state==='ready'||noDataDone&&slot.state==='no-data')near.done++;if(slot.state==='error'||slot.state==='no-data')near.unavailable++;
    }
    near.ready=near.total>0&&near.done===near.total;this.stats.near=near;
    this.stats.worldCoverTiles=0;this.stats.worldCoverCells=0;
    for(const b of this.bands)for(const slot of b.slots)if(slot.state==='ready'&&slot.mask?.worldCover?.available){
      this.stats.worldCoverTiles++;this.stats.worldCoverCells+=slot.mask.worldCover.added;
    }
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
        queue.push({b,index,key,x,y,generation:slot.generation,priority:(2-b.i)*8+Math.hypot(dx-1.5,dy-1.5)});
    }
    this.queue=queue.sort((a,b)=>a.priority-b.priority);
  }

  _clearSlot(b,index) {
    b.slots[index].writtenMask=null;
    const data=b.texture.image.data,width=b.size*4,sx=(index%4)*b.size,sy=Math.floor(index/4)*b.size;
    for(let y=0;y<b.size;y++)data.fill(0,((sy+y)*width+sx)*4,((sy+y)*width+sx+b.size)*4);
    for(let y=0;y<b.size;y++)b.classTexture.image.data.fill(0,(sy+y)*width+sx,(sy+y)*width+sx+b.size);
    b.classTexture.needsUpdate=true;
    this._packClassSlot(b,index);
    b.texture.needsUpdate=true;
  }

  _pump() {
    while(!this.disposed&&this.inFlight<STYLIZED_EARTH.maxRequests&&this.queue.length){
      const job=this.queue.shift(),{b,index,x,y}=job,slot=b.slots[index];
      if(slot.key!==job.key||slot.generation!==job.generation||slot.state==='loading'||slot.state==='ready'||slot.state==='no-data')continue;
      if(y<0||y>=2**b.z){slot.state='no-data';continue;}
      slot.state='loading';this.inFlight++;
      this.api.buildTile(b.z,mod(x,2**b.z),y,'earth-surface',{size:b.size,worldPass:worldPassRequest()}).then(result=>{
        if(this.disposed)return;
        if(result.v!==STYLIZED_EARTH.protocol)throw new Error(`Surface worker protocol ${result.v}`);
        if(!worldPassMatch(result))throw new Error('Surface worker built for another World Pass arm'); // WORLD PASS W0
        if(result.surface && result.surface.revision!==STYLIZED_EARTH.surfaceRevision)throw new Error(`Surface mask revision ${result.surface.revision}`);
        this.pending.push({...job,result});
      }).catch(error=>{
        if(!this.disposed&&slot.key===job.key&&slot.generation===job.generation){slot.state='error';slot.retryAt=performance.now()/1000+10;this.stats.failed++;this.stats.lastError={key:job.key,message:String(error?.message??error)};}
      }).finally(()=>{this.inFlight--;});
    }
  }

  _packClassSlot(b,index,x0=0,y0=0,w=b.size,h=b.size){
    const [ox,oy]=EARTH_CLASS_LAYOUT.bands[b.i],sx=(index%4)*b.size,sy=Math.floor(index/4)*b.size;
    const source=b.classTexture.image.data,target=this.classAtlas.image.data;
    for(let y=y0;y<y0+h;y++)target.set(source.subarray((sy+y)*b.size*4+sx+x0,(sy+y)*b.size*4+sx+x0+w),(oy+sy+y)*EARTH_CLASS_LAYOUT.width+ox+sx+x0);
    markAtlasRect(this,this.classAtlas,ox+sx+x0,oy+sy+y0,w,h);
    const rgba=b.texture.image.data,packed=this.appearanceAtlas.image.data;
    for(let y=y0;y<y0+h;y++)packed.set(rgba.subarray(((sy+y)*b.size*4+sx+x0)*4,((sy+y)*b.size*4+sx+x0+w)*4),((oy+sy+y)*this.appearanceAtlas.image.width+ox+sx+x0)*4);
    markAtlasRect(this,this.appearanceAtlas,ox+sx+x0,oy+sy+y0,w,h);
  }

  /** Upload this frame's dirty atlas slots (call before the frame renders). */
  flushAtlases(renderer) {
    if(!this._atlasDirty)return;
    for(const [atlas,dirty] of this._atlasDirty){
      if(!dirty.length)continue;
      if(!renderer?.copyTextureToTexture||!renderer.properties?.has(atlas)||atlas.version===0){
        atlas.needsUpdate=true;dirty.length=0;continue;
      }
      const staging=this._atlasStaging.get(atlas);
      for(let i=0;i<dirty.length;i+=4){
        _region.min.set(dirty[i],dirty[i+1]);_region.max.set(dirty[i]+dirty[i+2],dirty[i+1]+dirty[i+3]);
        renderer.copyTextureToTexture(staging,atlas,_region,_at.set(dirty[i],dirty[i+1]));
      }
      dirty.length=0;
    }
  }

  _commit(job,now) {
    const {b,index,result}=job,slot=b.slots[index];
    if(slot.key!==job.key||slot.generation!==job.generation){this.stats.staleDropped++;return;}
    const mask=result.surface;
    if(!mask){slot.state='no-data';this.stats.noData++;return;}
    slot.state='ready';slot.mask=mask;slot.retryAt=0;b.born[index]=now;
    this._writeSlot(b,index,mask);
    this.repaint.delete(b.i*16+index);
    if(this.paint)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const next=adjacentSurfaceSlot(b,index,dx,dy);
      if(next!==null&&b.slots[next].mask)this.repaint.add(b.i*16+next);
    }
    this.stats.commits++;this.stats.waterCells+=mask.waterCells;
  }

  _writeSlot(b,index,mask) {
    const slot=b.slots[index],id=surfaceId(mask);
    const full=slot.writtenMask!==id||slot.writtenPaint!==this.paint;
    let x0=0,y0=0,w=b.size,h=b.size;
    let blend=mask.blend;
    if(this.paint){
      const neighbors={};
      const feather=Math.min(FEATHER_RADIUS,b.size);
      let left=b.size,top=b.size,right=0,bottom=0;
      slot.paintInputs??=new Float64Array(9);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy){
        const next=adjacentSurfaceSlot(b,index,dx,dy);
        const neighbour=next!==null?b.slots[next].mask:null;
        if(neighbour)neighbors[`${dx},${dy}`]=neighbour;
        const key=(dy+1)*3+dx+1,tag=surfaceId(neighbour);
        if(slot.paintInputs[key]===tag)continue;
        slot.paintInputs[key]=tag;
        // Source masks are immutable. A newly arrived neighbour can only
        // alter the feather within three texels of its shared edge/corner.
        left=Math.min(left,dx>0?b.size-feather:0);
        right=Math.max(right,dx<0?feather:b.size);
        top=Math.min(top,dy>0?b.size-feather:0);
        bottom=Math.max(bottom,dy<0?feather:b.size);
      }
      if(!full){
        if(left>=right||top>=bottom)return;
        x0=left;y0=top;w=right-left;h=bottom-top;
      }
      blend=painterlyMaskBlend(mask,neighbors,x0,y0,w,h);
    }
    slot.writtenMask=id;slot.writtenPaint=this.paint;
    const data=b.texture.image.data,width=b.size*4,sx=(index%4)*b.size,sy=Math.floor(index/4)*b.size;
    const pixels=new Uint32Array(data.buffer,data.byteOffset,data.byteLength/4),ids=b.classTexture.image.data;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const j=(y+y0)*b.size+x+x0,p=(sy+y+y0)*width+sx+x+x0,cls=mask.classes[j];
      const keep=cls!==0&&(mask.exclusion[j]!==255||cls===EARTH_SURFACE.water||cls===EARTH_SURFACE.asphalt||cls===EARTH_SURFACE.concrete);
      ids[p]=keep?cls:0;
      pixels[p]=keep?(ink[cls]??ink[0])[blend[y*w+x]]:ink[0][0];
    }
    b.texture.needsUpdate=true;b.classTexture.needsUpdate=true;
    this._packClassSlot(b,index,x0,y0,w,h);
  }

  dispose(){if(this.disposed)return;this.disposed=true;this.queue=[];this.pending=[];this.repaint.clear();for(const b of this.bands){b.texture.dispose();b.classTexture.dispose();}this.classAtlas.dispose();this.appearanceAtlas.dispose();releaseCinematicMaterials();clearEarthUniforms(this.appearanceAtlas);}
}

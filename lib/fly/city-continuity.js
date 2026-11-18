import { Box2, DataTexture, LinearFilter, RGBAFormat, Vector2 } from 'three';
import { CITY_HEIGHT_BYTES, CITY_HEIGHT_PAD as PAD, CITY_HEIGHT_SIZE as SIZE, CITY_HEIGHT_TILES, decodeCityHeight } from './city-height-grid.mjs';
import { CITY_MASS_UNIFORMS as uniforms, releaseCityMass } from './city-continuity-material.js';

const WORLD = 40075016.68557849, WIDTH = PAD * 4;
const mod = (n, d) => (n % d + d) % d;
const heights = Float32Array.from({ length: 256 }, (_, code) => decodeCityHeight(code));

// The transport sends only a compressed height code per cell. Compute signed
// east/south grades once at upload (metres / true metre), off the render path.
export function packCityMass(codes, tileY) {
  const data = new Uint8Array(CITY_HEIGHT_BYTES * 4);
  let nonzero = 0, maxHeight = 0;
  for (let j = 0; j < PAD; j++) {
    const my = (tileY + (j - .5) / SIZE) / CITY_HEIGHT_TILES;
    const step = WORLD / CITY_HEIGHT_TILES / SIZE / Math.cosh(Math.PI * (1 - 2 * my));
    const north = Math.max(0,j-1)*PAD, south = Math.min(j+1,PAD-1)*PAD;
    for (let i = 0; i < PAD; i++) {
      const p = j * PAD + i, west = Math.max(0,i-1), east = Math.min(PAD-1,i+1);
      const sx = (heights[codes[j*PAD+east]]-heights[codes[j*PAD+west]])/((east-west)*step);
      const sz = (heights[codes[south+i]]-heights[codes[north+i]])/((south-north)/PAD*step);
      data[p*4] = codes[p];
      data[p*4+1] = Math.max(0,Math.min(255,Math.round(128+64*sx)));
      data[p*4+2] = Math.max(0,Math.min(255,Math.round(128+64*sz)));
      data[p*4+3] = 255;
      if(i>0 && i<PAD-1 && j>0 && j<PAD-1 && codes[p]) {
        nonzero++;
        maxHeight = Math.max(maxHeight, heights[codes[p]]);
      }
    }
  }
  return { data, nonzero, maxHeight };
}

export class CityContinuity {
  constructor() {
    this.slots = Array.from({ length: 16 }, () => ({}));
    this.atlas = new DataTexture(new Uint8Array(WIDTH*WIDTH*4), WIDTH, WIDTH, RGBAFormat);
    this.atlas.name = 'GHSL 2018 observed city mass';
    this.atlas.minFilter = this.atlas.magFilter = LinearFilter;
    this.atlas.generateMipmaps = false;
    this.atlas.needsUpdate = true;
    this.stage = new DataTexture(new Uint8Array(CITY_HEIGHT_BYTES*4),PAD,PAD,RGBAFormat);
    this.region = new Box2(new Vector2(0,0),new Vector2(PAD,PAD));
    this.dest = new Vector2();
    this.inFlight = 0;
    this.lastSelect = -Infinity;
    this.stats = { source: 'GHS-BUILT-H AGBH 2018', ready: 0, nonzeroCells: 0, maxHeightM: 0,
      pending: 0, requests: 0, failed: 0, uploads: 0, atlasBytes: WIDTH*WIDTH*4, draws: 0 };
    uniforms.uCityHeight.value = this.atlas;
  }

  update(engine, runtime, renderer, now, tier) {
    const f = runtime.flight, band = engine.bands[0];
    if (!f?.pos || !Number.isFinite(band.minX)) return;
    const span = band.span;
    const minX = Math.round((f.pos.x+WORLD/2)/span)-2;
    const minY = Math.round((f.pos.z+WORLD/2)/span)-2;
    const anchor = runtime.origin?.anchor;
    const cos = 1 / Math.cosh(f.pos.z / 6378137);
    uniforms.uCityGrid.value.set(minX*span-WORLD/2-(anchor?.x??0),minY*span-WORLD/2-(anchor?.z??0),span,cos);
    const skyline = runtime.satSkyline;
    // The dense stand-ins already describe the first kilometres. On tiers
    // with sparse distant geometry, blend in the observed backdrop sooner.
    const dense = skyline?.standInsOn && tier === 'high';
    const start = Math.min(dense ? 3700 : 1700,span*cos*.30);
    const end = Math.min(start+(dense ? 4500 : 2700),span*cos*.72);
    const k = 1-Math.exp(-Math.min(2,now-(this.lastFrame??now))*1.8);
    this.innerStart = this.innerStart==null ? start : this.innerStart+(start-this.innerStart)*k;
    this.innerEnd = this.innerEnd==null ? end : this.innerEnd+(end-this.innerEnd)*k;
    this.lastFrame=now;
    uniforms.uCityLayout.value.set(mod(minX,4),mod(minY,4),this.innerStart,this.innerEnd);
    if (this.minX !== minX || this.minY !== minY || now - this.lastSelect > .35) {
      this.minX = minX; this.minY = minY; this.lastSelect = now;
      const queued = [];
      for (let j=0;j<4;j++) for (let i=0;i<4;i++) {
        const tx=minX+i, ty=minY+j, index=mod(ty,4)*4+mod(tx,4);
        let slot=this.slots[index];
        if(slot.x !== tx || slot.y !== ty) {
          slot.abort?.abort();
          slot=this.slots[index]={ x:tx, y:ty, index, born:Infinity, retryAt:0 };
          uniforms.uCityReady.value[index]=0;
        }
        if(ty<0 || ty>=CITY_HEIGHT_TILES || slot.loaded || slot.waiting || slot.retryAt>now) continue;
        const x=(tx+.5)*span-WORLD/2-f.pos.x, z=(ty+.5)*span-WORLD/2-f.pos.z;
        queued.push({slot,dist:x*x+z*z});
      }
      queued.sort((a,b)=>a.dist-b.dist);
      for(const job of queued) {
        if(this.inFlight>=2) break;
        this.load(job.slot);
      }
    }
    // Upload one slot per frame. The harness and the device report count the
    // actual GPU publications, not successful HTTP responses.
    const next=this.slots.find(slot=>slot.packed);
    if(next) this.upload(next,renderer,now);
    let ready=0, cells=0, tallest=0;
    for (const slot of this.slots) {
      if (!slot.loaded || slot.born===Infinity) continue;
      ready++; cells+=slot.nonzero; tallest=Math.max(tallest,slot.maxHeight);
      const f=Math.max(0,Math.min(1,(now-slot.born)/1.8));
      uniforms.uCityReady.value[slot.index]=f*f*(3-2*f);
    }
    Object.assign(this.stats,{ready,nonzeroCells:cells,maxHeightM:tallest,pending:this.inFlight});
  }

  async load(slot) {
    slot.waiting=true;
    const abort=new AbortController();
    slot.abort=abort;
    const timeout=setTimeout(()=>abort.abort(),22000);
    this.inFlight++;this.stats.requests++;
    try {
      const response=await fetch('/api/city-height?v=1&x='+mod(slot.x,CITY_HEIGHT_TILES)+'&y='+slot.y,{signal:abort.signal,priority:'low'});
      if(!response.ok) throw new Error(String(response.status));
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length!==CITY_HEIGHT_BYTES) throw new Error('Invalid height tile');
      if(this.disposed || this.slots[slot.index]!==slot) return;
      slot.packed=packCityMass(bytes,slot.y);
      slot.loaded=true;
    } catch(error) {
      if(!this.disposed && this.slots[slot.index]===slot) {
        this.stats.failed++;
        slot.retryAt=performance.now()/1000+(error.message==='429'?3:60);
      }
    } finally {
      clearTimeout(timeout);slot.waiting=false;slot.abort=null;this.inFlight--;
    }
  }

  upload(slot,renderer,now) {
    const {data,nonzero,maxHeight}=slot.packed;
    const x=slot.index%4*PAD,y=Math.floor(slot.index/4)*PAD;
    const cpu=this.atlas.image.data;
    for(let r=0;r<PAD;r++) cpu.set(data.subarray(r*PAD*4,(r+1)*PAD*4),((y+r)*WIDTH+x)*4);
    if(renderer.properties.has(this.atlas)) {
      this.stage.image.data=data;
      this.dest.set(x,y);
      renderer.copyTextureToTexture(this.stage,this.atlas,this.region,this.dest);
    } else {
      this.atlas.needsUpdate=true;
      renderer.initTexture(this.atlas);
    }
    this.stats.uploads++;
    Object.assign(slot,{born:now,nonzero,maxHeight,packed:null});
  }

  dispose() {
    this.disposed=true;
    for(const slot of this.slots) slot.abort?.abort();
    releaseCityMass(this.atlas);
    this.atlas.dispose();this.stage.dispose();
  }
}

import { paintSurfacePolygon } from './earth-surface-mask.js';
import { airportSceneryMask } from './airport-scenery-mask';
import { buildAirportSurfaces } from './airport-surfaces';

/** Worker-owned evidence, separate from scatter exclusion. Raster settlement
 * evidence is never used to claim a surveyed footprint or an occupied gate. */
export function deriveWorldContent(vt, mask, span=2445.98490512564, k=1) {
  const {size,classes,exclusion}=mask;
  const settlement = mask.settlement ?? new Uint8Array(size*size);
  const land=vt.layers.landuse;
  if(land)for(let i=0;i<land.length;i++){
    const f=land.feature(i);
    if(f.type===3&&f.properties.class==='residential')paintSurfacePolygon(settlement,size,f.loadGeometry(),land.extent,1);
  }
  const forest=[];
  const airportExclusion=airportSceneryMask(vt,size,span/k);
  // Equal geographic cells; no camera-distance or quality-dependent selection.
  // Partial cells are subdivided, so coastlines and road clearances stay precise.
  const append=(x,y,step)=>{
    let wood=0,clear=0;
    for(let dy=0;dy<step;dy++)for(let dx=0;dx<step;dx++){
      const j=(y+dy)*size+x+dx;
      if(classes[j]===2)wood++;
      if(classes[j]===2&&!exclusion[j]&&!airportExclusion?.[j])clear++;
    }
    if(clear===step*step){forest.push((x+step*.5)/size,(y+step*.5)/size,step/size);return;}
    if(step>4&&wood>0)for(let dy=0;dy<step;dy+=4)for(let dx=0;dx<step;dx+=4)append(x+dx,y+dy,4);
  };
  if(span<3000)for(let y=0;y<size;y+=8)for(let x=0;x<size;x+=8)append(x,y,8);
  mask.settlement=settlement;
  mask.forest=new Float32Array(forest);
  mask.contentRevision=1;
  mask.airport=buildAirportSurfaces(span<3000?vt:{layers:{}},span,k);
  return mask;
}

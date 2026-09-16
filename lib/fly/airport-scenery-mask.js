import { paintSurfacePolygon } from './earth-surface-mask';
/** Conservative scenery exclusion, never a claim about a runway's physical width.
 * Existing map centrelines justify keeping inferred trees away; only actual
 * provider polygons are allowed to create a visible pavement surface.
 */
export function airportSceneryMask(vt,size,trueTileSpan,wholeAirfield=false){
  const layer=vt.layers.aeroway;if(!layer)return null;
  const mask=new Uint8Array(size*size),scale=size/layer.extent;
  for(let i=0;i<layer.length;i++){
    const f=layer.feature(i),cls=f.properties.class;
    if(!['runway','taxiway','apron',...(wholeAirfield?['aerodrome','terminal','hangar']:[])].includes(cls))continue;
    const geometry=f.loadGeometry();
    if(f.type===3){paintSurfacePolygon(mask,size,geometry,layer.extent,255);continue;}
    if(f.type!==2)continue;
    const radius=(cls==='runway'?48:18)*size/Math.max(1,trueTileSpan)+1;
    for(const ring of geometry)for(let j=1;j<ring.length;j++){
      const ax=ring[j-1].x*scale,ay=ring[j-1].y*scale,bx=ring[j].x*scale,by=ring[j].y*scale;
      const dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy;
      for(let y=Math.max(0,Math.floor(Math.min(ay,by)-radius));y<=Math.min(size-1,Math.ceil(Math.max(ay,by)+radius));y++)
        for(let x=Math.max(0,Math.floor(Math.min(ax,bx)-radius));x<=Math.min(size-1,Math.ceil(Math.max(ax,bx)+radius));x++){
          const t=Math.max(0,Math.min(1,((x+.5-ax)*dx+(y+.5-ay)*dy)/Math.max(1e-8,length)));
          if(Math.hypot(x+.5-ax-t*dx,y+.5-ay-t*dy)<=radius)mask[y*size+x]=255;
        }
    }
  }
  return mask;
}

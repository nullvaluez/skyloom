import { LIVING_EARTH } from './living-earth';
const WORLD=40075016.68557849;
/** Test only the local content set, not a global queue which can never be empty
 * while the world streams. Successful empty tiles are complete; errors aren't. */
export function localRingReadiness(engine,flight,radiusM=LIVING_EARTH.readinessRadiusM,zoom=14){
  if(!engine?.chunks||!flight)return{ready:false,total:0,done:0,unavailable:0};
  const k=1/Math.max(.1,Math.cos(flight.latDeg*Math.PI/180));let total=0,done=0,unavailable=0;
  const span=WORLD/2**zoom,radius=radiusM*k,n=2**zoom;
  const x0=Math.floor((flight.pos.x-radius+WORLD/2)/span),x1=Math.floor((flight.pos.x+radius+WORLD/2)/span);
  const y0=Math.max(0,Math.floor((flight.pos.z-radius+WORLD/2)/span)),y1=Math.min(n-1,Math.floor((flight.pos.z+radius+WORLD/2)/span));
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
    const minX=x*span-WORLD/2,minZ=y*span-WORLD/2;
    const d=Math.hypot(Math.max(minX-flight.pos.x,0,flight.pos.x-minX-span),Math.max(minZ-flight.pos.z,0,flight.pos.z-minZ-span))/k;
    if(!Number.isFinite(d)||d>radiusM)continue;
    total++;
    const c=engine.chunks.get(`${zoom}/${((x%n)+n)%n}/${y}`);
    if(c?.state==='ready'||c?.state==='empty'&&c.reason==='zero')done++;
    else if(c?.state==='error'||c?.reason==='no-data')unavailable++;
  }
  return{ready:total>0&&done===total,total,done,unavailable};
}
export function worldReadiness(runtime){
  const rt=runtime??{},earth=rt.earthSurface;
  const buildings=localRingReadiness(rt.satBuildings,rt.flight),roads=localRingReadiness(rt.satRoads,rt.flight,1000,13);
  const agl=(rt.flight?.pos.y??0)-(rt.groundElevVis??rt.flight?.groundElev??0);
  const parts={
    terrain:rt.terraStats?.sharp===true&&(agl>2800||rt.terraStats.camTileZ>=Math.min(15,rt.terraStats.targetZ-1)),
    surfaces:earth?.near?.ready===true,
    materials:earth?.materials?.state==='ready',
    buildings:agl>2800||buildings.ready,
    roads:agl>5000||roads.ready,
    // The geography ring above is complete in every direction. DEM-gated
    // scenery waits for the visible arrival area; behind-camera terrain is
    // intentionally not refined by three-tile. Hidden pending stays reported.
    forest:earth?.forest!=null&&earth.forest.nearPending===0&&earth.forest.sourceCommit===earth.commits,
    airports:earth?.airports!=null&&earth.airports.nearPending===0,
    fleet:rt.modelsReady===true&&rt.liveFleetReady===true,
    shaders:rt.prewarm?.done===true,
  };
  const missing=Object.keys(parts).filter(k=>!parts[k]);
  return{ready:missing.length===0,missing,parts,buildings,roads,progress:(Object.keys(parts).length-missing.length)/Object.keys(parts).length};
}

/** Re-arm provider errors without clearing successful world evidence or caches. */
export function retryWorldContent(runtime){
  for(const engine of [runtime.satBuildings,runtime.satRoads,runtime.satVeg]){
    for(const chunk of engine?.chunks?.values?.()??[])if(chunk.state==='error'||chunk.reason==='no-data'){
      chunk.retryAt=0;chunk.nextTryAt=0;chunk.attempts=0;
    }
  }
  runtime.retryEarthSurface?.();runtime.retryLiveFleet?.();
}

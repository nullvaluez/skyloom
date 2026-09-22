// Refine after the worker/cache boundary so previously cached pavement receives
// the same fix. All UVs and surface classes follow the split; paint stays put.
export const PAVEMENT_CLEARANCE_M = .65;
export function refinePavement(payload, metricScale = 1, edgeM = 24) {
  const pos=[],uv=[],style=[],limit=edgeM*metricScale;
  const read=i=>[payload.pos[i*3],payload.pos[i*3+2],payload.uv[i*2],payload.uv[i*2+1],payload.style[i*2],payload.style[i*2+1]];
  const emit=(a,b,c,depth=0)=>{
    const points=[a,b,c],lengths=points.map((p,i)=>Math.hypot(p[0]-points[(i+1)%3][0],p[1]-points[(i+1)%3][1]));
    const longest=lengths.indexOf(Math.max(...lengths));
    if(lengths[longest]>limit&&depth<12) {
      const p=points[longest],q=points[(longest+1)%3],r=points[(longest+2)%3],mid=p.map((v,i)=>(v+q[i])/2);
      emit(p,mid,r,depth+1);emit(mid,q,r,depth+1);return;
    }
    for(const p of points){pos.push(p[0],0,p[1]);uv.push(p[2],p[3]);style.push(p[4],p[5]);}
  };
  for(let i=0;i<payload.pos.length/3;i+=3){
    // Satellite imagery already supplies terrain-conforming streets. A second
    // opaque ribbon duplicates that surface and clips across changing DEM LOD.
    // Keep mapped runways/taxiways/aprons (classes 1–3); night road lighting
    // and traffic use their own geometry and are unaffected by this filter.
    if(payload.style[i*2]>=3.5)continue;
    emit(read(i),read(i+1),read(i+2));
  }
  return {...payload,pos:new Float32Array(pos),uv:new Float32Array(uv),style:new Float32Array(style)};
}

/** Rise immediately above arriving terrain; only downward corrections ease.
 * Interpolating upward from stale ground guarantees many buried frames. */
export function pavementHeight(previous, elevation, repair) {
  const target=elevation+PAVEMENT_CLEARANCE_M;
  return repair&&Number.isFinite(previous)&&previous>target?previous+(target-previous)*.25:target;
}

export function pavementSampleAccepted(support, ground) {
  // A coarser resident tile can be HIGHER than the previous fine mesh. Refusing
  // that correction leaves asphalt buried until the same zoom returns. Permit
  // upward corrections at any usable zoom, but never descend into a fallback.
  return Number.isFinite(ground?.elev)&&ground.tileZ>=14&&
    (ground.tileZ>=(support.zoom||0)||ground.elev>support.height);
}

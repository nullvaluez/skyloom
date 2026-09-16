/* Read the renderer's recorded drape heights, not roof vertices: min_height
 * legitimately elevates a building part and is not a terrain-contact error. */
function cinematicSupportCensus(){
 const rt=window.__fly,rows=[];
 for(const name of ['satBuildings','satSkyline']){
  const candidates=[];
  for(const [,c] of rt[name]?.chunks??[]){
   if(!c.mesh)continue;
   if(name==='satBuildings')for(const r of c.drapeRuns??[])candidates.push({x:c.cx+r.ax,z:c.cz+r.az,y:r.ground,zoom:r.zoom});
   else if(c.drape)for(const r of c.drape.runs)candidates.push({x:c.drape.minX+r.x*c.drape.step,z:c.drape.minZ+r.z*c.drape.step,y:r.ground,zoom:10});
  }
  candidates.sort((a,b)=>Math.hypot(a.x-rt.flight.pos.x,a.z-rt.flight.pos.z)-Math.hypot(b.x-rt.flight.pos.x,b.z-rt.flight.pos.z));
  // One nearest lane and a spatial spread across the rest of the resident set.
  const selected=[...candidates.slice(0,16),...candidates.filter((_,i)=>i>=16&&i%Math.max(1,Math.floor(candidates.length/16))===0).slice(0,16)];
  for(const r of selected){const g=rt.engine.getGroundAt(r.x/6378137*180/Math.PI,(2*Math.atan(Math.exp(-r.z/6378137))-Math.PI/2)*180/Math.PI);if(g&&g.tileZ>=10&&Number.isFinite(g.elev))rows.push({layer:name,errorM:r.y-g.elev,ground:g.elev,height:r.y,tileZ:g.tileZ,x:r.x,z:r.z});}
 }
 return{samples:rows.length,maxErrorM:Math.max(0,...rows.map(r=>Math.abs(r.errorM))),worst:rows.sort((a,b)=>Math.abs(b.errorM)-Math.abs(a.errorM)).slice(0,8)};
}
module.exports={cinematicSupportCensus};

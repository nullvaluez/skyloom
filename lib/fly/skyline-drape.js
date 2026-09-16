/** Fill only from measured terrain in this geographic group. The player's
 * previous-region altitude is never evidence about an unstreamed destination.
 */
export function fillSkylineGrid(grid,zoom,n){
  const valid=[];for(let i=0;i<grid.length;i++)if(zoom[i]>0&&Number.isFinite(grid[i]))valid.push(i);
  if(!valid.length)return false;
  const width=n+1;
  for(let i=0;i<grid.length;i++)if(!zoom[i]){
    let best=valid[0],distance=Infinity;
    for(const j of valid){const d=(i%width-j%width)**2+(Math.floor(i/width)-Math.floor(j/width))**2;if(d<distance){best=j;distance=d;}}
    grid[i]=grid[best];
  }return true;
}
export function skylineHeight(grid,n,x,y){
  const fx=Math.max(0,Math.min(n,x)),fy=Math.max(0,Math.min(n,y)),ix=Math.min(n-1,Math.floor(fx)),iy=Math.min(n-1,Math.floor(fy));
  const tx=fx-ix,ty=fy-iy,w=n+1;
  return (grid[iy*w+ix]*(1-tx)+grid[iy*w+ix+1]*tx)*(1-ty)+(grid[(iy+1)*w+ix]*(1-tx)+grid[(iy+1)*w+ix+1]*tx)*ty;
}
/** Whole-building translations retain min_height, normals and roof shape. */
export function applySkylineDrape(chunk){
  const d=chunk.drape,geometry=chunk.mesh.geometry,p=geometry.attributes.position;let changed=false,maxDisplacement=0;
  for(const run of d.runs){
    const y=skylineHeight(d.grid,d.n,run.x,run.z),delta=y-run.ground;
    if(Math.abs(delta)<.02)continue;
    for(let i=run.start;i<run.end;i++)p.array[i*3+1]+=delta;
    run.ground=y;maxDisplacement=Math.max(maxDisplacement,Math.abs(y-run.initialGround));changed=true;
  }
  if(changed){p.needsUpdate=true;d.maxDisplacement=Math.max(d.maxDisplacement??0,maxDisplacement);if(geometry.boundingSphere)geometry.boundingSphere.radius=d.baseRadius+d.maxDisplacement;}
  return changed;
}

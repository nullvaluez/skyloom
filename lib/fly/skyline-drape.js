/** Fill only from measured terrain in this geographic group. The player's
 * previous-region altitude is never evidence about an unstreamed destination.
 */
export function fillSkylineGrid(grid, zoom, n) {
  let measured = 0, missing = 0;
  for (let i = 0; i < grid.length; i++) {
    if (!zoom[i]) missing++;
    else if (Number.isFinite(grid[i])) measured++;
  }
  if (!measured) return false;
  if (!missing) return true;

  // At a given x, only the closest measured column from each row can win.
  // Preserve row-major ties (upper row, then left column). On a partly
  // streamed 33x33 canopy grid this bounds a hole's search to 33 candidates.
  const width = n + 1;
  const column = new Int32Array(grid.length);
  for (let row = 0; row < grid.length; row += width) {
    let left = -1, right = -1;
    for (let x = 0; x < width; x++) {
      if (zoom[row + x] && Number.isFinite(grid[row + x])) left = x;
      column[row + x] = left;
    }
    for (let x = width - 1; x >= 0; x--) {
      if (zoom[row + x] && Number.isFinite(grid[row + x])) right = x;
      const prev = column[row + x];
      if (right >= 0 && (prev < 0 || right - x < x - prev)) column[row + x] = right;
    }
  }
  for (let i = 0; i < grid.length; i++) {
    if (zoom[i]) continue;
    const x = i % width, y = Math.floor(i / width);
    let best = -1, distance = Infinity;
    for (let row = 0; row < width; row++) {
      const nearest = column[row * width + x];
      if (nearest < 0) continue;
      const d = (row - y) ** 2 + (nearest - x) ** 2;
      if (d < distance) { distance = d; best = row * width + nearest; }
    }
    grid[i] = grid[best];
  }
  return true;
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

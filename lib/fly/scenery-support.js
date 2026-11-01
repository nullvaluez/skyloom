/** Conservative maximum slope of an existing drape cell. No extra terrain
 * queries: both opposite edges matter when a cell crosses a valley wall. */
export function canopyCellSlope(grid,segments,span,x,z,mercatorK=1){
 if(!grid||!(span>0))return Infinity;
 const ix=Math.max(0,Math.min(segments-1,Math.floor((x/span+.5)*segments)));
 const iz=Math.max(0,Math.min(segments-1,Math.floor((z/span+.5)*segments)));
 const width=segments+1,i=iz*width+ix,a=grid[i],b=grid[i+1],c=grid[i+width],d=grid[i+width+1];
 if(![a,b,c,d].every(Number.isFinite))return Infinity;
 return Math.hypot(Math.max(Math.abs(b-a),Math.abs(d-c)),Math.max(Math.abs(c-a),Math.abs(d-b)))/(span/segments/mercatorK);
}
export function forestSupport(ground,xSupport,zSupport,reachM){
 if(![ground,xSupport,zSupport,reachM].every(Number.isFinite)||reachM<=0)return null;
 return {allowed:Math.hypot(xSupport-ground,zSupport-ground)/reachM<=.65,height:Math.min(ground,xSupport,zSupport)};
}

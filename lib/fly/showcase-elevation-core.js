import Martini from '@mapbox/martini';
const WORLD=40075016.68557849;
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
export function elevationTileBounds(x,y,z){const span=WORLD/2**z;return [x*span-WORLD/2,WORLD/2-(y+1)*span,(x+1)*span-WORLD/2,WORLD/2-y*span];}
export function elevationOverlap(a,b){return a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];}
export function sampleElevation(field,x,y){
 const {bounds:b,width,height,data}=field;
 if(x<b[0]||x>b[2]||y<b[1]||y>b[3])return null;
 // GeoTIFF area pixels, north-first. Half-pixel registration matters at seams.
 const px=Math.max(0,Math.min(width-1,(x-b[0])/(b[2]-b[0])*width-.5));
 const py=Math.max(0,Math.min(height-1,(b[3]-y)/(b[3]-b[1])*height-.5));
 const ix=Math.min(width-2,Math.floor(px)),iy=Math.min(height-2,Math.floor(py)),fx=px-ix,fy=py-iy;
 const i=iy*width+ix,a=data[i],c=data[i+width],d=data[i+width+1],v=data[i+1];
 if([a,v,c,d].some(n=>n===65535))return null;
 return ((a+(v-a)*fx)*(1-fy)+(c+(d-c)*fx)*fy)*.1;
}
export function elevationBlendWeight(bounds,x,y,edgeM){
 return smooth(Math.min(x-bounds[0],bounds[2]-x,y-bounds[1],bounds[3]-y)/edgeM);
}

/** Bucketed vertical sampling of the original surface. Skirt triangles have
 * zero XY area and are ignored. Used only in the regional feather, never per frame. */
function originalSampler(pos,index){
 const n=16,buckets=Array.from({length:n*n},()=>[]),tris=[];
 const cell=v=>Math.max(0,Math.min(n-1,Math.floor((v+.5)*n)));
 for(let i=0;i<index.length;i+=3){
  const a=index[i]*3,b=index[i+1]*3,c=index[i+2]*3;
  const det=(pos[b+1]-pos[c+1])*(pos[a]-pos[c])+(pos[c]-pos[b])*(pos[a+1]-pos[c+1]);
  if(Math.abs(det)<1e-14)continue;
  const t={a,b,c,det};tris.push(t);
  for(let y=cell(Math.min(pos[a+1],pos[b+1],pos[c+1]));y<=cell(Math.max(pos[a+1],pos[b+1],pos[c+1]));y++)
   for(let x=cell(Math.min(pos[a],pos[b],pos[c]));x<=cell(Math.max(pos[a],pos[b],pos[c]));x++)buckets[y*n+x].push(t);
 }
 return(x,y)=>{
  for(const {a,b,c,det}of buckets[cell(y)*n+cell(x)]){
   const u=((pos[b+1]-pos[c+1])*(x-pos[c])+(pos[c]-pos[b])*(y-pos[c+1]))/det;
   const v=((pos[c+1]-pos[a+1])*(x-pos[c])+(pos[a]-pos[c])*(y-pos[c+1]))/det,w=1-u-v;
   if(u>=-1e-6&&v>=-1e-6&&w>=-1e-6)return u*pos[a+2]+v*pos[b+2]+w*pos[c+2];
  }
  throw Error('Regional elevation could not sample original terrain');
 };
}

export function buildRegionalElevation({x,y,z,position,index,field,edgeM=1200,maxTriangles=4096}){
 const bounds=elevationTileBounds(x,y,z),span=bounds[2]-bounds[0],gridSize=z>=15?65:129,side=gridSize-1;
 const dem=new Float32Array(gridSize*gridSize),original=originalSampler(position,index);
 const elevation=(wx,wy)=>{
  const local=sampleElevation(field,wx,wy),weight=local===null?0:elevationBlendWeight(field.bounds,wx,wy,edgeM);
  if(weight>=.999999)return local;
  const h=original((wx-bounds[0])/span-.5,(wy-bounds[1])/span-.5);
  return h+((local??h)-h)*weight;
 };
 for(let row=0;row<gridSize;row++)for(let col=0;col<gridSize;col++){
  const u=col/side,v=row/side,wx=bounds[0]+u*span,wy=bounds[3]-v*span;
  dem[row*gridSize+col]=elevation(wx,wy);
 }
 const tile=new Martini(gridSize).createTile(dem);let error=z>=15?.7:z===14?1.4:3,mesh=tile.getMesh(error);
 while(mesh.triangles.length/3>maxTriangles&&error<2048){error*=1.35;mesh=tile.getMesh(error);}
 const p=new Float32Array(mesh.vertices.length/2*3),uv=new Float32Array(mesh.vertices.length),normal=new Float32Array(p.length);
 for(let i=0;i<mesh.vertices.length/2;i++){
  const col=mesh.vertices[i*2],row=mesh.vertices[i*2+1];p[i*3]=col/side-.5;p[i*3+1]=.5-row/side;p[i*3+2]=dem[row*gridSize+col];uv[i*2]=col/side;uv[i*2+1]=1-row/side;
 }
 // Different Martini triangles on opposite sides of a tile border must not
 // produce different cliff shading. Differentiate the same continuous field
 // at its source-pixel spacing, independently of the selected triangle LOD.
 const delta=Math.max((field.bounds[2]-field.bounds[0])/field.width,(field.bounds[3]-field.bounds[1])/field.height);
 for(let i=0;i<p.length;i+=3){
  const wx=bounds[0]+(p[i]+.5)*span,wy=bounds[1]+(p[i+1]+.5)*span;
  const interior=elevationBlendWeight(field.bounds,wx,wy,edgeM)>.999999;
  const x0=interior?wx-delta:Math.max(bounds[0],wx-delta),x1=interior?wx+delta:Math.min(bounds[2],wx+delta);
  const y0=interior?wy-delta:Math.max(bounds[1],wy-delta),y1=interior?wy+delta:Math.min(bounds[3],wy+delta);
  // Interior taps stay in the regional field. Edge taps stay in the base tile.
  const heightAt=interior?(x,y)=>sampleElevation(field,x,y):elevation;
  const nx=-(heightAt(x1,wy)-heightAt(x0,wy))*span/(x1-x0),ny=-(heightAt(wx,y1)-heightAt(wx,y0))*span/(y1-y0),length=Math.hypot(nx,ny,1);
  normal[i]=nx/length;normal[i+1]=ny/length;normal[i+2]=1/length;
 }
 return {attributes:{position:{value:p,size:3},texcoord:{value:uv,size:2},normal:{value:normal,size:3}},indices:mesh.triangles,dem,gridSize,error};
}

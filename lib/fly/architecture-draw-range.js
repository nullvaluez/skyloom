import { guardIndex } from './toy-world/flash-guard';
import { Box3, Frustum, Matrix4, Vector2, Vector3 } from 'three';
import { getBend } from './toy-world/world-bend';
import { bendWorldBounds } from './bent-bounds';

/** Spatial index ranges share the same vertex buffers. Splitting only
 * auxiliary indices lets cascades reject empty tile quadrants without adding
 * ordinary color draws or changing any triangle/normal/drape attribute. */
export function partitionArchitectureIndex(index, position, count, anchors) {
  if (!Number.isInteger(count) || !count) return { index, regions: [] };
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(let i=0;i<count;i++){const v=index[i]*3;minX=Math.min(minX,position[v]);maxX=Math.max(maxX,position[v]);minZ=Math.min(minZ,position[v+2]);maxZ=Math.max(maxZ,position[v+2]);}
  const grid=4,sx=grid/Math.max(1,maxX-minX),sz=grid/Math.max(1,maxZ-minZ);
  const bucket=i=>{const a=index[i]*3,b=index[i+1]*3,c=index[i+2]*3;
    const x=Math.min(grid-1,Math.max(0,Math.floor(((position[a]+position[b]+position[c])/3-minX)*sx)));
    const z=Math.min(grid-1,Math.max(0,Math.floor(((position[a+2]+position[b+2]+position[c+2])/3-minZ)*sz)));
    return z*grid+x;
  };
  const counts=Array(grid*grid).fill(0);for(let i=0;i<count;i+=3)counts[bucket(i)]+=3;
  let offset=0;
  const regions=counts.map(n=>{const r={start:offset,count:n,bounds:new Box3(),anchors:anchors?new Box3():null};offset+=n;return r;});
  const write=regions.map(r=>r.start),result=new index.constructor(index.length);
  for(let i=0;i<count;i+=3){const b=bucket(i),box=regions[b].bounds;
    for(let j=0;j<3;j++){const v=index[i+j]*3;result[write[b]++]=index[i+j];
      box.min.x=Math.min(box.min.x,position[v]);box.max.x=Math.max(box.max.x,position[v]);
      box.min.y=Math.min(box.min.y,position[v+1]);box.max.y=Math.max(box.max.y,position[v+1]);
      box.min.z=Math.min(box.min.z,position[v+2]);box.max.z=Math.max(box.max.z,position[v+2]);
      if(anchors){const box=regions[b].anchors,a=index[i+j]*2;
        box.min.x=Math.min(box.min.x,anchors[a]);box.max.x=Math.max(box.max.x,anchors[a]);
        box.min.z=Math.min(box.min.z,anchors[a+1]);box.max.z=Math.max(box.max.z,anchors[a+1]);box.min.y=box.max.y=0;
      }
    }
  }
  result.set(index.subarray(count),count);
  return {index:result,regions:regions.filter(r=>r.count).map(r=>({...r,minY:r.bounds.min.y,maxY:r.bounds.max.y}))};
}

/** Contact repairs publish their largest displacement from the original
 * geometry. Padding each region by that displacement is conservative without
 * giving every low-rise block the height of the tile's tallest skyscraper. */
export function padArchitectureRegionHeights(geometry,down,up) {
  for(const region of geometry.userData.architectureRegions??[]){
    region.bounds.min.y=region.minY+Math.min(0,down);
    region.bounds.max.y=region.maxY+Math.max(0,up);
  }
}

/** A complete legacy redrape replaces the original height reference. */
export function refreshArchitectureRegionHeights(geometry) {
  const index=geometry.index?.array,position=geometry.attributes.position?.array;
  if(!index||!position)return;
  for(const region of geometry.userData.architectureRegions??[]){
    let min=Infinity,max=-Infinity;
    for(let i=region.start;i<region.start+region.count;i++){
      const y=position[index[i]*3+1];min=Math.min(min,y);max=Math.max(max,y);
    }
    region.minY=region.bounds.min.y=min;region.maxY=region.bounds.max.y=max;
  }
}

/** Preserve the solid/detail boundary through in-place degenerate removal.
 * No extra index allocation; both ranges retain the transferred buffer. */
export function guardArchitectureIndex(index, position, auxiliaryCount) {
  if (!Number.isInteger(auxiliaryCount) || auxiliaryCount < 0 || auxiliaryCount > index.length || auxiliaryCount % 3) {
    return { ...guardIndex(index, position), auxiliaryCount: null };
  }
  const body = guardIndex(index.subarray(0, auxiliaryCount), position);
  const detail = guardIndex(index.subarray(auxiliaryCount), position);
  index.set(detail.idx, body.idx.length);
  return { idx: index.subarray(0, body.idx.length + detail.idx.length),
    dropped: body.dropped + detail.dropped, auxiliaryCount: body.idx.length };
}

/** The ordinary color pass keeps the complete mesh. Its shadow uses the
 * mapped body and roof, sharing positions/drape/bend and the same GPU index. */
export function installArchitectureShadowRange(mesh) {
  const geometry = mesh.geometry;
  const count = geometry.userData.auxiliaryIndexCount;
  if (!Number.isInteger(count)) return;
  geometry.computeBoundingBox();
  const bounds = new Box3(), anchorWorld = new Box3(), allAnchors = new Box3(), frustum = new Frustum(), projection = new Matrix4();
  for(const r of geometry.userData.architectureRegions??[])if(r.anchors)allAnchors.union(r.anchors);
  const eye = new Vector3(), size = new Vector2();
  const inView = (camera, localBounds=geometry.boundingBox, anchorBounds=allAnchors) => {
    if (!camera) return true;
    bounds.copy(localBounds).applyMatrix4(mesh.matrixWorld);
    if(anchorBounds&&!anchorBounds.isEmpty()){
      anchorWorld.copy(anchorBounds).applyMatrix4(mesh.matrixWorld);
      bendWorldBounds(bounds,anchorWorld,getBend());
    }else bounds.min.y -= mesh.userData.bendMarginM || 0;
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection, camera.coordinateSystem, camera.reversedDepth);
    return frustum.intersectsBox(bounds);
  };
  const drawRegions = (renderer, scene, camera, material, regions) => {
    let drawStart=0,drawCount=0;
    for(const region of regions){
      // The drape owner updates these bounds with the position buffer.
      if(inView(camera,region.bounds,region.anchors)){
        if(!drawCount)drawStart=region.start;
        drawCount+=region.count;
        continue;
      }
      if(!drawCount)continue;
      geometry.setDrawRange(drawStart,drawCount);
      renderer.renderBufferDirect(camera,scene,geometry,material,mesh,null);
      drawCount=0;
    }
    if(drawCount){geometry.setDrawRange(drawStart,drawCount);renderer.renderBufferDirect(camera,scene,geometry,material,mesh,null);}
  };
  let start = 0, length = Infinity;
  mesh.onBeforeShadow = (renderer, _object, _camera, shadowCamera, _geometry, material) => {
    start = geometry.drawRange.start; length = geometry.drawRange.count;
    // Tile spheres admit whole neighbouring city tiles into every cascade.
    // This conservative box only rejects geometry outside the real frustum.
    const regions=geometry.userData.architectureRegions;
    if(renderer&&shadowCamera&&regions?.length){
      // Adjacent visible regions form one draw. A fully visible tile costs
      // exactly one submission, while partial cascades keep only their rows.
      try{drawRegions(renderer,null,shadowCamera,material,regions);}
      finally{geometry.setDrawRange(start,length);}
      // The standard shadow dispatch follows this hook. All surviving ranges
      // were already drawn, so it must submit no second copy.
      geometry.setDrawRange(0,0);
    }else geometry.setDrawRange(0, inView(shadowCamera) ? count : 0);
  };
  mesh.onAfterShadow = () => geometry.setDrawRange(start, length);
  let colorStart = 0, colorLength = Infinity;
  let trimVisible = true;
  mesh.onBeforeRender = (renderer, scene, camera, _geometry, material) => {
    colorStart = geometry.drawRange.start; colorLength = geometry.drawRange.count;
    if (!inView(camera)) geometry.setDrawRange(0, 0);
    else if(renderer&&camera.isPerspectiveCamera&&colorLength>count){
      camera.getWorldPosition(eye);renderer.getDrawingBufferSize(size);
      const distance=Math.max(1,bounds.distanceToPoint(eye));
      // The widest ledge is 0.5 m. Retire it only below a pixel; metre-scale
      // roof forms stay in the body range. Hysteresis prevents boundary chatter.
      const pixels=.5*size.y/(2*Math.tan(camera.fov*Math.PI/360)*distance);
      if(pixels<1.)trimVisible=false;else if(pixels>1.5)trimVisible=true;
      if(!trimVisible)geometry.setDrawRange(0,count);
    }
    const regions=geometry.userData.architectureRegions;
    if(geometry.drawRange.count===count&&regions?.length&&renderer?.renderBufferDirect&&material===mesh.material&&!material.transparent){
      // WebGLRenderer computes these after the object callback. Auxiliary
      // region submissions must initialize the same transforms first.
      mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld);
      mesh.normalMatrix.getNormalMatrix(mesh.modelViewMatrix);
      material.onBeforeRender(renderer,scene,camera,geometry,mesh,null);
      try{drawRegions(renderer,scene,camera,material,regions);}
      finally{geometry.setDrawRange(colorStart,colorLength);}
      geometry.setDrawRange(0,0);
    }
  };
  mesh.onAfterRender = () => geometry.setDrawRange(colorStart, colorLength);
}

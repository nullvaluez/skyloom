import { Box3, Frustum, Matrix4 } from 'three';
import { getBend } from './toy-world/world-bend';

/** Conservative envelope of y -= distance(anchor.xz, centre)^2 * k.
 * Anchor bounds are separate: a building's centroid can lie outside one of
 * its wall triangles. A metre covers float32 projection/position rounding. */
export function bendWorldBounds(bounds, anchors, bend) {
  const nearX=Math.max(anchors.min.x-bend.cx,0,bend.cx-anchors.max.x);
  const nearZ=Math.max(anchors.min.z-bend.cz,0,bend.cz-anchors.max.z);
  const farX=Math.max(Math.abs(anchors.min.x-bend.cx),Math.abs(anchors.max.x-bend.cx));
  const farZ=Math.max(Math.abs(anchors.min.z-bend.cz),Math.abs(anchors.max.z-bend.cz));
  const a=(nearX*nearX+nearZ*nearZ)*bend.k,b=(farX*farX+farZ*farZ)*bend.k;
  bounds.min.y-=Math.max(a,b)+1;
  bounds.max.y-=Math.min(a,b)-1;
  return bounds;
}

/** Each pass tests its own camera; offscreen trees may still cast a visible
 * shadow. Retain all instances/history and restore count after every pass. */
export function installBentInstanceCulling(mesh,localBounds) {
  const bounds=new Box3(),projection=new Matrix4(),frustum=new Frustum();
  const visible=camera=>{
    if(!camera||localBounds.isEmpty())return true;
    bounds.copy(localBounds).applyMatrix4(mesh.matrixWorld);
    bendWorldBounds(bounds,bounds,getBend());
    projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection,camera.coordinateSystem,camera.reversedDepth);
    return frustum.intersectsBox(bounds);
  };
  let colorCount=0,shadowCount=0;
  mesh.onBeforeRender=(_renderer,_scene,camera)=>{colorCount=mesh.count;if(!visible(camera))mesh.count=0;};
  mesh.onAfterRender=()=>{mesh.count=colorCount;};
  mesh.onBeforeShadow=(_renderer,_object,_camera,shadowCamera)=>{shadowCount=mesh.count;if(!visible(shadowCamera))mesh.count=0;};
  mesh.onAfterShadow=()=>{mesh.count=shadowCount;};
}

import { Frustum, Matrix4, Sphere, Vector3 } from 'three';

/** Admission still requires real DEM support. Arrival waits only for scenery
 * intersecting the camera's view: three-tile does not refine behind the camera.
 * The conservative sphere includes crown height and the entire source cell. */
export class GroundSupportView {
  constructor(){this.frustum=new Frustum();this.matrix=new Matrix4();this.sphere=new Sphere(new Vector3(),1);this.anchor={x:0,z:0};this.active=false;}
  update(runtime){
    const c=runtime.camera;this.active=!!(c?.projectionMatrix&&c?.matrixWorldInverse);
    if(!this.active)return;
    this.anchor=runtime.origin?.anchor??{x:0,z:0};
    this.matrix.multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.matrix,c.coordinateSystem,c.reversedDepth);
  }
  visible(x,z,elevation,radius=80){
    if(!this.active)return true;
    this.sphere.center.set(x-this.anchor.x,elevation,z-this.anchor.z);this.sphere.radius=radius;
    return this.frustum.intersectsSphere(this.sphere);
  }
}

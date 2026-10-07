import { Vector3, Quaternion } from 'three';
/** Blend only camera poses; flight input stays live. Absolute coordinates
 * avoid rebase jumps, and a warp epoch cancels interpolation immediately. */
export class CameraTransition {
  constructor(){this.position=new Vector3();this.rotation=new Quaternion();this.from=new Vector3();this.fromQ=new Quaternion();this.ready=false;this.elapsed=1;}
  update(camera,mode,epoch,dt,reduced=false){
    if(!this.ready||this.epoch!==epoch){this.ready=true;this.elapsed=1;this.mode=mode;}
    else if(this.mode!==mode){this.from.copy(this.position);this.fromQ.copy(this.rotation);this.fromFov=this.fov;this.elapsed=0;this.mode=mode;}
    this.epoch=epoch;this.elapsed=Math.min(1,this.elapsed+Math.min(dt,.05)/.65);
    if(!reduced&&this.elapsed<1){const t=this.elapsed*this.elapsed*(3-2*this.elapsed);camera.position.lerpVectors(this.from,camera.position,t);camera.quaternion.slerpQuaternions(this.fromQ,camera.quaternion,t);camera.fov=this.fromFov+(camera.fov-this.fromFov)*t;camera.updateProjectionMatrix();}
    this.position.copy(camera.position);this.rotation.copy(camera.quaternion);this.fov=camera.fov;
  }
}

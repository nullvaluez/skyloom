import { Vector3, Quaternion } from 'three';
/** Blend only camera poses; flight input stays live. Absolute coordinates
 * avoid rebase jumps, and a warp epoch cancels interpolation immediately. */
export class CameraTransition {
  constructor(){this.position=new Vector3();this.rotation=new Quaternion();this.from=new Vector3();this.fromQ=new Quaternion();this.ready=false;this.elapsed=1;this.duration=.65;this.ease='smooth';this.started=false;}
  /** GATE TO GATE: blend from an explicit pose (a director cut, the lounge glide)
   * over sec seconds. ease 'smooth' (smoothstep, the default blend) or
   * 'smoother' (smootherstep). The next update() blends from this pose even
   * across a mode or warp-epoch change. */
  start(fromPose,sec=.65,ease='smooth'){this.from.copy(fromPose.position);this.fromQ.copy(fromPose.quaternion);this.fromFov=fromPose.fov??this.fov;this.elapsed=0;this.duration=sec;this.ease=ease;this.started=true;}
  update(camera,mode,epoch,dt,reduced=false){
    if(this.started){this.started=false;this.ready=true;this.mode=mode;}
    else if(!this.ready||this.epoch!==epoch){this.ready=true;this.elapsed=1;this.mode=mode;this.duration=.65;this.ease='smooth';}
    else if(this.mode!==mode){this.from.copy(this.position);this.fromQ.copy(this.rotation);this.fromFov=this.fov;this.elapsed=0;this.mode=mode;this.duration=.65;this.ease='smooth';}
    this.epoch=epoch;this.elapsed=Math.min(1,this.elapsed+Math.min(dt,.05)/this.duration);
    if(!reduced&&this.elapsed<1){const e=this.elapsed,t=this.ease==='smoother'?e*e*e*(e*(e*6-15)+10):e*e*(3-2*e);camera.position.lerpVectors(this.from,camera.position,t);camera.quaternion.slerpQuaternions(this.fromQ,camera.quaternion,t);camera.fov=this.fromFov+(camera.fov-this.fromFov)*t;camera.updateProjectionMatrix();}
    this.position.copy(camera.position);this.rotation.copy(camera.quaternion);this.fov=camera.fov;
  }
}

import { Euler, Vector2, Vector3, Vector4 } from 'three';

/** Two projected engine corridors. Reuses the cloud composite; no extra target,
 * draw, history, or scene-depth feedback. Nearer opaque hulls are never warped. */
export class ExhaustHeat {
  constructor() {
    this.uniforms = {
      cinemaHeatA: { value: new Vector4() }, cinemaHeatB: { value: new Vector4() },
      cinemaHeatDepth: { value: new Vector2() }, cinemaHeatPower: { value: 0 },
      cinemaHeatTime: { value: 0 },
    };
    this.rotation = new Euler(0,0,0,'YXZ');this.start = new Vector3();this.end = new Vector3();
  }
  update(flight, camera, enabled, dt, origin) {
    if (!flight || !camera) { this.uniforms.cinemaHeatPower.value = 0; return; }
    const u=this.uniforms,stations=flight.aircraftVisual?.engines;
    const burning=enabled&&flight.boosting&&!flight.operations?.grounded&&stations?.length;
    const target=burning?1:0;
    u.cinemaHeatPower.value+=(target-u.cinemaHeatPower.value)*(1-Math.exp(-Math.min(dt,.1)*8));
    u.cinemaHeatTime.value=(u.cinemaHeatTime.value+Math.min(dt,.1))%100;
    if(!burning){u.cinemaHeatPower.value=0;return;}
    this.rotation.set(flight.pitch,-flight.heading,-flight.bank);
    for(let i=0;i<2;i++){
      const station=stations[Math.min(i,stations.length-1)];
      this.start.fromArray(station).applyEuler(this.rotation).add(flight.pos);
      this.end.fromArray(station);this.end.z+=30;this.end.applyEuler(this.rotation).add(flight.pos);
      // Flight positions are absolute Mercator; the camera renders relative
      // to the floating origin. Project both engines in that same frame.
      if(origin){this.start.sub(origin);this.end.sub(origin);}
      const depth=this.start.distanceTo(camera.position);
      this.start.project(camera);this.end.project(camera);
      const v=i?u.cinemaHeatB.value:u.cinemaHeatA.value;
      v.set(this.start.x*.5+.5,this.start.y*.5+.5,this.end.x*.5+.5,this.end.y*.5+.5);
      u.cinemaHeatDepth.value.setComponent(i,depth);
      if(this.start.z<0||this.start.z>1||!Number.isFinite(v.x+v.y+v.z+v.w))u.cinemaHeatPower.value=0;
    }
  }
}
export const EXHAUST_HEAT_GLSL = /* glsl */ `
uniform vec4 cinemaHeatA, cinemaHeatB;
uniform vec2 cinemaHeatDepth;
uniform float cinemaHeatPower, cinemaHeatTime;
float heatCorridor(vec4 line,float engineDepth,float sceneDist){
 vec2 a=line.xy,b=line.zw,ab=b-a;
 float t=clamp(dot(vUv-a,ab)/max(dot(ab,ab),.000001),0.,1.);
 float radius=mix(.006,.012,t);
 float d=length(vUv-mix(a,b,t));
 return exp(-d*d/(radius*radius))*smoothstep(0.,.12,t)*(1.-smoothstep(.6,1.,t))*step(engineDepth+2.,sceneDist);
}
vec2 exhaustHeatOffset(float dist){
 if(cinemaHeatPower<.01)return vec2(0);
 float mask=max(heatCorridor(cinemaHeatA,cinemaHeatDepth.x,dist),heatCorridor(cinemaHeatB,cinemaHeatDepth.y,dist));
 return vec2(sin(vUv.y*970.-cinemaHeatTime*31.),cos(vUv.x*730.+cinemaHeatTime*23.))*.00045*mask*cinemaHeatPower;
}`;

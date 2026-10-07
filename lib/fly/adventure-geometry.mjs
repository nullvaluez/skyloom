import { FLIGHT, HANGAR } from './fly-constants.js';

export const ADVENTURE_AIRCRAFT_IDS = ['fighter','military','warbird-jet','warbird-prop','prop','glider','bizjet','airliner','cargo','flying-wing'];
const RAD = Math.PI / 180;
export const validAircraft = id => ADVENTURE_AIRCRAFT_IDS.includes(id);
export function distanceM(a,b) {
  return Math.hypot((b.lat-a.lat)*111320,(b.lon-a.lon)*111320*Math.cos((a.lat+b.lat)*RAD/2));
}
export function bearingDeg(a,b) {
  return (Math.atan2((b.lon-a.lon)*Math.cos((a.lat+b.lat)*RAD/2),b.lat-a.lat)/RAD+360)%360;
}
export function offsetPoint(p, bearing, metres, altM=p.altM) {
  return {...p,lat:p.lat+Math.cos(bearing*RAD)*metres/111320,lon:p.lon+Math.sin(bearing*RAD)*metres/(111320*Math.cos(p.lat*RAD)),altM};
}
export function interpolatePoint(a,b,t) {
  return {lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t,altM:a.altM+(b.altM-a.altM)*t};
}
export function adventureEnvelope(id) {
  const cfg={...FLIGHT,...HANGAR.byId[id]?.flight};
  const speed=cfg.speeds.cruise;
  // Use both the actual commanded heading rate and the bank envelope. The
  // latter deliberately leaves room for a gentle, scenic coordinated turn.
  const yaw=cfg.maxYawRateDeg*2.2*RAD;
  const radius=Math.max(speed/yaw,speed*speed/(9.81*Math.tan(Math.min(30,cfg.maxBankDeg*.75)*RAD)));
  return {speed,slow:cfg.speeds.slow,turnRadiusM:radius,gateRadiusM:Math.max(100,speed*1.7),altitudeToleranceM:Math.max(80,speed*.55),ceiling:cfg.ceiling};
}
export function segmentClosest(a,b,p) {
  const k=111320*Math.cos(p.lat*RAD),ax=(a.lon-p.lon)*k,ay=(a.lat-p.lat)*111320;
  const dx=(b.lon-a.lon)*k,dy=(b.lat-a.lat)*111320;
  const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
  return {distance:Math.hypot(ax+t*dx,ay+t*dy),altM:a.altM+(b.altM-a.altM)*t,t};
}
export function crossesGate(a,b,gate,headingDeg,radiusM,altitudeToleranceM) {
  const angle=headingDeg*RAD,k=111320*Math.cos(gate.lat*RAD);
  const signed=p=>(p.lon-gate.lon)*k*Math.sin(angle)+(p.lat-gate.lat)*111320*Math.cos(angle);
  const from=signed(a),to=signed(b);
  if(from>=0||to<0||to-from<.01)return false;
  const t=-from/(to-from),p=interpolatePoint(a,b,t);
  return distanceM(p,gate)<=radiusM&&Math.abs(p.altM-gate.altM)<=altitudeToleranceM;
}

/** Renderer-owned dimensions keyed by flight instance; never modify physics state. */
const dimensions=new WeakMap();
export function registerCameraModel(flight,size){
  dimensions.set(flight,size);
  return()=>{if(dimensions.get(flight)===size)dimensions.delete(flight);};
}
export function cameraModelSize(flight){return dimensions.get(flight);}

export const WORLD_FRAMING = Object.freeze({ fov:58, targetWidth:.15, largeWidth:.18 });
/** Physical dimensions in, horizontal map distance out. */
export function fittedChaseDistance(size, aspect, fov, targetWidth, upM, k=1) {
  const tan=Math.tan(fov*Math.PI/360);
  const width=size.width*k/(2*tan*Math.max(.5,aspect)*targetWidth);
  const height=size.height/(2*tan*.20);
  return Math.max(size.length*k*1.6,Math.sqrt(Math.max(1,Math.max(width,height)**2-upM**2)));
}

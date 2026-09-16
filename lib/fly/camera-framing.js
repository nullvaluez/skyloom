/** Renderer-owned dimensions keyed by flight instance; never modify physics state. */
const dimensions=new WeakMap();
export function registerCameraModel(flight,size){
  dimensions.set(flight,size);
  return()=>{if(dimensions.get(flight)===size)dimensions.delete(flight);};
}
export function cameraModelSize(flight){return dimensions.get(flight);}

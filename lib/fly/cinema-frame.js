import { Vector3, Vector4 } from 'three';
import { createCinemaEnvironment, evaluateCinemaEnvironment } from './cinema-environment';
import { cinemaOn } from './cinema-policy';
import { updateCinemaGeography } from './cinema-geography';

export const cinemaEnvironment=createCinemaEnvironment();
export const CINEMA_UNIFORMS={
  uCinema:{value:0},uCinemaKey:{value:new Vector3()},uCinemaKeyColor:{value:new Vector3()},
  uCinemaHorizon:{value:new Vector3()},uCinemaZenith:{value:new Vector3()},uCinemaFill:{value:new Vector3()},
  uCinemaCloudLower:{value:new Vector3()},uCinemaCloudUpper:{value:new Vector3()},
  uCinemaLight:{value:new Vector4(1,0,0,0)},uCinemaAir:{value:new Vector4(.00004,1700,1,1)},
};
export function updateCinemaFrame(runtime,state){
  const enabled=cinemaOn(state);CINEMA_UNIFORMS.uCinema.value=enabled?1:0;
  if(!enabled){runtime.cinemaEnvironment=null;runtime.cinemaGeography=null;return null;}
  runtime.cinemaGeography=updateCinemaGeography(runtime.cinemaGeography??{},runtime);
  const e=evaluateCinemaEnvironment(cinemaEnvironment,runtime.sun,runtime.weather?.wx);
  runtime.cinemaEnvironment=e;
  CINEMA_UNIFORMS.uCinemaKey.value.fromArray(e.keyDir);CINEMA_UNIFORMS.uCinemaKeyColor.value.fromArray(e.keyColor);
  CINEMA_UNIFORMS.uCinemaHorizon.value.fromArray(e.horizon);CINEMA_UNIFORMS.uCinemaZenith.value.fromArray(e.zenith);
  CINEMA_UNIFORMS.uCinemaFill.value.fromArray(e.fillColor);
  CINEMA_UNIFORMS.uCinemaCloudLower.value.fromArray(e.cloudLower);CINEMA_UNIFORMS.uCinemaCloudUpper.value.fromArray(e.cloudUpper);
  CINEMA_UNIFORMS.uCinemaLight.value.set(e.day,e.night,e.golden,e.overcast);
  CINEMA_UNIFORMS.uCinemaAir.value.set(e.extinction,e.heightM,e.exposure,e.sun);
  return e;
}
export { CINEMA_GLSL } from './cinema-sky.js';

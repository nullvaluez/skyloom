import { Vector3, Vector4 } from 'three';
import { createCinemaEnvironment, evaluateCinemaEnvironment } from './cinema-environment';
import { cinemaOn, cinemaArtOn } from './cinema-policy';
import { applyCinemaArt, updateCinemaCloudDatum } from './cinema-art';
import { updateCinemaGeography } from './cinema-geography';
import { applyAdventureAtmosphere } from './adventure-environment.mjs';
import { TWILIGHT, TWILIGHT_ACTIVE } from './cinema-sky.js';

export const cinemaEnvironment=createCinemaEnvironment();
export const CINEMA_UNIFORMS={
  uCinema:{value:0},uCinemaArt:{value:0},uCinemaKey:{value:new Vector3()},uCinemaKeyColor:{value:new Vector3()},
  uCinemaHorizon:{value:new Vector3()},uCinemaZenith:{value:new Vector3()},uCinemaFill:{value:new Vector3()},
  uCinemaCloudLower:{value:new Vector3()},uCinemaCloudUpper:{value:new Vector3()},
  uCinemaSun:{value:new Vector3(0,1,0)},uCinemaMoon:{value:new Vector3(0,1,0)},uCinemaOptics:{value:new Vector4(1,0,0,0)},
  uCinemaLight:{value:new Vector4(1,0,0,0)},uCinemaAir:{value:new Vector4(.00004,1700,1,1)},
};
export function updateCinemaFrame(runtime,state,dt=.016){
  const enabled=cinemaOn(state);CINEMA_UNIFORMS.uCinema.value=enabled?1:0;
  CINEMA_UNIFORMS.uCinemaArt.value=enabled&&cinemaArtOn()?1:0;
  if(!enabled){runtime.cinemaEnvironment=null;runtime.cinemaGeography=null;return null;}
  runtime.cinemaGeography=updateCinemaGeography(runtime.cinemaGeography??{},runtime);
  const e=evaluateCinemaEnvironment(cinemaEnvironment,runtime.sun,runtime.weather?.wx,TWILIGHT_ACTIVE?TWILIGHT:null);
  if(CINEMA_UNIFORMS.uCinemaArt.value){
    applyCinemaArt(e);
    runtime.cinemaCloudDatum=updateCinemaCloudDatum(runtime.cinemaCloudDatum,runtime.cinemaGeography,state.warpEpoch,!!runtime.worldLoading,dt);
    e.cloudBase+=runtime.cinemaCloudDatum?.groundM??0;
  }
  applyAdventureAtmosphere(runtime.adventureEnvironment,e,typeof window==='undefined'?undefined:window.__flyWeatherOverride);
  runtime.cinemaEnvironment=e;
  CINEMA_UNIFORMS.uCinemaKey.value.fromArray(e.keyDir);CINEMA_UNIFORMS.uCinemaKeyColor.value.fromArray(e.keyColor);
  CINEMA_UNIFORMS.uCinemaHorizon.value.fromArray(e.horizon);CINEMA_UNIFORMS.uCinemaZenith.value.fromArray(e.zenith);
  CINEMA_UNIFORMS.uCinemaFill.value.fromArray(e.fillColor);
  CINEMA_UNIFORMS.uCinemaSun.value.fromArray(e.sunDir);CINEMA_UNIFORMS.uCinemaMoon.value.fromArray(e.moonDir);
  // .w = the moon disc/aureole weight; only the TWILIGHT_FIX shader reads it.
  CINEMA_UNIFORMS.uCinemaOptics.value.set(e.sunVisibility,e.night*(1-e.overcast)*(1-e.fog),e.fog,TWILIGHT_ACTIVE?e.moonW:0);
  CINEMA_UNIFORMS.uCinemaCloudLower.value.fromArray(e.cloudLower);CINEMA_UNIFORMS.uCinemaCloudUpper.value.fromArray(e.cloudUpper);
  CINEMA_UNIFORMS.uCinemaLight.value.set(e.day,e.night,e.golden,e.overcast);
  CINEMA_UNIFORMS.uCinemaAir.value.set(e.extinction,e.heightM,e.exposure,e.sun);
  return e;
}
export { CINEMA_GLSL } from './cinema-sky.js';

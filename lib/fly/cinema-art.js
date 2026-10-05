/** Stylized cinematic radiance. Applied before lighting/AgX, never to the HUD. */
const mix=(a,b,t)=>a+(b-a)*t;
const rgb=(out,a,b,t)=>{for(let i=0;i<3;i++)out[i]=mix(a[i],b[i],t);};
const horizon=new Float64Array(3),zenith=new Float64Array(3);
const DAY_KEY=[1,.83,.60],GOLD_KEY=[1,.49,.20],FILL=[.30,.48,.88],GROUND=[.105,.075,.055];
const DAY_HORIZON=[.22,.44,.82],DAY_ZENITH=[.005,.035,.24];
const GOLD_HORIZON=[1.02,.285,.105],GOLD_ZENITH=[.035,.017,.10];
const GREY_HORIZON=[.255,.315,.43],GREY_ZENITH=[.064,.092,.17];
const CLOUD_LOWER=[.055,.092,.185],CLOUD_UPPER=[1.08,1.06,1.02];

export function applyCinemaArt(e) {
  const day=e.day,clear=1-e.overcast,visible=1-e.fog;
  // Preserve the live sun, weather and night visibility. The art direction
  // separates warm direct light from a cooler sky instead of lifting both.
  rgb(e.keyColor,e.keyColor,DAY_KEY,day*clear*.65);
  rgb(e.keyColor,e.keyColor,GOLD_KEY,e.golden*.45);
  rgb(e.fillColor,e.fillColor,FILL,day*.72);
  rgb(e.groundColor,e.groundColor,GROUND,day*.55);
  e.sun*=mix(1,.90,day*clear);
  e.fill*=mix(1,.82,day*clear);
  e.environment*=mix(1,.82,day*clear);

  // Amber at the rim, cobalt overhead, and a rose dusk band. Weather still
  // veils these colors; a real overcast sky cannot turn into a clear sunset.
  rgb(horizon,DAY_HORIZON,GOLD_HORIZON,e.golden*.76);
  rgb(zenith,DAY_ZENITH,GOLD_ZENITH,e.golden*.60);
  rgb(horizon,horizon,GREY_HORIZON,e.overcast*.82);
  rgb(zenith,zenith,GREY_ZENITH,e.overcast*.90);
  rgb(e.horizon,e.horizon,horizon,day*visible);
  rgb(e.zenith,e.zenith,zenith,day*visible);
  rgb(e.cloudLower,e.cloudLower,CLOUD_LOWER,day*visible*.85);
  rgb(e.cloudUpper,e.cloudUpper,CLOUD_UPPER,day*visible*.65);
  for(let i=0;i<3;i++)e.cloudUpper[i]=mix(e.cloudUpper[i],e.keyColor[i]*1.18,e.golden*.55);
  // More distinct terrain layers, with clarity close to the aircraft. The
  // same optical coefficients reach ground haze and cloud compositing.
  e.extinction*=mix(1,1.20,day*clear*visible);
  e.heightM=mix(e.heightM,1450,day*clear*visible);
  e.exposureStops-=.08*day*clear;
  e.exposure=2**e.exposureStops;
  return e;
}

/** A regional datum for our estimated cloud deck (the weather feed has no
 * cloud-base observation). Seed after warp loading; sample again only after
 * 20 km, then ease at <=4 m/s. Terrain refinement, aircraft climbs and normal
 * origin rebases must not drag the whole sky up and down with the player. */
export function updateCinemaCloudDatum(previous,geo,warpEpoch,loading,dt=.016){
  if(!geo||loading||!Number.isFinite(geo.groundM))return previous;
  const ground=Math.max(0,geo.groundM),x=geo.originX+geo.x,z=geo.originZ+geo.z;
  if(!previous||previous.epoch!==warpEpoch)return {epoch:warpEpoch,groundM:ground,targetM:ground,x,z};
  if(Math.hypot(x-previous.x,z-previous.z)/geo.worldUnitsPerMetre>20000){
    previous.targetM=ground;previous.x=x;previous.z=z;
  }
  const seconds=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));
  const movement=(previous.targetM-previous.groundM)*(1-Math.exp(-seconds/120));
  previous.groundM+=Math.max(-4*seconds,Math.min(4*seconds,movement));
  return previous;
}

// Values are per-material albedo, not a full-screen saturation filter. Keep
// negative channels out of the lighting equations for saturated source tiles.
export const CINEMA_PIGMENT_GLSL=`
vec3 cinemaPigment(vec3 color,float saturation){
 float luminance=dot(color,vec3(.2126,.7152,.0722));
 return max(vec3(0.),mix(vec3(luminance),color,saturation));
}
`;

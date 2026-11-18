import { LinearMipmapLinearFilter, RepeatWrapping, TextureLoader, Vector2 } from 'three';

// The map carries cloud optical coverage (R) and relative sun/sky illumination
// (G). Its ground, disc and blue sky were removed by build-flight-cloud-relief.
// The live atmosphere, weather and real solar azimuth supply all sky colours.
const mapUrl = '/materials/cinema-v1/day-cloud-relief.webp';
const localCloudWeight = `
uniform float uReliefStrength;
float reliefLocalWeight(float distanceM) {
 return 1.-uReliefStrength*smoothstep(2400.,7500.,distanceM);
}
`;
function smoothRange(a,b,x) {
  const t=Math.min(1,Math.max(0,(x-a)/(b-a)));
  return t*t*(3-2*t);
}
const compositeFunctions = `
uniform sampler2D uReliefMap;
${localCloudWeight}
uniform vec2 uReliefTravel;
uniform vec2 uReliefTangent; // depression angle (rad), distance to tangent (m)
vec3 reliefAir(vec3 ray,float height) {
 // The sky tables integrate the real Earth, while the terrain can be bent on
 // a smaller radius. Remap the air column to the actual visible tangent.
 // Reusing the physical table's last row below its horizon produced a solid
 // light grey band between the eye-level horizon and the game's curved ground.
 float angle=asin(clamp(ray.y,-1.,1.));
 float above=angle+uReliefTangent.x;
 float earthDip=sqrt(2.*height/6371000.);
 float corrected=angle+(uReliefTangent.x-earthDip)*(1.-smoothstep(.07,.65,above));
 vec2 az=ray.xz/max(.00001,length(ray.xz));
 vec3 air=cinemaSky(vec3(az.x*cos(corrected),sin(corrected),az.y*cos(corrected)));
 float l=dot(air,vec3(.2126,.7152,.0722));
 float away=1.-smoothstep(.60,.99,dot(ray,uCinemaSun));
 // Distant open-country air carries the blue of the diffuse sky. Preserve
 // directional solar haze for views into the sun.
 vec3 blue=vec3(.58,.87,1.19)*l;
 vec3 rim=mix(air,blue,(1.-smoothstep(.015,.28,above))*(.34+.37*away));
 // Lower lines of sight see progressively more of the near surface. Continue
 // their air colour below the tangent instead of repeating a flat sky row.
 return rim*mix(vec3(1.),vec3(.76,.84,.91),1.-smoothstep(-.09,.003,above));
}
vec3 reliefSky(vec3 sky, vec3 ray) {
 if(uReliefStrength<=.001)return sky;
 // Reproject the photographed directions to a layer with a finite height.
 // Moving up lowers the apparent elevation of its banks. Its horizon recedes
 // with the curved Earth and its horizontal parallax vanishes at the rim.
 float altitude=max(0.,metric(eye).y-uR25GroundY);
 float layer=max(3500.,base-uR25GroundY+1.55*thickness);
 sky=mix(sky,reliefAir(ray,altitude),uReliefStrength);
 float above=asin(clamp(ray.y,-1.,1.))+uReliefTangent.x;
 if(above<=0.)return sky;
 // Bend the distant photographed layer onto the same horizon. Its elevation
 // changes with the eye; at high altitude the volume owns the deck entirely.
 float raised=asin(clamp(ray.y,-1.,1.))+uReliefTangent.x*(1.-smoothstep(.10,.75,above));
 vec3 direction=normalize(vec3(ray.x, sin(raised)*layer/max(1000.,layer-altitude), ray.z));
 direction.xz+=uReliefTravel*max(0.,direction.y);
 direction=normalize(direction);
 float elevation=asin(clamp(direction.y,-1.,1.));
 if(elevation<0.)return sky;
 vec2 sunAxis=normalize(uCinemaSun.xz+vec2(.000001,0.));
 float azimuth=atan(direction.x*sunAxis.y-direction.z*sunAxis.x,dot(direction.xz,sunAxis));
 // The unmodified 2048x1024 panorama's sun is at (1218,239).
 vec2 uv=vec2(.5949707+azimuth*.15915494,clamp(elevation*.63661977,.001,.999));
 vec2 dx=dFdx(uv),dy=dFdy(uv);
 dx.x-=floor(dx.x+.5);
 dy.x-=floor(dy.x+.5);
 vec2 field=textureGrad(uReliefMap,uv,dx,dy).rg;
 float cover=field.r*uReliefStrength*cloudMix*smoothstep(.002,.022,elevation);
 float aerial=smoothstep(.006,.15,elevation);
 float light=pow(field.g,1.12);
 // A cloud's downward face sees cool diffuse skylight. Its sun-facing
 // protrusions receive the directional key. Warmth follows time and weather.
 float skyValue=dot(sky,vec3(.2126,.7152,.0722));
 vec3 diffuse=vec3(.27,.29,.32)+mix(vec3(skyValue),sky,.28)*.33;
 vec3 direct=vec3(1.70,1.67,1.63)*mix(vec3(1.),clamp(uCinemaKeyColor,.5,1.45),.38);
 vec3 radiance=mix(diffuse,direct,light);
 radiance=mix(sky,radiance,mix(.27,.97,aerial));
 return mix(sky,radiance,cover);
}
`;

function replaceOnce(program, anchor, next) {
  const first = program.indexOf(anchor);
  if (first < 0 || program.indexOf(anchor,first+anchor.length) >= 0) {
    throw new Error('Flight cloud relief shader anchor changed: ' + anchor.slice(0,65));
  }
  return program.replace(anchor,next);
}

export function installFlightCloudRelief(r25, status) {
  const uniforms = r25.uniforms;
  uniforms.uReliefMap = { value: null };
  uniforms.uReliefStrength = { value: 0 };
  uniforms.uReliefTravel = { value: new Vector2() };
  uniforms.uReliefTangent = { value: new Vector2(0,120000) };
  const rawRay = r25.composite.fragmentShader.includes('vec3 tsTrueRay(vec3 r)') ? 'tsTrueRay(ray)' : 'normalize(vec3(ray.x/metricScale,ray.y,ray.z/metricScale))';
  let composite = replaceOnce(r25.composite.fragmentShader,'void main(){',compositeFunctions+'\nvoid main(){');
  composite = replaceOnce(composite,'scene=cinemaSky(skyRay)*uR25Exposure;',
    `skyRay=normalize(mix(skyRay,${rawRay},uReliefStrength));
    scene=reliefSky(cinemaSky(skyRay),skyRay)*uR25Exposure;`);
  const caster='float casterVisibility=cloudShadowVisibility(projected,metric(eye),rangeM);';
  composite=replaceOnce(composite,caster,caster+'\n   casterVisibility*=reliefLocalWeight(length(projected-metric(eye)));');
  // At the outer terrain ring the last geometry and the physical sky sample
  // different air paths. Blend only distant, grazing-angle terrain toward
  // that same solar-facing sky row, before nearer clouds are composited.
  composite = replaceOnce(composite,'  vec3 p=metric(eye+ray*dist);',`  vec3 p=metric(eye+ray*dist);
  if(uReliefStrength>.001 && dist>1800. && uCinema>.5){
    vec3 dir=${rawRay};
    float metres=dist*length(vec3(ray.x/metricScale,ray.y,ray.z/metricScale));
    float angle=asin(clamp(dir.y,-1.,1.))+uReliefTangent.x;
    // Terrain depth falls from 51 to 23 km in six pixels along the Paris rim.
    // A narrow linear ramp changes authority across those pixels and paints
    // a stripe. This extinction has already converged at both distances.
    float scale=clamp(.16*uReliefTangent.y,6500.,16000.);
    float airWeight=1.-exp(-1.9*pow(metres/scale,1.45));
    float rim=(1.-smoothstep(.025,.130,abs(angle)))*airWeight;
    if(rim>.002)scene=mix(scene,(reliefAir(dir,max(0.,metric(eye).y-uR25GroundY))+cinemaCelestials(dir))*uR25Exposure,rim*uReliefStrength);
  }`);
  r25.composite.fragmentShader=composite;

  let march=replaceOnce(r25.march.fragmentShader,'void main(){',localCloudWeight+'\nvoid main(){');
  // Keep the real density, self-shadow, passage and weather inside the local
  // column. Farther away its mip-filtered ellipsoids become a low-frequency
  // approximation; hand off to the resolved distant layer over kilometres.
  const density='float d=densityAt(p,footprint);if(d<.002)continue;';
  march=replaceOnce(march,density,`float d=densityAt(p,footprint);
  d*=reliefLocalWeight(t*metricRay);
  if(d<.002)continue;`);
  // When the original far-deck approximation is present, let the resolved
  // deck carry its daylight share; preserve the independent cirrus and shafts.
  const far='livFarDeck(ray,livTR,metricRay,rayCone,livSceneT,livFarL,livFarA);';
  if(march.includes(far))march=replaceOnce(march,far,far+'livFarL*=1.-uReliefStrength;livFarA*=1.-uReliefStrength;');
  r25.march.fragmentShader=march;

  let alive=true, ready=false, blend=0;
  const texture=new TextureLoader().load(mapUrl,loaded=>{
    if(!alive)return;
    loaded.wrapS=RepeatWrapping;
    loaded.minFilter=LinearMipmapLinearFilter;
    uniforms.uReliefMap.value=loaded;
    ready=true;
  },undefined,()=>{ if(alive)status.reliefMapError=true; });
  return {
    update({ cameraHeight, state, sun, wx, worldX, worldZ, dt, groundY=0, curvature=0, cinema=true }) {
      blend=Math.min(1,blend+(ready?Math.max(0,dt):0));
      const altitudeWeight=1-smoothRange(state.cloudBase+state.cloudThickness*.20,state.cloudBase+state.cloudThickness*1.10,cameraHeight);
      const weather=smoothRange(.06,.78,wx?.presenceFrac??1)*(1-smoothRange(.18,.82,state.overcast))*(1-smoothRange(.05,.65,wx?.fogT??0));
      uniforms.uReliefStrength.value=cinema?blend*altitudeWeight*weather*smoothRange(.15,.49,sun):0;
      const height=Math.max(.5,cameraHeight-groundY);
      const k=Math.max(1/(2*6371000),curvature);
      const dip=Math.atan(2*Math.sqrt(k*height));
      uniforms.uReliefTangent.value.set(dip,Math.max(4000,Math.sqrt(height/k)));
      // Geographic coordinates include the origin and wind, so rebases,
      // head turns and frozen review cameras leave the distant field stable.
      uniforms.uReliefTravel.value.set(.22*Math.sin(worldX/78000),.22*Math.sin(worldZ/78000));
      status.reliefMapReady=ready;
      status.reliefDaylight=uniforms.uReliefStrength.value;
      status.reliefHorizonDeg=dip*180/Math.PI;
    },
    dispose(){alive=false;texture.dispose();}
  };
}

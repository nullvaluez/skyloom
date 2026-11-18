import { bindFlightFacadeSurfaces, FLIGHT_FACADE_SURFACE_GLSL } from './flight-facade-surfaces';

// The city cascade can span ten metres per texel. With a centimetre-scale
// receiver offset it samples its own wall in repeated diagonal bands. Keep
// the aircraft, ground, roof and fine cascades on their existing bias.
export function applyFacadeShadowFootprint(shader) {
  shader.uniforms.uFlightFacadeShadows = shader.uniforms.uLookFacade;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
uniform float uFlightFacadeShadows;
float flightReceiverOffset(mat4 shadowMatrix, float mapWidth, float original) {
  vec3 uAxis=vec3(shadowMatrix[0].x,shadowMatrix[1].x,shadowMatrix[2].x);
  float metresPerTexel=1./max(.001,mapWidth*length(uAxis));
  return max(0.,min(7.6,.50*metresPerTexel)-original);
}`)
    .replace('#include <shadowmap_vertex>', `#include <shadowmap_vertex>
#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
if (uFlightFacadeShadows>.5 && aBuildingStyle.z>.5) {
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
    vDirectionalShadowCoord[ i ] += directionalShadowMatrix[ i ] * vec4(shadowWorldNormal *
      flightReceiverOffset(directionalShadowMatrix[ i ],directionalLightShadows[ i ].shadowMapSize.x,
                           directionalLightShadows[ i ].shadowNormalBias),0.);
  }
  #pragma unroll_loop_end
}
#endif`);
}

// Recesses and spandrels sit on top of the worker's final wall material. Each
// has its own pixel footprint so a slanted facade can lose bays but keep floors.
export function applyFlightFacadeRelief(shader, taggedWall, material, renderer) {
  const surfaces = bindFlightFacadeSurfaces(shader, material, renderer);
  if (surfaces) shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
    '#include <common>\n' + FLIGHT_FACADE_SURFACE_GLSL);
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `void main() {
// Both derivatives precede the near/far ownership and chunk-fade discards.
vec2 flightFacadeDx = dFdx(vFacadeMetres), flightFacadeDy = dFdy(vFacadeMetres);
vec2 flightMetresPerPixel = max(abs(flightFacadeDx)+abs(flightFacadeDy), vec2(.0001));`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
if (uLookFacade > .5 && uCinema > .5 && uArchitectureNight < .999) {
  float day = uCinema * (1. - uArchitectureNight);
  float curtain = ${taggedWall ? '(wlMode > 1.5 ? 0. : wlMode > .5 ? 1. : isGlass)' : 'isGlass'};
  float commercial = max(curtain, float(family == 3. || family == 7.));
  float variant = fract(seed * .618034);
  vec2 coord = cell;
  vec2 footprint = flightMetresPerPixel / pitch;
  vec2 duty = opening;
  vec2 glass = mix(pane,duty,vec2(archMinify(footprint.x),archMinify(footprint.y)));
  float panes = glass.x * glass.y;
  // Broad masonry piers and grouped curtain-wall framing keep their own scale.
  float bayCount = 3. + floor(variant * 4.);
  float pier = archCoverage(coord.x/bayCount + variant,.12,footprint.x/bayCount);
  pier = mix(pier,.12,archMinify(footprint.x/bayCount));
  float deckCount = 3. + mod(seed,4.);
  float deck = archCoverage(coord.y/deckCount + .5,.075,footprint.y/deckCount);
  deck = mix(deck,.075,archMinify(footprint.y/deckCount));
  panes *= (1. - pier * .82) * (1. - deck * commercial * .76);
  float sillRelief = sill * (1.-archMinify(footprint.y)) * uArchitectureDetail;
  float headRelief = revealTop * (1.-archMinify(footprint.y)) * uArchitectureDetail;
  vec3 body = diffuseColor.rgb;
  vec3 glassTint = mix(vec3(.60,.76,.83),vec3(.89,.82,.67),smoothstep(.60,.91,variant));
  vec3 glazing = body * glassTint * mix(.27,.40,curtain) + glassTint * mix(.012,.032,curtain);
  vec3 wall = mix(body,glazing,panes);
  wall *= 1. - headRelief * .32 - deck * commercial * .16;
  wall += (body * .19 + .018) * sillRelief * (1. - curtain * .75);
  wall *= mix(.76,1.,smoothstep(0.,8.,vFacadeMetres.y));
  float face = clamp(isWall,0.,1.);
  ${surfaces ? `
  if (face>.5 && uFlightFacadeReady>.5) {
    float coarse=max(footprint.x,footprint.y),fine=min(footprint.x,footprint.y);
    float resolved=mix(1.-smoothstep(.15,.76,coarse),1.-smoothstep(.15,.65,fine),.26);
    if(resolved>.001){
      float layer=flightFacadeLayer(family,curtain,variant);
      // Each tile contains four bays and four storeys. The strip was decoded
      // top-first, so upward building coordinates run towards lower image rows.
      vec2 scale=vec2(.25,-.25)/pitch;
      vec2 phase=.25*vec2(mod(seed,4.),mod(floor(seed*.25),4.));
      vec3 uv=vec3(vFacadeMetres*scale+phase,layer);
      vec3 sampleColor=textureGrad(uFlightFacadeSheet,uv,flightFacadeDx*scale,flightFacadeDy*scale).rgb;
      // The last mip is each elevation's own area mean. Its exposure and
      // baked pigment cannot pull an entire district toward dark grey.
      vec3 meanColor=textureLod(uFlightFacadeSheet,vec3(.5,.5,layer),9.).rgb;
      vec3 luma=vec3(.2126,.7152,.0722);
      float sampleY=dot(sampleColor,luma),meanY=dot(meanColor,luma);
      float ratio=(sampleY+.014)/(meanY+.014);
      float value=clamp(.16+.84*pow(max(.001,ratio),.84),.25,1.95);
      vec3 hue=(sampleColor+vec3(.018))/(sampleY+.018);
      vec3 materialHue=(meanColor+vec3(.018))/(meanY+.018);
      vec3 tint=clamp(hue/materialHue,vec3(.70),vec3(1.33));
      // Use the worker's building pigment and live sun/sky. Photographic
      // departures supply the actual sill, mullion, recess and glazing shapes.
      // The city's glazing treatment already includes its coating. Applying
      // the uncoated worker colour here bleaches dark glass in direct sun.
      vec3 pigment=${taggedWall ? 'mix(body,wlBase,.24*(1.-curtain))' : 'body'};
      vec3 photographic=pigment*value*mix(vec3(1.),tint,.56);
      float glazing=1.-smoothstep(.47,1.10,ratio);
      photographic+=vec3(.009,.016,.022)*glazing;
      float weight=resolved*.93;
      wall=mix(wall,photographic,weight);
      panes=mix(panes,max(glazing,curtain*.45),weight);
    }
  }` : ''}
  diffuseColor.rgb = mix(body,wall,day * face);
  // Keep the sampled roof pigment, including zinc or clay, with a darker
  // roof-to-wall value break, even where individual seams cannot resolve.
  diffuseColor.rgb *= mix(1.,mix(.76,.95,variant),day * (1. - face));
  roughnessFactor = mix(roughnessFactor,mix(.32,.42,variant),day * face * panes * .50);
}`);
}

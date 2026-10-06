// Kept free of runtime dependencies so the exact GLSL also runs in isolated GPU
// probes: the only imports are the pure-data constants, the pin helper and the
// atmosphere's GLSL text.
import { pinned } from './fly-pins.js';
import { PHYS_SKY, TWILIGHT_FIX } from './fly-constants.js';
import { ATMO_SKY_LOOKUP_GLSL } from './atmosphere/glsl.js';

const LEGACY_SKY_GLSL=`
uniform float uCinema;
uniform float uCinemaArt;
uniform vec3 uCinemaKey,uCinemaKeyColor,uCinemaHorizon,uCinemaZenith,uCinemaFill;
uniform vec3 uCinemaCloudLower,uCinemaCloudUpper;
uniform vec4 uCinemaLight,uCinemaAir;
uniform vec3 uCinemaSun;
uniform vec4 uCinemaOptics;
vec3 cinemaSky(vec3 ray){
 float altitude=clamp(ray.y,0.,1.);
 float up=pow(altitude,.46);
 if(uCinemaArt>.5)up=pow(altitude,mix(.46,mix(.30,.46,uCinemaLight.w),uCinemaLight.x));
 vec3 sky=mix(uCinemaHorizon,uCinemaZenith,up);
 float mu=dot(ray,uCinemaKey),facing=max(0.,mu);
 float clear=1.-uCinemaLight.w;
 // Broad Rayleigh separation and a narrow Mie aureole share the same sun
 // as the terrain and PMREM. No screen-space flare or camera-facing sprite.
 float rayleigh=.75*(1.+mu*mu);
 sky*=mix(1.,rayleigh,.22*uCinemaLight.x*clear);
 float mie=pow(facing,16.)*.16+pow(facing,128.)*.38;
 sky+=uCinemaKeyColor*mie*uCinemaOptics.x*mix(.09,1.,uCinemaLight.x);
 // The rose anti-solar belt belongs to the real sun, even during the smooth
 // key handover to the moon. It remains continuous across geographic warps.
 float antisolar=pow(max(0.,-dot(ray,uCinemaSun)),2.);
 float belt=exp(-pow((altitude-.10)*10.,2.))*antisolar*uCinemaLight.z;
 sky+=vec3(.11,.025,.036)*belt;
 if(uCinemaArt>.5){
  // A sun-oriented warm horizon and violet anti-solar belt add depth to
  // sunsets without a screen-space gradient that rotates with the camera.
  float rim=exp(-altitude*9.)*uCinemaLight.z*clear;
  sky+=vec3(.20,.045,.012)*pow(facing,3.)*rim;
  sky+=vec3(.065,.010,.062)*antisolar*rim;
 }
 return max(sky,vec3(0.));
}
`;

// Celestial detail only belongs in visible sky. Haze, water and diffuse IBL
// use cinemaSky without baking tiny stars or a solar disc into their fill.
const LEGACY_CELESTIAL_GLSL=`
float cinemaStarHash(vec2 p){
 vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
 q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);
}
vec3 cinemaCelestials(vec3 ray){
 float facing=dot(ray,uCinemaKey);
 float aa=max(fwidth(facing),.000002);
 float disc=smoothstep(.999989-aa,.999989+aa,facing);
 vec3 light=uCinemaKeyColor*disc*mix(.60,18.,uCinemaLight.x)*uCinemaOptics.x;
 // Stable sky coordinates, derivative-filtered points; no twinkling timer.
 vec2 uv=vec2(atan(ray.z,ray.x)*.159154943+.5,asin(clamp(ray.y,-1.,1.))*.318309886+.5)*vec2(720.,360.);
 vec2 cell=floor(uv);float star=cinemaStarHash(cell);
 vec2 at=vec2(cinemaStarHash(cell+17.),cinemaStarHash(cell+43.));
 float radius=.045+.035*cinemaStarHash(cell+71.);
 float pixel=max(length(fwidth(uv)),.001),size=max(radius,pixel*.6);
 float point=exp(-dot(fract(uv)-at,fract(uv)-at)/(size*size))*min(1.,radius*radius/(size*size));
 vec3 tint=mix(vec3(.64,.77,1.),vec3(1.,.82,.59),cinemaStarHash(cell+23.));
 light+=tint*point*step(.9975,star)*2.5*uCinemaOptics.y*smoothstep(.02,.30,ray.y);
 return light;
}
`;

/*
 * TRUE EARTH — TWILIGHT_FIX. The twilight variants are DERIVED from the legacy
 * text above with anchors that must each match exactly once; a miss keeps the
 * legacy text and clears TWILIGHT_GLSL_OK, which scripts/verify-twilight.mjs
 * asserts, so a future edit can never make the flag a silent no-op (the R24
 * un-asserted String.replace lesson) or throw at module scope.
 */
function patchOnce(src, from, to) {
  if (src == null) return null;
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) return null;
  return src.slice(0, at) + to + src.slice(at + from.length);
}
let twilightSky = patchOnce(LEGACY_SKY_GLSL, 'uniform vec4 uCinemaOptics;\n', 'uniform vec4 uCinemaOptics;\nuniform vec3 uCinemaMoon;\n');
// The Rayleigh tilt and Mie aureole follow the real sun, not the key.
twilightSky = patchOnce(twilightSky, 'float mu=dot(ray,uCinemaKey),facing=max(0.,mu);', 'float mu=dot(ray,uCinemaSun),facing=max(0.,mu);');
// The moon's own aureole, weighted by its handover (uCinemaOptics.w): at full
// night this is exactly the legacy key aureole (night key colour, weight .09).
twilightSky = patchOnce(twilightSky,
  ' sky+=uCinemaKeyColor*mie*uCinemaOptics.x*mix(.09,1.,uCinemaLight.x);\n',
  ' sky+=uCinemaKeyColor*mie*uCinemaOptics.x*mix(.09,1.,uCinemaLight.x);\n' +
  ' float moonFacing=max(0.,dot(ray,uCinemaMoon));\n' +
  ' sky+=vec3(.57,.72,1.)*(pow(moonFacing,16.)*.16+pow(moonFacing,128.)*.38)*uCinemaOptics.x*.09*uCinemaOptics.w;\n');
let twilightCelestial = patchOnce(LEGACY_CELESTIAL_GLSL, ' float facing=dot(ray,uCinemaKey);\n', ' float facing=dot(ray,uCinemaSun);\n');
// A moon disc of its own; at full night it equals the legacy key disc.
twilightCelestial = patchOnce(twilightCelestial,
  ' vec3 light=uCinemaKeyColor*disc*mix(.60,18.,uCinemaLight.x)*uCinemaOptics.x;\n',
  ' vec3 light=uCinemaKeyColor*disc*mix(.60,18.,uCinemaLight.x)*uCinemaOptics.x;\n' +
  ' float moonFacing=dot(ray,uCinemaMoon),moonAa=max(fwidth(moonFacing),.000002);\n' +
  ' light+=vec3(.57,.72,1.)*smoothstep(.999989-moonAa,.999989+moonAa,moonFacing)*.60*uCinemaOptics.x*uCinemaOptics.w;\n');

export const TWILIGHT_GLSL_OK = twilightSky != null && twilightCelestial != null;
/** The resolved TWILIGHT_FIX block (URL / console pins applied once, at load). */
export const TWILIGHT = pinned(TWILIGHT_FIX, '__flyTwilightFixOverride');
const twilightOn = TWILIGHT.enabled === true && TWILIGHT_GLSL_OK;
/** True when the twilight shader AND the switched key light are both in effect. */
export const TWILIGHT_ACTIVE = twilightOn;

/*
 * TRUE EARTH Phase 2 — PHYS_SKY. cinemaSky becomes the physical sky table
 * (lib/fly/atmosphere/) times the sun's illuminance, under a sky-only
 * saturation grade, with the authored night sky as a floor and the weather
 * veil on top. It keeps every legacy declaration (other code reads them
 * through this text) and the twilight sun/moon discs, with the sun disc
 * coloured by the real transmittance. Built from the legacy and twilight texts
 * by asserted anchors; a miss keeps the other variants and clears
 * PHYS_SKY_GLSL_OK (verify-phys-sky.mjs asserts it).
 */
const PHYS_DECL_AT = LEGACY_SKY_GLSL.indexOf('vec3 cinemaSky(vec3 ray){');
const physSkyText = PHYS_DECL_AT > 0 && LEGACY_SKY_GLSL.indexOf('vec3 cinemaSky(vec3 ray){', PHYS_DECL_AT + 1) < 0
  ? `${LEGACY_SKY_GLSL.slice(0, PHYS_DECL_AT)}uniform vec3 uCinemaMoon;
${ATMO_SKY_LOOKUP_GLSL}
uniform vec3 uPskySunIllum,uPskyNightH,uPskyNightZ,uPskyVeilH,uPskyVeilZ,uPskySunDisc,uPskyGround;
uniform vec4 uPskyGrade;
vec3 cinemaSky(vec3 ray){
 vec3 sky=pskySky(ray)*uPskySunIllum;
 float l=dot(sky,vec3(.2126,.7152,.0722));
 sky=max(vec3(0.),vec3(l)+(sky-vec3(l))*uPskyGrade.x);
 float up=pow(clamp(ray.y,0.,1.),.46);
 sky+=mix(uPskyNightH,uPskyNightZ,up)*uPskyGrade.z;
 return max(mix(sky,mix(uPskyVeilH,uPskyVeilZ,up),uPskyGrade.y),vec3(0.));
}
// The night floor's own air. The tables scatter only sunlight, so at night the
// haze would add nothing and the ground would stand unveiled against the night
// sky. The floor (what the veil leaves of it) is the radiance of a long path
// at night; a path of transmittance T scatters (1-T) of it.
vec3 pskyNightAir(vec3 ray){
 return mix(uPskyNightH,uPskyNightZ,pow(clamp(ray.y,0.,1.),.46))*uPskyGrade.z*(1.-uPskyGrade.y);
}
`
  : null;
const physCelestial = patchOnce(twilightCelestial,
  ' vec3 light=uCinemaKeyColor*disc*mix(.60,18.,uCinemaLight.x)*uCinemaOptics.x;\n',
  ' vec3 light=uPskySunDisc*disc*uCinemaOptics.x;\n');
export const PHYS_SKY_GLSL_OK = physSkyText != null && physCelestial != null;
const physOn = pinned(PHYS_SKY, '__flyPhysSkyOverride').enabled === true && PHYS_SKY_GLSL_OK;
/** True when the physical sky text is the one in use. */
export const PHYS_SKY_TEXT_ACTIVE = physOn;

export const CINEMA_GLSL = physOn ? physSkyText : twilightOn ? twilightSky : LEGACY_SKY_GLSL;
export const CINEMA_CELESTIAL_GLSL = physOn ? physCelestial : twilightOn ? twilightCelestial : LEGACY_CELESTIAL_GLSL;
/** Every variant, for the node gates only. */
export const CINEMA_SKY_VARIANTS = {
  legacy: { sky: LEGACY_SKY_GLSL, celestial: LEGACY_CELESTIAL_GLSL },
  twilight: { sky: twilightSky, celestial: twilightCelestial },
  phys: { sky: physSkyText, celestial: physCelestial },
};

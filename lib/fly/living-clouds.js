/**
 * LIVING WORLD — the Enhanced cloud march, relit and extended to the horizon
 * (FLY_LIVING_WORLD.md: LIVING_CLOUDS, FAR_CLOUDS, CIRRUS).
 *
 * Everything here PATCHES the already-built Enhanced march program text
 * (immersive-cloud-pass.js: tsMarch('cloud-march-r25', marchR25)), after the
 * TRUE_SCALE edits, so every gate that asserts that file's construction lines
 * and the Classic texts keeps reading exactly what it always read. Each edit is
 * an exact, single-match substitution that THROWS on a miss (the R25 swapExact
 * rule); with all three flags off the program is returned untouched.
 *
 * LIVING_CLOUDS — the key light is integrated as optical depth along 2–5 taps
 * (by profile) instead of a weighted density average; the phase function is a
 * two-lobe Henyey–Greenstein (forward + back), and multiple scattering is
 * Wrenninge's octave sum (each octave attenuates less, scatters less and is
 * more isotropic), so lit tops glow, edges toward the sun carry a silver
 * lining and interiors stay luminous grey instead of turning to slate. Beer's
 * "powder" darkens sun-facing interiors seen from the shadow side. The
 * authored ambient (cool lower, bright upper) keeps its shape, but its colour
 * and level are the physical sky's at the deck: the whole dome's irradiance,
 * not the zenith's (the zenith is the dimmest, bluest part of it), dimming
 * with the sky toward sunset as the key does. An ambient that stayed at its
 * daylight level while the key fell outweighed the backlit cores' warm,
 * forward-scattered sun 3:1 at golden hour and turned them zenith blue.
 *
 * FAR_CLOUDS — beyond the 22 km volume, the ray meets the curved cloud shell at
 * mid-deck; one wide-footprint density sample there, an analytic slant optical
 * depth and the same light model give the deck out to the horizon, fading in
 * across the volume's own 16–22 km fade so the two never double. Hazed by the
 * physical aerial volume at its own distance. A cumulus stands as tall as its
 * density clears the threshold, so the slant path runs through that column,
 * not the whole deck: edges are thin and soft, cores opaque. The column's top,
 * sloped by the neighbouring pixels' samples (screen-space derivatives, so no
 * second sample), is the visible surface: lit where it faces the sun, in the
 * cloud's own shadow where it turns away.
 *
 * CIRRUS — a thin, wind-streaked ice layer at ~9.5 km on the same curved world:
 * value noise stretched along the upper wind, strongly forward scattering, lit
 * by the sun as seen from the layer's altitude (it stays gold and pink for
 * minutes after the ground sunset), drifting with the jet-level wind.
 */
import { Vector2, Vector3, Vector4 } from 'three';
import { livingWorldOn, livingWorldBlock } from './living-world.js';
import { ATMO_AERIAL_LOOKUP_GLSL } from './atmosphere/glsl.js';
import { skyRadiance } from './atmosphere/model.js';
import { physSkyCpu, PSKY_UNIFORMS } from './atmosphere/runtime.js';
import { PHYS_SKY_TEXT_ACTIVE } from './cinema-sky.js';
import { R25_SKY } from './fly-constants.js';

const LIGHT_ON = livingWorldOn('LIVING_CLOUDS');
const FAR_ON = livingWorldOn('FAR_CLOUDS');
const CIRRUS_ON = livingWorldOn('CIRRUS');
const LIGHT = livingWorldBlock('LIVING_CLOUDS');
const FAR = livingWorldBlock('FAR_CLOUDS');
const CIRRUS = livingWorldBlock('CIRRUS');

/** True when any of the three blocks changes the march. */
export const LIVING_MARCH_ACTIVE = LIGHT_ON || FAR_ON || CIRRUS_ON;

/** Per-program edit results ('patched' | 'off'), for the gate and the device report. */
export const LIVING_CLOUD_SHADERS = {};

function swap(src, from, to, name) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0)
    throw new Error(`living-clouds (${name}): anchor ${at < 0 ? 'missing' : 'repeated'}: ${from.slice(0, 70)}`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}
function swapAll(src, from, to, count, name) {
  const parts = src.split(from);
  if (parts.length - 1 !== count) throw new Error(`living-clouds (${name}): ${parts.length - 1} of ${count} anchors: ${from.slice(0, 70)}`);
  return parts.join(to);
}

/** The shared uniform holders (merged into the Enhanced pass's uniforms). */
export const LIVING_CLOUD_UNIFORMS = {
  uLivTaps: { value: 3 },
  uLivPhase: { value: new Vector4(0.62, -0.22, 0.72, 0.24) }, // forward g, back g, forward weight, scale
  uLivOctave: { value: new Vector4(0.5, 0.52, 0.85, 3) }, // extinction, scattering, eccentricity per octave, count
  uLivLight: { value: new Vector4(0.0031, 1, 1, 0.6) }, // key extinction /m per density, direct gain, ambient gain, powder
  uLivSkyTint: { value: new Vector3(1, 1, 1) }, // the sky's light on the deck's upper ambient (colour x level)
  uLivGroundTint: { value: new Vector3(1, 1, 1) }, // the ground's on its lower ambient (the bases face it)
  uLivFar: { value: new Vector4(16000, 22000, 180000, 1) }, // fade in m (start, end), max m, density gain
  uLivFarShape: { value: new Vector4(0.42, 7000, 1, 1) }, // shell height fraction, path cap m, opacity gain, light gain
  uLivWeatherExt: { value: 0 },
  uLivFarAir: { value: new Vector4(0.55, 1, 0, 0) },
  uLivFarForm: { value: new Vector4(1, 2, 2, 0.5) }, // density at a full-deck column, relief, width/height, body density
  uLivFarRes: { value: new Vector4(900, 3500, 0.05, 0) }, // along-shell footprint (m) where the mean takes over (start, end), the mean's cover, -
  uLivCirrus: { value: new Vector4(9500, 0, 0.55, 1) }, // altitude m, coverage, opacity, gain
  uLivCirrusWind: { value: new Vector2(1, 0) },
  uLivCirrusPhase: { value: new Vector2(0, 0) },
  uLivCirrusSun: { value: new Vector4(0, 1, 1, 1) }, // sun elevation at the ground (rad), sun radiance above the air (rgb)
};

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------
const DECL = `
uniform float uLivTaps;
uniform vec4 uLivPhase, uLivOctave, uLivLight, uLivFar, uLivFarShape, uLivCirrus, uLivCirrusSun;
uniform vec3 uLivSkyTint, uLivGroundTint;
uniform float uLivWeatherExt;
uniform vec4 uLivFarAir; // aerial mix, eye side of the deck (0 below .. 1 above), -, -
uniform vec4 uLivFarForm; // density at a full-deck column, relief, width/height, body density
uniform vec4 uLivFarRes; // along-shell footprint where the mean takes over (start, end), the mean's cover, -
uniform vec2 uLivCirrusWind, uLivCirrusPhase;
`;

const LIGHT_GLSL = `
// LIVING_CLOUDS: Henyey–Greenstein relative to isotropic (x4pi).
float livHG(float mu,float g){float g2=g*g;return (1.-g2)/pow(max(1.+g2-2.*g*mu,1e-4),1.5);}
float livPhase(float mu,float k){return mix(livHG(mu,uLivPhase.y*k),livHG(mu,uLivPhase.x*k),uLivPhase.z)*uLivPhase.w;}
// Wrenninge's octaves: o-th order light attenuates by a^o, scatters by b^o
// and loses eccentricity by c^o; the sum approximates multiple scattering.
float livScatter(float mu,float tau,float powder){
 float s=0.,a=1.,b=1.,c=1.;
 for(int o=0;o<4;o++){if(float(o)>=uLivOctave.w)break;s+=b*livPhase(mu,c)*exp(-tau*a);a*=uLivOctave.x;b*=uLivOctave.y;c*=uLivOctave.z;}
 // Beer–powder: light builds up a short way inside the cloud, so the sunlit
 // body seen from its shadow side reads darker than its silhouette edge.
 return s*mix(1.,powder,uLivLight.w*(.5-.5*mu));
}
// Optical depth toward the key: density x segment length per tap (5, 4, 3 or
// 2 taps by profile), with the footprint widening along the light path (soft,
// stable self-shadow). Each tap is a full density lookup inside the march, so
// the tap count is the cloud light's main cost.
float livKeyDepth(vec3 p,float fp){
 float t;
 if(uLivTaps>4.5)t=densityAt(p+uCinemaKey*50.,max(fp,12.))*75.+densityAt(p+uCinemaKey*150.,max(fp,38.))*140.+densityAt(p+uCinemaKey*330.,max(fp,82.))*235.
  +densityAt(p+uCinemaKey*620.,max(fp,155.))*385.+densityAt(p+uCinemaKey*1100.,max(fp,275.))*480.;
 else if(uLivTaps>3.5)t=densityAt(p+uCinemaKey*80.,max(fp,20.))*130.+densityAt(p+uCinemaKey*260.,max(fp,65.))*260.
  +densityAt(p+uCinemaKey*600.,max(fp,150.))*445.+densityAt(p+uCinemaKey*1150.,max(fp,290.))*550.;
 else if(uLivTaps>2.5)t=densityAt(p+uCinemaKey*110.,fp)*170.+densityAt(p+uCinemaKey*340.,fp)*335.+densityAt(p+uCinemaKey*780.,fp)*600.;
 else t=densityAt(p+uCinemaKey*170.,fp)*300.+densityAt(p+uCinemaKey*600.,fp)*600.;
 return t*uLivLight.x;
}
`;

const OVER_GLSL = `
// Front-to-back "over" of a premultiplied layer behind what is already held.
void livOver(inout vec3 L,inout float A,vec3 l,float a){L+=(1.-A)*l;A+=(1.-A)*a;}
// First crossing of the bent ray with a true-height shell (cloudRayBounds' terms).
float livShellHit(vec3 r,float y){
 vec2 d=eye.xz-bendCenter;float qa=bendK*dot(r.xz,r.xz),qb=r.y+2.*bendK*dot(d,r.xz),qc=eye.y+bendK*dot(d,d)-y;
 if(abs(qa)<1e-12)return abs(qb)>1e-9?-qc/qb:-1.;
 float disc=qb*qb-4.*qa*qc;if(disc<0.)return -1.;
 float q=-.5*(qb+(qb<0.?-1.:1.)*sqrt(disc));
 float r0=q/qa,r1=abs(q)>1e-12?qc/q:-1.,lo=min(r0,r1),hi=max(r0,r1);
 return lo>=0.?lo:hi;
}
// d(true height)/d(true metre) of the bent ray at t: the slant through a layer.
float livSlope(vec3 r,float t,float metricRay){vec2 d=eye.xz+r.xz*t-bendCenter;return (r.y+2.*bendK*dot(d,r.xz))/metricRay;}
`;

// The air in front of a far layer: the physical aerial volume at its own
// distance (PHYS_SKY), or the authored extinction toward the sky otherwise,
// then the weather-only veil, exactly as the composite treats near clouds.
const AIR_GLSL = PHYS_SKY_TEXT_ACTIVE
  ? `${ATMO_AERIAL_LOOKUP_GLSL}
vec3 livAir(vec3 r,vec3 tr,float m,vec3 c){
 vec3 S,T,dir=normalize(vec3(r.x/metricScale,r.y,r.z/metricScale));
 pskyAerial(dir,m*.001,S,T);
 // The aerial pass mixes the same physics into the terrain at uLivFarAir.x
 // (AerialPerspective's 0.55): far layers take the same mix, so a cloud and
 // the ground behind it fade into one air instead of the cloud yellowing.
 c=mix(c,c*T+S*uPskySunIllum+pskyNightAir(dir)*(1.-T),uLivFarAir.x);
 return mix(cinemaSky(tr),c,exp(-uLivWeatherExt*m));
}
`
  : `
vec3 livAir(vec3 r,vec3 tr,float m,vec3 c){return mix(cinemaSky(tr),c,exp(-(uCinemaAir.x*uLivFarAir.x+uLivWeatherExt)*m));}
`;

const FAR_GLSL = `
// FAR_CLOUDS: the light on a far cloud of density d whose visible surface faces
// n. Seen from above, that surface is the column's top: the sun reaches a slope
// that faces it through little cloud and the far slope through the cloud's
// body (at least uLivFarForm.w dense; its own shadow side); the sky lights what
// faces up, the walls see the ground too. From below, the base under the whole
// deck.
vec3 livFarLight(float d,vec3 n,vec3 tr,float above){
 float tauBase=d*uLivLight.x*thickness*.62/max(uCinemaKey.y,.04);
 float tau=mix(tauBase,max(d,uLivFarForm.w)*uLivLight.x*thickness*(.5-.5*dot(n,uCinemaKey)),above);
 float mu=dot(tr,uCinemaKey),powder=1.-exp(-d*2.4);
 vec3 amb=mix(uCinemaCloudLower*uLivGroundTint,uCinemaCloudUpper*uLivSkyTint,mix(.62,.2+.8*n.y,above));
 return amb*uLivLight.z*(.62+.38*powder)+uCinemaKeyColor*uCinemaAir.w*livScatter(mu,tau,powder)*uLivLight.y*uLivFarShape.w;
}
// FAR_CLOUDS: the deck past the volume, on the curved mid-deck shell.
void livFarDeck(vec3 r,vec3 tr,float metricRay,float rayCone,float sceneT,inout vec3 L,inout float A){
 // From above the volume shows cloud tops, from below their bases: the far
 // sample sits where the volume's visible surface is, so the two agree across
 // the hand-over band instead of stacking a flat mid-deck slice under the tops.
 float side=uLivFarAir.y;
 float shell=base+thickness*mix(uLivFarShape.x-.14,uLivFarShape.x+.2,side);
 float t=livShellHit(r,shell);
 float m=t*metricRay;
 float reach=t>0.?smoothstep(uLivFar.x,uLivFar.y,m)*(1.-smoothstep(uLivFar.z*.72,uLivFar.z,m)):0.;
 // Out of the ring there is nothing to draw (and its edge is where the fade
 // is 0, so a slope lost across it is never seen).
 if(reach<=.001)return;
 vec3 p=metric(eye+r*t);
 // A pixel's footprint along the shell: across a grazing view it spans
 // kilometres and many clouds (measured: 6-11 km per cloud-resolution row near
 // the horizon from cruise; the whole far ring from just under the deck).
 float slope=max(abs(livSlope(r,t,metricRay)),.005),along=t*rayCone/slope;
 // A footprint this wide reads only the bank and billow scales: the far deck
 // never carries detail that would crawl as the camera moves.
 float d=densityAt(p,max(max(t*rayCone*1.6,600.),along*.5))*uLivFar.w;
 // A cumulus stands as tall as its density clears the threshold: the column
 // under this sample, and its top's horizontal slope from the neighbouring
 // pixels (a 2x2 solve of the column's screen derivatives against the shell
 // position's), so the one sample also gives the cloud its shape. Behind
 // terrain the sample is still taken, so a ridge does not slope the clouds
 // beside it.
 float col=thickness*smoothstep(0.,uLivFarForm.x,d);
 vec3 px=dFdx(p),py=dFdy(p);float cx=dFdx(col),cy=dFdy(col),det=px.x*py.z-px.z*py.x;
 vec2 g=abs(det)>1.?vec2(py.z*cx-px.z*cy,px.x*cy-py.x*cx)/det:vec2(0.);
 g*=uLivFarForm.y/max(1.,length(g)*.2);
 // No return from here on: one would let the compiler sink the derivatives
 // into divergent flow (measured: zero slope in every quad a cloud's edge
 // crosses). An empty or hidden sample only weighs nothing.
 // The slant path crosses that column, not the whole deck, and at a grazing
 // angle no more of it than a cumulus is wide (about its height times
 // uLivFarForm.z): thin edges let the ground through and fade, cores stay opaque.
 float path=min(col*min(.8/max(slope,.025),uLivFarForm.z),uLivFarShape.y);
 float a=(1.-exp(-d*.0027*path*uLivFarShape.z))*step(.002,d);
 // Where a pixel spans more of the shell than single clouds, it sees the
 // deck's mean instead: uLivFarRes.z of it covered, lit like a top. Structure
 // a pixel cannot resolve is replaced by its mean, never aliased, so the deck
 // runs to the horizon as one soft band and holds still in motion.
 float u=smoothstep(uLivFarRes.x,uLivFarRes.y,along),aBand=uLivFarRes.z;
 vec3 n=normalize(vec3(-g.x,1.,-g.y));
 // From above the tops' own slopes take the sun at any height, a low one too
 // (the base model's slant through the whole deck left far tops grey at sunset).
 float above=side;
 float cover=mix(a,aBand,u);
 vec3 c=(livFarLight(d,n,tr,above)*a*(1.-u)+livFarLight(uLivFarForm.w,vec3(0.,1.,0.),tr,above)*aBand*u)/max(cover,1e-4);
 c=livAir(r,tr,m,c);
 cover*=t<sceneT?reach:0.;
 livOver(L,A,c*cover,cover);
}
`;

const CIRRUS_GLSL = `
// CIRRUS: value noise whose lattices tile the cloud phase's 131072-unit period
// exactly (x cells 2048 units, z cells 512: 64 and 256 per period; octaves at
// integer multiples; hash period 64), so the periodic phase wraps without a
// seam. Streaks run west-east, the prevailing jet-stream direction: rotating
// the field by the live wind would swing the whole pattern about a point
// thousands of kilometres away whenever the wind veered.
float livCH(vec2 c,vec2 period){c=mod(c,period);vec3 q=fract(vec3(c.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float livCN(vec2 p,vec2 period){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(livCH(i,period),livCH(i+vec2(1,0),period),f.x),mix(livCH(i+vec2(0,1),period),livCH(i+vec2(1,1),period),f.x),f.y);}
float livCirrusDensity(vec2 xz,float lod){
 // Where the layer is at all: soft patches tens of kilometres across.
 vec2 pa=xz/16384.;
 float cover=livCN(pa,vec2(8.))*.65+livCN(pa*2.+vec2(3.,1.),vec2(16.))*.35;
 float cov=uLivCirrus.y;
 float area=smoothstep(1.-cov-.12,1.-cov+.18,cover);
 if(area<=0.)return 0.;
 // Filaments: thin ridges along the streak axis, bent gently by the cover
 // field (the hooked "mares' tails"), with a finer grain inside them.
 vec2 ps=vec2(xz.x/4096.,xz.y/256.+(cover-.5)*6.);
 float ridge=1.-abs(livCN(ps,vec2(32.,64.))*2.-1.);
 float fil=ridge*ridge*ridge*ridge;
 float fine=livCN(vec2(xz.x/2048.,xz.y/128.),vec2(64.));
 // Unresolved filaments are replaced by their mean, never aliased.
 return area*mix(fil*(.55+.45*fine),.3,lod);
}
void livCirrus(vec3 r,vec3 tr,float metricRay,float rayCone,float sceneT,inout vec3 L,inout float A){
 if(uLivCirrus.y<=.001)return;
 float t=livShellHit(r,uLivCirrus.x);
 if(t<=0.||t>=sceneT)return;
 float m=t*metricRay;
 vec3 p=metric(eye+r*t);
 // The cloud field's own geographic frame (the periodic phase), plus the
 // layer's faster upper-wind drift.
 vec2 xz=vec2(p.x*metricScale+phase.x,p.z*metricScale+phase.z)+uLivCirrusPhase;
 float lod=clamp(log2(max(1.,t*rayCone*2.5/256.))/3.,0.,1.);
 float d=livCirrusDensity(xz,lod);
 if(d<.003)return;
 float slant=1./max(abs(livSlope(r,t,metricRay)),.06);
 float a=(1.-exp(-d*.42*min(slant,8.)))*uLivCirrus.z*(1.-smoothstep(220000.,320000.,m));
 // The sun seen from the layer: ~3 degrees of horizon dip at 9.5 km keep it
 // lit after the ground sunset, reddened by the long path (fleet-trails' law).
 float dip=sqrt(2.*uLivCirrus.x/6371000.),el=uLivCirrusSun.x+dip;
 float lit=smoothstep(-.012,.012,el);
 float airMass=exp(-uLivCirrus.x/8500.)/(sin(max(el,0.))+.028);
 vec3 sunTint=exp(-vec3(.032,.072,.16)*airMass);
 // Ice crystals: a strong forward lobe and a faint 22-degree-halo shoulder.
 float mu=dot(tr,uCinemaSun);
 float ph=.55+1.6*pow(max(0.,mu),6.)+.18*smoothstep(.90,.93,mu)*(1.-smoothstep(.93,.96,mu));
 vec3 sun=uLivCirrusSun.yzw*sunTint*lit*ph;
 vec3 c=(sun+mix(uCinemaCloudLower,uCinemaCloudUpper,.9)*uLivSkyTint*.55)*uLivCirrus.w;
 c=livAir(r,tr,m,c);
 livOver(L,A,c*a,a);
}
`;

// ---------------------------------------------------------------------------
// The march patch
// ---------------------------------------------------------------------------
const LIGHT_FROM_A = `    float cloudShade;
    if(lightSamples<2.5)cloudShade=densityAt(p+uCinemaKey*170.,footprint)*.55+densityAt(p+uCinemaKey*600.,footprint)*.45;
    else cloudShade=densityAt(p+uCinemaKey*110.,footprint)*.38+densityAt(p+uCinemaKey*340.,footprint)*.34+densityAt(p+uCinemaKey*780.,footprint)*.28;
    float lit=exp(-cloudShade*mix(4.1,5.5,uCinemaArt*uCinemaLight.x));
`;
const LIGHT_TO_A = `    // LIVING_CLOUDS: integrated optical depth toward the key (cloudShade is tau now).
    float cloudShade=livKeyDepth(p,footprint);
    float lit=exp(-cloudShade);
`;
const LIGHT_FROM_B = `    float phase=.24+.38*pow(max(0.,mu),8.)+.10*pow(max(0.,-mu),3.);
    float powder=1.-exp(-d*2.4);
    float multi=(1.-exp(-cloudShade*1.2))*.085;
    vec3 ambient=mix(uCinemaCloudLower,uCinemaCloudUpper,smoothstep(.02,.92,h));
    color=ambient*(.43+.20*powder)+uCinemaKeyColor*uCinemaAir.w*(lit*phase*(.82+.24*powder)+multi);
`;
const LIGHT_TO_B = `    float powder=1.-exp(-d*2.4);
    vec3 ambient=mix(uCinemaCloudLower*uLivGroundTint,uCinemaCloudUpper*uLivSkyTint,smoothstep(.02,.92,h));
    color=ambient*uLivLight.z*(.62+.38*powder)+uCinemaKeyColor*uCinemaAir.w*livScatter(mu,cloudShade,powder)*uLivLight.y;
`;
// The art's "cool interiors" multiplied shade by (.70,.80,1.02): with the sky's
// own colour now in the ambient that counted the blue twice (measured: shaded
// bases at a 30-deg sun went violet, b/r 1.8). The sculpting stays, neutral.
const ART_FROM = 'color*mix(vec3(.70,.80,1.02),vec3(1.10,1.04,.92),lit)';
const ART_TO = 'color*mix(vec3(.80),vec3(1.10,1.04,.92),lit)';

/**
 * Patch the built Enhanced march (after TRUE_SCALE). Returns the input when
 * every block is off.
 */
export function livingMarch(src, name = 'cloud-march-r25') {
  if (!LIVING_MARCH_ACTIVE) {
    LIVING_CLOUD_SHADERS[name] = 'off';
    return src;
  }
  const ts = src.includes('vec3 tsTrueRay(vec3 r)');
  const trueRay = ts ? 'tsTrueRay(ray)' : 'ray';
  const sceneDist = ts ? 'tsSceneDistanceAt(vUv)' : 'distanceAt(vUv)';
  let out = swap(src, 'void main(){', `${DECL}${LIGHT_GLSL}${OVER_GLSL}${AIR_GLSL}${FAR_GLSL}${CIRRUS_GLSL}\nvoid main(){`, name);
  if (LIGHT_ON) {
    out = swap(out, LIGHT_FROM_A, LIGHT_TO_A, name);
    out = swap(out, LIGHT_FROM_B, LIGHT_TO_B, name);
    out = swap(out, ART_FROM, ART_TO, name);
  }
  if (FAR_ON || CIRRUS_ON) {
    // The far layers sit behind everything the volume holds (the camera is
    // below the cirrus everywhere it flies at cruise; above it, the cirrus
    // goes in front, the second branch). Computed before the slab bounds so
    // the empty-slab early returns still carry them.
    const far = FAR_ON ? ` if(uCinema>.5)livFarDeck(ray,livTR,metricRay,rayCone,livSceneT,livFarL,livFarA);\n` : '';
    const cirrus = CIRRUS_ON ? ` if(uCinema>.5&&eye.y<uLivCirrus.x)livCirrus(ray,livTR,metricRay,rayCone,livSceneT,livFarL,livFarA);\n` : '';
    const front = CIRRUS_ON ? ` vec3 livTopL=vec3(0.);float livTopA=0.;if(uCinema>.5&&eye.y>=uLivCirrus.x)livCirrus(ray,livTR,metricRay,rayCone,livSceneT,livTopL,livTopA);\n` : ` vec3 livTopL=vec3(0.);float livTopA=0.;\n`;
    out = swap(out, ' float low=base-600.,high=base+thickness;',
      ` vec3 livTR=${trueRay};float livSceneT=${sceneDist};\n vec3 livFarL=vec3(0.);float livFarA=0.;\n${front}${far}${cirrus} float low=base-600.,high=base+thickness;`, name);
    // Empty-slab exits keep the layers behind (and the cirrus in front).
    out = swapAll(out, 'gl_FragColor=vec4(0,0,0,1);return;}',
      'livOver(livTopL,livTopA,livFarL,livFarA);gl_FragColor=vec4(livTopL,1.-livTopA);return;}', 2, name);
    out = swap(out, ' gl_FragColor=vec4(light,trans);\n}',
      ' light+=trans*livFarL;trans*=1.-livFarA;\n vec3 livOL=livTopL;float livOA=livTopA;livOver(livOL,livOA,light,1.-trans);\n gl_FragColor=vec4(livOL,1.-livOA);\n}', name);
  }
  LIVING_CLOUD_SHADERS[name] = 'patched';
  return out;
}

// ---------------------------------------------------------------------------
// FAR_CLOUDS: the upsampling
// ---------------------------------------------------------------------------
// The cloud-resolution filter and the composite's reconstruction weigh
// neighbours by how alike their SCENE depths are, so cloud never bleeds across
// a silhouette. Within 0.8% of the distance, though, terrain seen at a grazing
// angle differs by ~3% per cloud row past ~15 km: neither ever blurred the far
// deck vertically, and it upsampled as 2.5-pixel blocks. Past the volume the
// tolerance widens to 4%, and (as the composite's reconstruction does, see
// immersive-cloud-pass.js) every depth beyond the volume's reach counts as one:
// grazing terrain and the sky blend under the deck; real silhouettes (an
// aircraft, a ridge in front of a valley) still differ by far more.
const farTolerance = (d) => `max(2.,${d}*mix(.008,.04,smoothstep(15000.,30000.,${d})))`;
const FILTER_WEIGHT = 'weight*=exp(-abs(distanceAt(uv)-dist)/max(2.,dist*.008));';

/** The Enhanced cloud-resolution filter (common + CLOUD_FILTER_GLSL) for the far deck; null when FAR_CLOUDS is off. */
export function livingFarFilter(src, name = 'cloud-filter-r25') {
  if (!FAR_ON) return null;
  const out = swap(src, 'void main(){', 'uniform float rangeM;\nvoid main(){', name);
  return swap(out, FILTER_WEIGHT, `{float livReach=rangeM*max(metricScale,1.)*1.1,fa=min(distanceAt(uv),livReach),fb=min(dist,livReach);weight*=exp(-abs(fa-fb)/${farTolerance('fb')});}`, name);
}

/** The Enhanced composite's reconstruction, the same tolerance; untouched when FAR_CLOUDS is off. */
export function livingComposite(src, name = 'cloud-composite-r25') {
  if (!FAR_ON) return src;
  const d = src.includes('min(distView,cloudReach)*.008') ? 'distView' : 'dist';
  return swap(src, `max(2.,min(${d},cloudReach)*.008)`, farTolerance(`min(${d},cloudReach)`), name);
}

// ---------------------------------------------------------------------------
// The sky a deck sees (PHYS_SKY)
// ---------------------------------------------------------------------------
// The scalar irradiance of the upper hemisphere at the deck's own height: three
// Gauss–Legendre rings in sin(elevation), each the 1:2:1 mean toward the sun,
// across and away (runtime.js's horizon average), within 2% of a 48x48
// integral and 3% in chroma from noon to the end of twilight. Ring radiances
// are cached on the deck height and the sun; the sky's own grade (illuminance,
// saturation, night floor, weather veil) is applied every frame, so the deck
// sees exactly the sky the composite draws.
const RINGS = [[0.1127, 0.2778], [0.5, 0.4444], [0.8873, 0.2778]];
const RING_UP = RINGS.map(([s]) => Math.pow(s, 0.46)); // the sky shader's up for a ray at that elevation
const deckSky = { h: NaN, muS: NaN, rings: RINGS.map(() => [0, 0, 0]), tap: [0, 0, 0] };
function deckSkyIrradiance(hKm, muS, out) {
  if (!(Math.abs(hKm - deckSky.h) <= 0.05 && Math.abs(muS - deckSky.muS) <= 2e-4)) {
    const c = physSkyCpu();
    deckSky.h = hKm;
    deckSky.muS = muS;
    for (let i = 0; i < RINGS.length; i++) {
      const L = deckSky.rings[i];
      L[0] = L[1] = L[2] = 0;
      for (const [lvc, w] of [[1, 0.25], [0, 0.5], [-1, 0.25]]) {
        const r = skyRadiance(c.p, c.trans, c.ms, hKm, RINGS[i][0], lvc, muS, 16, deckSky.tap);
        for (let k = 0; k < 3; k++) L[k] += r[k] * w;
      }
    }
  }
  const U = PSKY_UNIFORMS, illum = U.uPskySunIllum.value.x, g = U.uPskyGrade.value;
  const nH = U.uPskyNightH.value, nZ = U.uPskyNightZ.value, vH = U.uPskyVeilH.value, vZ = U.uPskyVeilZ.value;
  out[0] = out[1] = out[2] = 0;
  for (let i = 0; i < RINGS.length; i++) {
    const L = deckSky.rings[i], up = RING_UP[i], w = RINGS[i][1];
    const l = (0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2]) * illum;
    for (let k = 0; k < 3; k++) {
      const night = nH.getComponent(k) + (nZ.getComponent(k) - nH.getComponent(k)) * up;
      const veil = vH.getComponent(k) + (vZ.getComponent(k) - vH.getComponent(k)) * up;
      const graded = Math.max(0, l + (L[k] * illum - l) * g.x) + night * g.z;
      out[k] += Math.max(0, graded + (veil - graded) * g.y) * w;
    }
  }
  return out;
}
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const _sky = [0, 0, 0], _amb = [0, 0, 0];

// ---------------------------------------------------------------------------
// Per-frame uniforms
// ---------------------------------------------------------------------------
const TAPS = { ultra: 5, 'ultra-balanced': 4, high: 4, 'high-balanced': 3, medium: 3, phone: 2, low: 2 };

/**
 * @param u        the Enhanced uniforms holder (immersive-cloud-pass r25)
 * @param profile  the live cinema profile ({ name, ... })
 * @param ctx      { env: cinemaEnvironment, sky: [r,g,b] physical zenith radiance or null,
 *                   wx: runtime.weather.wx, sinEl, dt, paused, weatherExt, k: world units per metre }
 */
export function updateLivingClouds(u, profile, ctx) {
  if (!LIVING_MARCH_ACTIVE || !u.uLivTaps) return;
  const name = profile?.name ?? 'high';
  u.uLivTaps.value = LIGHT_ON ? TAPS[name] ?? 3 : 3;
  const ph = LIGHT.phase ?? {};
  u.uLivPhase.value.set(ph.gForward ?? 0.62, ph.gBack ?? -0.22, ph.wForward ?? 0.72, ph.scale ?? 0.24);
  const oc = LIGHT.octaves ?? {};
  u.uLivOctave.value.set(oc.a ?? 0.5, oc.b ?? 0.52, oc.c ?? 0.85, name === 'phone' || name === 'low' ? 2 : oc.count ?? 3);
  const li = LIGHT.light ?? {};
  u.uLivLight.value.set(li.keyExtinction ?? 0.0031, li.direct ?? 1, li.ambient ?? 1, li.powder ?? 0.6);
  // The sky's light on the deck, relative to the authored ambient: colour
  // (desaturated by skyTint) and level, the scalar irradiance the deck receives
  // over the authored ambient's luminance, times skyLevel, never above 1 (the
  // authored daylight ambient is the cap; the sky only ever dims it). Measured
  // (deck 2-5.5 km): ~1 from a high sun to ~25 deg, 0.65-0.75 at a 5-deg sun,
  // ~0.2 just after sunset, 1 again at night and under overcast.
  const tint = u.uLivSkyTint.value;
  const env = ctx.env;
  if (LIGHT_ON && PHYS_SKY_TEXT_ACTIVE && env?.cloudLower) {
    const deckKm = Math.max(0.001, ((ctx.cloudBase ?? 1500) + 0.5 * (ctx.cloudThickness ?? 2300)) / 1000);
    const E = deckSkyIrradiance(deckKm, Math.max(-1, Math.min(1, env.sunDir[1])), _sky), l = Math.max(1e-6, lum(E));
    for (let k = 0; k < 3; k++) _amb[k] = 0.5 * (env.cloudLower[k] + env.cloudUpper[k]);
    const level = Math.min(1, (LIGHT.skyLevel ?? 6.5) * l / Math.max(1e-6, lum(_amb)));
    const k = LIGHT.skyTint ?? 0.35;
    tint.set(level * (1 + (E[0] / l - 1) * k), level * (1 + (E[1] / l - 1) * k), level * (1 + (E[2] / l - 1) * k));
    // The bases face the ground, lit by the sun and the sky (the IBL's lower
    // hemisphere): near neutral by day, so a shaded base reads grey, not the
    // sky's blue (which tinting the already-blue authored lower ambient doubled).
    const G = PSKY_UNIFORMS.uPskyGround.value, gl = Math.max(1e-6, 0.2126 * G.x + 0.7152 * G.y + 0.0722 * G.z);
    u.uLivGroundTint.value.set(level * (1 + (G.x / gl - 1) * k), level * (1 + (G.y / gl - 1) * k), level * (1 + (G.z / gl - 1) * k));
  } else if (ctx.sky && LIGHT_ON) {
    // Without the physical sky: the zenith at the eye tints the authored ambient.
    const s = ctx.sky, l = Math.max(1e-4, 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]);
    const k = LIGHT.skyTint ?? 0.35;
    tint.set(1 + (s[0] / l - 1) * k, 1 + (s[1] / l - 1) * k, 1 + (s[2] / l - 1) * k);
    u.uLivGroundTint.value.copy(tint);
  } else {
    tint.set(1, 1, 1);
    u.uLivGroundTint.value.set(1, 1, 1);
  }
  const far = FAR ?? {};
  const farMax = name === 'phone' || name === 'low' ? 0 : name === 'medium' ? (far.mediumKm ?? 90) * 1000 : (far.maxKm ?? 180) * 1000;
  // Fade in across the volume's own fade-out (R25_SKY.cloudAir), so the two never double.
  const f0 = R25_SKY.cloudAir.fadeStartM, f1 = R25_SKY.cloudAir.fadeEndM;
  u.uLivFar.value.set(f0 + (f1 - f0) * (far.overlap ?? 0.4), f1 + (f1 - f0) * 0.15, FAR_ON ? farMax : 0, far.density ?? 1);
  u.uLivFarShape.value.set(far.shell ?? 0.42, far.pathCapM ?? 7000, far.opacity ?? 1, far.light ?? 1);
  u.uLivFarForm.value.set(far.formDensity ?? 1, far.relief ?? 2, far.aspect ?? 2, far.bodyDensity ?? 0.5);
  // The mean cover follows the deck's own coverage (measured from cruise: 0.024-0.096
  // of the far ring covered at coverage 0.44, 0.05 on average).
  const res = far.resolveM ?? [900, 3500];
  u.uLivFarRes.value.set(res[0], res[1], Math.min(0.3, ((far.meanCover ?? 0.05) * (ctx.coverage ?? 0.44)) / 0.44), 0);
  u.uLivWeatherExt.value = ctx.weatherExt ?? 0;
  // Which side of the deck the eye is on (0 below the base, 1 above the tops).
  const span = Math.max(1, ctx.cloudThickness ?? 2300), baseM = ctx.cloudBase ?? 1500;
  const side = Math.min(1, Math.max(0, ((ctx.eyeY ?? baseM) - baseM) / span));
  u.uLivFarAir.value.set(far.airMix ?? 0.55, side * side * (3 - 2 * side), 0, 0);
  // Cirrus cover: a deterministic slow wander (a few hours of period) under
  // the weather's own cover, thinning to nothing under a full overcast lid
  // (the lid hides it anyway) and in the cleanest clear air.
  const ci = CIRRUS ?? {};
  const wx = ctx.wx;
  const overcast = Math.min(1, Math.max(0, wx?.overcastT ?? 0));
  const presence = Math.min(1, Math.max(0, wx?.presenceFrac ?? 0.5));
  const hours = (ctx.timeMs ?? 0) / 3600000;
  const wander = 0.5 + 0.5 * Math.sin(hours * 0.9 + 1.3) * Math.cos(hours * 0.37 + 0.4);
  const cover = CIRRUS_ON && name !== 'low' ? ((ci.cover ?? 0.34) + (ci.coverRange ?? 0.26) * (wander - 0.5) * 2) * (0.55 + 0.45 * presence) * (1 - 0.8 * overcast) : 0;
  u.uLivCirrus.value.set(ci.altitudeM ?? 9500, Math.max(0, Math.min(0.85, cover)), ci.opacity ?? 0.55, ci.gain ?? 1);
  // Jet-level wind: the surface wind's direction, faster (capped), in scene units.
  const wxX = wx?.windX ?? 5, wxZ = wx?.windZ ?? 0, sp = Math.hypot(wxX, wxZ) || 1;
  u.uLivCirrusWind.value.set(wxX / sp, wxZ / sp);
  if (!ctx.paused) {
    const jet = Math.min(ci.windMaxMps ?? 38, Math.max(12, sp * (ci.windK ?? 4)));
    const dt = Math.min(ctx.dt ?? 0, 0.1), k = ctx.k ?? 1, P = 131072;
    const cp = u.uLivCirrusPhase.value;
    cp.x = (((cp.x - (wxX / sp) * jet * k * dt) % P) + P) % P;
    cp.y = (((cp.y - (wxZ / sp) * jet * k * dt) % P) + P) % P;
  }
  // The sun above the air (the trails' near-white), at the strength of the
  // authored clear key, so a sunlit layer matches the sunlit deck below it.
  const el = Math.asin(Math.max(-1, Math.min(1, ctx.sinEl ?? 1)));
  const sunK = (ci.sun ?? 0.85) * (ctx.keyStrength ?? 5.58) * 0.22;
  u.uLivCirrusSun.value.set(el, sunK, sunK * 0.97, sunK * 0.92);
}

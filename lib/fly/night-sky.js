/**
 * LIVING WORLD — the night sky (FLY_LIVING_WORLD.md: NIGHT_SKY).
 *
 * Three additions to the VISIBLE sky's celestial layer only (the composite's
 * cinemaCelestials; haze, water and the IBL bake never see them):
 *  - the Milky Way where it really is: the galactic pole and centre are
 *    turned into the local sky from sidereal time and latitude, so the band
 *    rises, wheels and sets with the stars; structure (star clouds, dust
 *    lanes) is noise in the galactic frame, so it rides with the band; the
 *    bulge toward Sagittarius is warmer and brighter;
 *  - scintillation: each star flickers at its own rate, more the more air
 *    its light crosses (strong near the horizon, still overhead);
 *  - the moon: maria and limb darkening on the disc, and a soft corona.
 * Everything scales with the existing star weight (night x clear sky), so a
 * day, overcast or fog frame is unchanged, and the band fades under city
 * skyglow (Manhattan shows none of it; Yosemite all of it). Anchored
 * single-match edits that throw on a miss; flag off = the composite untouched.
 */
import { Vector3, Vector4 } from 'three';
import { livingWorldOn, livingWorldBlock } from './living-world.js';
import { CITIES } from './poi/cities.js';

export const NIGHT_SKY_ON = livingWorldOn('NIGHT_SKY');
const NIGHT = livingWorldBlock('NIGHT_SKY');
const DEG = Math.PI / 180;

export const NIGHT_SKY_UNIFORMS = {
  uLivNight: { value: new Vector4(0, 0, 0, 0) }, // Milky Way gain, twinkle depth, moon corona gain, time (s)
  uLivGalPole: { value: new Vector3(0, 1, 0) },
  uLivGalCenter: { value: new Vector3(1, 0, 0) },
};

const HELPERS = `
uniform vec4 uLivNight;
uniform vec3 uLivGalPole,uLivGalCenter;
float livNH(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float livNN(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(livNH(i),livNH(i+vec3(1,0,0)),f.x),mix(livNH(i+vec3(0,1,0)),livNH(i+vec3(1,1,0)),f.x),f.y),
  mix(mix(livNH(i+vec3(0,0,1)),livNH(i+vec3(1,0,1)),f.x),mix(livNH(i+vec3(0,1,1)),livNH(i+vec3(1,1,1)),f.x),f.y),f.z);}
float livNF(vec3 p){return livNN(p)*.5+livNN(p*2.03+3.1)*.28+livNN(p*4.07+7.7)*.14+livNN(p*8.13+1.3)*.08;}
vec3 livMilkyWay(vec3 r){
 if(uLivNight.x<=0.)return vec3(0.);
 float b=dot(r,uLivGalPole);
 float band=exp(-b*b/.030),core=exp(-b*b/.0036);
 float toward=max(0.,dot(r,uLivGalCenter));
 float bulge=pow(toward,5.)*exp(-b*b/.016);
 vec3 e2=cross(uLivGalPole,uLivGalCenter);
 vec3 g=vec3(dot(r,uLivGalCenter),dot(r,e2),b);
 float starClouds=livNF(g*5.+vec3(2.,7.,1.));
 float lanes=smoothstep(.42,.70,livNF(g*vec3(9.,9.,22.)+vec3(5.,1.,3.)));
 float glow=(band*.30+core*.42+bulge*1.25)*(.45+.75*starClouds)*mix(1.,.30,lanes*core*(.6+.4*toward));
 vec3 col=mix(vec3(.60,.68,.98),vec3(1.,.86,.68),clamp(bulge*1.3+.12,0.,1.));
 return col*glow*uLivNight.x*smoothstep(0.,.22,r.y);
}
float livTwinkle(vec2 cell,float up){
 float rate=5.+9.*cinemaStarHash(cell+5.);
 float s=sin(uLivNight.w*rate+cinemaStarHash(cell+9.)*6.2832)*.5+sin(uLivNight.w*rate*1.73+1.)*.5;
 return 1.+uLivNight.y*s*(1.-smoothstep(.12,.7,up));
}
`;

const MOON_FROM = ' light+=vec3(.57,.72,1.)*smoothstep(.999989-moonAa,.999989+moonAa,moonFacing)*.60*uCinemaOptics.x*uCinemaOptics.w;\n';
const MOON_TO = ` float livMoonDisc=smoothstep(.999989-moonAa,.999989+moonAa,moonFacing);
 if(livMoonDisc>0.){
  // The disc in its own frame: maria (low-frequency dark seas) and limb darkening.
  vec3 livMt=normalize(cross(uCinemaMoon,vec3(.0001,1.,0.)));vec3 livMb=cross(livMt,uCinemaMoon);
  vec2 livMd=vec2(dot(ray,livMt),dot(ray,livMb))/.00469;
  float livMr=clamp(dot(livMd,livMd),0.,1.);
  float livMaria=smoothstep(.46,.74,livNF(vec3(livMd*2.2,3.7)));
  livMoonDisc*=(1.-.36*livMaria)*(.70+.30*sqrt(1.-livMr));
 }
 light+=vec3(.57,.72,1.)*livMoonDisc*.60*uCinemaOptics.x*uCinemaOptics.w;
 float livMh=max(0.,moonFacing);
 light+=vec3(.50,.60,.82)*(pow(livMh,2400.)*.30+pow(livMh,180.)*.06)*uLivNight.z*uCinemaOptics.w*(1.-uCinemaOptics.z);
`;
const STARS_FROM = ' light+=tint*point*step(.9975,star)*2.5*uCinemaOptics.y*smoothstep(.02,.30,ray.y);\n return light;\n}';
const STARS_TO = ` light+=tint*point*step(.9975,star)*2.5*uCinemaOptics.y*smoothstep(.02,.30,ray.y)*livTwinkle(cell,ray.y);
 // A uniform branch: daylight frames (star weight 0) skip the band entirely.
 if(uCinemaOptics.y>0.)light+=livMilkyWay(ray)*uCinemaOptics.y;
 return light;
}`;

function once(src, from, to, what) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) throw new Error(`night-sky: ${what} anchor ${at < 0 ? 'missing' : 'repeated'}`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

/** Patch the built Enhanced composite's celestial layer; off = untouched. */
export function nightSkyComposite(src) {
  if (!NIGHT_SKY_ON) return src;
  let out = once(src, 'vec3 cinemaCelestials(vec3 ray){', `${HELPERS}vec3 cinemaCelestials(vec3 ray){`, 'celestials');
  out = once(out, MOON_FROM, MOON_TO, 'moon');
  return once(out, STARS_FROM, STARS_TO, 'stars');
}

// IAU galactic north pole and centre (J2000).
const GNP = { ra: 192.85948 * DEG, dec: 27.12825 * DEG };
const GC = { ra: 266.40499 * DEG, dec: -28.93617 * DEG };

/** A J2000 RA/Dec as a scene direction (+X east, +Y up, +Z south) for an observer. */
export function equatorialToScene(ra, dec, lstRad, latRad, out) {
  const H = lstRad - ra, cd = Math.cos(dec), sd = Math.sin(dec), cl = Math.cos(latRad), sl = Math.sin(latRad);
  const east = -cd * Math.sin(H);
  const north = sd * cl - cd * Math.cos(H) * sl;
  const up = sd * sl + cd * Math.cos(H) * cl;
  return out.set(east, up, -north);
}

/** Local sidereal time (radians) — the same sidereal clock trueSun() uses. */
export function localSiderealRad(tMs, lonDeg) {
  const n = tMs / 86400000 + 2440587.5 - 2451545.0;
  const gmstH = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  return (gmstH * 15 + lonDeg) * DEG;
}

/**
 * Artificial skyglow at the eye, 0..1: Walker's law (a town's sky brightness
 * falls as distance^-2.5) summed over the curated cities within 80 km. The
 * list is densest where people live (the New York area alone is dozens of
 * entries), so its count stands in for population.
 */
export function skyglowAt(latDeg, lonDeg) {
  let g = 0;
  const cl = Math.cos(latDeg * DEG);
  for (let i = 0; i < CITIES.length; i++) {
    const c = CITIES[i], dy = (c[1] - latDeg) * 111.32, dx = (c[2] - lonDeg) * 111.32 * cl, d2 = dx * dx + dy * dy;
    if (d2 < 6400) g += 1 / (1 + Math.pow(d2, 1.25) / 498.83); // 1 / (1 + (d / 12 km)^2.5)
  }
  return 1 - Math.exp(-g / 2);
}
const _glow = { lat: NaN, lon: NaN, k: 0 };

/** Per frame (cheap): the galactic frame for the eye, and the gains. */
export function updateNightSky(u, { timeMs, latDeg, lonDeg, elapsed, reducedMotion }) {
  if (!NIGHT_SKY_ON || !u.uLivNight) return;
  const lst = localSiderealRad(timeMs, lonDeg || 0), lat = (latDeg || 0) * DEG;
  equatorialToScene(GNP.ra, GNP.dec, lst, lat, u.uLivGalPole.value);
  equatorialToScene(GC.ra, GC.dec, lst, lat, u.uLivGalCenter.value);
  // The skyglow sum only when the eye has moved a couple of kilometres.
  if (!(Math.abs((latDeg || 0) - _glow.lat) < 0.02 && Math.abs((lonDeg || 0) - _glow.lon) < 0.02)) {
    _glow.lat = latDeg || 0; _glow.lon = lonDeg || 0; _glow.k = skyglowAt(_glow.lat, _glow.lon);
  }
  const n = NIGHT ?? {};
  const milkyWay = (n.milkyWay ?? 0.055) * (1 - (n.skyglow ?? 0.9) * _glow.k);
  u.uLivNight.value.set(milkyWay, reducedMotion ? 0 : n.twinkle ?? 0.35, n.moonCorona ?? 1, elapsed % 3600);
}

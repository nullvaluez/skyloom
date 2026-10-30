/**
 * SHIP PASS CITY (FLY_SHIP_PASS.md 5.3, CT-5) — NIGHT_RHYTHM: the city's
 * evening, read off the sun.
 *
 *  (a) the NIGHT_LIGHTS hand-off seam at the road ring (nightLightsSeamGLSL,
 *      an anchored edit on lib/fly/night-lights-atlas.js's text);
 *  (b) window light keyed to the true sun elevation (twilightK);
 *  (c) window occupancy by local solar hour (occupancyAt, solarHour), all four numbers in
 *      ONE shared uniform, `uNightRhythm` = (office, residential, other,
 *      twilight), bound into the Enhanced architecture programs by
 *      applyNightRhythm (anchored edits; the satellite-architecture-material.js
 *      / city-facades.js idiom: a missing or repeated anchor throws).
 *
 * Flag off: NIGHT_RHYTHM_ON is false, no text is touched, no key changes and
 * the uniform is never bound or written. No new program: with the flag on
 * each edited material keeps one program under its own key suffix.
 */
import { Vector4 } from 'three';
import { shipPassBlock, shipPassOn } from './ship-pass';

export const NIGHT_RHYTHM_ON = shipPassOn('NIGHT_RHYTHM');
const BLOCK = shipPassBlock('NIGHT_RHYTHM');
export const NIGHT_RHYTHM_KEY = '|night-rhythm-v1';

/** The one uniform: (office share, residential share, other share, twilight weight). */
export const NIGHT_RHYTHM_UNIFORM = { value: new Vector4(1, 1, 1, 0) };

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Local SOLAR hour from the published sun (runtime.sun: sinEl, decl, az) and
 * the latitude: cos H = (sin el - sin phi sin decl) / (cos phi cos decl), with
 * H's sign the azimuth's (both the legacy `az` = H and the true azimuth share
 * sign(sin H)). The sun's own clock (live, pinned, an adventure's or the
 * conditions picker's) is therefore the clock: nothing else is read.
 */
export function solarHour(sun, latDeg = 40) {
  const DEG = Math.PI / 180;
  const phi = Math.max(-89, Math.min(89, latDeg)) * DEG;
  const d = sun?.decl ?? 0;
  const c = ((sun?.sinEl ?? 1) - Math.sin(phi) * Math.sin(d)) / Math.max(1e-6, Math.cos(phi) * Math.cos(d));
  const H = Math.acos(Math.max(-1, Math.min(1, c))) * ((sun?.az ?? 0) < 0 ? -1 : 1);
  const h = 12 + H / DEG / 15;
  return ((h % 24) + 24) % 24;
}

/** Piecewise-linear [[hour, value], ...] at `hour` (wraps at 24). */
export function curveAt(points, hour) {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < points.length; i++) {
    const [h0, v0] = points[i - 1];
    const [h1, v1] = points[i];
    if (h <= h1) return h1 === h0 ? v1 : v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  return points[points.length - 1][1];
}

/** { office, residential, other } window shares at a local solar hour. */
export function occupancyAt(hour, block = BLOCK) {
  const o = block.occupancy;
  return { office: curveAt(o.office, hour), residential: curveAt(o.residential, hour), other: curveAt(o.other, hour) };
}

/** Window-light weight from the TRUE sun elevation (deg): 0 above offEl, 1 by fullEl. */
export function twilightK(elDeg, block = BLOCK) {
  const { offEl, fullEl } = block.twilight;
  return 1 - smooth(fullEl, offEl, elDeg);
}

/**
 * Write the uniform from runtime.sun and the latitude (runtime.geo.y). Cheap;
 * the building and skyline layers call it every frame only while the flag is on.
 */
export function updateNightRhythm(sun, latDeg = 40, block = BLOCK) {
  if (!sun) return NIGHT_RHYTHM_UNIFORM.value;
  const el = (Math.asin(Math.max(-1, Math.min(1, sun.sinEl ?? 1))) * 180) / Math.PI;
  const occ = occupancyAt(solarHour(sun, latDeg), block);
  return NIGHT_RHYTHM_UNIFORM.value.set(occ.office, occ.residential, occ.other, twilightK(el, block));
}

function once(text, from, to, where) {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + from.length) >= 0) {
    throw new Error(`night-rhythm: ${where} anchor ${at < 0 ? 'missing' : 'repeated'}: ${from.trim().slice(0, 70)}`);
  }
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** The architecture edits as text (pure; the node gate reads them). */
export const NIGHT_RHYTHM_ARCH = {
  decl: ['uniform float uArchitectureNight;', 'uniform float uArchitectureNight;\nuniform vec4 uNightRhythm;'],
  // Before the glow: the share for this building's family, then a stable
  // per-window-cell switch (the filtered average once the floor is sub-pixel).
  glow: [
    'float glow = paneMask * occupied * darkBuilding * ',
    `float nrOffice=float(family==3.||family==4.||family==7.);
float nrHome=float(family==0.||family==1.||family==6.);
float nrShare=mix(mix(uNightRhythm.z,uNightRhythm.x,nrOffice),uNightRhythm.y,nrHome);
occupied*=mix(step(archHash(vec2(floor(cell.x)+seed*.37,floor(cell.y)*1.31+7.)),nrShare),nrShare,minify);
float glow = paneMask * occupied * darkBuilding * `,
  ],
  // The window emission takes at least the elevation-keyed twilight weight.
  emit: [
    'totalEmissiveRadiance += lamp * glow * uArchitectureNight * uArchitectureLighting * ',
    'totalEmissiveRadiance += lamp * glow * max(uArchitectureNight,uNightRhythm.w) * uArchitectureLighting * ',
  ],
};

/** Apply the architecture edits to a compiling shader (throws on a bad anchor). */
export function applyNightRhythm(shader) {
  const A = NIGHT_RHYTHM_ARCH;
  shader.uniforms.uNightRhythm = NIGHT_RHYTHM_UNIFORM;
  let fs = shader.fragmentShader;
  fs = once(fs, A.decl[0], A.decl[1], 'fragment');
  fs = once(fs, A.glow[0], A.glow[1], 'fragment');
  fs = once(fs, A.emit[0], A.emit[1], 'fragment');
  shader.fragmentShader = fs;
}

/**
 * (a) The NIGHT_LIGHTS hand-off: the lamps' near fade re-anchored to the road
 * ring (recovered from the shipped uniform: uNLFade.y = nearHi x ring, with
 * `nearHi` NIGHT_LIGHTS.nearFade[1], the value living-ground.js writes).
 */
export function nightLightsSeamGLSL(text, nearHi, block = BLOCK) {
  const { band, gain, easeK } = block.seam;
  const f = (x) => Number(x).toFixed(4);
  return once(
    text,
    'float near=smoothstep(uNLFade.x,uNLFade.y,length(metricRay.xz))*uNLPatPlace.w;',
    `float nrD=length(metricRay.xz),nrRing=uNLFade.y/${f(nearHi)};
  float near=smoothstep(${f(band[0])}*nrRing,${f(band[1])}*nrRing,nrD)*uNLPatPlace.w*mix(${f(gain)},1.,smoothstep(${f(band[1])}*nrRing,${f(band[1] + easeK)}*nrRing,nrD));`,
    'night-lights',
  );
}

/** The resolved block (tunables; harnesses read it). */
export function nightRhythmBlock() {
  return BLOCK;
}

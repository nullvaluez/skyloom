/**
 * TRUE EARTH — HDR_GUARD: sanitize the cloud composite's final HDR write.
 *
 * The composite (lib/fly/immersive-cloud-pass.js) is the last full-screen
 * pass before bloom wherever bloom runs, and it rewrites every pixel. A single
 * NaN, Inf or negative value there is spread across the frame by bloom's
 * mipmap chain (BLACK_FLICKER_FIX.md measured it). `hdrSafe` maps NaN to 0 and
 * +Inf to the half-float ceiling, and leaves every valid pixel untouched.
 *
 * Pure strings and one pin read, so a node gate can test it
 * (scripts/verify-hdr-guard.mjs, which also runs the GLSL on WebGL2).
 */
import { pinned } from './fly-pins';
import { HDR_GUARD } from './fly-constants';

export const HDR_SAFE_GLSL = `
// HDR_GUARD: min/max follow IEEE maxNum/minNum on D3D, Metal and GL drivers,
// so NaN becomes 0 even where fast-math folds isnan() away.
vec3 hdrSafe(vec3 c){return min(max(c,vec3(0.)),vec3(65504.));}
`;

const OUT = ' gl_FragColor=vec4(mix(scene,result,cloudMix),1.);';
const OUT_SAFE = ' gl_FragColor=vec4(hdrSafe(mix(scene,result,cloudMix)),1.);';

function once(src, from, to) {
  if (typeof src !== 'string') return null;
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) return null;
  return src.slice(0, at) + to + src.slice(at + from.length);
}

/** The composite with its final HDR write sanitized, or null if an anchor moved. */
export function guardHdrComposite(src) {
  return once(once(src, OUT, OUT_SAFE), 'void main(){', `${HDR_SAFE_GLSL}\nvoid main(){`);
}

/** The resolved HDR_GUARD block (URL / console pins applied once, at load). */
export const HDR_GUARD_ACTIVE = pinned(HDR_GUARD, '__flyHdrGuardOverride');

/** Guarded when the flag is on and both anchors matched; else the input, unchanged. */
export function hdrGuarded(src) {
  return HDR_GUARD_ACTIVE.enabled === true ? guardHdrComposite(src) ?? src : src;
}

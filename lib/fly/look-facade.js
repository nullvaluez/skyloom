import { LOOK_FACADE } from './fly-constants';
import { pinned } from './fly-pins';

/** LOOK PASS C (FACADE): building walls, glass, roofs and their response to light.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_FACADE_CFG = pinned(LOOK_FACADE, '__flyLookFacadeOverride');
export const LOOK_FACADE_ON = LOOK_FACADE_CFG.enabled === true;

/** Appended to the architecture program key only when the flag is on. */
export const LOOK_FACADE_KEY = '|look-facade-v1';

const f = (x) => Number(x).toFixed(4);

/** Replace exactly one occurrence of `from`; a miss or a repeat throws. */
function once(src, from, to) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) throw new Error(`LOOK_FACADE: shader anchor ${at < 0 ? 'missing' : 'repeated'}: ${from.slice(0, 70)}`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

/**
 * Night: when a window cell becomes subpixel the shipped shader replaced the
 * lit pattern by its area average, so every building past ~1 km became a flat,
 * evenly lit tan wall. Here the average is replaced by two coarser lit-room
 * levels (a lit window in a 2x2 cluster, then a lit 2x2 group in a 6x4 block),
 * each box-filtered like the windows and retired to its own mean before it is
 * subpixel. The far mean is per building and lower than before, so a far tower
 * is a dark mass with a few points, not a lit slab. Weighted by uCinema.
 */
function nightGLSL(c, baseGlow, nightRhythm) {
  const n = c.night;
  return `// LOOK_FACADE: sparse lit rooms instead of an evenly lit far wall.
if(uCinema>.5){
 float lfOcc=occupancy*.6${nightRhythm ? '*nrShare' : ''};
 float lfAct=mix(${f(n.activity[0])},${f(n.activity[1])},archHash(vec2(seed*.5387,7.13)));
 float lfBase=darkBuilding*(${baseGlow});
 float lfWall=isWall*step(.5,vFacadeMetres.y);
 vec2 lfC1=cell/vec2(${f(n.l1[0])},${f(n.l1[1])}),lfW1=width/vec2(${f(n.l1[0])},${f(n.l1[1])});
 vec2 lfC2=cell/vec2(${f(n.l2[0])},${f(n.l2[1])}),lfW2=width/vec2(${f(n.l2[0])},${f(n.l2[1])});
 float lfLit1=step(archHash(floor(lfC1)+vec2(seed*.71,seed*.29+3.1)),lfOcc*lfAct*${f(n.share1)});
 float lfLit2=step(archHash(floor(lfC2)+vec2(seed*.43+1.7,seed*.19)),lfOcc*lfAct*${f(n.share2)});
 float lfBox1=archCoverage(lfC1.x,${f(n.duty1[0])},lfW1.x)*archCoverage(lfC1.y,${f(n.duty1[1])},lfW1.y);
 float lfBox2=archCoverage(lfC2.x,${f(n.duty2[0])},lfW2.x)*archCoverage(lfC2.y,${f(n.duty2[1])},lfW2.y);
 float lfM1=smoothstep(${f(n.minify1[0])},${f(n.minify1[1])},max(lfW1.x,lfW1.y));
 float lfM2=smoothstep(${f(n.minify2[0])},${f(n.minify2[1])},max(lfW2.x,lfW2.y));
 float lfMean2=${f(n.duty2[0] * n.duty2[1])}*lfOcc*lfAct*${f(n.share2)}*${f(n.farMean)};
 float lfE2=${f(n.gain2)}*mix(lfBox2*lfLit2,lfMean2,lfM2);
 float lfE1=mix(${f(n.gain1)}*lfBox1*lfLit1,lfE2,lfM1);
 glow=mix(glow,lfWall*lfBase*lfE1,minify*${f(n.strength)});
}
`;
}

/** The CITY_FACADES / BUILDING_REALISM palette block with this pass's cladding
 * and glazing overrides (flag on only; city-facades.js calls it). */
export function lookFacadeCityBlock(block, c = LOOK_FACADE_CFG) {
  const o = c.day?.enabled === false ? null : c.day?.palette;
  return o ? { ...block, ...o, claddingCuts: { ...block.claddingCuts, ...o.claddingCuts } } : block;
}

/**
 * Day: the realism palette chose believable materials but pulled every
 * building to one mid-grey value (jitter 0.94-1.04) and roofs to the walls'
 * value, so a city from the air read as one grey mass. Here each building
 * gets its own value and a little chroma, flat roofs sit a step darker than
 * the sunlit walls with filtered tar/plant patches, and tall facades carry a
 * multi-storey band that stays legible after single floors retire.
 * Weighted by cityDay, so full night and Classic keep their pixels.
 */
function dayGLSL(c) {
  const d = c.day;
  return `// LOOK_FACADE: one value per building, roofs apart from walls, storey bands.
float lfDay=cityDay*${f(d.strength)};
float lfPick=mix(fract(seed*.6173+.19),fract(cityCell*5.17+.61),cityShared);
float lfOpaqueWall=realOpaque*(1.-realPane);
float lfLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
diffuseColor.rgb=mix(diffuseColor.rgb,max(vec3(0.),mix(vec3(lfLuma),diffuseColor.rgb,${f(1 + d.chroma)})),lfDay*lfOpaqueWall);
diffuseColor.rgb*=mix(1.,mix(${f(d.wallValue[0])},${f(d.wallValue[1])},lfPick),lfDay*lfOpaqueWall);
float lfRoof=(1.-isWall)*cityFlat;
diffuseColor.rgb*=mix(1.,mix(${f(d.roofValue[0])},${f(d.roofValue[1])},fract(seed*.2791+.37)),lfDay*lfRoof);
vec2 lfR=vArchitectureRoof*uCinematicMetres/${f(d.roofPatchM)}+vec2(fract(seed*.37),fract(seed*.53));
vec2 lfRW=max(fwidth(lfR),vec2(.001));
float lfRH=archHash(floor(lfR)+vec2(seed*.11,seed*.07));
float lfRDark=step(.5,archHash(floor(lfR)+vec2(3.7,seed*.13)));
float lfRPatch=archCoverage(lfR.x,.62,lfRW.x)*archCoverage(lfR.y,.48,lfRW.y)*step(${f(1 - d.roofPatchShare)},lfRH);
float lfRRes=1.-smoothstep(.25,.6,max(lfRW.x,lfRW.y));
float lfRTone=mix(${f(d.roofPatchTone[1])},${f(d.roofPatchTone[0])},lfRDark);
diffuseColor.rgb*=mix(1.,mix(1.+${f(d.roofPatchShare * 0.3)}*(${f((d.roofPatchTone[0] + d.roofPatchTone[1]) / 2)}-1.),mix(1.,lfRTone,lfRPatch),lfRRes),lfDay*lfRoof);
float lfStoreys=${f(d.bandFloors[0])}+mod(seed,${f(d.bandFloors[1] - d.bandFloors[0] + 1)});
float lfBandW=max(width.y/lfStoreys,.001);
float lfBand=archCoverage(cell.y/lfStoreys+.5,${f(d.bandDuty)},lfBandW);
float lfBandRes=1.-smoothstep(.3,.7,lfBandW);
float lfTall=float(family==1.||family==3.||family==4.||family==7.);
diffuseColor.rgb*=1.-lfDay*isWall*lfTall*mix(${f(d.bandDuty)},lfBand,lfBandRes)*${f(d.band)};
`;
}

/** Flag-on only: anchored edits at the end of the architecture material's onBeforeCompile. */
export function applyLookFacade(shader, { groundLighting = true, nightRhythm = false } = {}, c = LOOK_FACADE_CFG) {
  let s = shader.fragmentShader;
  const baseGlow = groundLighting ? 'buildingGlow' : '0.14+fract(seed*0.113)*0.24';
  if (c.day?.enabled !== false && s.includes('float realGlassMask=')) s = once(s, 'float entrance = ', `${dayGLSL(c)}float entrance = `);
  if (c.night?.enabled !== false) s = once(s, 'glow += entrance * ', `${nightGLSL(c, baseGlow, nightRhythm)}glow += entrance * `);
  shader.fragmentShader = s;
}

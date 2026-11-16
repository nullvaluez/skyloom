import { Vector3 } from 'three';
import { LOOK_FACADE } from './fly-constants';
import { pinned } from './fly-pins';
import { cityFacadeGLSL, CITY_FACADES_BLOCK } from './city-facades';
import { lookTierAllowed } from './look-tier';

/** LOOK PASS C (FACADE): building walls, glass, roofs and their response to light.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_FACADE_CFG = pinned(LOOK_FACADE, '__flyLookFacadeOverride');
export const LOOK_FACADE_ON = LOOK_FACADE_CFG.enabled === true;

/** Appended to the architecture program key only when the flag is on. */
export const LOOK_FACADE_KEY = '|look-facade-v4';

const f = (x) => Number(x).toFixed(4);
const v3 = (c) => `vec3(${c.map(f).join(',')})`;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * uLookFacade is 1 on desktop High/Ultra and 0 on Medium/Low and phones. Every
 * LOOK_FACADE block sits behind a uniform branch on it, so the lower tiers run
 * only the shipped expressions (rule 5: their pixels AND their cost). It starts
 * at 0 and SatBuildingLayer sets it once a frame from the live cinema profile.
 * uLookFacadeTwilight / uLookFacadeSun carry the twilight weight and the
 * world-space sun direction (written by updateLookFacade once a frame).
 */
export const LOOK_FACADE_UNIFORMS = {
  uLookFacade: { value: 0 },
  uLookFacadeTwilight: { value: 0 },
  uLookFacadeSun: { value: new Vector3(0, 1, 0) },
};
/** SatBuildingLayer calls this once a frame with the live cinema profile (flag on only).
 * The shared tier test (lib/fly/look-tier.js) decides; a touch device keeps the pre-pass look. */
export function setLookFacadeProfile(profile) {
  LOOK_FACADE_UNIFORMS.uLookFacade.value = lookTierAllowed(profile) ? 1 : 0;
}
/** SatBuildingLayer calls this once a frame with runtime.sun (flag on only): two uniform writes. */
export function updateLookFacade(sun, c = LOOK_FACADE_CFG) {
  const t = c.twilight;
  if (!sun || !Number.isFinite(sun.sinEl)) return;
  const sin = Math.max(-1, Math.min(1, sun.sinEl)), cos = Math.sqrt(1 - sin * sin), az = Number.isFinite(sun.az) ? sun.az : 0;
  const el = Math.asin(sin) * 180 / Math.PI;
  LOOK_FACADE_UNIFORMS.uLookFacadeTwilight.value = t && t.enabled !== false
    ? smooth(t.elevation[0], t.elevation[1], el) * (1 - smooth(t.elevation[2], t.elevation[3], el)) * t.strength : 0;
  LOOK_FACADE_UNIFORMS.uLookFacadeSun.value.set(-Math.sin(az) * cos, sin, Math.cos(az) * cos);
}

/** Replace exactly one occurrence of `from`; a miss or a repeat throws. */
function once(src, from, to) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) throw new Error(`LOOK_FACADE: shader anchor ${at < 0 ? 'missing' : 'repeated'}: ${from.slice(0, 70)}`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

/** A cumulative-share choice as nested ternaries (h < share0 ? t0 : ...). */
function chooseTint(list, h) {
  let s = v3(list[list.length - 1].tint);
  for (let i = list.length - 2; i >= 0; i--) s = `(${h}<${f(list[i].share)}?${v3(list[i].tint)}:${s})`;
  return s;
}

/** The per-building dark-glass pick for tall families (shared by the day and light blocks). */
const darkTowerGLSL = (d) => `float lfTall=float(family==1.||family==3.||family==4.||family==7.);
 float lfDarkT=lfTall*step(${f(1 - d.darkTower.share)},mix(fract(seed*.3371+.13),fract(cityCell*9.13+.37),cityShared));`;

/**
 * Night: when a window cell becomes subpixel the shipped shader replaced the
 * lit pattern by its area average, so every building past ~1 km became a flat,
 * evenly lit tan wall. Here the average is replaced by two coarser lit-room
 * levels (a lit window in a 2x2 cluster, then a lit 2x2 group in a 6x4 block),
 * each box-filtered like the windows and retired to its own mean before it is
 * subpixel. The far mean is per building and lower than before, so a far tower
 * is a dark mass with a few points, not a lit slab. r2: a share of city blocks
 * runs dark and activity falls with distance, so districts differ.
 */
function nightGLSL(c, baseGlow, nightRhythm, blockId, dist) {
  const n = c.night;
  const db = n.darkBlocks, fa = n.farActivity;
  return `// LOOK_FACADE: sparse lit rooms instead of an evenly lit far wall.
if(uCinema>.5&&uLookFacade>.5){
 float lfOcc=occupancy*.6${nightRhythm ? '*nrShare' : ''};
 float lfAct=mix(${f(n.activity[0])},${f(n.activity[1])},archHash(vec2(seed*.5387,7.13)));${db ? `
 float lfDarkBlock=step(${f(1 - db.share)},archHash(vec2(${blockId}*17.31+.5,5.71)));
 lfAct*=mix(1.,${f(db.activity)},lfDarkBlock);` : ''}${fa ? `
 lfAct*=mix(1.,${f(fa.k)},smoothstep(${f(fa.fromM)},${f(fa.toM)},${dist}*uCinematicMetres));` : ''}
 float lfBase=darkBuilding*(${baseGlow});
 float lfWall=isWall*step(.5,vFacadeMetres.y);
 vec2 lfC1=cell/vec2(${f(n.l1[0])},${f(n.l1[1])}),lfW1=width/vec2(${f(n.l1[0])},${f(n.l1[1])});
 vec2 lfC2=cell/vec2(${f(n.l2[0])},${f(n.l2[1])}),lfW2=width/vec2(${f(n.l2[0])},${f(n.l2[1])});
 float lfLit1=step(archHash(floor(lfC1)+vec2(seed*.71,seed*.29+3.1)),lfOcc*lfAct*${f(n.share1)});
 float lfLit2=step(archHash(floor(lfC2)+vec2(seed*.43+1.7,seed*.19)),lfOcc*lfAct*${f(n.share2)});
 float lfBox1=archCoverage(lfC1.x,${f(n.duty1[0])},lfW1.x)*archCoverage(lfC1.y,${f(n.duty1[1])},lfW1.y);
 float lfBox2=archCoverage(lfC2.x,${f(n.duty2[0])},lfW2.x)*archCoverage(lfC2.y,${f(n.duty2[1])},lfW2.y);
 float lfM1=smoothstep(${f(n.minify1[0])},${f(n.minify1[1])},max(lfW1.x,lfW1.y));${n.retire ? `
 // r3: single lit windows retire to the lit-room level by distance (mid-field sparkle at dusk).
 lfM1=max(lfM1,smoothstep(${f(n.retire.fromM)},${f(n.retire.toM)},${dist}*uCinematicMetres${n.retire.twilight ? `/max(1.-${f(n.retire.twilight)}*uLookFacadeTwilight,.1)` : ''}));` : ''}
 float lfM2=smoothstep(${f(n.minify2[0])},${f(n.minify2[1])},max(lfW2.x,lfW2.y));
 float lfMean2=${f(n.duty2[0] * n.duty2[1])}*lfOcc*lfAct*${f(n.share2)}*${f(n.farMean)};
 float lfE2=${f(n.gain2)}*mix(lfBox2*lfLit2,lfMean2,lfM2);
 float lfE1=mix(${f(n.gain1)}*lfBox1*lfLit1,lfE2,lfM1);${n.farLift ? `
 // r3: the far skyline reads as a lit cluster from the harbor.
 lfE1*=mix(1.,${f(n.farLift.gain)},smoothstep(${f(n.farLift.fromM)},${f(n.farLift.toM)},${dist}*uCinematicMetres));` : ''}
 // r3: houses keep the shipped window glow (suburb lights read as before).
 float lfKeep=${n.houses === false ? '1.' : '1.-float(family==0.||family==6.)'};
 glow=mix(glow,lfWall*lfBase*lfE1,minify*${f(n.strength)}*lfKeep);${db ? `
 glow*=mix(1.,${f(Math.min(1, db.activity * 2))},lfDarkBlock*(1.-minify)*lfKeep);` : ''}
}
`;
}

/** The CITY_FACADES / BUILDING_REALISM palette block with this pass's cladding
 * and glazing overrides (applyLookFacade selects them by uLookFacade). */
export function lookFacadeCityBlock(block, c = LOOK_FACADE_CFG) {
  const o = c.day?.enabled === false ? null : c.day?.palette;
  return o ? { ...block, ...o, claddingCuts: { ...block.claddingCuts, ...o.claddingCuts } } : block;
}

/**
 * Day: the realism palette chose believable materials but pulled every
 * building to one mid-grey value (jitter 0.94-1.04) and roofs to the walls'
 * value, so a city from the air read as one grey mass. Here each building
 * gets its own value, a hue family (brick, limestone, sandstone, cool grey,
 * green-grey, a rare terracotta accent) and more of its own chroma; flat roofs
 * sit a step below the sunlit walls with filtered tar/plant patches; tall
 * facades carry a multi-storey band; a share of tall towers is dark glass.
 * r2: once the cells are subpixel the value, hue and dark-glass terms apply
 * to the whole averaged face, panes included, so they survive at 3-8 km.
 * Weighted by cityDay, so full night and Classic keep their pixels.
 */
function dayGLSL(c, dist, wl = null) {
  const d = c.day;
  // WORLD PASS D (WORLD_LOOK): with the worker as the roof authority, the
  // per-building roof value steps aside (the photo already says how light the
  // roof is) and the patches keep `roofPatchKeep` of their weight.
  const wlRoofValue = wl && wl.roof ? '*0.' : '';
  const wlRoofPatch = wl && wl.roof ? `*${f(wl.roofPatchKeep)}` : '';
  return `// LOOK_FACADE: one value and hue per building, roofs apart from walls, storey bands.
if(uLookFacade>.5){
 float lfDay=cityDay*${f(d.strength)};
 float lfPick=mix(fract(seed*.6173+.19),fract(cityCell*5.17+.61),cityShared);
 float lfFace=mix(realOpaque*(1.-realPane),realOpaque,minify*${f(d.farKeep ?? 0)});
 float lfLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
 diffuseColor.rgb=mix(diffuseColor.rgb,max(vec3(0.),mix(vec3(lfLuma),diffuseColor.rgb,${f(1 + d.chroma)})),lfDay*lfFace);${d.hues?.length ? `
 float lfHueH=mix(fract(seed*.4127+.71),fract(cityCell*3.71+.29),cityShared);
 diffuseColor.rgb*=mix(vec3(1.),${chooseTint(d.hues, 'lfHueH')},lfDay*lfFace*${f(d.hueStrength ?? 1)});` : ''}
 // r3: at low sun the light itself splits the city hard; the per-building value spread eases there (golden edge shimmer).
 float lfLowSun=${d.lowSunEase ? `smoothstep(${f(d.lowSunEase.elevation[0])},${f(d.lowSunEase.elevation[1])},uLookFacadeSun.y)*(1.-smoothstep(${f(d.lowSunEase.elevation[2])},${f(d.lowSunEase.elevation[3])},uLookFacadeSun.y))` : '0.'};
 diffuseColor.rgb*=mix(1.,1.+(mix(${f(d.wallValue[0])},${f(d.wallValue[1])},lfPick)-1.)*(1.-lfLowSun*${f(d.lowSunEase?.value ?? 0)}),lfDay*lfFace);
 ${darkTowerGLSL(d)}
 diffuseColor.rgb*=mix(1.,${f(d.darkTower.value)},lfDay*isWall*lfDarkT);${d.gradient ? `
 float lfY=vFacadeMetres.y;
 diffuseColor.rgb*=mix(1.,mix(${f(d.gradient.base)},1.,smoothstep(0.,${f(d.gradient.baseM)},lfY))*mix(1.,${f(d.gradient.top)},smoothstep(${f(d.gradient.topM[0])},${f(d.gradient.topM[1])},lfY)),lfDay*isWall);` : ''}${d.far ? `
 // r2: haze flattens 3-8 km, so each building's own value, hue and saturation
 // are pushed further there (same picks as near: identity holds across rings).
 float lfFarW=lfDay*isWall*smoothstep(${f(d.far.fromM)},${f(d.far.toM)},${dist}*uCinematicMetres)*(1.-lfLowSun*${f(d.lowSunEase?.far ?? 0)});
 float lfFarL=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
 diffuseColor.rgb=mix(diffuseColor.rgb,max(vec3(0.),mix(vec3(lfFarL),diffuseColor.rgb,${f(1 + d.far.chroma)})),lfFarW);
 diffuseColor.rgb*=mix(1.,mix(${f(d.far.value[0])},${f(d.far.value[1])},lfPick)*mix(1.,${f(d.far.darkTower)},lfDarkT),lfFarW);` : ''}
 float lfRoof=(1.-isWall)*cityFlat;
 diffuseColor.rgb*=mix(1.,mix(${f(d.roofValue[0])},${f(d.roofValue[1])},fract(seed*.2791+.37)),lfDay*lfRoof${wlRoofValue});
 vec2 lfR=vArchitectureRoof*uCinematicMetres/${f(d.roofPatchM)}+vec2(fract(seed*.37),fract(seed*.53));
 vec2 lfRW=max(fwidth(lfR),vec2(.001));
 float lfRH=archHash(floor(lfR)+vec2(seed*.11,seed*.07));
 float lfRDark=step(.5,archHash(floor(lfR)+vec2(3.7,seed*.13)));
 float lfRPatch=archCoverage(lfR.x,.62,lfRW.x)*archCoverage(lfR.y,.48,lfRW.y)*step(${f(1 - d.roofPatchShare)},lfRH);
 float lfFadeK=${d.fade ? `1.-smoothstep(${f(d.fade.fromM)},${f(d.fade.toM)},${dist}*uCinematicMetres)` : '1.'};
 float lfRRes=(1.-smoothstep(${f(d.nyquist?.[0] ?? 0.25)},${f(d.nyquist?.[1] ?? 0.6)},max(lfRW.x,lfRW.y)))*lfFadeK;
 float lfRTone=mix(${f(d.roofPatchTone[1])},${f(d.roofPatchTone[0])},lfRDark);
 diffuseColor.rgb*=mix(1.,mix(1.+${f(d.roofPatchShare * 0.3)}*(${f((d.roofPatchTone[0] + d.roofPatchTone[1]) / 2)}-1.),mix(1.,lfRTone,lfRPatch),lfRRes),lfDay*lfRoof${wlRoofPatch});
 float lfStoreys=${f(d.bandFloors[0])}+mod(seed,${f(d.bandFloors[1] - d.bandFloors[0] + 1)});
 float lfBandW=max(width.y/lfStoreys,.001);
 float lfBand=archCoverage(cell.y/lfStoreys+.5,${f(d.bandDuty)},lfBandW);
 float lfBandRes=(1.-smoothstep(${f(d.nyquist?.[0] ?? 0.3)},${f(d.nyquist?.[1] ?? 0.7)},lfBandW))*lfFadeK;
 diffuseColor.rgb*=1.-lfDay*isWall*lfTall*mix(${f(d.bandDuty)},lfBand,lfBandRes)*${f(d.band)};
}
`;
}

/**
 * Floor ribbons: the shipped pane mask retired both axes together on
 * max(width.x,width.y), so the moment a bay became subpixel (oblique walls
 * foreshorten x first) every floor line went with it and the facade became a
 * flat tone. Here each axis retires on its own footprint, rows a little later,
 * so a tower keeps its storeys as filtered horizontal bands out to ~2.5 km.
 * The else branch is the shipped expression (Medium/Low run only that).
 */
function ribbonGLSL(c, soften, dist) {
  const r = c.day.ribbons, fd = c.day.fade;
  return `// LOOK_FACADE: per-axis retire keeps floor ribbons after bays go subpixel.
if(uLookFacade>.5){
 float lfMinX=archMinify(width.x),lfMinY=smoothstep(${f(r.rowMinify[0])},${f(r.rowMinify[1])},width.y);${soften ? '\n lfMinX=max(lfMinX,architectureDistanceMix);lfMinY=max(lfMinY,architectureDistanceMix);' : ''}${fd ? `
 // r3: the pane and floor pattern fades to its wall mean by distance, whatever the pixel footprint (mid-field shimmer).
 float lfFadeD=smoothstep(${f(fd.fromM)},${f(fd.toM)},${dist}*uCinematicMetres);
 lfMinX=max(lfMinX,lfFadeD);lfMinY=max(lfMinY,lfFadeD);` : ''}
 paneMask = mix(mix(paneMask, opening.x * opening.y * isWall, minify),mix(pane.x,opening.x,lfMinX)*mix(pane.y,opening.y,lfMinY)*isWall*step(0.5,vFacadeMetres.y),uCinema);
}else paneMask = mix(paneMask, opening.x * opening.y * isWall, minify);
`;
}

/**
 * Lights stage (after the city sky reflection): the sun-side / shade-side
 * split on walls by day, the dark-glass towers' weaker mirror, the low-sun
 * glint, and the twilight sky/horizon lift.
 *
 * Glint: the sun's mirror image as a broad lobe (degrees wide, the panel
 * waviness of a real curtain wall) on whole faces that face it, with a stable
 * per-building tilt so neighbours do not flash together, soft-saturated so it
 * never clips, plus a faint wide warm halo on the faces beside it. A flat face
 * has one normal, so every term here is constant across a face: nothing to crawl.
 */
function lightGLSL(c, glassMask, dist) {
  const g = c.glint, d = c.day, t = c.twilight;
  const glint = g && g.enabled !== false && glassMask;
  const day = d && d.enabled !== false && d.sunSide;
  const tw = t && t.enabled !== false;
  const kn = d && d.enabled !== false && d.lowSunKnee && d.lowSunKnee.enabled !== false ? d.lowSunKnee : null;
  return `
// LOOK_FACADE: sun side / shade side, dark glass, low-sun glint, twilight.
if(uLookFacade>.5){
 vec3 lfUp=normalize((viewMatrix*vec4(0.,1.,0.,0.)).xyz);${day && glassMask ? `
 ${darkTowerGLSL(d)}
 reflectedLight.indirectSpecular*=mix(1.,${f(d.darkTower.reflect)},lfDarkT*isWall*cityDay);` : ''}
#if NUM_DIR_LIGHTS > 0
 vec3 lfL=directionalLights[0].direction;${day ? `
 float lfNdl=dot(nonPerturbedNormal,lfL),lfSideW=cityDay*isWall*${f(d.strength)}${d.sunSide.far ? `*mix(1.,${f(d.sunSide.far.keep)},smoothstep(${f(d.sunSide.far.fromM)},${f(d.sunSide.far.toM)},${dist}*uCinematicMetres))` : ''};
 // r2: low sun already splits faces hard; the shade cut eases out below about 25 degrees (golden shimmer).
 reflectedLight.indirectDiffuse*=mix(1.,${f(d.sunSide.shade)},lfSideW*(1.-smoothstep(-.05,.3,lfNdl))*smoothstep(.12,.42,dot(lfL,lfUp)));
 reflectedLight.directDiffuse*=1.+${f(d.sunSide.direct)}*lfSideW*smoothstep(.05,.5,lfNdl)*smoothstep(.12,.42,dot(lfL,lfUp));` : ''}${kn ? `
 {
  // r3: soft knee on the albedo of sun-lit walls at low sun, so pale stone stays cream under the golden lift.
  float lfKEl=dot(lfL,lfUp);
  float lfKW=isWall*${f(kn.strength)}*smoothstep(${f(kn.elevation[0])},${f(kn.elevation[1])},lfKEl)*(1.-smoothstep(${f(kn.elevation[2])},${f(kn.elevation[3])},lfKEl))*smoothstep(.05,.45,dot(nonPerturbedNormal,lfL));
  float lfKA=dot(material.diffuseColor,vec3(.2126,.7152,.0722));
  float lfKO=lfKA<${f(kn.from)}?lfKA:${f(kn.from)}+${f(kn.to - kn.from)}*(1.-exp(-(lfKA-${f(kn.from)})/${f(kn.to - kn.from)}));
  reflectedLight.directDiffuse*=mix(1.,lfKO/max(lfKA,.001),lfKW);
 }` : ''}${glint ? `
 {
  float lfEl=dot(lfL,lfUp);
  float lfLow=smoothstep(${f(g.elevation[0])},${f(g.elevation[1])},lfEl)*(1.-smoothstep(${f(g.elevation[2])},${f(g.elevation[3])},lfEl))*isWall;${g.far ? `
  // r3: small far faces swept through the lobe flashed under motion (golden shimmer); the glint eases with distance.
  float lfGFar=mix(1.,${f(g.far.keep)},smoothstep(${f(g.far.fromM)},${f(g.far.toM)},${dist}*uCinematicMetres));` : `
  float lfGFar=1.;`}
  vec3 lfN=normalize(nonPerturbedNormal+lfUp*(fract(seed*.7713+.21)-.5)*${f(g.tilt)});
  float lfRL=dot(reflect(-geometryViewDir,lfN),lfL);
  float lfLobe=smoothstep(${f(Math.cos((g.widthDeg * Math.PI) / 180))},1.,lfRL);${g.halo ? `
  float lfHalo=smoothstep(${f(Math.cos((g.halo.widthDeg * Math.PI) / 180))},1.,lfRL);` : ''}
  // r4: the glint rides a face-level glass weight (curtain wall x its frame mean), never the
  // pane/mullion masks: a bright mirror lobe on a sub-2-px pane grid was the golden shimmer.
  float lfGM=${g.faceMask ? `cityCurtain*isWall*cityDay*${f(g.faceMask)}` : glassMask};
  vec3 lfG=directionalLights[0].color*lfLow*lfGFar*(lfLobe*lfLobe*${f(g.gain)}*lfGM${g.halo ? `+${v3(g.halo.tint)}*lfHalo*lfHalo*${f(g.halo.gain)}*mix(${f(g.halo.stone ?? 0.35)},1.,lfGM)` : ''});${g.knee ? `
  lfG=${f(g.knee)}*(1.-exp(-lfG/${f(g.knee)}));` : ''}
  reflectedLight.directSpecular+=lfG;${g.stoneEdge ? `
  // r2: sun-facing opaque faces take a warm-gold edge at low sun, so the city catches light, not one tower group.
  reflectedLight.directDiffuse*=vec3(1.)+${v3(g.stoneEdge.tint)}*${f(g.stoneEdge.gain)}*lfLow*smoothstep(.15,.7,dot(nonPerturbedNormal,lfL))*(1.-${glassMask})*(1.-smoothstep(${f(g.stoneEdge.fadeM[0])},${f(g.stoneEdge.fadeM[1])},${dist}*uCinematicMetres)*${f(1 - g.stoneEdge.farKeep)});` : ''}
 }` : ''}
#endif${tw ? `
 if(uLookFacadeTwilight>.001&&uCinema>.5){
  float lfNUp=dot(nonPerturbedNormal,lfUp);
  vec3 lfS=(viewMatrix*vec4(uLookFacadeSun,0.)).xyz;
  vec3 lfSH=lfS-lfUp*dot(lfS,lfUp),lfNH=nonPerturbedNormal-lfUp*lfNUp;
  float lfFacing=max(dot(lfNH,lfSH),0.)/max(length(lfNH)*length(lfSH),.001);
  float lfHigh=smoothstep(${f(t.heightM[0])},${f(t.heightM[1])},vFacadeMetres.y);
  float lfSkyW=mix(smoothstep(.6,.95,lfNUp)*${f(t.roof ?? 1)},.55*lfHigh,isWall);
  vec3 lfTw=${v3(t.sky)}*lfSkyW+${v3(t.horizon)}*lfFacing*isWall*mix(.3,1.,lfHigh);${t.far ? `
  lfTw*=mix(1.,${f(t.far.keep)},smoothstep(${f(t.far.fromM)},${f(t.far.toM)},${dist}*uCinematicMetres));` : ''}
  reflectedLight.indirectDiffuse+=material.diffuseColor*lfTw*uLookFacadeTwilight;
 }` : ''}
}
`;
}

/** One whole GLSL statement starting at `head` (up to its `;\n`). */
function statement(src, head) {
  const at = src.indexOf(head);
  if (at < 0) throw new Error(`LOOK_FACADE: palette statement missing: ${head}`);
  return src.slice(at, src.indexOf(';\n', at) + 1);
}

/**
 * Palette: more curtain glass, darker coated glazing (two green-tinted), a
 * lower sky lift and a stronger mirror. The shipped constants stay and are
 * selected by uLookFacade, so Medium/Low render the shipped palette exactly.
 */
function paletteSwap(s, c) {
  const base = CITY_FACADES_BLOCK, look = lookFacadeCityBlock(base, c);
  const gb = cityFacadeGLSL(base), gl = cityFacadeGLSL(look);
  for (const head of ['vec3 cityCuts=', 'vec3 cityTint=']) {
    const a = statement(gb.albedo, head), b = statement(gl.albedo, head);
    s = once(s, a, `${head}uLookFacade>.5?(${b.slice(head.length, -1)}):(${a.slice(head.length, -1)});`);
  }
  s = once(s, `+vec3(0.,${f(base.skyBias)}+cityPanelTilt,0.)`, `+vec3(0.,(uLookFacade>.5?${f(look.skyBias)}:${f(base.skyBias)})+cityPanelTilt,0.)`);
  return once(s, 'reflectedLight.indirectSpecular*=1.+(uCityReflect-1.)*cityGlassMask;',
    `reflectedLight.indirectSpecular*=1.+((uLookFacade>.5?${f(look.reflect)}:uCityReflect)-1.)*cityGlassMask;`);
}

/** Flag-on only: anchored edits at the end of the architecture material's onBeforeCompile. */
export function applyLookFacade(shader, { groundLighting = true, nightRhythm = false, distant = false, worldLook = null } = {}, c = LOOK_FACADE_CFG) {
  let s = shader.fragmentShader;
  Object.assign(shader.uniforms, LOOK_FACADE_UNIFORMS);
  s = once(s, 'uniform float uArchitectureDetail;', 'uniform float uArchitectureDetail;\nuniform float uLookFacade;\nuniform float uLookFacadeTwilight;\nuniform vec3 uLookFacadeSun;');
  const city = s.includes('float cityCell=');
  if (c.day?.enabled !== false && c.day?.palette && s.includes('vec3 cityTint=')) s = paletteSwap(s, c);
  if (c.day?.enabled !== false && c.day?.ribbons?.enabled !== false) {
    s = once(s, 'paneMask = mix(paneMask, opening.x * opening.y * isWall, minify);', ribbonGLSL(c, s.includes('float architectureDistanceMix'), distant ? 'vSkyDist' : 'vSatDist'));
  }
  const baseGlow = groundLighting ? 'buildingGlow' : '0.14+fract(seed*0.113)*0.24';
  const realism = s.includes('float realGlassMask=');
  if (c.day?.enabled !== false && realism) s = once(s, 'float entrance = ', `${dayGLSL(c, distant ? 'vSkyDist' : 'vSatDist', worldLook)}float entrance = `);
  const glassMask = realism ? 'realGlassMask' : s.includes('float cityGlassMask=') ? 'cityGlassMask' : null;
  // The light block needs the realism day terms (cityDay, cityCell) for its day parts.
  const lc = realism ? c : { ...c, day: null };
  if (glassMask || c.twilight?.enabled !== false) {
    const anchor = glassMask ? statement(s, 'reflectedLight.indirectSpecular*=1.+(') : '#include <lights_fragment_end>';
    s = once(s, anchor, `${anchor}${lightGLSL(lc, glassMask, distant ? 'vSkyDist' : 'vSatDist')}`);
  }
  if (c.night?.enabled !== false) {
    const blockId = city ? 'cityCell' : 'floor(seed*.0371)';
    s = once(s, 'glow += entrance * ', `${nightGLSL(c, baseGlow, nightRhythm, blockId, distant ? 'vSkyDist' : 'vSatDist')}glow += entrance * `);
  }
  shader.fragmentShader = s;
}

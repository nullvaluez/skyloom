import { Box3, BufferAttribute, CanvasTexture, Color, Matrix4, SRGBColorSpace, Vector3, Vector4 } from 'three';
import { commercialPaintOn, drawAirlineTail, drawAirlineTitle } from './airline-art.js';

export function liveryMaterialRole(material, mesh) {
  const name = (material.name || mesh.name).toLowerCase();
  return /hull|painted pearl/.test(name) ? 'hull' : /trim|midnight wing/.test(name) ? 'trim' : /accent|copper recognition/.test(name) ? 'accent' : null;
}

const PATTERNS = { tactical: 1, camo: 2, airline: 3, executive: 4, splinter: 5, sport: 6, commercial: 7 };
const declarations = `
varying vec3 vFleetPaint;
uniform float uFleetPaintOn, uFleetPattern, uFleetRole, uFleetWing;
uniform vec3 uFleetHull, uFleetTrim, uFleetAccent, uFleetInk, uFleetTailInk;
uniform vec3 uFleetBelly, uFleetNacelle, uFleetWingColor;
uniform float uFleetCheat, uFleetBellyStyle;
uniform vec4 uFleetSideRect, uFleetTailRect;
uniform sampler2D uFleetMarkings;
float fleetHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float fleetNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(fleetHash(i),fleetHash(i+vec3(1,0,0)),f.x),mix(fleetHash(i+vec3(0,1,0)),fleetHash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(fleetHash(i+vec3(0,0,1)),fleetHash(i+vec3(1,0,1)),f.x),mix(fleetHash(i+vec3(0,1,1)),fleetHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fleetBand(float p,float center,float width){float aa=max(fwidth(p),.00012);return 1.-smoothstep(width-aa,width+aa,abs(p-center));}
float fleetMark(vec2 uv,float row){
 if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return 0.;
 return texture2D(uFleetMarkings,vec2(uv.x,uv.y*.5+row)).a;
}
vec4 fleetColorMark(vec2 uv,float row){
 if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec4(0.);
 return texture2D(uFleetMarkings,vec2(uv.x,uv.y*.5+row));
}
`;
const paint = `
if(uFleetPaintOn>.5){
 vec3 p=vFleetPaint;
 vec3 normal=normalize(cross(dFdx(p),dFdy(p)));
 vec3 base=uFleetRole<.5?uFleetHull:uFleetRole<1.5?uFleetTrim:uFleetAccent;
 float side=smoothstep(.42,.72,abs(normal.x));
 float fuselage=1.-smoothstep(.075,.11,abs(p.x));
 float tail=smoothstep(.24,.33,p.z)*smoothstep(.035,.065,p.y);
 if(uFleetPattern>6.5){
   base=mix(uFleetWingColor,uFleetHull,fuselage);
   float bellyLine=uFleetBellyStyle>1.5?.009:-.017;
   float belly=(1.-smoothstep(bellyLine-.001,bellyLine+.001,p.y))*fuselage;
   base=mix(base,uFleetBelly,belly);
   base=mix(base,uFleetTrim,tail);
   float engine=step(.10,abs(p.x))*(1.-smoothstep(-.045,-.033,p.y));
   base=mix(base,uFleetNacelle,engine);
   float sweep=bellyLine+.004+max(0.,p.z-.15)*.14;
   base=mix(base,uFleetAccent,fleetBand(p.y,sweep,.0018)*fuselage*uFleetCheat);
 }else if(uFleetPattern>1.5&&uFleetPattern<2.5){
   vec3 q=p*14.;float n=fleetNoise(q+fleetNoise(q*.7)*2.)*.86+fleetNoise(q*2.3)*.14;
   float aa=max(fwidth(n),.012);
   base=mix(uFleetHull,uFleetTrim,smoothstep(.43-aa,.43+aa,n));
   base=mix(base,uFleetAccent,smoothstep(.65-aa,.65+aa,n));
 }else if(uFleetPattern>4.5&&uFleetPattern<5.5){
   vec3 q=p*vec3(24.,29.,18.);q.x+=q.z*.6;q.z-=q.y*.7;
   float n=fleetHash(floor(q));
   base=n<.34?uFleetHull:n<.66?uFleetTrim:uFleetAccent;
 }else if(uFleetPattern>2.5&&uFleetPattern<4.5){
   if(uFleetRole<.5){
     float sweep=.007+max(0.,p.z-.10)*.20;
     float belt=fleetBand(p.y,sweep,uFleetPattern<3.5?.006:.0025)*fuselage;
     float belly=(1.-smoothstep(-.018,-.012,p.y))*fuselage;
     base=mix(base,uFleetTrim,belly*(uFleetPattern<3.5?1.:.35));
     base=mix(base,uFleetTrim,tail);
     base=mix(base,uFleetAccent,belt);
     base=mix(base,uFleetTrim,fleetBand(p.y,sweep+.010,.002)*fuselage);
   }
 }else if(uFleetPattern>5.5){
   float belt=fleetBand(p.y,.003+max(0.,p.z)*.10,.009)*fuselage;
   base=mix(base,uFleetTrim,tail);base=mix(base,uFleetAccent,belt);
 }else{
   base=mix(base,uFleetTrim,tail*.7);
   base=mix(base,uFleetAccent,fleetBand(p.y,.12,.005)*tail);
 }
 // Paint is attached to neutral mesh coordinates, so it follows the hinges.
 vec2 bodyUV=vec2((p.z-uFleetSideRect.x)/uFleetSideRect.z,(p.y-uFleetSideRect.y)/uFleetSideRect.w);
 if(p.x>0.)bodyUV.x=1.-bodyUV.x;
 vec4 titleMark=fleetColorMark(bodyUV,.5);
 base=mix(base,uFleetPattern>6.5?titleMark.rgb:uFleetInk,titleMark.a*side*fuselage);
 vec2 tailUV=vec2((p.z-uFleetTailRect.x)/uFleetTailRect.z,(p.y-uFleetTailRect.y)/uFleetTailRect.w);
 if(p.x>0.)tailUV.x=1.-tailUV.x;
 vec4 tailMark=fleetColorMark(tailUV,0.);
 base=mix(base,uFleetPattern>6.5?tailMark.rgb:uFleetTailInk,tailMark.a*side*step(.025,p.y));
 if(uFleetWing>.5){
   vec2 wingUV=vec2((abs(p.x)-.18)/.23,(p.z+.03)/.15);
   base=mix(base,uFleetInk,fleetMark(wingUV,0.)*smoothstep(.6,.85,abs(normal.y)));
 }
 diffuseColor.rgb=base;
 #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
 diffuseColor.rgb*=vColor.rgb;
 #endif
}
`;

/** One private atlas per visible aircraft, replaced and disposed on pick.
 * Original finishes use tinted alpha glyphs; commercial paint uses sRGB vector artwork.
 */
function markings(skin) {
  const canvas = document.createElement('canvas');
  canvas.width = skin.operator ? 2048 : 1024; canvas.height = skin.operator ? 1024 : 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (skin.operator) {
    // A small gutter prevents neighboring atlas rows bleeding into the fin.
    drawAirlineTitle(ctx,skin.operator,16,16,canvas.width-32,canvas.height/2-32);
    drawAirlineTail(ctx,skin.operator,0,canvas.height/2,canvas.width,canvas.height/2);
    const texture=new CanvasTexture(canvas);texture.anisotropy=8;
    texture.colorSpace=SRGBColorSpace;texture.name=`livery-${skin.id}`;
    return texture;
  }
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 86px Arial, sans-serif';
  const font = Math.min(86, 900 / Math.max(1, ctx.measureText(skin.marking).width) * 86);
  ctx.font = `700 ${font}px Arial, sans-serif`;
  ctx.fillText(skin.marking, 512, 127);
  ctx.font = '700 158px Arial, sans-serif'; ctx.fillText(skin.code, 512, 379);
  // A pair of simple original wing marks frames the squadron/operator code.
  for (const side of [-1, 1]) {
    const x = 512 + side * 285;
    ctx.beginPath(); ctx.moveTo(x, 349); ctx.lineTo(x + side * 72, 321);
    ctx.lineTo(x + side * 58, 382); ctx.lineTo(x, 402); ctx.closePath(); ctx.fill();
  }
  const texture = new CanvasTexture(canvas); texture.anisotropy = 4;
  texture.name = `livery-${skin.id}`;
  return texture;
}

function prepare(root, id) {
  root.updateWorldMatrix(true, true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert(), matrix = new Matrix4(), p = new Vector3();
  const box = new Box3();
  // Measure in the model's own coordinate system even when it is already mounted.
  root.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    matrix.multiplyMatrices(inverse, o.matrixWorld);
    const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) box.expandByPoint(p.fromBufferAttribute(a, i).applyMatrix4(matrix));
  });
  const length = Math.max(1, box.max.z - box.min.z);
  const slender = ['concorde','glider'].includes(id), light = ['prop','warbird-prop'].includes(id);
  const uniforms = {
    uFleetPaintOn: { value: 0 }, uFleetPattern: { value: 0 },
    uFleetHull: { value: new Color() }, uFleetTrim: { value: new Color() }, uFleetAccent: { value: new Color() },
    uFleetInk: { value: new Color() }, uFleetTailInk: { value: new Color() },
    uFleetBelly: { value: new Color() }, uFleetNacelle: { value: new Color() }, uFleetWingColor: { value: new Color() },
    uFleetCheat: { value: 0 }, uFleetBellyStyle: { value: 0 },
    uFleetMarkings: { value: null }, uFleetWing: { value: ['fighter','military','warbird-jet','warbird-prop','flying-wing','f35','c17'].includes(id) ? 1 : 0 },
    uFleetSideRect: { value: new Vector4(-.28, slender ? .003 : light ? .005 : .008, .52, slender ? .027 : .046) },
    uFleetTailRect: { value: new Vector4(.25, .06, .24, Math.max(.045, box.max.y / length - .072)) },
  };
  root.traverse(o => {
    if (!o.isMesh) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (!materials.some(m => m && liveryMaterialRole(m, o))) return;
    // Cached GLTF geometry is shared by the hangar and flight; own the paint UVs.
    if (!o.geometry.userData.fleetOwned) { o.geometry = o.geometry.clone(); o.geometry.userData.fleetOwned = true; }
    const a = o.geometry.attributes.position, coords = new Float32Array(a.count * 3);
    matrix.multiplyMatrices(inverse, o.matrixWorld);
    for (let i = 0; i < a.count; i++) {
      p.fromBufferAttribute(a, i).applyMatrix4(matrix).divideScalar(length);
      p.toArray(coords, i * 3);
    }
    o.geometry.setAttribute('aFleetPaint', new BufferAttribute(coords, 3));
    for (const material of materials) {
      const role = material && liveryMaterialRole(material, o);
      if (!role || material.userData.fleetPaintPatched) continue;
      material.userData.fleetPaintPatched = true;
      const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
      material.onBeforeCompile = (shader, renderer) => {
        previous?.(shader, renderer);
        Object.assign(shader.uniforms, uniforms, { uFleetRole: { value: { hull: 0, trim: 1, accent: 2 }[role] } });
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aFleetPaint; varying vec3 vFleetPaint;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFleetPaint=aFleetPaint;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${declarations}`)
          .replace('#include <color_fragment>', `#include <color_fragment>\n${paint}`);
      };
      material.customProgramCacheKey = () => `${key}|fleet-paint-v2`;
      material.needsUpdate = true;
    }
  });
  return { uniforms, skinId: null, texture: null, originalTailRect: uniforms.uFleetTailRect.value.clone() };
}

export function applyLiveryPaint(root, id, skin) {
  if (skin?.operator && !commercialPaintOn()) skin = null;
  let state = root.userData.fleetPaint;
  // House/earned finishes retain the existing geometry and material path until
  // a preset is actually requested. Once installed, switches only update uniforms.
  if (!state && !skin) return;
  if (!state) state = root.userData.fleetPaint = prepare(root, id);
  state.uniforms.uFleetPaintOn.value = skin ? 1 : 0;
  if (!skin) { state.texture?.dispose(); state.texture = null; state.skinId = null; state.uniforms.uFleetMarkings.value = null; return; }
  const u = state.uniforms;
  u.uFleetPattern.value = PATTERNS[skin.pattern];
  u.uFleetHull.value.set(skin.hull); u.uFleetTrim.value.set(skin.trim); u.uFleetAccent.value.set(skin.accent);
  if(skin.operator){
    const s=skin.operator;
    u.uFleetBelly.value.set(s.colors.belly);u.uFleetNacelle.value.set(s.colors.nacelle);u.uFleetWingColor.value.set(s.colors.wing);
    u.uFleetCheat.value=s.cheat?1:0;u.uFleetBellyStyle.value=s.bellyStyle;
  }
  // Full-bleed paint uses the whole fin. Emblems sit inside the swept leading
  // edge on BOTH sides; flipping the entire fin projection clips the aft face.
  const fullFin=skin.operator&&['southwest','united','american','british-airways','air-france','emirates','jetblue','etihad','iberia'].includes(skin.operator.id);
  if(skin.operator&&!fullFin){
    u.uFleetTailRect.value.set(id==='concorde'?.31:.35,id==='concorde'?.035:.065,id==='concorde'?.13:.12,id==='concorde'?.09:.14);
  }else u.uFleetTailRect.value.copy(state.originalTailRect);
  const c = u.uFleetHull.value, light = .2126*c.r + .7152*c.g + .0722*c.b > .24;
  u.uFleetInk.value.set(light ? skin.trim : '#d6e0dd');
  u.uFleetTailInk.value.set(['airline','executive','sport','tactical'].includes(skin.pattern) ? '#e9eee6' : light ? skin.trim : '#d6e0dd');
  if (state.skinId !== skin.id || !state.texture) {
    state.texture?.dispose(); state.texture = typeof document === 'undefined' ? null : markings(skin);
    state.skinId = skin.id; u.uFleetMarkings.value = state.texture;
  }
}

export function disposeLiveryPaint(root) {
  const state = root.userData.fleetPaint;
  if (state) { state.texture?.dispose(); state.texture = null; state.skinId = null; state.uniforms.uFleetMarkings.value = null; }
}

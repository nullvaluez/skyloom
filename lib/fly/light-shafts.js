/**
 * LIVING WORLD — crepuscular rays and the sun through a lens
 * (FLY_LIVING_WORLD.md: LIGHT_SHAFTS, LENS_FLARE).
 *
 * Shafts are the scattering-as-a-post-process idea (Mitchell, GPU Gems 3,
 * ch. 13), fed by what this pipeline already knows instead of a re-render:
 *  1. SOURCE, at the cloud resolution: open sky (no depth) times the cloud
 *     march's own transmittance, inside a soft core around the sun's screen
 *     position (.r), and the same core with nothing in the way (.g);
 *  2. BLUR: both averaged along the line from each pixel toward the sun;
 *  3. COMPOSITE: (occluded − k·free) of that average is light scattered by
 *     the air between the eye and the pixel — bright beams through cloud gaps
 *     and between ridges, darker air in their shadows, ~nothing in an open
 *     sky (the physical sky already has its aureole). Weighted by the air
 *     actually in front of the pixel, so a near aircraft gets none on itself.
 * The lens: veiling glare, a soft aperture starburst and five faint ghosts on
 * the line through the frame centre, all scaled by how much of the sun the
 * SOURCE says is visible (cloud and terrain cover it, the flare goes).
 *
 * The composite edits are anchored, single-match substitutions over the built
 * Enhanced composite (after TRUE_SCALE and HDR_GUARD, before hdrSafe), and
 * throw on a miss; with both flags off nothing is patched or allocated.
 */
import { DataTexture, HalfFloatType, RGBAFormat, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget } from 'three';
import { livingWorldOn, livingWorldBlock } from './living-world.js';

export const SHAFTS_ON = livingWorldOn('LIGHT_SHAFTS');
export const FLARE_ON = livingWorldOn('LENS_FLARE');
const SHAFTS = livingWorldBlock('LIGHT_SHAFTS');
const FLARE = livingWorldBlock('LENS_FLARE');
/** True when the composite carries the shaft/flare terms. */
export const SHAFT_COMPOSITE_ACTIVE = SHAFTS_ON || FLARE_ON;

const black = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat);
black.needsUpdate = true;

export const LIGHT_SHAFT_UNIFORMS = {
  uLivShafts: { value: black },
  uLivShaftSrc: { value: black },
  uLivSunUv: { value: new Vector2(0.5, 0.5) },
  uLivAspect: { value: 16 / 9 },
  uLivShaftSrcK: { value: new Vector4(0.22, 0, 0, 0) }, // core radius (frame heights), -, -, -
  uLivShaftBlur: { value: new Vector4(48, 0.9, 0.985, 0) }, // samples, length (fraction to the sun), decay, -
  uLivShaftLight: { value: new Vector4(0, 0.72, 1800, 0) }, // gain, free-glow cancel k, air metres (half in-scatter), -
  uLivShaftColor: { value: new Vector3() },
  uLivFlare: { value: new Vector4(0, 0, 0, 0) }, // veil, starburst, ghosts, aperture rotation
  uLivFlareColor: { value: new Vector3() },
};

const SOURCE_GLSL = `
uniform sampler2D clouds;
uniform vec2 uLivSunUv;
uniform float uLivAspect;
uniform vec4 uLivShaftSrcK;
void main(){
 vec2 d=(vUv-uLivSunUv)*vec2(uLivAspect,1.);
 float core=exp(-dot(d,d)/(uLivShaftSrcK.x*uLivShaftSrcK.x));
 float sky=distanceAt(vUv)>900000.?1.:0.;
 // The march target's alpha is the cloud TRANSMISSION in front of the sky.
 float clear=texture2D(clouds,vUv).a;
 gl_FragColor=vec4(sky*clear*core,core,0.,1.);
}`;

const BLUR_GLSL = `
varying vec2 vUv;
uniform sampler2D uLivShaftSrc;
uniform vec2 uLivSunUv;
uniform vec4 uLivShaftBlur;
void main(){
 vec2 step=(vUv-uLivSunUv)*uLivShaftBlur.y/max(uLivShaftBlur.x,1.);
 // Interleaved-gradient offset per pixel: no banding rings at 48 taps.
 float j=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
 vec2 uv=vUv-step*j;
 vec2 sum=vec2(0.);float w=1.,total=0.;
 for(int i=0;i<64;i++){
  if(float(i)>=uLivShaftBlur.x)break;
  sum+=texture2D(uLivShaftSrc,clamp(uv,vec2(0.),vec2(1.))).rg*w;total+=w;
  w*=uLivShaftBlur.z;uv-=step;
 }
 gl_FragColor=vec4(sum/max(total,1e-4),0.,1.);
}`;

const COMPOSITE_DECL = `
uniform sampler2D uLivShafts, uLivShaftSrc;
uniform vec2 uLivSunUv;
uniform float uLivAspect;
uniform vec4 uLivShaftLight, uLivFlare;
uniform vec3 uLivShaftColor, uLivFlareColor;
// How much of the sun's own disc reaches the lens (cloud and terrain cover it).
float livSunVisible(){
 vec2 o=vec2(.004/uLivAspect,.004);float v=0.,c=0.;
 for(int i=0;i<5;i++){vec2 uv=uLivSunUv+o*vec2(i==1?1.:i==2?-1.:0.,i==3?1.:i==4?-1.:0.);vec2 s=texture2D(uLivShaftSrc,uv).rg;v+=s.r;c+=s.g;}
 return c>1e-4?clamp(v/c,0.,1.):0.;
}
vec3 livLens(vec2 uv){
 if(uLivFlare.x+uLivFlare.y+uLivFlare.z<=0.)return vec3(0.);
 float vis=livSunVisible();if(vis<=.001)return vec3(0.);
 vec2 asp=vec2(uLivAspect,1.),d=(uv-uLivSunUv)*asp;float r=length(d);
 // A six-blade aperture: twelve thin spikes and a softer second set.
 float a=atan(d.y,d.x)+uLivFlare.w;
 float burst=(pow(abs(cos(a*6.)),180.)*exp(-r*7.)+pow(abs(cos(a*6.+.2618)),40.)*exp(-r*16.)*.45)*smoothstep(.002,.012,r);
 vec3 c=uLivFlareColor*(burst*uLivFlare.y+exp(-r*2.4)*uLivFlare.x);
 // Ghosts: internal reflections on the line from the sun through the centre,
 // each a soft disc with a brighter rim and its own coating tint.
 vec2 axis=vec2(.5)-uLivSunUv;
 for(int i=0;i<5;i++){
  float fi=float(i);
  float k=i==0?.55:i==1?1.18:i==2?1.62:i==3?-.32:2.1;
  float size=i==0?.035:i==1?.09:i==2?.05:i==3?.022:.16;
  vec3 tint=i==0?vec3(.55,.85,1.):i==1?vec3(1.,.72,.42):i==2?vec3(.62,1.,.72):i==3?vec3(1.,.9,.7):vec3(.55,.6,1.);
  float g=length((uv-(uLivSunUv+axis*k))*asp)/size;
  float disc=(1.-smoothstep(.72,1.,g))*(.45+.55*smoothstep(.2,.95,g));
  c+=uLivFlareColor*tint*disc*uLivFlare.z*(i==4?.35:1.)*(1.-fi*.08);
 }
 return c*vis;
}
`;
const SHAFT_LIGHT = (bound) => `
vec3 livShaftLight(vec2 uv,float metres){
 if(uLivShaftLight.x<=0.)return vec3(0.);
 vec2 s=texture2D(uLivShafts,uv).rg;
 float beam=s.r-uLivShaftLight.y*s.g;
 // Only the air in front of the pixel scatters: none on a near hull.
 float air=1.-exp(-metres/uLivShaftLight.z);
 vec3 l=uLivShaftColor*beam*air*uLivShaftLight.x;
${bound} return l;
}
`;
// PHYS_SKY (the composite carries the aerial volume): air in a cloud's shadow
// stops scattering only the light it scattered, so the darkening is bounded,
// per channel, by the physical in-scatter of the air in front of the pixel.
// Unbounded, a backlit cloud near a low sun lost 3-4x that air's light in red
// (in the key's colour, ~40% of the cloud's own red): its core turned blue.
const SHADOW_BOUND = ` if(beam<0.){vec3 r=rayAt(uv),d=vec3(r.x/metricScale,r.y,r.z/metricScale),S,T;
  pskyAerial(normalize(d),metres*length(d)*.001,S,T);l=max(l,-S*uPskySunIllum);}
`;
const AERIAL_DECL = 'void pskyAerial(vec3 dir, float distKm, out vec3 S, out vec3 T)';

/**
 * Patch the built Enhanced composite. `final` is the composite's last write
 * (hdrSafe or not), so the additions land in the same HDR value bloom reads.
 */
export function shaftComposite(src, name = 'cloud-composite-r25') {
  if (!SHAFT_COMPOSITE_ACTIVE) return src;
  const guarded = ' gl_FragColor=vec4(hdrSafe(mix(scene,result,cloudMix)),1.);';
  const plain = ' gl_FragColor=vec4(mix(scene,result,cloudMix),1.);';
  const from = src.includes(guarded) ? guarded : plain;
  if (src.split(from).length !== 2) throw new Error(`light-shafts (${name}): final write anchor missing`);
  const metres = src.includes('float dist=tsSceneDistanceAt(vUv);') ? 'distView' : 'dist';
  const add = ` vec3 livExtra=(livShaftLight(vUv,min(${metres},1e6))+livLens(vUv))*uR25Exposure;\n`;
  const to = from === guarded
    ? `${add} gl_FragColor=vec4(hdrSafe(mix(scene,result,cloudMix)+livExtra),1.);`
    : `${add} gl_FragColor=vec4(mix(scene,result,cloudMix)+livExtra,1.);`;
  let out = src.replace(from, to);
  const at = out.indexOf('void main(){');
  if (at < 0) throw new Error(`light-shafts (${name}): main missing`);
  // The LAST main is the composite's own (helpers above it may not declare one).
  const last = out.lastIndexOf('void main(){');
  out = out.slice(0, last) + COMPOSITE_DECL + SHAFT_LIGHT(src.includes(AERIAL_DECL) ? SHADOW_BOUND : '') + out.slice(last);
  return out;
}

const SAMPLES = { ultra: 64, 'ultra-balanced': 56, high: 48, 'high-balanced': 40, medium: 28 };

/** The two shaft targets and programs; owned by the cloud pass. */
export class LightShafts {
  constructor(vertexShader, sourceFragment, uniforms) {
    const opts = { type: HalfFloatType, depthBuffer: false };
    this.source = new WebGLRenderTarget(1, 1, opts);
    this.blur = new WebGLRenderTarget(1, 1, opts);
    this.sourceMaterial = new ShaderMaterial({ uniforms, vertexShader, fragmentShader: sourceFragment + SOURCE_GLSL, depthTest: false, depthWrite: false, toneMapped: false });
    this.blurMaterial = new ShaderMaterial({ uniforms, vertexShader, fragmentShader: BLUR_GLSL, depthTest: false, depthWrite: false, toneMapped: false });
    this.uniforms = uniforms;
    this.active = false;
    this._v = new Vector3();
    this.stats = { active: false, samples: 0, visibility: 0 };
  }
  setSize(w, h) {
    if (this.source.width !== w || this.source.height !== h) { this.source.setSize(w, h); this.blur.setSize(w, h); }
  }
  /**
   * Per frame, before the composite. Returns false (and zeroes the terms) when
   * the sun is off-screen, down, or the profile has no shafts.
   */
  update(pass, renderer, camera, env, profileName, aspect, trueK) {
    const u = this.uniforms;
    const samples = SAMPLES[profileName] ?? 0;
    const sun = env?.sunDir;
    let on = !!sun && samples > 0;
    let facing = 0, edge = 0;
    if (on) {
      // The TRUE sun direction seen through TRUE_SCALE's vertical scale is the
      // scene direction (x, y/k0, z); project a point far down it.
      const v = this._v.set(sun[0], sun[1] / (trueK || 1), sun[2]).normalize();
      camera.getWorldDirection(pass._livFwd ??= new Vector3());
      facing = v.dot(pass._livFwd);
      v.multiplyScalar(5e4).add(camera.position).project(camera);
      // In front of the lens (reversed depth makes NDC z useless as a test).
      on = facing > 0.05;
      if (on) {
        u.uLivSunUv.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
        // The occlusion source exists only inside the frame: for a sun past the
        // edge the blur and the visibility taps read the clamped border row, which
        // drew straight streaks and a lens response from a sun nobody can see.
        // Both fade out as the sun nears the edge and are off beyond it.
        const e = Math.max(Math.abs(v.x), Math.abs(v.y));
        edge = 1 - Math.min(1, Math.max(0, (e - 0.8) / 0.2));
        on = edge > 0;
      }
    }
    u.uLivAspect.value = aspect;
    const day = env?.day ?? 1, golden = env?.golden ?? 0, overcast = env?.overcast ?? 0, sunVis = env?.sunVisibility ?? 1;
    const lit = on ? Math.min(1, edge * Math.min(1, facing * 2.2)) * sunVis * (1 - 0.85 * overcast) : 0;
    const key = env?.keyColor ?? [1, 1, 1];
    const sh = SHAFTS ?? {};
    const shaftGain = SHAFTS_ON ? lit * (sh.gain ?? 0.55) * (0.55 + 0.45 * day + (sh.goldenBoost ?? 1.1) * golden) : 0;
    u.uLivShaftLight.value.set(shaftGain, sh.cancel ?? 0.72, sh.airM ?? 1800, 0);
    const sunK = (env?.sun ?? 5) * (sh.colorK ?? 0.11);
    u.uLivShaftColor.value.set(key[0] * sunK, key[1] * sunK, key[2] * sunK);
    u.uLivShaftSrcK.value.x = sh.coreRadius ?? 0.22;
    u.uLivShaftBlur.value.set(samples, sh.length ?? 0.9, sh.decay ?? 0.985, 0);
    const fl = FLARE ?? {};
    const flareK = FLARE_ON && on ? lit * (0.45 + 0.55 * day) : 0;
    u.uLivFlare.value.set(flareK * (fl.veil ?? 0.05), flareK * (fl.starburst ?? 0.9), flareK * (fl.ghosts ?? 0.05), fl.rotation ?? 0.35);
    const fk = (env?.sun ?? 5) * (fl.colorK ?? 0.2);
    u.uLivFlareColor.value.set(key[0] * fk, key[1] * fk, key[2] * fk);
    this.active = on && (shaftGain > 0 || flareK > 0);
    this.stats.active = this.active; this.stats.samples = this.active ? samples : 0;
    if (!this.active) { u.uLivShafts.value = black; u.uLivShaftSrc.value = black; return false; }
    // 1. occlusion source; 2. radial average toward the sun.
    const prev = pass.fullscreenMaterial;
    pass.fullscreenMaterial = this.sourceMaterial;
    renderer.setRenderTarget(this.source); renderer.render(pass.scene, pass.camera);
    u.uLivShaftSrc.value = this.source.texture;
    pass.fullscreenMaterial = this.blurMaterial;
    renderer.setRenderTarget(this.blur); renderer.render(pass.scene, pass.camera);
    u.uLivShafts.value = this.blur.texture;
    pass.fullscreenMaterial = prev;
    return true;
  }
  /** Compile both programs now (boot prewarm, alongside the Enhanced pair). */
  warm(renderer, pass) {
    const prev = pass.fullscreenMaterial;
    for (const m of [this.sourceMaterial, this.blurMaterial]) { pass.fullscreenMaterial = m; renderer.compile(pass.scene, pass.camera); }
    pass.fullscreenMaterial = prev;
  }
  dispose() {
    this.source.dispose(); this.blur.dispose(); this.sourceMaterial.dispose(); this.blurMaterial.dispose();
    this.uniforms.uLivShafts.value = black; this.uniforms.uLivShaftSrc.value = black;
  }
}

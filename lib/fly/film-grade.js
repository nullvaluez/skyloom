import { Effect } from 'postprocessing';
import { SRGBColorSpace, Uniform } from 'three';
import { livingWorldBlock, livingWorldOn } from './living-world';
import { readReducedMotion } from './immersive';
import { useFlyStore } from '../../stores/fly-store';

/**
 * LIVING WORLD — FILM_GRADE (FLY_LIVING_WORLD.md): the film finish.
 *
 * Fine luminance grain, display-referred (after AgX and the Enhanced grade),
 * strongest in the midtones the way a film emulsion's is and nearly absent in
 * deep shadow and highlight, so night skies stay clean and sunlit cloud stays
 * white. Triangular (two-hash) noise of zero mean: it never shifts exposure.
 * The pattern moves each frame in flight and holds still in photo mode and
 * under reduced motion. No texture, no target, no extra pass: it merges into
 * the existing display EffectPass beside HDRGrade and Vignette.
 */
export const FILM_GRADE_GLSL = `
uniform float uFilmGrain;
uniform float uFilmSeed;
float filmHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){
 vec2 px=floor(gl_FragCoord.xy);
 float n=filmHash(px+vec2(uFilmSeed*17.13,uFilmSeed*5.31))+filmHash(px.yx*1.37+vec2(uFilmSeed*3.71,uFilmSeed*11.9))-1.;
 vec3 c=inputColor.rgb;
 float y=clamp(dot(c,vec3(.2126,.7152,.0722)),0.,1.);
 outputColor=vec4(max(c+n*uFilmGrain*(.25+3.*y*(1.-y)),0.),inputColor.a);
}
`;

export function filmGradeOn(tier) {
  return livingWorldOn('FILM_GRADE') && tier !== 'low';
}

export class FilmGradeEffect extends Effect {
  constructor() {
    const b = livingWorldBlock('FILM_GRADE') ?? {};
    super('FilmGrade', FILM_GRADE_GLSL, { uniforms: new Map([['uFilmGrain', new Uniform(b.grain ?? 0.018)], ['uFilmSeed', new Uniform(0)]]) });
    this.inputColorSpace = SRGBColorSpace;
    this.frame = 0;
  }
  update() {
    // The live camera mode decides whether the grain moves (photo mode holds it).
    const still = readReducedMotion() || useFlyStore.getState().cameraMode === 'photo';
    if (!still) this.frame = (this.frame + 1) % 997;
    this.uniforms.get('uFilmSeed').value = this.frame;
  }
}

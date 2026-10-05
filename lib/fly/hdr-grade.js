import { Effect } from 'postprocessing';
import { SRGBColorSpace, Uniform } from 'three';
import { cinemaEnvironment } from './cinema-frame';

// Display finishing only. HDR radiance, bloom and AgX have already run.
// Preserve black/white endpoints and keep the night toe open for navigation.
export const HDR_GRADE_GLSL = `
uniform float hdrDay;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
 vec3 c=clamp(inputColor.rgb,0.,1.);
 float y=dot(c,vec3(.2126,.7152,.0722));
 float mid=smoothstep(.08,.35,y)*(1.-smoothstep(.72,1.,y));
 c=mix(vec3(y),c,1.+.15*mid);
 c+=(c-.45)*c*(1.-c)*mix(.08,.38,hdrDay);
 // Restrained split tone: open blue shade, honey light, neutral whites.
 vec3 tint=mix(vec3(-.012,.001,.018),vec3(.016,.003,-.014),smoothstep(.22,.78,y));
 c+=tint*c*(1.-c)*mix(.45,1.,hdrDay);
 outputColor=vec4(clamp(c,0.,1.),inputColor.a);
}
`;

/** Merges into the existing display pass; no texture, target, or extra draw. */
export class HDRGradeEffect extends Effect {
  constructor() {
    super('HDRGrade', HDR_GRADE_GLSL, { uniforms: new Map([['hdrDay', new Uniform(1)]]) });
    this.inputColorSpace = SRGBColorSpace;
  }
  update() { this.uniforms.get('hdrDay').value = cinemaEnvironment.day; }
}

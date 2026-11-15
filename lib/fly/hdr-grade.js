import { Effect } from 'postprocessing';
import { SRGBColorSpace, Uniform, Vector4 } from 'three';
import { cinemaEnvironment } from './cinema-frame';
import { BUILDING_REALISM_ON } from './architectural-realism';
import { LOOK_GRADE_CFG, LOOK_GRADE_ON, lookGradeState } from './look-grade';

const f = (v, d) => (Number.isFinite(v) ? v : d).toFixed(4);

/*
 * LOOK PASS E (GRADE): the display tone curve and colour finish, after AgX.
 * AgX resolves highlights gracefully but leaves a flat, grey midtone; this
 * opens the toe (shadow detail), adds a luma-only midtone S with a soft
 * shoulder (no hue shift), lifts chroma on unsaturated colour while denying
 * most of the lift to orange/brown hues (the owner's "brown city" rejection),
 * and splits tone: blue-grey shade, honey light at low sun. uLook.x is the
 * live weight (0 on Medium/phone/Low and with the flag off: exact identity).
 */
function lookGradeGLSL(C = LOOK_GRADE_CFG) {
  return `
uniform vec4 uLook;   // x weight, y day, z low sun, w twilight
vec3 lookGrade(vec3 c){
 float g=uLook.x;
 // Full night keeps today's curve: contrast and vibrance fade out below civil
 // twilight (only the toe lift stays, which opens night shade a little).
 float awake=clamp(3.*max(max(uLook.y,uLook.z),uLook.w),0.,1.);
 float y=max(dot(c,vec3(.2126,.7152,.0722)),1e-5);
 // Toe lift then a midtone S on luma, scaled back onto the colour.
 float y1=y+${f(C.toeLift, 0.3)}*g*y*pow(1.-y,3.)*mix(.35,1.,max(uLook.y,uLook.w));
 float k=${f(C.contrast, 0.42)}*g*mix(.35,1.,uLook.y)*awake;
 float y2=y1+k*(y1-${f(C.pivot, 0.4)})*y1*(1.-y1)*2.;
 y2-=${f(C.shoulder, 0.1)}*g*smoothstep(.78,1.,y2)*(y2-.78);
 c*=clamp(y2,0.,1.)/y;
 // Vibrance with a warm guard: greens, blues and water take the lift.
 float yy=dot(c,vec3(.2126,.7152,.0722));
 float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b));
 float sat=(mx-mn)/max(mx,1e-4);
 float warm=smoothstep(.0,.08,c.r-c.b)*smoothstep(-.02,.06,c.r-c.g);
 // At low sun the guard lifts off sunlit (bright) warm colour: gold light is
 // the point of the hour. Dark and mid browns stay guarded at every hour.
 warm*=1.-uLook.z*smoothstep(.30,.60,yy);
 float v=${f(C.vibrance, 0.34)}*g*awake*mix(.25,1.,max(uLook.y,uLook.z))*(1.-sat)*smoothstep(.02,.18,yy)*(1.-${f(C.warmGuard, 0.7)}*warm);
 c=mix(vec3(yy),c,1.+v);
 // Split tone: cool open shade by day and at twilight, honey in lit mids at low sun.
 float shade=(1.-smoothstep(.06,.42,yy))*smoothstep(.0,.05,yy);
 c+=vec3(-.55,-.10,1.)*${f(C.shadeCool, 0.055)}*g*shade*max(uLook.y,.6*uLook.w);
 float lit=smoothstep(.30,.62,yy)*(1.-smoothstep(.80,1.,yy));
 c+=vec3(1.,.45,-.6)*${f(C.keyWarm, 0.03)}*g*lit*uLook.z;
 return max(c,0.);
}
`;
}

// Display finishing only. HDR radiance, bloom and AgX have already run.
// Preserve black/white endpoints and keep the night toe open for navigation.
export function hdrGradeGLSL(realism = BUILDING_REALISM_ON, look = LOOK_GRADE_ON) { return `
uniform float hdrDay;${look ? lookGradeGLSL() : ''}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
 vec3 c=clamp(inputColor.rgb,0.,1.);
 float y=dot(c,vec3(.2126,.7152,.0722));
 float mid=smoothstep(.08,.35,y)*(1.-smoothstep(.72,1.,y));
 c=mix(vec3(y),c,${realism ? '1.+mix(.15,.035,hdrDay)*mid' : '1.+.15*mid'});
 c+=(c-.45)*c*(1.-c)*mix(.08,.38,hdrDay);
 // Restrained split tone: open blue shade, honey light, neutral whites.
 vec3 tint=mix(vec3(-.012,.001,.018),vec3(.016,.003,-.014),smoothstep(.22,.78,y));
 c+=tint*c*(1.-c)*${realism ? 'mix(.45,.20,hdrDay)' : 'mix(.45,1.,hdrDay)'};${look ? `
 if(uLook.x>0.)c=lookGrade(clamp(c,0.,1.));` : ''}
 outputColor=vec4(clamp(c,0.,1.),inputColor.a);
}
`; }
export const HDR_GRADE_GLSL = hdrGradeGLSL();

/** Merges into the existing display pass; no texture, target, or extra draw. */
export class HDRGradeEffect extends Effect {
  constructor() {
    const uniforms = new Map([['hdrDay', new Uniform(1)]]);
    if (LOOK_GRADE_ON) uniforms.set('uLook', new Uniform(new Vector4()));
    super('HDRGrade', HDR_GRADE_GLSL, { uniforms });
    this.inputColorSpace = SRGBColorSpace;
  }
  update() {
    this.uniforms.get('hdrDay').value = cinemaEnvironment.day;
    const look = this.uniforms.get('uLook');
    if (look) {
      const s = lookGradeState, g = s.weight * (Number.isFinite(LOOK_GRADE_CFG.grade) ? LOOK_GRADE_CFG.grade : 1);
      look.value.set(g, s.day * (1 - 0.5 * s.overcast), s.lowSun * (1 - s.overcast), s.twilight);
    }
  }
}

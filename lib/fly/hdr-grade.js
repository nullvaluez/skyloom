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
 // Noon share: full daylight with the sun high (day, not low sun).
 float noon=clamp(uLook.y-uLook.z,0.,1.);
 // Toe lift then a midtone S on luma, scaled back onto the colour. The toe
 // opens shade by day and at twilight; at noon most of it is withheld so the
 // blacks stay deep (an open toe read as a milky lower frame from cruise).
 // Keyed on day, not low sun: a full toe at golden hour opened forest shade
 // texture and doubled the Yosemite burst sparkle.
 float y1=y+${f(C.toeLift, 0.3)}*g*y*pow(1.-y,3.)*mix(.35,1.,max(uLook.y,uLook.w))*(1.-.6*noon);
 float k=(${f(C.contrast, 0.42)}+${f(C.contrastNoon, 0)}*noon)*g*mix(.35,1.,uLook.y)*awake;
 // At noon the pivot rises: hazy mid ground (cruise, far suburbs) holds or
 // deepens instead of lifting toward milk, while clouds and sunlit roofs open.
 float y2=y1+k*(y1-mix(${f(C.pivot, 0.4)},${f(C.pivotNoon, 0.4)},noon))*y1*(1.-y1)*2.;
 // Soft shoulder, firmer at low sun so gold-lit cloud tops keep their shading.
 float sh0=mix(.78,.66,uLook.z);
 y2-=${f(C.shoulder, 0.1)}*(1.+${f(C.shoulderGolden, 0)}*uLook.z)*g*smoothstep(sh0,1.,y2)*(y2-sh0);
 c*=clamp(y2,0.,1.)/y;
 // Vibrance with a warm guard: greens, blues and water take the lift.
 float yy=dot(c,vec3(.2126,.7152,.0722));
 float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b));
 float sat=(mx-mn)/max(mx,1e-4);
 float warm=smoothstep(.0,.08,c.r-c.b)*smoothstep(-.02,.06,c.r-c.g);
 // At low sun the guard lifts off sunlit (bright) warm colour: gold light is
 // the point of the hour. Dark and mid browns stay guarded at every hour, and
 // so do the brightest tops (clouds), which would otherwise blow to cream.
 warm*=1.-uLook.z*smoothstep(.30,.60,yy)*(1.-smoothstep(.74,.90,yy));
 float v=${f(C.vibrance, 0.34)}*g*awake*mix(.25,1.,max(uLook.y,uLook.z))*(1.-sat)*smoothstep(.02,.18,yy)*(1.-${f(C.warmGuard, 0.7)}*warm);
 c=mix(vec3(yy),c,1.+v);
 // Noon colour: hue-selective chroma on the cool and green families only
 // (sky, water, crops, trees). Warm/brown is never pushed (brown-city rule).
 float wB=smoothstep(.0,.10,c.b-max(c.r,c.g));
 float wG=smoothstep(.0,.05,c.g-c.b)*smoothstep(-.04,.03,c.g-c.r);
 float day=g*uLook.y*awake;
 vec3 d=c-yy;
 // Already-saturated colour (the cruise zenith) takes little, and the lift
 // stops where a channel would leave the gamut (no clipped, hue-shifted blue).
 float ns=1.+day*(1.-.75*sat)*(${f(C.noonBlue, 0)}*wB+${f(C.noonGreen, 0)}*wG);
 float dn=min(d.r,min(d.g,d.b));
 ns=min(ns,max(1.,.97*yy/max(-dn,1e-4)));
 c=yy+d*ns;
 // Crop variety: spread green hues apart (yellow-greens toward gold-olive,
 // blue-greens toward deep green), so a field of two greens separates.
 if(wG*day>.001){
  float a=c.r-c.g,bb=.5*(c.r+c.g)-c.b,m=(c.r+c.g+c.b)/3.;
  float ang=atan(bb,a),rad=length(vec2(a,bb));
  if(ang<0.)ang+=6.2831853; // greens sit near 1.6..3.5 rad: no wrap inside the band
  ang=2.03+(ang-2.03)*(1.+${f(C.greenSpread, 0)}*wG*day);
  a=rad*cos(ang);bb=rad*sin(ang);
  float b2=m-bb/1.5,rg=3.*m-b2;
  vec3 s2=max(vec3(.5*(rg+a),.5*(rg-a),b2),0.);
  float ys=dot(s2,vec3(.2126,.7152,.0722));
  c=mix(c,s2*(yy/max(ys,1e-4)),wG);
 }
 // A deeper zenith: bright saturated blue (the upper sky) loses value, the
 // pale horizon much less, so the blue-to-horizon gradient strengthens.
 float skyB=smoothstep(.04,.16,c.b-max(c.r,c.g))*smoothstep(.25,.55,yy);
 c*=1.-${f(C.skyDeep, 0)}*day*skyB;
 // Low sun: the warmed key's mie on a blue sky passes through teal-green
 // between the blue and the gold. Bright, unsaturated, green-led pixels are
 // turned toward lavender-peach so the hue path is blue, lavender, peach, gold.
 float ge=max(0.,c.g-max(c.r,c.b));
 float teal=g*uLook.z*smoothstep(.30,.50,yy)*(1.-smoothstep(.12,.30,sat));
 c+=vec3(.55,-1.,.25)*ge*teal*${f(C.tealGuard, 0)};
 // Split tone: cool open shade by day and at twilight, honey in lit mids at low sun.
 float shade=(1.-smoothstep(.06,.42,yy))*smoothstep(.0,.05,yy);
 c+=vec3(-.55,-.10,1.)*${f(C.shadeCool, 0.055)}*g*shade*max(uLook.y,.6*uLook.w);
 float lit=smoothstep(.30,.62,yy)*(1.-smoothstep(.76,.95,yy));
 c+=vec3(1.,.45,-.6)*${f(C.keyWarm, 0.03)}*g*lit*uLook.z;
 // Noon: a warm-neutral key on sunlit stone, brick and concrete (lit,
 // unsaturated), against the blue shade. Clouds (the brightest) are spared.
 float litN=smoothstep(.36,.62,yy)*(1.-smoothstep(.80,.95,yy))*(1.-smoothstep(.10,.32,sat));
 c+=vec3(1.,.62,-.35)*${f(C.noonWarm, 0)}*litN*g*noon;
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

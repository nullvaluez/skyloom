/**
 * TRUE EARTH — verify-hdr-guard: HDR_GUARD (lib/fly/hdr-guard.js, wired into
 * both cloud composite materials in lib/fly/immersive-cloud-pass.js).
 *
 * THE DEFECT CLASS. One NaN/Inf/negative HDR pixel reaching bloom is spread by
 * its mipmap chain over the whole frame, which presents black
 * (BLACK_FLICKER_FIX.md: 7 black frames in 702 from one forest instance).
 * The forest source was fixed; nothing guarded the next source.
 *
 * THE CONTRACT
 *  (1) flag explicitly off: the composite text is untouched;
 *  (2) the guard transform hits both anchors exactly once, and refuses (null)
 *      when an anchor is missing or duplicated, so it can never half-apply;
 *  (3) both composite materials in immersive-cloud-pass.js go through
 *      hdrGuarded(), and the output anchor exists exactly once in that file;
 *  (4) ON A REAL WebGL2 IMPLEMENTATION (headless Chromium, SwiftShader here;
 *      the owner's GPUs on their run list): hdrSafe maps NaN -> 0, +Inf ->
 *      65504, -Inf and negatives -> 0, and leaves valid values bit-exact. An
 *      unguarded control must show NaN/Inf, proving the inputs were really
 *      produced at runtime and not constant-folded away.
 *
 * Run: node scripts/verify-hdr-guard.mjs
 */
import { register, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BloomEffect } from 'postprocessing';
globalThis.window={__flyHdrGuardOverride:{enabled:false}};
register('./_node-resolve.mjs', import.meta.url);
const { HDR_SAFE_GLSL, guardHdrComposite, hdrGuarded, HDR_GUARD_ACTIVE, hdrGuardBloom: bloomOff } = await import('../lib/fly/hdr-guard.js');
const { MobileBloomEffect } = await import('../lib/fly/mobile-bloom.js');
delete globalThis.window.__flyHdrGuardOverride;
const { hdrGuardBloom: bloomOn, guardBloomLuminance } = await import('../lib/fly/hdr-guard.js?shipped');

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const OUT = ' gl_FragColor=vec4(mix(scene,result,cloudMix),1.);';
const sample = `uniform float x;\nvoid main(){\n vec3 scene=vec3(1.);vec3 result=scene;float cloudMix=.5;\n${OUT}\n}`;

// (1)
check('(1) flag explicitly off: composite text untouched', HDR_GUARD_ACTIVE.enabled === false && hdrGuarded(sample) === sample);

// (2)
{
  const g = guardHdrComposite(sample);
  const ok =
    typeof g === 'string' &&
    g.includes('gl_FragColor=vec4(hdrSafe(mix(scene,result,cloudMix)),1.);') &&
    g.indexOf('vec3 hdrSafe(') < g.indexOf('void main(){') &&
    guardHdrComposite(sample.replace(OUT, '')) === null &&
    guardHdrComposite(sample + OUT) === null &&
    guardHdrComposite(sample.replace('void main(){', 'void mainX(){')) === null;
  check('(2) transform hits both anchors once; refuses a missing or duplicated anchor', ok);
}

// (3)
{
  const src = readFileSync(path.join(ROOT, 'lib/fly/immersive-cloud-pass.js'), 'utf8');
  const count = src.split(OUT).length - 1;
  const ok =
    count === 1 &&
    // TRUE_SCALE (Phase 1) and PHYS_SKY (Phase 2) wrap the text first; the
    // guard is still the last word.
    /this\.compositeMaterial=material\(hdrGuarded\((tsComposite\('cloud-composite',)?composite\)?\)\);/.test(src) &&
    /composite:material\(hdrGuarded\((tsComposite\('cloud-composite-r25',)?(physComposite\()?compositeR25\)?\)?\)\)/.test(src);
  check('(3) both composite materials go through hdrGuarded(); anchor present once', ok, `anchor count ${count}`);
}

const desktop = new BloomEffect({ luminanceThreshold: 1, luminanceSmoothing: 0.2 });
const mobile = new MobileBloomEffect({ luminanceThreshold: 1, luminanceSmoothing: 0.2 });
const originalLuminance = desktop.luminanceMaterial.fragmentShader;
const desktopTargets = [desktop.luminancePass.renderTarget, desktop.mipmapBlurPass];
bloomOff(desktop);
check('flag off: actual bloom luminance shader untouched', desktop.luminanceMaterial.fragmentShader === originalLuminance);
bloomOn(desktop);
bloomOn(mobile);
const guardedLuminance = desktop.luminanceMaterial.fragmentShader;
check('desktop and mobile guard the actual bloom sample before luma and filtering',
  guardedLuminance !== originalLuminance &&
  guardedLuminance === mobile.luminanceMaterial.fragmentShader &&
  guardedLuminance.indexOf('texel.rgb=hdrSafe(texel.rgb)') < guardedLuminance.indexOf('float l=luminance(texel.rgb)') &&
  desktop.luminancePass.renderTarget === desktopTargets[0] && desktop.mipmapBlurPass === desktopTargets[1] &&
  guardBloomLuminance(originalLuminance.replace('vec4 texel=texture2D(inputBuffer,vUv);', '')) === null);
desktop.dispose();
mobile.dispose();

// (4) the GLSL on a real WebGL2 implementation
{
  const require = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    chromium = null;
  }
  if (!chromium) {
    check('(4) WebGL2 readback', false, 'playwright not resolvable');
  } else {
    const browser = await chromium.launch({
      channel: process.env.FLY_BROWSER_CHANNEL,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    try {
      const page = await browser.newPage();
      const result = await page.evaluate(({ glsl, luminance, guardedLuminance }) => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');
        if (!gl) return { error: 'no webgl2' };
        if (!gl.getExtension('EXT_color_buffer_float')) return { error: 'no EXT_color_buffer_float' };
        const N = 8;
        const run = (guard, bloom = false) => {
          const vs = `#version 300 es
in vec2 p;out vec2 vUv;void main(){vUv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
          const fs = bloom ? `#version 300 es
precision highp float;out vec4 o;
#define FRAMEBUFFER_PRECISION_HIGH
#define COLOR
#define THRESHOLD
${(guard ? guardedLuminance : luminance)
  .replace('#include <common>', 'float luminance(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}')
  .replace('varying vec2 vUv;', 'in vec2 vUv;')
  .replace('texture2D(', 'texture(')
  .replaceAll('gl_FragColor', 'o')}` : `#version 300 es
precision highp float;uniform float uZero;out vec4 o;
${glsl}
float v(int i){
 if(i==0)return uZero/uZero;
 if(i==1)return 1./uZero;
 if(i==2)return -1./uZero;
 if(i==3)return -1.;
 if(i==4)return .5;
 if(i==5)return 100.;
 if(i==6)return 70000.;
 return 0.;
}
void main(){float x=v(int(gl_FragCoord.x));vec3 c=vec3(x);o=vec4(${guard ? 'hdrSafe(c)' : 'c'},1.);}`;
          const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            return s;
          };
          const prog = gl.createProgram();
          gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
          gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
          gl.bindAttribLocation(prog, 0, 'p');
          gl.linkProgram(prog);
          if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, 1, 0, gl.RGBA, gl.FLOAT, null);
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          const buf = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
          gl.viewport(0, 0, N, 1);
          gl.useProgram(prog);
          if (bloom) {
            const input = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, input);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            const channels = [NaN, Infinity, -Infinity, -1, 0.5, 100, 65504, 0];
            const data = new Float32Array(channels.flatMap(x => [x, x, x, 1]));
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, 1, 0, gl.RGBA, gl.FLOAT, data);
            gl.uniform1f(gl.getUniformLocation(prog, 'threshold'), 1);
            gl.uniform1f(gl.getUniformLocation(prog, 'smoothing'), .2);
          } else {
            gl.uniform1f(gl.getUniformLocation(prog, 'uZero'), 0);
          }
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const px = new Float32Array(N * 4);
          gl.readPixels(0, 0, N, 1, gl.RGBA, gl.FLOAT, px);
          return Array.from({ length: N }, (_, i) => String(px[i * 4]));
        };
        try {
          return { renderer: gl.getParameter(gl.RENDERER), guarded: run(true), control: run(false),
            bloomGuarded: run(true, true), bloomControl: run(false, true) };
        } catch (e) {
          return { error: e.message };
        }
      }, { glsl: HDR_SAFE_GLSL, luminance: originalLuminance, guardedLuminance });
      if (result.error) {
        check('(4) WebGL2 readback', false, result.error);
      } else {
        const want = ['0', '65504', '0', '0', '0.5', '100', '65504', '0'];
        const controlInvalid = result.control[0] === 'NaN' && result.control[1] === 'Infinity';
        const ok = JSON.stringify(result.guarded) === JSON.stringify(want) && controlInvalid;
        check(
          '(4) on WebGL2, hdrSafe: NaN->0, +Inf->65504, -Inf/neg->0, valid values exact',
          ok,
          `guarded [${result.guarded.join(', ')}]; unguarded control [${result.control.join(', ')}] on ${result.renderer}`,
        );
        const bloomWanted = ['0', '65504', '0', '0', '0', '100', '65504', '0'];
        check('invalid scene pixels are bounded before the actual bloom luma filter',
          JSON.stringify(result.bloomGuarded) === JSON.stringify(bloomWanted) &&
          result.bloomControl[0] === 'NaN' && result.bloomControl[1] === 'Infinity' &&
          result.bloomControl[5] === result.bloomGuarded[5] && result.bloomControl[6] === result.bloomGuarded[6],
          `guarded [${result.bloomGuarded.join(', ')}]; unguarded [${result.bloomControl.join(', ')}]`);
      }
    } finally {
      await browser.close();
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

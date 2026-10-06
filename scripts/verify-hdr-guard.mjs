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
 *  (1) flag off (default): the composite text is untouched;
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
register('./_node-resolve.mjs', import.meta.url);
const { HDR_SAFE_GLSL, guardHdrComposite, hdrGuarded, HDR_GUARD_ACTIVE } = await import('../lib/fly/hdr-guard.js');

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
check('(1) flag off (default): composite text untouched', HDR_GUARD_ACTIVE.enabled === false && hdrGuarded(sample) === sample);

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
    src.includes('this.compositeMaterial=material(hdrGuarded(composite));') &&
    src.includes('composite:material(hdrGuarded(compositeR25))');
  check('(3) both composite materials go through hdrGuarded(); anchor present once', ok, `anchor count ${count}`);
}

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
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    try {
      const page = await browser.newPage();
      const result = await page.evaluate((glsl) => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');
        if (!gl) return { error: 'no webgl2' };
        if (!gl.getExtension('EXT_color_buffer_float')) return { error: 'no EXT_color_buffer_float' };
        const N = 8;
        const run = (guard) => {
          const vs = `#version 300 es
in vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
          const fs = `#version 300 es
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
          gl.uniform1f(gl.getUniformLocation(prog, 'uZero'), 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const px = new Float32Array(N * 4);
          gl.readPixels(0, 0, N, 1, gl.RGBA, gl.FLOAT, px);
          return Array.from({ length: N }, (_, i) => String(px[i * 4]));
        };
        try {
          return { renderer: gl.getParameter(gl.RENDERER), guarded: run(true), control: run(false) };
        } catch (e) {
          return { error: e.message };
        }
      }, HDR_SAFE_GLSL);
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
      }
    } finally {
      await browser.close();
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

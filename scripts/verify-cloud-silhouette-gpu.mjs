import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { CLOUD_DEPTH_GLSL, CLOUD_FILTER_GLSL, CLOUD_RECONSTRUCTION_GLSL } from '../lib/fly/cloud-reconstruction.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
try {
  const page = await browser.newPage();
  const results = [];
  for (const stable of [false, true]) results.push(await page.evaluate(({ filter, reconstruct, depthRead, stable }) => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw Error('Float render targets unavailable');
    const compile = (type, source) => {
      const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s;
    };
    const vertex = '#version 300 es\nout vec2 vUv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.-1.,0,1);}';
    const header = '#version 300 es\nprecision highp float;precision highp sampler2D;in vec2 vUv;out vec4 color;\n#define gl_FragColor color\n#define texture2D texture\nuniform sampler2D guide;\n' + depthRead
      + (stable ? 'float distanceAt(vec2 uv){return cloudDepthAt(guide,uv);}\n' : 'float distanceAt(vec2 uv){return texture(guide,uv).r;}\n');
    const program = fragment => {
      const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, header + fragment)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p)); return p;
    };
    const blur = program(filter);
    const march = program('void main(){gl_FragColor=distanceAt(vUv)<100.?vec4(0,0,0,1):vec4(.6,.3,.15,.25);}');
    const up = program('uniform sampler2D clouds;uniform vec2 texel;void main(){float dist=distanceAt(vUv);' + reconstruct + 'gl_FragColor=total>.001?sum/total:vec4(0,0,0,1);}');
    const texture = (size, data) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, data);
      for (const a of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, a, gl.NEAREST);
      for (const a of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, a, gl.CLAMP_TO_EDGE); return t;
    };
    const draw = (p, input, output, size, guide, low, axis) => {
      gl.useProgram(p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input); gl.uniform1i(gl.getUniformLocation(p, 'clouds'), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, guide); gl.uniform1i(gl.getUniformLocation(p, 'guide'), 1);
      gl.uniform2f(gl.getUniformLocation(p, 'texel'), 1 / low, 1 / low); if (axis) gl.uniform2f(gl.getUniformLocation(p, 'filterAxis'), ...axis);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Incomplete filter target');
      gl.viewport(0, 0, size, size); gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const fb = gl.createFramebuffer(), cases = [];
    const size = 120;
    for (const low of [24, 30, 36]) for (const offset of [0, 0.6, 1.2, 1.8, 2.4]) {
      const opaque = (x, y) => {
        x -= 60 + offset; y -= 60;
        const angle = 0.37, xx = x * Math.cos(angle) - y * Math.sin(angle), yy = x * Math.sin(angle) + y * Math.cos(angle);
        // A fuselage, swept wings and tail: concavities are where four
        // low-resolution centres can cover an otherwise open sky pixel.
        return (Math.abs(xx) < 5 && Math.abs(yy) < 38)
          || (Math.abs(xx) < 42 && Math.abs(yy + Math.abs(xx) * 0.45) < 5)
          || (Math.abs(xx) < 17 && Math.abs(yy - 29 + Math.abs(xx) * 0.2) < 3);
      };
      const depth = new Float32Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) depth[(x + y * size) * 4] = opaque(x + 0.5, y + 0.5) ? 10 : 1e6;
      const guide = texture(size, depth), source = texture(low, null), horizontal = texture(low, null), vertical = texture(low, null), target = texture(size, null);
      draw(march, null, source, low, guide, low); draw(blur, source, horizontal, low, guide, low, [1, 0]); draw(blur, horizontal, vertical, low, guide, low, [0, 1]); draw(up, vertical, target, size, guide, low);
      const data = new Float32Array(size * size * 4); gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, data);
      let skyLoss = 0, hullLeak = 0;
      for (let i = 0; i < size * size; i++) {
        if (depth[i * 4] > 100 && data[i * 4] < 0.5) skyLoss++;
        if (depth[i * 4] < 100 && data[i * 4] > 1e-6) hullLeak++;
      }
      cases.push({ scale: low / size, offset, skyLoss, hullLeak });
      for (const t of [guide, source, horizontal, vertical, target]) gl.deleteTexture(t);
    }
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { stable, cases, glError: gl.getError(), renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  }, { filter: CLOUD_FILTER_GLSL, reconstruct: CLOUD_RECONSTRUCTION_GLSL, depthRead: CLOUD_DEPTH_GLSL, stable }));
  const [legacy, fixed] = results;
  for (const result of results) assert.equal(result.glError, 0);
  const leaks = result => result.cases.reduce((n, row) => n + row.hullLeak, 0);
  assert.ok(leaks(legacy) > 0, 'RED calibration: driver did not reproduce the original cloud/hull depth-address mismatch');
  for (const row of fixed.cases) {
    assert.equal(row.hullLeak, 0, `cloud leaked into the opaque aircraft at scale ${row.scale}, offset ${row.offset}`);
    // Four taps can still miss a subpixel concave gap in the airframe; they
    // must not create a broad clear-sky fringe as the aircraft moves.
    assert.ok(row.skyLoss <= 8, `cloud missing from ${row.skyLoss} background pixels`);
  }
  console.log(`PASS cloud/aircraft silhouette: ${leaks(legacy)} -> ${leaks(fixed)} leaked hull pixels across ${fixed.cases.length} moving silhouettes, no GL errors`);
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }

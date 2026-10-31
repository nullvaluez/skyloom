import assert from 'node:assert/strict';
import { ShaderLib, UniformsUtils } from 'three';
import { getDFGLUT } from 'three/src/renderers/shaders/DFGLUTData.js';
import { chromium } from 'playwright';
import { applyTerrainDfg, TERRAIN_DFG_GLSL, TERRAIN_DFG_UNIFORMS } from '../lib/fly/terrain-dfg.js';

const shader = { fragmentShader: ShaderLib.standard.fragmentShader, uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms) };
applyTerrainDfg(shader);
assert(!/\bdfgLUT\b/.test(shader.fragmentShader));
assert.equal(shader.fragmentShader.split('earthDfgSample(').length, 6, 'definition and all four Three lookups');
assert.equal(shader.uniforms.uEarthDfg, TERRAIN_DFG_UNIFORMS.uEarthDfg);
assert.throws(() => applyTerrainDfg({ fragmentShader: '', uniforms: {} }), /anchors changed/);
const original = getDFGLUT().image.data, packed = TERRAIN_DFG_UNIFORMS.uEarthDfg.value;
for (let i = 0; i < 256; i++) {
  assert.equal(packed[i] & 65535, original[i * 2]);
  assert.equal(packed[i] >>> 16, original[i * 2 + 1]);
}
console.log('PASS all 512 upstream half floats preserved; every lighting lookup converted; missing anchors rejected');

const browser = await chromium.launch({ args: [process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(({ glsl, packed, original }) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
    const gl = canvas.getContext('webgl2');
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw Error('Float WebGL2 target required');
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}'],
      [gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; precision highp int;
uniform sampler2D reference; uniform vec3 sampleGrid; out vec4 color;
${glsl}
void main(){vec2 uv=(gl_FragCoord.xy/sampleGrid.x)*sampleGrid.y+sampleGrid.z;
color=vec4(earthDfgSample(uv).rg,texture(reference,uv).rg);}`],
    ]) {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program); gl.uniform4uiv(gl.getUniformLocation(program, 'uEarthDfg[0]'), new Uint32Array(packed));
    const reference = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, reference);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, 16, 16, 0, gl.RG, gl.HALF_FLOAT, new Uint16Array(original));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const output = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, output);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 96, 96, 0, gl.RGBA, gl.FLOAT, null);
    const target = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
    gl.bindTexture(gl.TEXTURE_2D, reference);
    const rows = [];
    for (const [name, size, scale, offset] of [['texel-centres', 16, 1, 0], ['interpolated', 64, 1, 0], ['clamped-edges', 96, 1.5, -.25]]) {
      gl.viewport(0, 0, size, size); gl.uniform3f(gl.getUniformLocation(program, 'sampleGrid'), size, scale, offset);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixels = new Float32Array(size * size * 4); gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, pixels);
      let maxError = 0;
      for (let i = 0; i < pixels.length; i += 4) maxError = Math.max(maxError, Math.abs(pixels[i] - pixels[i + 2]), Math.abs(pixels[i + 1] - pixels[i + 3]));
      rows.push({ name, samples: size * size, maxError });
    }
    return { rows, glError: gl.getError(), uniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) };
  }, { glsl: TERRAIN_DFG_GLSL, packed: Array.from(packed), original: Array.from(original) });
  console.log(JSON.stringify(result));
  assert.equal(result.glError, 0);
  assert.equal(result.rows[0].maxError, 0, 'texel centres reproduce the upstream table exactly');
  for (const row of result.rows) assert(row.maxError <= .001, `${row.name}: below one quarter of an 8-bit step, including driver filtering precision`);
  console.log('PASS uniform lookup matches the original GPU texture across centres, bilinear samples and clamped edges');
} finally { await browser.close(); }

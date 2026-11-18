// Exercise the production photo packing and GLSL at fractional camera phases.
// A one-texel stripe has a known box-filtered mean once a pixel spans its period.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chromium } from 'playwright';

register('./_node-resolve.mjs', import.meta.url);
globalThis.window = { location: { search: '' }, __flyFlightClarityOverride: { enabled: true } };
const { packPhotoMips } = await import('../lib/fly/toy-world/sat-stand-in-photo-core.js');
const { createPhotoAtlas } = await import('../lib/fly/toy-world/sat-stand-in-photo.js');
const { STAND_IN_PHOTO_FILTER } = await import('../lib/fly/sat-stand-in-material.js');
const { filmGradeOn } = await import('../lib/fly/film-grade.js');
assert.equal(filmGradeOn('high'), false);

const size = 64;
const stripe = new Uint8Array(size * size * 4);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = (y * size + x) * 4;
  stripe.fill(x % 2 ? 255 : 0, i, i + 3);
  stripe[i + 3] = 255;
}
const pixels = packPhotoMips(stripe, size);
assert.deepEqual(pixels.subarray(0, stripe.length), stripe);
for (let side = size / 2; side >= 1; side /= 2) {
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = ((size + y) * size + size - 2 * side + x) * 4;
    assert.equal(pixels[i], 188, '50% linear energy is sRGB byte 188');
  }
}
const atlas = createPhotoAtlas(size, 2, 0);
assert.equal(atlas.alloc({ n: size, alb: pixels }), 0);
assert.equal(atlas.alloc({ n: size, alb: pixels }), 1);
assert.deepEqual([...atlas.texture.layerUpdates], [0, 1]);
atlas.texture.clearLayerUpdates();
atlas.free(0);
assert.equal(atlas.alloc({ n: size, alb: pixels }), 0);
assert.deepEqual([...atlas.texture.layerUpdates], [0]);
atlas.dispose();

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(({ filter, data, size }) => {
    const gl = document.createElement('canvas').getContext('webgl2', { antialias: false });
    const program = gl.createProgram();
    function attach(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    attach(gl.VERTEX_SHADER, `#version 300 es
    void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`);
    attach(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    uniform highp sampler2DArray uStandInPhotos;
    uniform vec2 sampleAt;
    uniform float footprint;
    uniform bool filtered;
    out vec4 pixel;
    ${filter}
    void main(){
      vec3 c=filtered ? standInPhotoFiltered(sampleAt,0.,footprint) : standInPhotoLevel(sampleAt,0.,float(textureSize(uStandInPhotos,0).x),0.);
      pixel=vec4(c,1.);
    }`);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.viewport(0, 0, 1, 1);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.SRGB8_ALPHA8, size, size * 1.5, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const output = new Uint8Array(4);
    function sweep(filtered, texelsPerPixel) {
      gl.uniform1i(gl.getUniformLocation(program, 'filtered'), Number(filtered));
      gl.uniform1f(gl.getUniformLocation(program, 'footprint'), texelsPerPixel / size);
      const values = [];
      for (let i = 0; i <= 32; i++) {
        gl.uniform2f(gl.getUniformLocation(program, 'sampleAt'), (16.5 + i / 16) / size, .5);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, output);
        values.push(output[0]);
      }
      return { min: Math.min(...values), max: Math.max(...values) };
    }
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
      old: sweep(false, 4), filtered: sweep(true, 4), close: sweep(true, .25), glError: gl.getError() };
  }, { filter: STAND_IN_PHOTO_FILTER, data: [...pixels], size });
  assert.equal(result.glError, 0);
  assert.ok(result.old.min <= 1 && result.old.max >= 254);
  assert.ok(result.filtered.min >= 126 && result.filtered.max <= 130);
  assert.deepEqual(result.close, result.old);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}

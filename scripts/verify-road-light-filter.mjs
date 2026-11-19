import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chromium } from 'playwright';
import { MeshBasicMaterial, ShaderLib } from 'three';
register('./_node-resolve.mjs', import.meta.url);
globalThis.window = { location: { search: '' }, __flyRoadLightFilterOverride: { enabled: true } };
const { applyBendRoadSat } = await import('../lib/fly/toy-world/world-bend.js');
const { SAT_ROADS, SUBURB_NIGHT } = await import('../lib/fly/fly-constants.js');
const { satelliteRoadLighting } = await import('../lib/fly/night-city.js');
const cfg = satelliteRoadLighting();
const material = new MeshBasicMaterial();
applyBendRoadSat(material, SAT_ROADS, SUBURB_NIGHT, { ...cfg, cinematic: true });
const shader = { ...ShaderLib.basic, uniforms: {} };
material.onBeforeCompile(shader);
assert.match(material.customProgramCacheKey(), /cinematic-filter/);
assert.match(shader.fragmentShader, /roadPixelM = fwidth\(ra\)/);
assert.equal(shader.fragmentShader.match(/wbFilteredDash\(/g).length, 5);
assert.match(shader.fragmentShader, /wbFilteredLamp\(sp, uRoadLamp.y/);
const begin = shader.fragmentShader.indexOf('float wbDash(');
const endOfFilter = (await import('../lib/fly/road-light-filter.js')).ROAD_LIGHT_FILTER_GLSL;
const functions = shader.fragmentShader.slice(begin, shader.fragmentShader.indexOf(endOfFilter) + endOfFilter.length);
const hardware = process.argv.includes('--hardware');
const browser = await chromium.launch(hardware ? { channel: 'chrome', args: ['--use-angle=d3d11'] } :
  { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const rows = await (await browser.newPage()).evaluate(shaderFunctions => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 4;
    const gl = canvas.getContext('webgl2', {antialias:false, alpha:true, premultipliedAlpha:false});
    gl.disable(gl.DITHER);
    const program = gl.createProgram();
    for (const [type, text] of [[gl.VERTEX_SHADER, `#version 300 es
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(2.*p-1.,0.,1.);}`],
      [gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float;
      uniform float width; out vec4 color;
      ${shaderFunctions}
      void main(){
        float t=(gl_FragCoord.x-.5)/512.+(gl_FragCoord.y-.5)*width;
        float phase=fract(t), w=fwidth(t), d=min(phase,1.-phase);
        color=vec4(wbFilteredDash(phase,.045,w), wbDash(phase,.045),
          wbFilteredLamp(phase,260.,w),exp(-260.*d*d));
      }`]]) {
      const shader = gl.createShader(type); gl.shaderSource(shader,text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program,shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const rows = [];
    for (const width of [0,.06,.24,.7,2.4]) {
      gl.uniform1f(gl.getUniformLocation(program,'width'),width);
      gl.drawArrays(gl.TRIANGLES,0,3);
      const pixels = new Uint8Array(512*4); gl.readPixels(0,0,512,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      rows.push({width,channels:Array.from({length:4},(_,c)=>Array.from(pixels.filter((_,i)=>i%4===c)))});
    }
    if (gl.getError() !== gl.NO_ERROR) throw Error('WebGL error while reading road shader');
    return rows;
  }, functions);
  const range = a => Math.max(...a) - Math.min(...a);
  const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
  for (const {width, channels:[dash, originalDash, lamp, originalLamp]} of rows) {
    assert.ok(range(originalDash)>250 && range(originalLamp)>250, 'baseline must resolve the full pulse');
    assert.ok(Math.abs(mean(dash)-mean(originalDash))<1 && Math.abs(mean(lamp)-mean(originalLamp))<1);
    if (width === 0) { assert.deepEqual(dash,originalDash); assert.deepEqual(lamp,originalLamp); }
    else if (width > .65) { assert.equal(range(dash),0); assert.equal(range(lamp),0); }
    else { assert.ok(range(dash)<range(originalDash)); assert.ok(range(lamp)<range(originalLamp)); }
    console.log('PASS', {cyclesPerPixel:width,dashRange:range(dash),lampRange:range(lamp),dashMean:mean(dash),lampMean:mean(lamp)});
  }
} finally { await browser.close(); }

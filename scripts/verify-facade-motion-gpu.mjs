import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { FACADE_FILTER_GLSL } from '../lib/fly/facade-filtering.js';

// Lighting aliasing needs a moving, shaded GPU experiment. Raw frame changes
// count genuine surface motion as failure, so compare against each policy's
// 6x6 supersampled lighting reference at the SAME physical pixel footprint.
// This isolates missing pixel integration instead of rewarding a darker scene.
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage();
  const report = await page.evaluate(({ helpers }) => {
    const size = 40, scale = 6, frames = 18;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size * scale;
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const hardware = debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float render targets unavailable');
    const compile = (kind, source) => {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const vertex = `#version 300 es
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
    const fragment = `#version 300 es
      precision highp float;
      uniform float footprint,referenceScale,phase,viewAngle,roll;
      uniform int policy;
      out vec4 result;
      ${helpers}
      float s(float a,float b,float x){return smoothstep(a,b,x);}
      vec2 filteredSlope(vec2 cell,vec2 opening,vec2 pitch,vec2 width){
        vec2 gradient=vec2(
          archPaneAxis(cell.x+width.x*.5,opening.x).x-archPaneAxis(cell.x-width.x*.5,opening.x).x,
          archPaneAxis(cell.y+width.y*.5,opening.y).x-archPaneAxis(cell.y-width.y*.5,opening.y).x)/width;
        return gradient*vec2(archCoverage(cell.y,opening.y,width.y),archCoverage(cell.x,opening.x,width.x))/pitch;
      }
      // Dielectric GGX plus diffuse under one broad environment and a sun.
      // Keep roughness/albedo identical in all arms: only relief is on trial.
      float lighting(vec3 n){
        vec3 v=normalize(vec3(sin(viewAngle),.12,cos(viewAngle)));
        vec3 l=normalize(vec3(-.36,.50,.78)),h=normalize(v+l);
        float nv=max(.001,dot(n,v)),nl=max(0.,dot(n,l)),nh=max(0.,dot(n,h)),vh=max(0.,dot(v,h));
        float a=.24*.24,a2=a*a,d=nh*nh*(a2-1.)+1.;
        float D=a2/(3.14159265*d*d),k=(.24+1.)*(.24+1.)/8.;
        float G=nv/(nv*(1.-k)+k)*nl/max(.001,nl*(1.-k)+k);
        float F=.055+.945*pow(1.-vh,5.);
        float energy=.15+.36*nl+4.*D*G*F/max(.004,4.*nv);
        // Smooth sky highlights exercise glancing normals without a texture.
        vec3 r=reflect(-v,n);
        energy+=.11*pow(max(0.,r.y*.4+r.z*.9165),5.);
        return energy/(1.+energy);
      }
      void main(){
        vec2 screen=gl_FragCoord.xy/referenceScale;
        mat2 rotation=mat2(cos(roll),sin(roll),-sin(roll),cos(roll));
        vec2 cell=(rotation*screen)*vec2(footprint,footprint*.73)/max(1.,abs(cos(roll))+abs(sin(roll)))+vec2(phase*.037,phase*.071)+vec2(.137,.293);
        vec2 pitch=vec2(3.1,3.8),opening=vec2(.47,.58);
        // Freeze the filter footprint across the low/high-resolution pair.
        // High-resolution shading integrates the same pixel-scale policy.
        vec2 width=max(fwidth(cell)*referenceScale,vec2(.00001));
        float pixel=max(width.x,width.y);
        vec3 eye=vec3(cell*pitch,0.),normal=vec3(0.,0.,1.);
        vec3 dx=dFdx(eye),dy=dFdy(eye),rx=cross(dy,normal),ry=cross(normal,dx);
        float det=dot(dx,rx);
        vec2 slope;
        if(policy==0){
          vec2 pane=1.-smoothstep(opening*.5-width,opening*.5+width,abs(fract(cell)-.5));
          float minify=smoothstep(.3,1.4,pixel);
          float paneMask=mix(pane.x*pane.y,opening.x*opening.y,minify);
          float relief=-.19*paneMask*(1.-minify);
          normal=normalize(abs(det)*normal-sign(det)*(dFdx(relief)*rx+dFdy(relief)*ry));
        }else{
          float retirement=archReliefResolved(pixel);
          if(policy==2||policy==3)retirement=1.-smoothstep(.12,.30,pixel);
          slope=(policy==3?filteredSlope(cell,opening,pitch,width):archPaneSlope(cell,opening,pitch))*(-.19)*retirement;
          normal=normalize(vec3(-slope,1.));
        }
        result=vec4(vec3(lighting(normal)),1.);
      }`;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const uniforms = Object.fromEntries(['footprint', 'referenceScale', 'phase', 'viewAngle', 'roll', 'policy'].map((name) => [name, gl.getUniformLocation(program, name)]));
    const target = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size * scale, size * scale, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete float framebuffer');
    const low = new Float32Array(size * size * 4), high = new Float32Array(size * size * scale * scale * 4);
    const render = (resolution, pixels) => {
      gl.viewport(0, 0, size * resolution, size * resolution);
      gl.uniform1f(uniforms.referenceScale, resolution);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, size * resolution, size * resolution, gl.RGBA, gl.FLOAT, pixels);
      const error = gl.getError(); if (error) throw new Error(`GL error ${error}`);
    };
    const rows = [];
    for (const footprint of [.01, .0125, .02, .025, .05, .075, .10, .12, .18, .25, .30, .40]) {
      for (const yaw of [0, 65, 80]) for (const roll of [0, .43]) for (const policy of [0, 1, 2, 3]) {
        gl.uniform1f(uniforms.footprint, footprint); gl.uniform1f(uniforms.viewAngle, yaw * Math.PI / 180);
        gl.uniform1f(uniforms.roll, roll); gl.uniform1i(uniforms.policy, policy);
        let squaredError = 0, squaredDelta = 0, maxError = 0;
        const previous = new Float64Array(size * size);
        for (let frame = 0; frame < frames; frame++) {
          gl.uniform1f(uniforms.phase, frame);
          render(1, low); render(scale, high);
          for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            let reference = 0;
            for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) reference += high[((y * scale + sy) * size * scale + x * scale + sx) * 4];
            const index = y * size + x, error = low[index * 4] - reference / (scale * scale);
            if (!Number.isFinite(error)) throw new Error('Non-finite facade pixel');
            squaredError += error * error; maxError = Math.max(maxError, Math.abs(error));
            if (frame) squaredDelta += (error - previous[index]) ** 2;
            previous[index] = error;
          }
        }
        rows.push({ footprint, yaw, roll, policy, rms: Math.sqrt(squaredError / (frames * size * size)), temporalRms: Math.sqrt(squaredDelta / ((frames - 1) * size * size)), maxError });
      }
    }
    return { hardware, size, scale, frames, rows };
  }, { helpers: FACADE_FILTER_GLSL });
  assert.match(report.hardware, /D3D11/);
  assert.doesNotMatch(report.hardware, /SwiftShader|llvmpipe|WARP/i);
  const names = ['legacy-derivative', 'analytic-fixed', 'analytic-wide', 'box-filtered-wide'];
  console.log(`Facade motion GPU: ${report.hardware}; ${report.scale}x${report.scale} lighting reference, ${report.frames} motion frames/case.`);
  for (const footprint of [...new Set(report.rows.map((row) => row.footprint))]) {
    const maxima = names.map((_, policy) => Math.max(...report.rows.filter((row) => row.footprint === footprint && row.policy === policy).map((row) => row.temporalRms)));
    console.log(`  ${footprint.toFixed(3)} cells/px | temporal alias RMS ${names.map((name, i) => `${name}=${maxima[i].toFixed(6)}`).join(' | ')}`);
  }
  if (process.env.FACADE_GPU_REPORT) fs.writeFileSync(process.env.FACADE_GPU_REPORT, JSON.stringify(report, null, 2) + '\n');
  // This experiment is also a calibrated RED control: an accidentally flat
  // normal, empty target or disabled light must not masquerade as stability.
  const red = Math.max(...report.rows.filter((row) => row.policy === 0 && row.footprint >= .05 && row.footprint <= .12).map((row) => row.temporalRms));
  assert.ok(red > .001, 'Legacy derivative chain must visibly fail the lighting integration control');
  for (const row of report.rows.filter((row) => row.policy === 1 && row.footprint >= .025)) assert.ok(row.temporalRms < .0001, 'Retired unresolved bevel must not sparkle');
} finally {
  await browser.close();
}

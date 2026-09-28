import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { COASTAL_WATER_GLSL } from '../lib/fly/coastal-water.js';

// Execute the real surface GLSL, not a JS imitation of its arithmetic. The
// capture deliberately excludes scene lighting so it can test normals at the
// material-frame wrap and at footprints smaller/larger than a wave.
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
try{
 const page=await browser.newPage();
 const result=await page.evaluate(glsl=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const gl=canvas.getContext('webgl2',{antialias:false});if(!gl)throw Error('WebGL2 unavailable');
  const shader=(type,text)=>{const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const program=gl.createProgram();
  gl.attachShader(program,shader(gl.VERTEX_SHADER,'#version 300 es\nin vec2 position;void main(){gl_Position=vec4(position,0.,1.);}'));
  gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;\n#define texture2D texture\nout vec4 pixel;uniform vec2 offset;uniform float time,footprint;\n'+glsl+'\nvoid main(){vec3 field=seaSurface(offset+gl_FragCoord.xy*.5,time,footprint);pixel=vec4(field.yz*2.+.5,field.x,1.);}'));
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const a=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);gl.disable(gl.DITHER);
  const draw=(x,z,time,footprint)=>{gl.uniform2f(gl.getUniformLocation(program,'offset'),x,z);gl.uniform1f(gl.getUniformLocation(program,'time'),time);gl.uniform1f(gl.getUniformLocation(program,'footprint'),footprint);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);const bytes=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;};
  const diff=(a,b)=>{let max=0,sum=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);sum+=d;}return{max,mean:sum/a.length};};
  const spread=a=>{let sum=0,min=255,max=0;for(let i=0;i<a.length;i+=4)for(let j=0;j<2;j++){sum+=(a[i+j]-127.5)**2;min=Math.min(min,a[i+j]);max=Math.max(max,a[i+j]);}return{rms:Math.sqrt(sum/(a.length/2)),min,max};};
  const base=draw(4000.25,1200.25,27,.5),later=draw(4000.25,1200.25,28,.5);
  const extension=gl.getExtension('WEBGL_debug_renderer_info');
  return{renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):null,
   wrapX:diff(base,draw(8096.25,1200.25,27,.5)),wrapZ:diff(base,draw(4000.25,5296.25,27,.5)),
   motion:diff(base,later),near:spread(base),distant:spread(draw(4000.25,1200.25,27,256)),
   seam:diff(draw(4095.749,1200.25,27,.5),draw(4095.751,1200.25,27,.5)),error:gl.getError()};
 },COASTAL_WATER_GLSL);
 assert.equal(result.error,0);assert.ok(result.wrapX.max<=1&&result.wrapZ.max<=1,'4096 m wrap must not jump');
 assert.ok(result.seam.max<=2,'Normals must remain continuous at the wrap');
 assert.ok(result.motion.mean>.1,'Moving water must actually evolve');
 assert.ok(result.near.rms>2&&result.near.min>0&&result.near.max<255,'Resolved normals have finite unsaturated relief');
 assert.ok(result.distant.rms<=.51,'Unresolved ripples retire instead of aliasing');
 fs.mkdirSync('.graphics-review/surface-correction',{recursive:true});fs.writeFileSync('.graphics-review/surface-correction/water-field.json',JSON.stringify(result,null,2));
 console.log('PASS real GLSL: rebase wrap, continuity, motion, resolved normals, distant filtering');console.log(JSON.stringify(result));
}finally{await browser.close();}

import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {CINEMA_CLOUD_GLSL,cinemaCloudDensity,cinemaBankData} from '../lib/fly/cinema-cloud.js';
import {loadCinemaCloudVolume,sampleCinemaCloudVolume} from '../lib/fly/cinema-cloud-volume.js';
const volume=fs.readFileSync(new URL('../public/materials/cinema-v1/cloud-density.rg',import.meta.url));
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>volume.buffer.slice(volume.byteOffset,volume.byteOffset+volume.byteLength)});
await loadCinemaCloudVolume();globalThis.fetch=originalFetch;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
try{
 const page=await browser.newPage();
 const variants=[];
 for(const optimized of [false,true]){
 const result=await page.evaluate(({glsl,data,banks,optimized})=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const gl=canvas.getContext('webgl2');
  if(!gl.getExtension('EXT_color_buffer_float'))throw Error('Float readback unavailable');
  const compile=(type,s)=>{const shader=gl.createShader(type);gl.shaderSource(shader,s);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
  const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}'));
  gl.attachShader(program,compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;uniform float coverage,offset;out vec4 pixel;'+glsl+'\nvoid main(){vec3 p=vec3((gl_FragCoord.x-.5)*1701.+offset,2400.,(gl_FragCoord.y-.5)*1901.);pixel=vec4(cinemaDensity(p/1024.,0.,(2400.-1500.)/2300.),0,0,1);}'));
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  if(optimized){
   gl.activeTexture(gl.TEXTURE1);const lookup=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,lookup);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,16,16,0,gl.RGBA,gl.FLOAT,new Float32Array(banks));
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   gl.uniform1i(gl.getUniformLocation(program,'cinemaBanks'),1);gl.activeTexture(gl.TEXTURE0);
  }
  const noise=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,noise);gl.texImage3D(gl.TEXTURE_3D,0,gl.RG8,64,64,64,0,gl.RG,gl.UNSIGNED_BYTE,new Uint8Array(data));
  for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,p,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  const target=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,target);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,64,64,0,gl.RGBA,gl.FLOAT,null);
  const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);
  assertFramebuffer();function assertFramebuffer(){if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete density target');}
  gl.uniform1f(gl.getUniformLocation(program,'coverage'),.5);gl.uniform1f(gl.getUniformLocation(program,'cinemaNoiseReady'),1);
  const draw=offset=>{gl.uniform1f(gl.getUniformLocation(program,'offset'),offset);gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Float32Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.FLOAT,pixels);return Array.from(pixels.filter((_,i)=>i%4===0));};
  const pixels=draw(0),wrapped=draw(131072),error=gl.getError();return {pixels,wrapped,error};
 },{glsl:(optimized?'\n#define CINEMA_BANK_LUT\n':'')+CINEMA_CLOUD_GLSL,data:Array.from(volume),banks:Array.from(cinemaBankData()),optimized});
 assert.equal(result.error,0);let maxError=0,wrapError=0,nonempty=0;
 for(let z=0;z<64;z++)for(let x=0;x<64;x++){const i=x+z*64,cpu=cinemaCloudDensity(x*1701,2400,z*1901,{},sampleCinemaCloudVolume);maxError=Math.max(maxError,Math.abs(cpu-result.pixels[i]));wrapError=Math.max(wrapError,Math.abs(result.pixels[i]-result.wrapped[i]));if(result.pixels[i]>.1)nonempty++;}
 assert.ok(maxError<.02,`GPU/CPU mismatch ${maxError}`);assert.ok(wrapError<.001,`Rebase wrap ${wrapError}`);assert.ok(nonempty>100,'Cloud volume must actually render');
 variants.push({optimized,pixels:result.pixels,status:'PASS',samples:4096,maxError,wrapError,nonempty});
 }
 const maxDelta=Math.max(...variants[0].pixels.map((v,i)=>Math.abs(v-variants[1].pixels[i])));
 // Texture-loaded constants and shader division can round a few float32 ULPs
 // differently. Bound below one 16-bit normalized quantum AND require exact
 // equality after 8-bit quantization, rather than claiming bitwise float identity.
 assert.ok(maxDelta<1/65535,`Cloud lookup must preserve the original GPU density: ${maxDelta}`);
 assert.ok(variants[0].pixels.every((v,i)=>Math.round(v*255)===Math.round(variants[1].pixels[i]*255)),'Lookup changes quantized cloud density');
 const report={status:'PASS',maxDelta,variants:variants.map(({pixels,...row})=>row)};
 fs.mkdirSync('.graphics-review/render-flight',{recursive:true});fs.writeFileSync('.graphics-review/render-flight/cloud-gpu.json',JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();}

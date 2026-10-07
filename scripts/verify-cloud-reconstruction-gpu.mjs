import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {CLOUD_FILTER_GLSL,CLOUD_RECONSTRUCTION_GLSL} from '../lib/fly/cloud-reconstruction.js';

// An opaque foreground edge beside a cloud: filtering must preserve constant
// premultiplied radiance/transmission and must never leak cloud across the edge.
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
try{
 const page=await browser.newPage();
 const result=await page.evaluate(({filter,reconstruct})=>{
  const gl=document.createElement('canvas').getContext('webgl2');
  if(!gl.getExtension('EXT_color_buffer_float'))throw Error('Float render targets unavailable');
  const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const vertex='#version 300 es\nout vec2 vUv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.-1.,0,1);}';
  const header='#version 300 es\nprecision highp float;in vec2 vUv;out vec4 color;\n#define gl_FragColor color\n#define texture2D texture\nuniform sampler2D guide;float distanceAt(vec2 uv){return texture(guide,uv).r;}\n';
  const program=fragment=>{const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,header+fragment));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;};
  const blur=program(filter),up=program('uniform sampler2D clouds;uniform vec2 texel;void main(){float dist=distanceAt(vUv);'+reconstruct+'gl_FragColor=total>.001?sum/total:vec4(0,0,0,1);}');
  const texture=(size,data)=>{
   const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,size,size,0,gl.RGBA,gl.FLOAT,data);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   for(const a of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,a,gl.CLAMP_TO_EDGE);
   return t;
  };
  const pixels=new Float32Array(8*8*4),depth=new Float32Array(32*32*4);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)pixels.set(x<4?[.6,.3,.15,.25]:[0,0,0,1],(x+y*8)*4);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)depth[(x+y*32)*4]=x<16?1000000:10;
  const source=texture(8,pixels),horizontal=texture(8,null),vertical=texture(8,null),target=texture(32,null),guide=texture(32,depth),fb=gl.createFramebuffer();
  const draw=(p,input,output,size,axis)=>{
   gl.useProgram(p);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.uniform1i(gl.getUniformLocation(p,'clouds'),0);
   gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,guide);gl.uniform1i(gl.getUniformLocation(p,'guide'),1);
   gl.uniform2f(gl.getUniformLocation(p,'texel'),1/8,1/8);if(axis)gl.uniform2f(gl.getUniformLocation(p,'filterAxis'),...axis);
   gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete filter target');
   gl.viewport(0,0,size,size);gl.drawArrays(gl.TRIANGLES,0,3);
  };
  draw(blur,source,horizontal,8,[1,0]);draw(blur,horizontal,vertical,8,[0,1]);draw(up,vertical,target,32);
  const data=new Float32Array(32*32*4);gl.readPixels(0,0,32,32,gl.RGBA,gl.FLOAT,data);
  let cloudError=0,foregroundError=0;
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){
   const expected=x<16?[.6,.3,.15,.25]:[0,0,0,1];
   const error=Math.max(...expected.map((v,i)=>Math.abs(data[(x+y*32)*4+i]-v)));
   if(x<16)cloudError=Math.max(cloudError,error);else foregroundError=Math.max(foregroundError,error);
  }
  return {cloudError,foregroundError,glError:gl.getError()};
 },{filter:CLOUD_FILTER_GLSL,reconstruct:CLOUD_RECONSTRUCTION_GLSL});
 assert.equal(result.glError,0);assert.ok(result.cloudError<1e-6,'cloud radiance/transmission changed');
 assert.ok(result.foregroundError<1e-6,'cloud leaked across opaque foreground edge');
 console.log('PASS real GPU cloud reconstruction:',result);
}finally{await browser.close();}

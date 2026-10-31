import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const hooks=registerHooks({resolve(s,c,next){
  if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}
  return next(s,c);
}});
const { uniqueArchitectureSurfaces } = await import('../lib/fly/architecture-surfaces.js');
const { COASTAL_REFLECTION_FILTER_GLSL } = await import('../lib/fly/coastal-water.js');
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
check('duplicate paint and reversed winding share one face; separate heights and bends survive',()=>{
  const face=[0,0,0, 1,0,0, 0,0,1];
  const position=new Float32Array([...face,...face,...face,...face.map((v,i)=>i%3===1?v+.01:v),...face]);
  const anchors=new Float32Array(5*3*2);anchors.fill(2,4*3*2);
  const index=new Uint16Array([0,1,2, 5,4,3, 6,7,8, 9,10,11, 12,13,14]);
  const result=uniqueArchitectureSurfaces(index,position,anchors,6);
  assert.deepEqual([...result.index],[0,1,2,9,10,11,12,13,14]);
  assert.equal(result.removed,2);assert.equal(result.bodyCount,3);
  assert.equal(result.index.buffer,index.buffer,'compact in place, retaining worker transfer');
});
check('large indices and nonduplicate body/detail ownership are preserved',()=>{
  const p=new Float32Array(65539*3),a=new Float32Array(65539*2);
  p.set([0,0,0,1,0,0,0,0,1],65536*3);
  const result=uniqueArchitectureSurfaces(new Uint32Array([65536,65537,65538]),p,a,0);
  assert.deepEqual([...result.index],[65536,65537,65538]);assert.equal(result.bodyCount,0);assert.equal(result.removed,0);
});

// An actual fragment-shader regression: sweep a one-texel building highlight
// through the stretched kernel. The former five point samples MUST reproduce
// gaps and flashes; the production filter must conserve the highlight without
// those gaps and with bounded changes under subtexel motion.
hooks.deregister();
const { chromium }=await import('playwright');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined,args:process.platform==='win32'?['--use-angle=d3d11']:[]});
try{
  const page=await browser.newPage();
  const result=await page.evaluate(filter=>{
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=1;
    const gl=canvas.getContext('webgl2');if(!gl)throw Error('WebGL2 required');
    const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const vertex=shader(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}');
    const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
    const pixels=new Uint8Array(256*256*4);pixels.fill(255,128*256*4,129*256*4);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,256,256,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    const old=`vec4 coastalCitySample(vec2 uv,float s){return textureLod(uCoastReflection,uv,0.)*.36+(textureLod(uCoastReflection,uv+vec2(uCoastTexel.x,s*.45),0.)+textureLod(uCoastReflection,uv-vec2(uCoastTexel.x,s*.45),0.))*.22+(textureLod(uCoastReflection,uv+vec2(0.,s),0.)+textureLod(uCoastReflection,uv-vec2(0.,s),0.))*.10;}`;
    const measure=code=>{
      const frag=shader(gl.FRAGMENT_SHADER,`#version 300 es\nprecision highp float;uniform sampler2D uCoastReflection;const vec2 uCoastTexel=vec2(1./256.);uniform float shift;out vec4 color;${code}\nvoid main(){vec2 uv=vec2(.5,.502+(gl_FragCoord.x/512.-.5)*.08+shift);float a=coastalCitySample(uv,.08).a;color=vec4(a*8.,0.,0.,1.);}`);
      const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,frag);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
      const rows=[];for(const shift of [0,.25/256]){gl.uniform1f(gl.getUniformLocation(program,'shift'),shift);gl.drawArrays(gl.TRIANGLES,0,3);const row=new Uint8Array(512*4);gl.readPixels(0,0,512,1,gl.RGBA,gl.UNSIGNED_BYTE,row);rows.push(Array.from({length:512},(_,i)=>row[i*4]));}
      return {zeros:rows[0].filter(x=>x===0).length,min:Math.min(...rows[0]),maxStep:Math.max(...rows[0].map((x,i)=>Math.abs(x-rows[1][i]))),sum:rows[0].reduce((s,x)=>s+x,0)};
    };
    return {before:measure(old),after:measure(filter),error:gl.getError()};
  },COASTAL_REFLECTION_FILTER_GLSL);
  check('GPU reproduces old reflection gaps and removes them with overlapping area samples',()=>{
    assert.ok(result.before.zeros>200,JSON.stringify(result));assert.equal(result.after.zeros,0,JSON.stringify(result));
    assert.ok(result.after.maxStep<result.before.maxStep*.2,JSON.stringify(result));assert.ok(result.after.sum>1000);assert.equal(result.error,0);
  });
  console.log(JSON.stringify(result));
}finally{await browser.close();}
console.log(`REFLECTION STABILITY: ${checks}/${checks}`);

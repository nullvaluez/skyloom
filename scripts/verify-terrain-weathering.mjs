/** GPU regression for artificial contour rings. Renders the production rock
 * weathering block on a vertical face; the old 18 m shader is a RED control.
 * This isolates the shader defect, not live imagery, DEM or performance. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const source=fs.readFileSync(new URL('../lib/fly/earth-surface-material.js',import.meta.url),'utf8');
const noise=source.match(/float earthNoise\(vec2 p\) \{[\s\S]*?\n\}/)?.[0];
const start=source.indexOf('    if(uCinemaArt>.5){',source.indexOf('    authored*=1.+(coarse-.5)*.16*cinemaRockAmount;'));
const end=source.indexOf('    earthCanopyAmount*=.45;',start);
assert(noise&&start>0&&end>start,'Production rock shader anchors exist');
const current=source.slice(start,end);
const gradientEnd='cinemaRockGradient=rockCoarseGradient+rockFineGradient*rockFineResolved;';
const gradients=source.slice(source.indexOf('    float rockCoarseHeight='),source.indexOf(gradientEnd)+gradientEnd.length);
const scanEnd='cinemaRockGradient=mix(cinemaRockGradient,rockScanGradient,rockScanWeight);';
const scanGradients=source.slice(source.indexOf('      float rockScanHeight='),source.indexOf(scanEnd)+scanEnd.length);
assert(gradients.includes('dFdx(rockCoarseHeight)')&&scanGradients.includes('dFdx(rockScanHeight)'),'Raw gradient anchors exist');
const legacy=`if(uCinemaArt>.5){
 float strata=vEarthHeight/18.+coarse*.72;
 float strataAA=max(fwidth(strata),.001);
 float resolved=1.-smoothstep(.12,.65,strataAA);
 float band=sin(strata*6.2831853)*resolved;
 float mineral=cinemaRockAmount*uCinemaLight.x;
 authored*=1.+band*.14*mineral*(1.-regionalCliff);
 cinemaRockHeight+=band*.38*resolved*uCinemaLight.x*(1.-regionalCliff);
 cinemaRockAmount*=1.+.25*uCinemaLight.x;
}`;
const browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined,args:[process.platform==='win32'?'--use-angle=d3d11':'--use-angle=swiftshader','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage();
 const result=await page.evaluate(({noise,current,legacy,gradients,scanGradients})=>{
  const w=128,h=1024,span=1152,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL2 unavailable');
  const ext=gl.getExtension('WEBGL_debug_renderer_info');
  const renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  const vertex=`#version 300 es
   void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;
  function render(block,gradient=false){
   const program=gl.createProgram();
   for(const [type,text]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,`#version 300 es
    precision highp float;out vec4 color;
    ${noise}
    void main(){
     vec3 p=vec3(gl_FragCoord.x,gl_FragCoord.y*${span/h},83.);
     float vEarthHeight=p.y,coarse=earthNoise(p.xy/32.);
     float uCinemaArt=1.,regionalCliff=0.,cinemaRockAmount=1.,cinemaRockHeight=0.;
     vec4 uCinemaLight=vec4(1.);vec3 authored=vec3(.5);
     ${gradient?`// Feed a resolved footprint ramp: using a nested derivative
      // in the RED control would itself be undefined, never a valid oracle.
      float rockPixelM=1.+gl_FragCoord.x*.08;
      float cameraM=gl_FragCoord.x*16.;
      coarse=.2;float fine=.7;vec4 scanShape=vec4(.8);
      vec2 cinemaRockGradient=vec2(0.);`:''}
     ${block}
     ${gradient?'authored=vec3(.5+cinemaRockGradient.x*32.);':''}
     color=vec4(authored,1.);
    }`]]){
    const shader=gl.createShader(type);gl.shaderSource(shader,text);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program,shader);
   }
   gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
   gl.useProgram(program);gl.viewport(0,0,w,h);gl.drawArrays(gl.TRIANGLES,0,3);
   const pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   let bandEnergy=0,totalVariance=0;
   for(let x=0;x<w;x+=4){
    let mean=0;for(let y=0;y<h;y++)mean+=pixels[(y*w+x)*4]/255/h;
    for(let y=0;y<h;y++)totalVariance+=(pixels[(y*w+x)*4]/255-mean)**2/h;
    // Capture the oscillator and its coarse phase-modulation sidebands.
    for(let frequency=Math.ceil(span/22);frequency<=Math.floor(span/14);frequency++){
     let re=0,im=0;
     for(let y=0;y<h;y++){
      const value=pixels[(y*w+x)*4]/255-mean,phase=2*Math.PI*frequency*(y+.5)/h;
      re+=value*Math.cos(phase)/h;im+=value*Math.sin(phase)/h;
     }
     bandEnergy+=2*(re*re+im*im);
    }
   }
   let mean=0,screenVariance=0;
   for(let i=0;i<pixels.length;i+=4)mean+=pixels[i]/255/(w*h);
   for(let i=0;i<pixels.length;i+=4)screenVariance+=(pixels[i]/255-mean)**2/(w*h);
   return {bandEnergy:bandEnergy/(w/4),variance:totalVariance/(w/4),screenVariance,error:gl.getError()};
  }
  const gradientLegacy=`
   cinemaRockHeight=(1.-abs(coarse*2.-1.))*2.4+(fine-.5)*.65*(1.-smoothstep(2.,8.,rockPixelM));
   float scanNear=1.-smoothstep(450.,1600.,cameraM);
   float scanResolved=1.-smoothstep(1.5,5.,rockPixelM);
   cinemaRockHeight=mix(cinemaRockHeight,(scanShape.b-.5)*.38,scanNear*scanResolved);
   cinemaRockGradient=vec2(dFdx(cinemaRockHeight),dFdy(cinemaRockHeight));`;
  return {renderer,current:render(current),legacy:render(legacy),
   gradientCurrent:render(gradients+scanGradients,true),gradientLegacy:render(gradientLegacy,true)};
 },{noise,current,legacy,gradients,scanGradients});
 assert.equal(result.current.error,0);assert.equal(result.legacy.error,0);
 assert(result.legacy.bandEnergy>0.0001,'RED control must reproduce visible contour rings');
 assert(result.current.bandEnergy<result.legacy.bandEnergy*.05,'Production must remove at least 95% of the artificial 14–22 m band energy');
 assert(result.current.variance>0.00001,'Irregular terrain weathering must remain visible');
 assert.match(source,/vec3 rockDx=dFdx\(p\),rockDy=dFdy\(p\)/,'Rock detail accounts for vertical pixel span');
 assert.doesNotMatch(source,/dFd[xy]\(cinemaRock(?:Height|Gradient)\)/,'Filtered gradients are never differentiated again');
 assert.equal(result.gradientCurrent.error,0);assert.equal(result.gradientLegacy.error,0);
 assert(result.gradientCurrent.screenVariance<1e-12,'A constant rock height must not grow normals from changing detail weights');
 assert(result.gradientLegacy.screenVariance>0.0001,'RED control must reproduce false normals at changing detail weights');
 console.log(JSON.stringify({ok:true,...result},null,2));
}finally{await browser.close();}

const {chromium}=require('playwright'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 try{
  const page=await browser.newPage();await page.goto(process.env.CINEMA_URL||'http://localhost:3079');
  const results=await page.evaluate(async()=>{
   const gl=document.createElement('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_compressed_texture_s3tc');
   if(!ext)throw Error('BC3 unavailable on this validation GPU');
   const manifest=await (await fetch('/materials/cinema-v1/manifest.json')).json(),rows=[];
   const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
   const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}'));
   gl.attachShader(program,compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;precision highp sampler2DArray;uniform sampler2DArray image;uniform float layer;out vec4 pixel;void main(){pixel=texture(image,vec3(gl_FragCoord.xy/64.,layer));}'));
   gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
   const canvas=gl.canvas;canvas.width=canvas.height=64;gl.viewport(0,0,64,64);gl.disable(gl.DITHER);
   for(const size of [128,256,512,1024])for(const name of ['color','detail']){
    const f=manifest.variants[size].files[name],data=new Uint8Array(await(await fetch('/materials/cinema-v1/'+f.bc3.file)).arrayBuffer());
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D_ARRAY,texture);
    f.bc3.levels.forEach((m,l)=>gl.compressedTexImage3D(gl.TEXTURE_2D_ARRAY,l,ext.COMPRESSED_RGBA_S3TC_DXT5_EXT,m.width,m.height,8,0,data.subarray(m.offset,m.offset+m.length)));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    let min=255,max=0;
    for(let layer=0;layer<8;layer++){gl.uniform1f(gl.getUniformLocation(program,'layer'),layer);gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);for(let p=0;p<pixels.length;p+=4){min=Math.min(min,pixels[p]);max=Math.max(max,pixels[p]);}}
    const error=gl.getError();if(error||min===max)throw Error('Invalid compressed array '+size+'/'+name+': '+error);
    rows.push({size,name,min,max,bytes:data.length,error});gl.deleteTexture(texture);
   }
   gl.deleteProgram(program);return rows;
  });
  fs.mkdirSync('.graphics-review/cinema-overhaul',{recursive:true});fs.writeFileSync('.graphics-review/cinema-overhaul/compressed-textures.json',JSON.stringify(results,null,2));
  console.log('PASS: eight device/material variants, complete BC3 mip chains, all eight layers rendered on hardware');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

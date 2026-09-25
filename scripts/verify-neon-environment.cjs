// GPU parity proof for replacing implicit PMREM with an explicitly owned bake.
// A synthetic HDR panorama exercises coloured highlights across roughnesses.
// No application route or permanent test server is added.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
(async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<canvas></canvas>');return;}
    const name=req.url.slice(1);
    if(name==='compact-shadow-target.js'){
      res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync('lib/fly/compact-shadow-target.js','utf8').replace("from 'three'","from '/three.module.js'"));return;
    }
    if(!['three.module.js','three.core.js'].includes(name)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join('node_modules/three/build',name)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
    const page=await browser.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result=await page.evaluate(async()=>{
      const T=await import('/three.module.js');
      const gl=new T.WebGLRenderer({canvas:document.querySelector('canvas'),reversedDepthBuffer:true});gl.setSize(256,128);
      const scene=new T.Scene(),camera=new T.PerspectiveCamera(40,2,.1,100);camera.position.z=8;
      const data=new Float32Array(128*64*4);
      for(let y=0;y<64;y++)for(let x=0;x<128;x++){
        const i=(y*128+x)*4;data[i]=.1+5*(x/127)**6;data[i+1]=.1+1.2*y/63;data[i+2]=.25+2*(1-x/127);data[i+3]=1;
      }
      const source=new T.DataTexture(data,128,64,T.RGBAFormat,T.FloatType);
      source.mapping=T.EquirectangularReflectionMapping;source.needsUpdate=true;
      const geometry=new T.SphereGeometry(.8,32,24),materials=[];
      for(let i=0;i<3;i++){
        const material=new T.MeshStandardMaterial({color:0xb18f60,roughness:[.15,.5,.9][i],metalness:.65});
        materials.push(material);const mesh=new T.Mesh(geometry,material);mesh.position.x=(i-1)*2;scene.add(mesh);
      }
      const target=new T.WebGLRenderTarget(256,128),a=new Uint8Array(256*128*4),b=new Uint8Array(a.length);
      gl.setRenderTarget(target);scene.environment=source;gl.render(scene,camera);gl.readRenderTargetPixels(target,0,0,256,128,a);
      const generator=new T.PMREMGenerator(gl),owned=generator.fromEquirectangular(source);generator.dispose();
      scene.environment=owned.texture;gl.render(scene,camera);gl.readRenderTargetPixels(target,0,0,256,128,b);
      let maxDelta=0,changed=0,sum=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);maxDelta=Math.max(maxDelta,d);changed+=d>0;sum+=d;}
      const {compactDepthShadowTarget}=await import('/compact-shadow-target.js');
      gl.shadowMap.enabled=true;gl.shadowMap.type=T.PCFShadowMap;
      const light=new T.DirectionalLight(0xffffff,3);light.position.set(2,4,3);light.castShadow=true;light.shadow.mapSize.set(512,512);scene.add(light);
      scene.children.filter(o=>o.isMesh).forEach(o=>o.castShadow=true);
      const floor=new T.Mesh(new T.PlaneGeometry(15,15),new T.MeshStandardMaterial({color:0x8d9fa0}));floor.rotation.x=-Math.PI/2;floor.position.y=-1;floor.receiveShadow=true;scene.add(floor);
      gl.render(scene,camera);gl.readRenderTargetPixels(target,0,0,256,128,a);
      const compacted=compactDepthShadowTarget(light.shadow,gl.shadowMap.type);
      gl.render(scene,camera);gl.readRenderTargetPixels(target,0,0,256,128,b);
      let shadowMaxDelta=0;for(let i=0;i<a.length;i++)shadowMaxDelta=Math.max(shadowMaxDelta,Math.abs(a[i]-b[i]));
      gl.shadowMap.enabled=false;materials.forEach(m=>m.needsUpdate=true);floor.material.needsUpdate=true;
      gl.render(scene,camera);gl.readRenderTargetPixels(target,0,0,256,128,a);
      let shadowControlPixels=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>3)shadowControlPixels++;
      const ext=gl.getContext().getExtension('WEBGL_debug_renderer_info');
      const renderer=ext?gl.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown';
      owned.dispose();source.dispose();target.dispose();geometry.dispose();materials.forEach(m=>m.dispose());gl.dispose();
      return {renderer,maxDelta,changed,mean:sum/a.length,compacted,shadowMaxDelta,shadowControlPixels};
    });
    const pass=result.maxDelta===0&&result.compacted&&result.shadowMaxDelta===0&&result.shadowControlPixels>20&&errors.length===0;
    const out='.graphics-review/painterly/neon-environment';fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(`${out}/report.json`,JSON.stringify({status:pass?'PASS':'FAIL',...result,errors},null,2));
    console.log(JSON.stringify({status:pass?'PASS':'FAIL',...result,errors}));process.exitCode=pass?0:1;
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});

/* Read the presented framebuffer synchronously after EVERY composer render.
 * No terrain/governor pins. Readbacks affect timing: this is not an FPS test.
 * --diagnose also scans half-float pass targets for NaN/Infinity.
 * Example: node scripts/verify-black-frames.cjs --url=http://localhost:3044 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const args = Object.fromEntries(process.argv.slice(2).map(s => { const [k,...v]=s.replace(/^--/,'').split('='); return [k,v.join('=')]; }));
async function main() {
  const report={status:'BLOCKED',halfFloatScan:!!args.diagnose,errors:[],legs:[]};let browser;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
    const page=await browser.newPage({viewport:{width:1280,height:720}});
    page.on('pageerror',e=>report.errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader/i.test(m.text()))report.errors.push(m.text().slice(0,2000));});
    await page.addInitScript(()=>{
      localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-controls-seen','1');
      localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-crash-mode','forgiving');
      window.__flySunOverride=Date.UTC(2026,6,18,17);window.__flyWeatherOverride='baseline';
    });
    await page.goto((args.url||'http://localhost:3000')+'/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>window.__flyComposer,null,{timeout:120000});

    report.hardware=await page.evaluate(()=>{const gl=window.__flyComposer.getRenderer().getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return e&&gl.getParameter(e.UNMASKED_RENDERER_WEBGL);});
    await page.evaluate(diagnose=>{
      const c=window.__flyComposer,gl=window.__flyComposer.getRenderer().getContext(),render=c.render.bind(c);
      const pixels=new Uint8Array(64*4);
      if(diagnose)for(const pass of c.passes){
        const original=pass.render.bind(pass);let data;
        pass.render=function(renderer,input,output,...rest){
          original(renderer,input,output,...rest);
          if(this.renderToScreen)return;
          const target=this.needsSwap?output:input;
          data??=new Uint16Array(target.width*target.height*4);
          if(data.length!==target.width*target.height*4)data=new Uint16Array(target.width*target.height*4);
          renderer.readRenderTargetPixels(target,0,0,target.width,target.height,data);
          let invalid=0,first=-1;
          for(let i=0;i<data.length;i++){if((data[i]&0x7c00)===0x7c00){invalid++;if(first===-1)first=i;}}
          this.__probe={name:this.name,effects:this.effects?.map(e=>e.name),invalid,first};
          if(invalid&&this.name==='RenderPass'&&window.__blackFrames)window.__blackFrames.invalidSceneFrames++;

        };
      }
      window.__blackFrames={frames:0,black:0,invalidSceneFrames:0,min:255,max:0,hits:[],selfHits:0,inject:false};
      c.render=function(dt){
        render(dt);
        const s=window.__blackFrames;
        const self=s.inject;s.inject=false;
        if(self){const color=gl.getParameter(gl.COLOR_CLEAR_VALUE);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.clearColor(...color);}
        let sum=0,dark=0;
        for(const fy of [.2,.5,.8]){
          gl.readPixels(Math.floor((gl.drawingBufferWidth-64)/2),Math.floor(gl.drawingBufferHeight*fy),64,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          for(let i=0;i<pixels.length;i+=4){const v=Math.max(pixels[i],pixels[i+1],pixels[i+2]);sum+=v;if(v<3)dark++;}
        }
        const mean=sum/192,black=dark/192>.98;
        if(self){if(black)s.selfHits++;return;}
        if(window.__flyBoot?.pct!==100)return;
        s.frames++;s.min=Math.min(s.min,mean);s.max=Math.max(s.max,mean);
        if(black){s.black++;if(s.hits.length<12)s.hits.push({frame:s.frames,mean,warp:window.__flyStore.getState().warpEpoch,loading:window.__fly.worldLoading,passes:c.passes.map(p=>p.__probe)});}
      };
    },!!args.diagnose);
    await page.waitForFunction(()=>window.__flyBoot?.pct===100,null,{timeout:120000});
    for(const leg of (args.legs||'arrival,stationary,coasting,cruise,boost,warp-powell,warp-newyork').split(',')){
      await page.evaluate(leg=>{
        const rt=window.__fly;
        if(leg.startsWith('warp-')){
          if(window.__blackOriginalStep)rt.flight.step=window.__blackOriginalStep;
          const p=leg==='warp-powell'?[40.2083,-83.0701,750]:[40.6892,-74.0445,800];
          rt.warpToGeo(p[0],p[1],{altM:p[2],name:leg});
        }
        if(['stationary','coasting','cruise','boost'].includes(leg)){
          const f=rt.flight;window.__blackOriginalStep??=f.step.bind(f);
          f.step=leg==='stationary'?()=>{}:(dt,cmd)=>window.__blackOriginalStep(dt,{...cmd,turn:0,pitch:0,boost:leg==='boost',speedOverride:leg==='coasting'?60:180});
        }
        if(leg!=='arrival')Object.assign(window.__blackFrames,{frames:0,black:0,invalidSceneFrames:0,min:255,max:0,hits:[]});
      },leg);
      if(leg.startsWith('warp-')){
        await page.waitForTimeout(1000);
        await page.waitForFunction(()=>window.__fly.worldLoading===false&&window.__fly.worldReadiness?.ready,null,{timeout:120000});
      }
      await page.waitForTimeout(Number(args.seconds||12)*1000);
      const result=await page.evaluate(()=>({...window.__blackFrames,forest:window.__fly.earthSurface?.forest,stats:window.__flyStats.night,ready:window.__fly.worldReadiness}));
      report.legs.push({leg,...result});console.log(leg,JSON.stringify(result));
    }
    await page.evaluate(()=>{window.__blackFrames.inject=true;});await page.waitForTimeout(1000);
    report.selfHits=await page.evaluate(()=>window.__blackFrames.selfHits);
    report.status=report.selfHits!==1?'BLOCKED':report.errors.length||report.legs.some(l=>l.black>0||l.invalidSceneFrames>0)?'FAIL':report.legs.every(l=>l.frames>=60&&l.forest?.patches>0&&l.ready?.ready)?'PASS':'BLOCKED';
  } catch(error){report.reason=error.stack;}
  finally {await browser?.close();const output=args.output||'.graphics-review/black-frames.json';fs.mkdirSync(require('node:path').dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(report.status,report.reason||'');process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?1:2;}
}
main();

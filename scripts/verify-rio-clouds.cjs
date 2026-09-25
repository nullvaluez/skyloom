const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(process.env.RIO_OUT||'.graphics-review/painterly/rio-clouds');
fs.mkdirSync(out,{recursive:true});
const report={source:require('./graphics-source.cjs')(),status:'IN_PROGRESS',errors:[],profiles:{}};
(async()=>{let browser;try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{
    localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');
    localStorage.setItem('fly-aircraft','prop');localStorage.setItem('fly-sound-on','0');
    localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-quality-tier','high');
    window.__flyGovPin='hold';window.__flyWeatherOverride='baseline';window.__flyCloudFreeze=1;
    window.__flySunOverride=Date.UTC(2026,8,24,23);
  });
  await page.goto(`${process.env.FLY_URL||'http://localhost:3039'}/?graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByTestId('title-free-flight').click({timeout:90000});
  await page.getByTestId('hangar-dest-rio').click();
  await page.getByTestId('hangar-fly').click({timeout:90000});
  await page.waitForFunction(()=>window.__flyStore.getState().screen==='flight'&&window.__flyBoot?.pct===100,null,{timeout:90000});
  await page.evaluate(()=>{const rt=window.__fly;rt.flight.step=()=>{};rt.flight.speed=0;});
  await page.waitForTimeout(18000);
  report.launch=await page.evaluate(()=>({screen:window.__flyStore.getState().screen,lat:window.__fly.flight.latDeg,lon:window.__fly.flight.lonDeg,visuals:window.__flyStore.getState().visuals,sun:window.__fly.sun}));
  for(const profile of ['enhanced','classic','enhanced']){
    await page.evaluate(p=>window.__flyStore.getState().setVisuals(p),profile);
    await page.waitForTimeout(6000);
    const tag=profile==='enhanced'&&report.profiles.enhanced?'enhanced-return':profile;
    await page.screenshot({path:path.join(out,tag+'.png')});
    report.profiles[tag]=await page.evaluate(()=>{
      const p=window.__flyComposer.passes.find(p=>p.name==='ImmersiveClouds'),gl=window.__flyGl,t=p.target;
      const data=new Uint16Array(t.width*t.height*4);gl.readRenderTargetPixels(t,0,0,t.width,t.height,data);
      const half=b=>{const s=b&32768?-1:1,e=(b>>10)&31,f=b&1023;return e===0?s*2**-14*f/1024:e===31?(f?NaN:s*Infinity):s*2**(e-15)*(1+f/1024);};
      let count=0,black=0,sum=0,invalid=0;
      for(let i=0;i<data.length;i+=4){const opacity=1-half(data[i+3]);if(opacity<.3)continue;
        const y=(.2126*half(data[i])+.7152*half(data[i+1])+.0722*half(data[i+2]))/opacity;
        if(!Number.isFinite(y)){invalid++;continue;}count++;sum+=y;if(y<.001)black++;
      }
      const q=p.r25?.uniforms;
      return{cloudPixels:count,meanRadiance:count?sum/count:null,blackFraction:count?black/count:null,invalid,day:p.uniforms.day.value,key:q?.uR25Key.value,ambient:q?.uR25AmbHi.value};
    });
    console.log(tag,JSON.stringify(report.profiles[tag]));
  }
  const arms=[report.profiles.enhanced,report.profiles['enhanced-return']];
  report.status=report.errors.length?'FAIL':arms.some(p=>p.cloudPixels<100)?'BLOCKED':arms.every(p=>p.day<.01&&p.meanRadiance>.005&&p.blackFraction<.05&&p.invalid===0)?'PASS':'FAIL';
}catch(e){report.status='BLOCKED';report.reason=e.stack;console.error(e.message);}finally{
  await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('RIO CLOUDS: '+report.status);process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?1:2;
}})();

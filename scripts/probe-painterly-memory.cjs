const {chromium}=require('playwright'),fs=require('node:fs');
const {enterFlight}=require('./_skip-menus');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  await page.addInitScript(()=>{window.__groundTextureAuditPeakDetails=true;window.__flyTitleBypass=true;window.__flyGovPin='hold';window.__flySunOverride=Date.UTC(2026,6,18,18);localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-map-style-2','satellite');});
  await page.addInitScript(require('./ground-texture-audit.cjs').installGroundTextureAudit);
  await page.goto('http://localhost:3040/?graphicsReview=1');
  await enterFlight(page,{lat:40.20403,lon:-83.0896,altM:380,heading:3.9,name:null},{timeoutMs:90000,waitReveal:true});
  await page.evaluate(()=>{window.__fly.flight.step=()=>{};});await page.waitForTimeout(20000);
  const rows=[];
  for(const style of ['satellite','toy','satellite']){
   await page.evaluate(s=>window.__flyStore.getState().setMapStyle(s),style);await page.waitForTimeout(12000);
   rows.push(await page.evaluate(()=>{
    const composer=window.__flyComposer,gl=composer.getRenderer(),seen=new Set(),owners=[];
    function walk(o,p,d=0){if(!o||typeof o!=='object'||seen.has(o)||d>5)return;seen.add(o);
     if(o.isTexture){const t=window.__groundTextureAudit.describeTexture(gl.properties.get(o).__webglTexture);if(t)owners.push({path:p,id:t.id,MiB:t.bytes/1048576});return;}
     if(ArrayBuffer.isView(o)||o.isScene||o.isCamera||o.isWebGLRenderer)return;
     for(const [k,v]of Object.entries(o))if(!['parent','children','gl','renderer','_renderer'].includes(k))walk(v,p+'.'+k,d+1);
    }walk(composer,'composer');
    return {style:window.__flyStore.getState().mapStyle,owners,audit:window.__groundTextureAudit.snapshot({topLimit:20})};
   }));
  }
  fs.writeFileSync('.graphics-review/painterly/memory-probe.json',JSON.stringify(rows,null,2));
  console.log(rows.map(r=>({style:r.style,MiB:r.audit.currentBytes/1048576,peak:r.audit.peakBytes/1048576,owners:r.owners})));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

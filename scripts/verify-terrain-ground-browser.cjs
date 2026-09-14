const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const [k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true]}));
const output=args.output||'.graphics-review/stylized-earth/contact/query';
(async()=>{let browser;const r={status:'BLOCKED',errors:[],sites:[]};
 try{
  fs.mkdirSync(output,{recursive:true});browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>r.errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');window.__flySunOverride=Date.UTC(2026,6,18,17);window.__flyWeatherOverride='baseline';});
  await page.goto(`${args.url}/?earth=stylized&graphicsReview=1`);
  r.servedBuild=await require('./ground-build-receipt.cjs')(page,args.url,args['build-id']);
  await page.waitForFunction(()=>window.__flyBoot?.pct===100,null,{timeout:120000});
  for(const [name,lat,lon,altM] of [['erie',41.7588,-82.6925,480],['elyria',41.1859,-82.0982,600],['hudson',40.7472,-74.0168,300],['owens',36.601,-118.06,1800]]){
   await page.evaluate(({lat,lon,altM})=>{const rt=window.__fly;rt.warpToGeo(lat,lon,{altM,name:null});rt.flight.step=()=>{rt.flight.speed=0;};},{lat,lon,altM});
   await page.waitForTimeout(18000);
   const row=await page.evaluate(({lat,lon})=>{
    const engine=window.__fly.engine,map=engine.map,q=engine._groundQuery,p=window.__fly.flight.pos.clone(),points=[];
    for(let i=0;i<100;i++)points.push([lon+Math.cos(i*2.4)*(i%10)*.0006,lat+Math.sin(i*2.4)*(i%10)*.0006]);
    let hits=0,maxError=0,mismatch=0,fallbacks=0;
    const t0=performance.now();const raw=points.map(([x,y])=>map.getLocalInfoFromGeo(p.set(x,y,0)));const rawMs=performance.now()-t0;
    const t1=performance.now();const fast=points.map(([x,y])=>q.sample(x,y));const fastMs=performance.now()-t1;
    for(let i=0;i<points.length;i++){
     if(fast[i]===undefined){fallbacks++;continue;}
     if(!!raw[i]!==!!fast[i]){mismatch++;continue;}
     if(raw[i]){hits++;let o=raw[i].object;while(o&&!o.isTile)o=o.parent;
      maxError=Math.max(maxError,Math.abs(raw[i].location.z-fast[i].elev));if(o.z!==fast[i].tileZ)mismatch++;
     }
    }
    return{hits,maxError,mismatch,fallbacks,rawMs,fastMs,pins:[window.__flyTerraPin??null,window.__flyGovPin??null],stats:{...q.stats}};
   },{lat,lon});
   r.sites.push({name,...row});console.log(JSON.stringify(r.sites.at(-1)));
  }
  r.status=r.errors.length||r.sites.some(s=>s.hits<50||s.mismatch||s.fallbacks||s.maxError>1e-4||s.pins.some(v=>v!==null))?'FAIL':'PASS';
 }catch(e){r.reason=e.stack;}finally{await browser?.close();fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(r,null,2));console.log(`TERRAIN QUERY: ${r.status}`);process.exitCode=r.status==='PASS'?0:1;}
})();

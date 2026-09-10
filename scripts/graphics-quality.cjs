/* Exercise the real governor ladder during translating flight. Readiness/count
 * assertions accompany captures; visual continuity still requires inspection. */
const {chromium}=require('playwright');
const fs=require('node:fs');
const args=Object.fromEntries(process.argv.slice(2).map(s=>{const[k,v]=s.replace(/^--/,'').split('=');return[k,v??true]}));
const output=args.output||'.graphics-review/quality-final';
(async()=>{
 const r={...require('./graphics-source.cjs')(),status:'BLOCKED',errors:[],steps:[]};let browser;
 try{
  fs.mkdirSync(output,{recursive:true});
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const page=await browser.newPage({viewport:{width:Number(args.width||1920),height:Number(args.height||1080)},deviceScaleFactor:1});
  page.on('pageerror',e=>r.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|TypeError|ReferenceError/.test(m.text()))r.errors.push(m.text().slice(0,1000));});
  await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');window.__flySunOverride=Date.UTC(2026,6,18,4);window.__flyWeatherOverride='baseline';window.__flyGovPin='hold';});
  await page.goto(`${args.url||'http://localhost:3010'}/?graphics=${encodeURIComponent(args.stage||'cinematic')}&graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly,null,{timeout:90000});
  await page.evaluate(()=>window.__fly.warpToGeo(40.7028,-74.017,{altM:305,name:null}));
  await page.waitForTimeout(25000);
  await page.evaluate(()=>{
    const f=window.__fly.flight,step=f.step.bind(f);let t=0;
    f.step=(dt,cmd)=>{t+=dt;step(dt,{...cmd,speedOverride:60,turn:Math.sin(t/9)*.15,pitch:(100-(f.pos.y-f.groundElev))*.002,boost:false,speedPreset:'slow'});};
  });
  const sample=async(label)=>{
    await page.waitForTimeout(6000);
    const s=await page.evaluate(()=>{
      const c=window.__flyComposer.passes.find(p=>p.name==='ImmersiveClouds');
      if(c&&!window.__qualityCloudPass)window.__qualityCloudPass=c;
      return {review:window.__graphicsReview,gov:window.__flyGov.state(),night:window.__fly.satBuildings?.nightEnabled,position:{...window.__fly.flight.pos},
        clouds:c?{samePass:c===window.__qualityCloudPass,steps:c.uniforms.steps.value,width:c.target.width,height:c.target.height}:null,
        fx:window.__flyStats.fx};
    });
    s.label=label;r.steps.push(s);
    await page.screenshot({path:`${output}/${r.steps.length}-${label}.png`});
    console.log(`${label}: scene ${s.review?.tier}, effects ${s.review?.effectsTier}, DPR ${s.review?.dpr}`);
  };
  await sample('high');
  for(let i=1;i<=4;i++){await page.evaluate(()=>window.__flyGov.force(-1));await sample(`down-${i}`);}
  for(let i=1;i<=4;i++){await page.evaluate(()=>window.__flyGov.force(1));await sample(`up-${i}`);}
  const present=r.steps.every(s=>s.review?.buildings?.ready>0&&s.review?.roads?.ready>0&&s.review?.skyline?.ready>0&&s.night);
  const order=r.steps.slice(0,3).map(s=>[s.review.tier,s.review.effectsTier]);
  r.effectsBeforeDetail=JSON.stringify(order)===JSON.stringify([['high','high'],['high','medium'],['high','low']]);
  r.recovered=r.steps.at(-1).review?.tier==='high'&&r.steps.at(-1).review?.dpr===1&&r.steps.at(-1).review?.effectsTier==='high';
  r.depthContinuity=args.stage!=='immersive'||r.steps.every(s=>s.clouds?.samePass&&s.clouds.steps>0&&s.review.immersive?.shadows&&s.fx?.bufferMatchesDrawing);
  r.status=r.errors.length||!present||!r.effectsBeforeDetail||!r.recovered||!r.depthContinuity?'FAIL':'PASS';
  r.note='Governor held only against unsolicited steps; force() used its actual DPR/tier ladder. Flight continued throughout. Screenshots require visual inspection.';
 }catch(e){r.reason=e.stack;}
 finally{await browser?.close();fs.mkdirSync(output,{recursive:true});fs.writeFileSync(`${output}/report.json`,JSON.stringify(r,null,2));console.log(JSON.stringify({status:r.status,errors:r.errors,reason:r.reason}));process.exitCode=r.status==='PASS'?0:r.status==='BLOCKED'?2:1;}
})();

const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const {enterHangar}=require('./_title');
const assets=JSON.parse(fs.readFileSync('lib/fly/landmark-fidelity-assets.json'));
const sites=[['Empire State Building',40.7484,-73.9857,420],['Eiffel Tower',48.8584,2.2945,280],['Taj Mahal',27.1751,78.0421,120],['Sydney Opera House',-33.8568,151.2153,120],['Big Ben',51.5007,-.1246,135],['Space Needle',47.6205,-122.3493,210],['Gateway Arch',38.6247,-90.1848,210],['Colosseum',41.8902,12.4922,115],['Willis Tower',41.8789,-87.6359,450],['Burj Khalifa',25.1972,55.2744,650],['CN Tower',43.6426,-79.3871,460]];
const out='.graphics-review/landmark-fidelity';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
 const defaults=process.env.FLY_SHIPPED_DEFAULTS==='1';
 const smoke=process.argv.includes('--smoke');
 const report={errors:[],runs:[],status:'RUNNING',shippedDefaults:defaults,smoke,pins:{governor:'hold',pose:'fixed',sun:'local noon'},scope:'Placement, detail transitions, cache bounds, and desktop/phone layouts; not a performance or settled-terrain certification.'};
 try{
  for(const phone of [false,true]){
   const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1500,height:1000},isMobile:phone,hasTouch:phone});
   page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|GL_INVALID|WebGLProgram/.test(m.text()))report.errors.push(m.text());});
   await page.addInitScript(()=>{localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-quality-tier','high');window.__flyGovPin='hold';window.__flySunOverride=Date.UTC(2026,6,18,17);});
   await page.goto((process.env.FLY_URL||'http://localhost:3162')+'/?graphicsReview=1'+(defaults?'':'&flags=LANDMARK_FIDELITY,LIBERTY_DETAIL,COMMERCIAL_PAINT,OPERATOR_LIVERIES'));
   await enterHangar(page,'ops',{timeoutMs:180000,tap:phone});await page.getByTestId('hangar-pick-prop').click();
   await page.getByRole('radio',{name:'Approach',exact:true}).check();await page.getByTestId('hangar-fly').click();
   await page.waitForFunction(()=>window.__fly?.flight&&window.__flyBoot?.pct===100,null,{timeout:180000});
   const selected=smoke?sites.filter(s=>s[0]==='Big Ben'):phone?sites.filter(s=>['Big Ben','Sydney Opera House','Colosseum'].includes(s[0])):sites;
   for(const [name,lat,lon,altM]of selected){
    await page.evaluate(({lat,lon,altM,phone})=>{
     const r=window.__fly,f=r.flight;window.__flyStore.getState().setQualityTier(phone?'medium':'high');
     // Local noon at every longitude; only the camera pose is held for comparison.
     window.__flySunOverride=Date.UTC(2026,6,18,12)-lon/15*3600000;
     r.warpToGeo(lat,lon,{offsetM:650,offsetBearingRad:Math.PI,altM});r.autopilot.disengage();
     window.__landmarkFidelityStep??=f.step.bind(f);const pos=f.pos.clone();
     f.step=(dt,cmd)=>{window.__landmarkFidelityStep(dt,{...cmd,speedOverride:0,turn:0,pitch:0,boost:false});f.pos.copy(pos);f.speed=0;f.heading=0;f.pitch=0;f.bank=0;};
    },{lat,lon,altM,phone});
    const level=phone?'medium':'high',expected=assets.find(a=>a.poi===name&&a.level===level);
    await page.waitForFunction(({name,level,tris})=>window.__flyMonuments?.placed?.some(p=>p.name===name&&p.detail===level&&p.triangles===tris),{name,level,tris:expected.triangles},{timeout:90000});
    await page.getByTestId('warp-hold').waitFor({state:'hidden',timeout:90000});
    const data=await page.evaluate(name=>({placed:window.__flyMonuments.placed.find(p=>p.name===name),stats:window.__flyStats.monuments,ready:window.__fly.worldReadiness?.ready}),name);
    assert.ok(data.stats.detailed<=2&&data.stats.detailCache<=4);assert.equal(data.placed.triangles,expected.triangles);
    await page.screenshot({path:`${out}/world-${name.toLowerCase().replaceAll(' ','-')}-${phone?'phone':'desktop'}.png`});
    report.runs.push({phone,name,level,...data});console.log(`PASS ${phone?'phone':'desktop'} ${name}: ${expected.triangles} triangles`);
   }
   // A low-tier change must release detail and retain the new distant silhouette.
   const last=selected.at(-1)[0],far=assets.find(a=>a.poi===last&&a.level==='far');
   await page.evaluate(()=>window.__flyStore.getState().setQualityTier('low'));
   await page.waitForFunction(({name,tris})=>window.__flyMonuments?.placed?.some(p=>p.name===name&&p.detail==='far'&&p.triangles===tris),{name:last,tris:far.triangles},{timeout:40000});
   report.runs.push({phone,name:last,level:'low',triangles:far.triangles});
   await page.close();
  }
  assert.equal(report.errors.length,0);report.status='PASS';
 }catch(e){report.status='FAIL';report.failure=String(e.stack||e);throw e;}
 finally{fs.writeFileSync(`${out}/browser-report.json`,JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

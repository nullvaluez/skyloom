/* Playable review controls and physical-airframe framing. Not a GPU benchmark. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const [k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const url=args.url||'http://localhost:3028',output=path.resolve(args.output||'.graphics-review/stylized-earth/final/review-controls');
(async()=>{
  const report={...require('./graphics-source.cjs')(),status:'BLOCKED',checks:[],errors:[]};let browser;
  const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);};
  try{
    fs.mkdirSync(output,{recursive:true});
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
    const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.addInitScript(()=>{localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-map-style-2','satellite');});
    await page.goto(`${url}/stylized-earth-review.html`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow.__fly?.earthSurface?.ready>=16,null,{timeout:120000});
    if(args['build-id']){
      const receipt=require('./ground-build-receipt.cjs'),frame=page.frames().find(f=>f!==page.mainFrame());
      const response=await page.request.get(`${url}/_next/static/${args['build-id']}/ground-source.json`);
      report.servedBuild=receipt.bindDocument(receipt.validateReceipt(await response.json(),args['build-id']),await frame.content(),frame.url(),url);
    }
    check('review opens default Satellite without an opt-in URL',await page.locator('#world').inputValue()==='satellite' && await page.evaluate(()=>!document.querySelector('iframe').contentWindow.location.search.includes('earth=')));
    await page.selectOption('#place','powell');await page.selectOption('#height','1000');await page.selectOption('#light','noon');await page.click('#visit');
    await page.waitForTimeout(16000);
    for(const id of ['prop','fighter','cargo']){
      await page.evaluate(id=>document.querySelector('iframe').contentWindow.__flyStore.getState().setAircraftId(id),id);
      await page.waitForFunction(id=>document.querySelector('iframe').contentWindow.__flyStore.getState().aircraftId===id,id,{timeout:30000});
      await page.waitForTimeout(5000);
      const bounds=await page.evaluate(()=>{
        const w=document.querySelector('iframe').contentWindow,rt=w.__fly,f=rt.flight;let root=rt.engine.object;while(root.parent)root=root.parent;
        let rig;root.traverse(o=>{if(o.type==='Group'&&o.rotation.order==='YXZ'&&o.position.distanceTo(f.pos)<1)rig=o;});
        if(!rig)return null;
        const points=[];
        rig.traverse(o=>{if(!o.isMesh)return;for(let p=o;p;p=p.parent)if(!p.visible)return;
          o.geometry.computeBoundingBox();const b=o.geometry.boundingBox;
          for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])points.push(f.pos.clone().set(x,y,z).applyMatrix4(o.matrixWorld).project(rt.camera));
        });
        return{minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y)),meshCorners:points.length,earth:rt.earthSurface};
      });
      check(`${id} actual model fits the closer camera`,bounds&&bounds.minX>-.97&&bounds.maxX<.97&&bounds.minY>-.97&&bounds.maxY<.97&&bounds.maxX-bounds.minX>.10,bounds);
      await page.screenshot({path:path.join(output,`frame-${id}.png`)});
    }
    await page.selectOption('#light','live');await page.click('#visit');
    check('real-time option releases both lighting overrides',await page.evaluate(()=>{const w=document.querySelector('iframe').contentWindow;return w.__flySunOverride===undefined&&w.__flyWeatherOverride===undefined;}));
    // Exercise hot style transitions in one runtime, so disposal is observable.
    await page.evaluate(()=>document.querySelector('iframe').contentWindow.__flyStore.getState().setMapStyle('toy'));
    await page.waitForTimeout(8000);
    check('Neon releases the surface engine and restores its residency budget',await page.evaluate(()=>{const w=document.querySelector('iframe').contentWindow;return w.__flyStore.getState().mapStyle==='toy'&&!w.__fly.earthSurface&&w.__fly.engine.residency.budgetBytes===140e6;}));
    await page.evaluate(()=>document.querySelector('iframe').contentWindow.__flyStore.getState().setMapStyle('satellite'));
    await page.waitForFunction(()=>document.querySelector('iframe').contentWindow.__fly?.earthSurface?.ready>=16,null,{timeout:90000});
    check('returning to Satellite restores bounded surface coverage and budget',await page.evaluate(()=>{const rt=document.querySelector('iframe').contentWindow.__fly;return rt.earthSurface.maskBytes===6*1024*1024&&rt.engine.residency.budgetBytes===120*1024*1024;}));
    check('only Satellite and Neon are offered',await page.locator('#world option').evaluateAll(options=>options.map(o=>o.value).join(',')==='satellite,neon'));
    report.status=report.errors.length||report.checks.some(c=>!c.pass)?'FAIL':'PASS';
  }catch(e){report.reason=e.stack;}
  finally{await browser?.close();fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(`EARTH REVIEW: ${report.status}`);process.exitCode=report.status==='PASS'?0:report.status==='BLOCKED'?2:1;}
})();

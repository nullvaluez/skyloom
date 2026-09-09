/* Fresh boots prove defaults and the Neon boundary; no graphics/governor pins. */
const {chromium}=require('playwright'),fs=require('node:fs');
const args=Object.fromEntries(process.argv.slice(2).map(s=>{const[k,v]=s.replace(/^--/,'').split('=');return[k,v??true]}));
const output=args.output||'.graphics-review/style-smoke';
(async()=>{
 const r={...require('./graphics-source.cjs')(),status:'BLOCKED',errors:[],cases:[]};let browser;
 try{
  fs.mkdirSync(output,{recursive:true});
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  for(const [name,style,query] of [['ordinary','satellite',''],['legacy','satellite','&graphics=legacy'],['neon','toy','&graphics=cinematic']]){
   const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
   page.on('pageerror',e=>r.errors.push(e.message));
   await page.addInitScript(style=>{localStorage.setItem('fly-map-style-2',style);localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');},style);
   await page.goto(`${args.url||'http://localhost:3010'}/?graphicsReview=1${query}`,{waitUntil:'domcontentloaded',timeout:90000});
   await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly,null,{timeout:90000});
   await page.evaluate(()=>window.__fly.warpToGeo(40.7028,-74.017,{altM:500,name:null}));
   await page.waitForTimeout(15000);
   const s=await page.evaluate(()=>{
    const rt=window.__fly;let root=rt.engine.object;while(root.parent)root=root.parent;
    const keys=new Set();
    root.traverse(o=>{if(!o.isMesh)return;let p=o;while(p){if(!p.visible)return;p=p.parent;}for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m)keys.add(m.customProgramCacheKey?.()||m.type);});
    return {style:window.__flyStore.getState().mapStyle,review:window.__graphicsReview,visibleMaterialKeys:[...keys],shadows:rt.engine.map?.castShadow};
   });
   s.name=name;
   const cinematic=s.visibleMaterialKeys.some(k=>k.includes('cinematic-architecture'));
   s.pass=style==='toy' ? s.style==='toy'&&!s.visibleMaterialKeys.some(k=>k.includes('cinematic-architecture')) :
     s.review?.terrain?.sharp&&s.review?.buildings?.ready>0&&cinematic===(name==='ordinary'&&args['expect-default']==='cinematic');
   r.cases.push(s);await page.screenshot({path:`${output}/${name}.png`});await page.close();
   console.log(`Style ${name}: ${s.pass?'PASS':'FAIL'}`);
  }
  r.status=r.errors.length||r.cases.some(s=>!s.pass)?'FAIL':'PASS';
 }catch(e){r.reason=e.message;}
 finally{await browser?.close();fs.mkdirSync(output,{recursive:true});fs.writeFileSync(`${output}/report.json`,JSON.stringify(r,null,2));console.log(`STYLE SMOKE: ${r.status}`);process.exitCode=r.status==='PASS'?0:r.status==='BLOCKED'?2:1;}
})();

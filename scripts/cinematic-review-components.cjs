/* Real review selectors, observed compiled uniforms and physical aircraft materials. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const {readFrame}=require('./cinematic-flight-probe.cjs');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const[k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const url=args.url||'http://localhost:3046',out=args.output||'.graphics-review/cinematic-flight/final/components';
(async()=>{let browser;const report={status:'BLOCKED',rows:[],checks:{},errors:[]};try{
 fs.mkdirSync(out,{recursive:true});browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');window.__flyGovPin='hold';});
 await page.goto(`${url}/stylized-earth-review.html`,{waitUntil:'domcontentloaded'});
 await page.selectOption('#place','jfk');await page.selectOption('#height','300');await page.selectOption('#light','noon');
 for(const feature of ['', 'materials','lighting','camera','aircraft']){
  if(feature)await page.selectOption('#compare',feature);
  await page.waitForFunction(feature=>{const w=document.querySelector('iframe').contentWindow;return w.location.search.includes('cinematicOff='+feature)||!feature;},feature);
  await page.waitForFunction(()=>document.querySelector('iframe').contentWindow.__flyBoot?.pct===100,null,{timeout:120000});
  await page.click('#visit');await page.waitForTimeout(1000);
  const frame=page.frames().find(f=>f!==page.mainFrame());
  await frame.evaluate(()=>{const rt=window.__fly,f=rt.flight;rt.autopilot.disengage();const step=f.step.bind(f);f.step=(dt,cmd)=>step(dt,{...cmd,speedOverride:0,turn:0,pitch:0,boost:false});});
  await frame.waitForFunction(()=>window.__fly?.earthSurface?.ready>=16,null,{timeout:90000});await page.waitForTimeout(5000);
  if(args['build-id']){
   const receipt=require('./ground-build-receipt.cjs'),response=await page.request.get(`${url}/_next/static/${args['build-id']}/ground-source.json`);
   report.servedBuild=receipt.bindDocument(receipt.validateReceipt(await response.json(),args['build-id']),await frame.content(),frame.url(),url);
  }
  const values=await frame.evaluate(()=>{
   const rt=window.__fly,renderer=window.__flyComposer?.renderer;let root=rt.engine.object;while(root.parent)root=root.parent;
   let materialUniform=null;root.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){
    const u=renderer?.properties?.get(m)?.uniforms;if(u?.uCinematicMaterials)materialUniform=u.uCinematicMaterials.value;
   }});return{materialUniform,lighting:rt.immersiveLighting,search:window.location.search};
  });
  const aircraft=await frame.evaluate(readFrame);report.rows.push({feature:feature||'full',...values,aircraft});
  await page.screenshot({path:path.join(out,`${feature||'full'}.png`)});
 }
 const by=Object.fromEntries(report.rows.map(r=>[r.feature,r]));
 report.checks={materials:by.full.materialUniform>.9&&by.materials.materialUniform===0,
  // The revised art direction reduces flat sky fill and raises reflected
  // environment light. Verify that direction through the actual selector.
  lighting:by.full.lighting.environment-by.lighting.lighting.environment>.05&&by.full.lighting.fill<by.lighting.lighting.fill,
  camera:by.camera.aircraft.camera.fov-by.full.aircraft.camera.fov>1,
  aircraft:by.full.aircraft.materials.some(m=>m.roughness===.48)&&!by.aircraft.aircraft.materials.some(m=>m.roughness===.48),
  rendered:report.rows.every(r=>r.aircraft?.count>0&&r.aircraft.earth.materials.state==='ready')};
 report.status=Object.values(report.checks).every(Boolean)&&!report.errors.length?'PASS':'FAIL';
 }catch(e){report.reason=e.stack;}finally{await browser?.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(`REVIEW COMPONENTS: ${report.status}`,report.checks,report.reason||'');process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?1:2;}})();

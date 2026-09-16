/* Actual moving airframe projection and material diagnostics. Not a timing benchmark. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const[k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const url=args.url||'http://localhost:3042',output=path.resolve(args.output||'.graphics-review/cinematic-flight/framing');
function readFrame(){
  const rt=window.__fly,f=rt.flight;let root=rt.engine.object;while(root.parent)root=root.parent;
  let rig;root.traverse(o=>{if(o.type==='Group'&&o.rotation.order==='YXZ'&&o.position.distanceTo(f.pos)<2)rig=o;});
  if(!rig)return null;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,count=0;
  const materials=[];
  rig.traverse(o=>{
    if(!o.isMesh||!o.material?.isMeshPhysicalMaterial)return;
    for(let p=o;p;p=p.parent)if(!p.visible)return;
    const attribute=o.geometry.attributes.position;
    for(let i=0;i<attribute.count;i++){
      const p=f.pos.clone().set(attribute.getX(i),attribute.getY(i),attribute.getZ(i)).applyMatrix4(o.matrixWorld).project(rt.camera);
      minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);count++;
    }
    materials.push({name:o.material.name,roughness:o.material.roughness,metalness:o.material.metalness,coat:o.material.clearcoat,environment:o.material.envMapIntensity});
  });
  return{minX,maxX,minY,maxY,width:(maxX-minX)/2,count,materials,speed:f.speed,position:{x:f.pos.x,y:f.pos.y,z:f.pos.z},agl:f.pos.y-f.groundElev,size:f.cameraModelSize,earth:rt.earthSurface,camera:{x:rt.camera.position.x,y:rt.camera.position.y,z:rt.camera.position.z,fov:rt.camera.fov}};
}
async function main(){
 const r={status:'BLOCKED',errors:[],rows:[]};let browser;
 try{
  fs.mkdirSync(output,{recursive:true});browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  page.on('pageerror',e=>r.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|TypeError|ReferenceError/.test(m.text()))r.errors.push(m.text().slice(0,2500));});
  if(args['fail-material'])await page.route('**/materials/cinematic-v*/*.bin',route=>route.fulfill({status:503,body:'Test outage'}));
  await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,6,18,17);window.__flyGovPin='hold';});
  await page.goto(`${url}/?graphicsReview=1${args.off?'&cinematicOff='+args.off:''}`,{waitUntil:'domcontentloaded'});
  if(args['build-id'])r.servedBuild=await require('./ground-build-receipt.cjs')(page,url,args['build-id']);
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly?.earthSurface?.ready>=16,null,{timeout:120000});
  for(const id of args['fail-material']?['fighter']:['fighter','prop','cargo']){
    await page.evaluate(id=>window.__flyStore.getState().setAircraftId(id),id);await page.waitForTimeout(3500);
    for(const speed of args['fail-material']?[60]:id==='fighter'?[60,180]:[80]){
      await page.evaluate(speed=>{
        const rt=window.__fly,f=rt.flight;delete f.step;rt.autopilot.disengage();rt.warpToGeo(40.6245,-73.7854,{altM:320,name:null});
        f.heading=44*Math.PI/180;f.pitch=0;f.bank=0;
        const step=f.step.bind(f);f.step=(dt,cmd)=>step(dt,{...cmd,turn:0,pitch:Math.max(-.3,Math.min(.3,(320-f.pos.y)*.002)),speedOverride:speed,boost:false,speedPreset:'cruise'});
      },speed);
      await page.waitForTimeout(12000);const row={id,speed,frames:[]};r.rows.push(row);
      for(let i=0;i<4;i++){row.frames.push(await page.evaluate(readFrame));await page.waitForTimeout(500);}
      await page.screenshot({path:path.join(output,`${id}-${speed}.png`)});
      console.log(`${id} ${speed}: width ${row.frames.map(f=>(f?.width*100).toFixed(1)).join(', ')}%`);
    }
  }
  const frames=r.rows.flatMap(row=>row.frames);
  r.framing=frames.every(f=>f&&f.count>0&&f.minX>-.95&&f.maxX<.95&&f.minY>-.95&&f.maxY<.95);
  r.fighterWidth=r.rows.filter(row=>row.id==='fighter').every(row=>row.frames.every(f=>f.width>=.12&&f.width<=.18));
  r.assets=frames.every(f=>f.earth.materials.state===(args['fail-material']?'fallback':'ready'));
  r.status=r.errors.length||!r.framing||(!args.off&&!r.fighterWidth)||!r.assets?'FAIL':'PASS';
 }catch(error){r.reason=error.stack;}
 finally{await browser?.close();fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(r,null,2));console.log(`CINEMATIC PROBE: ${r.status}`);process.exitCode=r.status==='PASS'?0:r.status==='FAIL'?1:2;}
}
if(require.main===module)main();
module.exports={readFrame};

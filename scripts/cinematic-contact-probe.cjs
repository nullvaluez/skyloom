const {chromium}=require('playwright'),fs=require('node:fs');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const[k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const out=args.output||'.graphics-review/cinematic-flight/contact-diagnostic',url=args.url||'http://localhost:3044';
const {cinematicSupportCensus}=require('./cinematic-support-census.cjs');
function contacts(){
 const rt=window.__fly,f=rt.flight,rows=[];
 for(const engine of ['satBuildings','satSkyline'])for(const [key,c] of rt[engine]?.chunks??[]){
  if(!c.mesh)continue;
  const p=c.mesh.geometry.attributes.position,a=c.mesh.geometry.attributes.aBendAnchor??c.mesh.geometry.attributes.aAnchor;
  const cx=c.mesh.position.x,cz=c.mesh.position.z,mins=new Map();
  if(a)for(let i=0;i<p.count;i++){const x=a.getX(i),z=a.getY(i),id=x+','+z,old=mins.get(id);if(!old||p.getY(i)<old.y)mins.set(id,{x,z,y:p.getY(i)});}
  else for(const r of c.drapeRuns??[])mins.set(r.ax+','+r.az,{x:r.ax,z:r.az,y:r.ground});
  for(const r of [...mins.values()].filter((_,i)=>i%Math.max(1,Math.floor(mins.size/24))===0)){
   const wx=cx+r.x,wz=cz+r.z,lon=wx/6378137*180/Math.PI,lat=(2*Math.atan(Math.exp(-wz/6378137))-Math.PI/2)*180/Math.PI,g=rt.engine.getGroundAt(lon,lat);
   rows.push({engine,key,x:wx,z:wz,y:r.y+c.mesh.position.y,ground:g,delta:r.y+c.mesh.position.y-(g?.elev??0),d:Math.hypot(wx-f.pos.x,wz-f.pos.z),coarse:c.coarse,runCount:c.drapeRuns?.length,attributes:Object.keys(c.mesh.geometry.attributes)});
  }
 }
 return{ground:f.groundElev,vis:rt.groundElevVis,position:{...f.pos},worst:rows.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,35),counts:{buildings:rt.satBuildings.stats,skyline:rt.satSkyline.stats}};
}
(async()=>{let browser;const r={rows:[]};try{
 fs.mkdirSync(out,{recursive:true});browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});const page=await browser.newPage({viewport:{width:1920,height:1080}});
 await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');window.__flySunOverride=Date.UTC(2026,6,18,3);window.__flyWeatherOverride='baseline';});
 await page.goto(url+'/?graphicsReview=1');await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly?.earthSurface?.ready>=16,null,{timeout:120000});
 for(const [name,lat,lon,alt] of [['bali',-8.801,115.231,320],['tokyo',35.6812,139.7671,313]]){
  await page.evaluate(({lat,lon,alt})=>{const rt=window.__fly,f=rt.flight;rt.autopilot.disengage();rt.warpToGeo(lat,lon,{altM:alt,name:null});delete f.step;const step=f.step.bind(f);f.step=(dt,cmd)=>{step(dt,{...cmd,speedOverride:0,turn:0,pitch:0,boost:false});f.pos.y=f.groundElev+304.8;};f.heading=40*Math.PI/180;},{lat,lon,alt});
  for(let t=0;t<5;t++){await page.waitForTimeout(6000);const data=await page.evaluate(contacts),support=await page.evaluate(cinematicSupportCensus);r.rows.push({name,seconds:(t+1)*6,...data,support});console.log(name,(t+1)*6,JSON.stringify(support));await page.screenshot({path:`${out}/${name}-${t}.png`});fs.writeFileSync(`${out}/report.json`,JSON.stringify(r,null,2));}
 }
 }finally{await browser?.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={contacts};

/* Inspect actual canopy instance bases during arrival; not a timing benchmark. */
const {chromium}=require('playwright'),fs=require('node:fs');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const[k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const url=args.url||'http://localhost:3046',out=args.output||'.graphics-review/cinematic-flight/vegetation-diagnostic';
function canopySupport(){
 const rt=window.__fly,f=rt.flight;let root=rt.engine.object;while(root.parent)root=root.parent;
 const points=[];root.traverse(o=>{if(!o.isInstancedMesh||!o.geometry.attributes.aCanopyPhase)return;
  for(let i=0;i<o.count;i++){
   const a=o.instanceMatrix.array,offset=i*16;if(a[offset]*a[offset+5]*a[offset+10]===0)continue;
   const p=f.pos.clone().set(a[offset+12],a[offset+13],a[offset+14]).applyMatrix4(o.matrixWorld);p.x+=rt.origin.anchor.x;p.z+=rt.origin.anchor.z;
   const distance=Math.hypot(p.x-f.pos.x,p.z-f.pos.z);
   if(distance<2400)points.push({x:p.x,y:p.y,z:p.z,distance});
  }});
 const selected=[...new Set([...points.sort((a,b)=>a.distance-b.distance).slice(0,32),...points.sort((a,b)=>b.y-a.y).slice(0,32)])];
 for(const p of selected){const g=rt.engine.getGroundAt(p.x/6378137*180/Math.PI,(2*Math.atan(Math.exp(-p.z/6378137))-Math.PI/2)*180/Math.PI);p.ground=g;p.delta=Number.isFinite(g?.elev)&&g.tileZ>=12?p.y-g.elev:null;}
 return{points:points.length,checked:selected.filter(p=>p.delta!==null).length,maxErrorM:Math.max(0,...selected.filter(p=>p.delta!==null).map(p=>Math.abs(p.delta))),worst:selected.filter(p=>p.delta!==null).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,8),
  chunks:rt.satVeg.nearest(f.pos.x,f.pos.z).map(c=>({key:c.key,coarse:c.coarse,min:Math.min(...c.grid),max:Math.max(...c.grid)}))};
}
(async()=>{let browser;const r={status:'BLOCKED',rows:[],errors:[]};try{
 fs.mkdirSync(out,{recursive:true});browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>r.errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');window.__flySunOverride=Date.UTC(2026,6,18,17);window.__flyWeatherOverride='baseline';});
 await page.goto(url+'/?graphicsReview=1');if(args['build-id'])r.servedBuild=await require('./ground-build-receipt.cjs')(page,url,args['build-id']);
 await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly?.earthSurface?.ready>=16,null,{timeout:120000});
 await page.evaluate(()=>{const rt=window.__fly,f=rt.flight;rt.autopilot.disengage();rt.warpToGeo(40.7028,-74.017,{altM:94,name:null});f.step=()=>{f.speed=0;f.pos.y=f.groundElev+91.44;f.heading=17*Math.PI/180;f.pitch=0;f.bank=0;};});
 for(let t=3;t<=36;t+=3){await page.waitForTimeout(3000);const row={seconds:t,...await page.evaluate(canopySupport)};r.rows.push(row);console.log(`Canopy ${t}s: ${row.points} instances; ${row.maxErrorM.toFixed(2)}m maximum support error`);await page.screenshot({path:`${out}/${t}.png`});}
 r.status=r.errors.length||r.rows.some(row=>row.maxErrorM>30)?'FAIL':r.rows.some(row=>row.checked>0)?'PASS':'BLOCKED';
 }catch(e){r.reason=e.stack;}finally{await browser?.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(`${out}/report.json`,JSON.stringify(r,null,2));console.log(`CANOPY SUPPORT: ${r.status}`);process.exitCode=r.status==='PASS'?0:r.status==='FAIL'?1:2;}})();

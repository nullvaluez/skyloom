// Read the actual contact-shadow texture uploaded by a production boot.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const a=Object.fromEntries(process.argv.slice(2).map(s=>{const[k,...v]=s.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
(async()=>{const dir=path.resolve(a.output||'.graphics-review/stylized-earth/review/player-shadow'),url=a.url||'http://localhost:3029';let browser;const r={status:'BLOCKED',errors:[]};
try{fs.mkdirSync(dir,{recursive:true});browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});const page=await browser.newPage({viewport:{width:1920,height:1080}});
page.on('pageerror',e=>r.errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-map-style-2','satellite');window.__flySunOverride=Date.UTC(2026,6,18,18);window.__flyWeatherOverride='baseline';});
await page.goto(`${url}/?earth=stylized&graphicsReview=1`);if(a['build-id'])r.servedBuild=await require('./ground-build-receipt.cjs')(page,url,a['build-id']);
await page.waitForFunction(()=>window.__flyBoot?.pct===100,null,{timeout:120000});
await page.evaluate(()=>{const f=window.__fly.flight;window.__fly.warpToGeo(41.7898,-82.7004,{altM:267,name:null});f.step=()=>{f.speed=0;f.heading=356*Math.PI/180;f.pitch=-.3;f.bank=.15;};});await page.waitForTimeout(22000);
r.texture=await page.evaluate(()=>{const f=window.__fly.flight;f.pos.y=f.groundElev+91.44;let root=window.__fly.engine.object;while(root.parent)root=root.parent;let found;
root.traverse(o=>{const im=o.material?.alphaMap?.image;if(o.geometry?.type==='CircleGeometry'&&o.geometry.parameters.radius===26&&im?.width===64&&im?.getContext){const ctx=im.getContext('2d');found={center:Array.from(ctx.getImageData(32,32,1,1).data),middle:Array.from(ctx.getImageData(50,32,1,1).data),edge:Array.from(ctx.getImageData(63,32,1,1).data)};}});return found;});
r.greenFalloff=!!r.texture&&r.texture.center[1]>245&&r.texture.middle[1]>70&&r.texture.middle[1]<200&&r.texture.edge[1]<15;
await page.waitForTimeout(1000);await page.screenshot({path:path.join(dir,'water-shadow.png')});r.status=r.errors.length||!r.greenFalloff?'FAIL':'PASS';
}catch(e){r.reason=e.stack;}finally{await browser?.close();fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(r,null,2));console.log(JSON.stringify(r));process.exitCode=r.status==='PASS'?0:r.status==='FAIL'?1:2;}})();

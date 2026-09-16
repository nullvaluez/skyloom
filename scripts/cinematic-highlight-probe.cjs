/* Matched aircraft-only highlight diagnostic, separate from timing acceptance. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const {readFrame}=require('./cinematic-flight-probe.cjs');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const[k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const url=args.url||'http://localhost:3044',out=args.output||'.graphics-review/cinematic-flight/highlights';
function projectedTriangles(){
 const rt=window.__fly,f=rt.flight;let root=rt.engine.object;while(root.parent)root=root.parent;
 let rig;root.traverse(o=>{if(o.type==='Group'&&o.rotation.order==='YXZ'&&o.position.distanceTo(f.pos)<2)rig=o;});
 const triangles=[];
 rig?.traverse(o=>{if(!o.isMesh||!o.material?.isMeshPhysicalMaterial)return;for(let p=o;p;p=p.parent)if(!p.visible)return;
  const pos=o.geometry.attributes.position,index=o.geometry.index,projected=[];
  for(let i=0;i<pos.count;i++){const p=f.pos.clone().set(pos.getX(i),pos.getY(i),pos.getZ(i)).applyMatrix4(o.matrixWorld).project(rt.camera);projected.push([(p.x+1)*960,(1-p.y)*540]);}
  for(let i=0;i<(index?.count??pos.count);i+=3)triangles.push([projected[index?index.getX(i):i],projected[index?index.getX(i+1):i+1],projected[index?index.getX(i+2):i+2]]);
 });return triangles;
}
async function metrics(png,triangles){
 const {data,info}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true}),mask=new Uint8Array(info.width*info.height);
 const cross=(a,b,x,y)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
 for(const [a,b,c] of triangles){
  const area=cross(a,b,...c);if(Math.abs(area)<.1)continue;
  for(let y=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1])));y<=Math.min(info.height-1,Math.ceil(Math.max(a[1],b[1],c[1])));y++)
   for(let x=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0])));x<=Math.min(info.width-1,Math.ceil(Math.max(a[0],b[0],c[0])));x++)
    if(cross(a,b,x+.5,y+.5)*area>=0&&cross(b,c,x+.5,y+.5)*area>=0&&cross(c,a,x+.5,y+.5)*area>=0)mask[y*info.width+x]=1;
 }
 let white=0;const luma=[];
 for(let i=0;i<mask.length;i++)if(mask[i]){const [r,g,b]=data.subarray(i*info.channels,i*info.channels+3);if(Math.min(r,g,b)>=245)white++;luma.push(.2126*r+.7152*g+.0722*b);}
 luma.sort((a,b)=>a-b);return{pixels:luma.length,whiteFraction:white/luma.length,p50:luma[Math.floor(luma.length*.5)],p95:luma[Math.floor(luma.length*.95)],p99:luma[Math.floor(luma.length*.99)]};
}
(async()=>{const report={status:'BLOCKED',purpose:'Silhouette-masked aircraft highlight comparison; no timing acceptance',rows:[],errors:[]};let browser;
 try{
  fs.mkdirSync(out,{recursive:true});browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  for(const variant of ['prior-aircraft','full','without-bloom']){
   const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});page.on('pageerror',e=>report.errors.push(e.message));
   await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,6,18,17);window.__flyGovPin='hold';});
   await page.goto(`${url}/?graphicsReview=1${variant==='prior-aircraft'?'&cinematicOff=aircraft':''}`,{waitUntil:'domcontentloaded'});
   report.servedBuild=await require('./ground-build-receipt.cjs')(page,url,args['build-id']);
   await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly?.earthSurface?.ready>=16,null,{timeout:120000});
   await page.evaluate(()=>{const rt=window.__fly;rt.autopilot.disengage();rt.warpToGeo(40.6245,-73.7854,{altM:650,name:null});const f=rt.flight,step=f.step.bind(f);f.step=(dt,cmd)=>step(dt,{...cmd,speedOverride:0,turn:0,pitch:0,boost:false});});
   await page.waitForTimeout(16000);
   let bloomFound=true;
   if(variant==='without-bloom')bloomFound=await page.evaluate(()=>{let n=0;for(const p of window.__flyComposer.passes)for(const e of p.effects??[])if(e.name==='BloomEffect'){e.blendMode.opacity.value=0;n++;}return n>0;});
   if(!bloomFound)throw Error('Bloom comparison could not find the actual effect');
   for(const heading of [0,45,90,135,180,225,270,315]){
    await page.evaluate(heading=>{const f=window.__fly.flight;f.heading=heading*Math.PI/180;f.pitch=0;f.bank=.18;f.pos.y=650;},heading);await page.waitForTimeout(1800);
    const frame=await page.evaluate(readFrame),triangles=await page.evaluate(projectedTriangles),file=`${variant}-${heading}.png`,png=await page.screenshot({path:path.join(out,file)});
    const values=await metrics(png,triangles);report.rows.push({variant,heading,file,frame,metrics:values});console.log(`${variant} ${heading}: white ${(values.whiteFraction*100).toFixed(2)}%, p99 ${values.p99.toFixed(1)}`);
   }
   await page.close();
  }
  report.status=report.errors.length?'FAIL':'CAPTURED';report.note='The mask is the union of projected physical-aircraft mesh triangles; navigation-light sprites are excluded. White means all output RGB channels >=245. This diagnoses these angles/conditions, not every possible sun angle.';
 }catch(error){report.reason=error.stack;}
 finally{await browser?.close();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(`HIGHLIGHTS: ${report.status}`);process.exitCode=report.status==='CAPTURED'?0:2;}
})();

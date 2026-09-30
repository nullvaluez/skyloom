const {chromium}=require('playwright'),fs=require('node:fs');
const {enterFlight}=require('./_skip-menus');
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 if(args.audit==='1')await page.addInitScript(require('./ground-texture-audit.cjs').installGroundTextureAudit);
 await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');window.__flySunOverride=Date.UTC(2026,8,27,17);window.__flyWeatherOverride='baseline';});
 await page.goto(args.url+'/?graphicsReview=1',{waitUntil:'domcontentloaded'});await enterFlight(page,{lat:40.72,lon:-74.02,altM:900,headingRad:.3,name:null},{waitReveal:true});
 await page.evaluate(({hour,travel})=>{
  if(hour!==undefined)window.__flySunOverride=Date.UTC(2026,8,27,Number(hour));
  const r=window.__fly;
  if(travel){const start=performance.now();window.__diagnosticFlying=true;
   function tick(now){if(!window.__diagnosticFlying)return;const t=(now-start)/1000,f=r.flight,clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
    const pitch=clamp((Math.max(900,(f.groundElev||0)+500)-f.pos.y)*.0012,-.32,.32);
    r.input.setTouchSteer(Math.sin(t*Math.PI/18)*.26,-clamp((pitch-f.pitch)*3,-1,1));r.input.setBoost(t%60>35&&t%60<39);requestAnimationFrame(tick);
   }requestAnimationFrame(tick);
  }else r.flight.step=()=>{};
 },{hour:args.hour,travel:Number(args.travel||0)});
 await page.waitForTimeout(Number(args.travel||15)*1000);
 await page.evaluate(()=>{window.__diagnosticFlying=false;window.__fly.flight.step=()=>{};window.__fly.input.clearTouchSteer();window.__fly.input.setBoost(false);});
 await page.evaluate(()=>{
  let root=window.__fly.engine.object;while(root.parent)root=root.parent;
  const rows=window.__submissions={};
  root.traverse(o=>{if(!o.isMesh)return;const name=(o.name||o.parent?.name||o.material?.name||o.geometry?.type||o.type).slice(0,100);
   for(const pass of ['Render','Shadow']){
    let before=0;
    const first=o['onBefore'+pass],last=o['onAfter'+pass];
    o['onBefore'+pass]=function(...a){before=a[0].info.render.triangles;first?.apply(this,a);};
    o['onAfter'+pass]=function(...a){last?.apply(this,a);const key=(pass==='Render'&&a[2]?.layers.mask===(1<<28)?'Reflection':pass==='Render'&&a[2]?.layers.mask===(1<<29)?'SkyOverlay':pass)+':'+name,row=rows[key]??={calls:0,triangles:0};row.calls++;row.triangles+=a[0].info.render.triangles-before;};
   }
  });
 });
 await page.waitForTimeout(3000);
 const report=await page.evaluate(()=>({rows:Object.entries(window.__submissions).sort((a,b)=>b[1].triangles-a[1].triangles),review:window.__graphicsReview,profile:window.__fly.cinemaProfile,resources:window.__fly.cinemaResources,audit:window.__groundTextureAudit?.snapshot({topLimit:20})}));
 if(args.regions==='1'){
  report.regionComparisons=[];
  for(const [grid,morton]of [[4,false],[8,false],[8,true],[16,true]]){
   await page.evaluate(({grid,morton})=>{
    let root=window.__fly.engine.object;while(root.parent)root=root.parent;
    root.traverse(o=>{const g=o.geometry,old=g?.userData.architectureRegions;if(!old?.length)return;
     const ix=g.index.array,p=g.attributes.position.array,count=g.userData.auxiliaryIndexCount;
     let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
     for(let i=0;i<count;i++){const v=ix[i]*3;x0=Math.min(x0,p[v]);x1=Math.max(x1,p[v]);z0=Math.min(z0,p[v+2]);z1=Math.max(z1,p[v+2]);}
     const buckets=Array.from({length:grid*grid},()=>[]),bounds=Array.from({length:grid*grid},()=>old[0].bounds.clone().makeEmpty());
     for(let i=0;i<count;i+=3){let x=0,z=0;for(let j=0;j<3;j++){const v=ix[i+j]*3;x+=p[v];z+=p[v+2];}
      const bx=Math.min(grid-1,Math.max(0,Math.floor((x/3-x0)*grid/Math.max(1,x1-x0)))),bz=Math.min(grid-1,Math.max(0,Math.floor((z/3-z0)*grid/Math.max(1,z1-z0))));
      let b=bz*grid+bx;if(morton){b=0;for(let bit=0;(1<<bit)<grid;bit++)b|=((bx>>bit)&1)<<(bit*2)|((bz>>bit)&1)<<(bit*2+1);}
      const box=bounds[b];for(let j=0;j<3;j++){const v=ix[i+j]*3;buckets[b].push(ix[i+j]);for(const [axis,k]of [['x',0],['y',1],['z',2]]){box.min[axis]=Math.min(box.min[axis],p[v+k]);box.max[axis]=Math.max(box.max[axis],p[v+k]);}}
     }
     const next=new ix.constructor(ix.length),regions=[];let offset=0;
     for(let i=0;i<buckets.length;i++){const a=buckets[i],box=bounds[i];if(!a.length)continue;next.set(a,offset);regions.push({start:offset,count:a.length,bounds:box,minY:box.min.y,maxY:box.max.y});offset+=a.length;}
     next.set(ix.subarray(count),count);g.setIndex(new g.index.constructor(next,1));g.userData.architectureRegions=regions;
    });
   },{grid,morton});
   await page.waitForTimeout(2000);
   const value=await page.evaluate(()=>({draws:window.__graphicsReview.drawCalls,triangles:window.__graphicsReview.triangles}));
   report.regionComparisons.push({grid,morton,...value});
  }
  console.log(JSON.stringify(report.regionComparisons));
 }
 fs.mkdirSync('.graphics-review/visual-finish/diagnostic',{recursive:true});fs.writeFileSync('.graphics-review/visual-finish/diagnostic/'+(args.name||'current')+'.json',JSON.stringify(report,null,2));await page.screenshot({path:'.graphics-review/visual-finish/diagnostic/'+(args.name||'current')+'.png'});console.log(JSON.stringify({rows:report.rows.slice(0,25),profile:report.profile,resources:report.resources},null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

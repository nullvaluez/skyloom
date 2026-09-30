// Traffic only is deterministic here: live geographic scenery, real renderer,
// real HUD picking. Public ADS-B availability cannot certify a hidden label.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {enterFlight}=require('./_skip-menus');
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const out=args.output||'.graphics-review/visual-finish/quiet';
(async()=>{
 fs.mkdirSync(out,{recursive:true});const report={...require('./graphics-source.cjs')(),syntheticTraffic:true,checks:[],errors:[]};
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const check=(name,ok,detail)=>{report.checks.push({name,passed:!!ok,detail});assert.ok(ok,name);console.log('PASS '+name);};
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram|GL_INVALID/.test(m.text()))report.errors.push(m.text());});
 try{
  await page.addInitScript(()=>{
   localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');
   window.__flySunOverride=Date.UTC(2026,8,27,17);window.__flyWeatherOverride='baseline';
   const draw=CanvasRenderingContext2D.prototype.fillText;
   CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
    if(String(text).startsWith('POLISH')){(window.__polishLabels??=[]).push({text,x,y,t:performance.now()});if(window.__polishLabels.length>200)window.__polishLabels.splice(0,100);}
    return draw.call(this,text,x,y,...rest);
   };
  });
  await page.goto((args.url||'http://localhost:3091')+'/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:90000});
  await enterFlight(page,{lat:40.72,lon:-74.02,altM:2000,headingRad:0,name:null},{waitReveal:true});
  await page.evaluate(()=>{
   const r=window.__fly,f=r.flight;f.step=()=>{};f.pitch=0;f.bank=0;f.heading=0;r.input.neutralize();
   r.targeting.update=()=>null;r.targeting.lockedHex=null;r.targeting.target=null;
   window.__flyStore.setState({lockedHex:null,inspectHex:null,spotting:false});
   r.chaseRig.update=(_dt,f,c)=>{window.__polishCamera=c;c.position.set(f.pos.x,f.pos.y+30,f.pos.z+40);c.lookAt(f.pos.x,f.pos.y+1500,f.pos.z-15000);};
   const tracks=[8000,16000,32000].map((d,i)=>{
    const x=f.pos.x+[-2000,2400,-3600][i],y=f.pos.y+[1400,2100,5000][i],z=f.pos.z-d;
    return {hex:'faee0'+i,meta:{flight:'POLISH'+i,t:'A320'},archetype:0,flags:0,rx:x,ry:y,ryd:y,rz:z,yaw:Math.PI/2,bank:0,opacity:1,scaleK:1,stale:0,distM:d,fix1:{x,y,z,vE:180,vN:0,vUp:0,latRad:f.latDeg*Math.PI/180,t:performance.now()/1000}};
   });
   r.traffic.tracks=new Map(tracks.map(t=>[t.hex,t]));r.traffic.update=()=>{r.traffic.items=tracks;return tracks;};
  });
  const snapshot=()=>page.evaluate(()=>{
   let root=window.__fly.engine.object;while(root.parent)root=root.parent;
   let dots;root.traverse(o=>{if(o.geometry?.attributes.aTrafficPresence)dots=o;});
   let energy=0,navVisible;window.__flyTracers?.traverse(o=>{if(o.name==='traffic-tracers-spot')navVisible=o.visible;const colors=o.geometry?.attributes.color;if(colors?.itemSize===4)for(const v of colors.array)energy+=Math.abs(v);});
   return {items:window.__fly.traffic.items.length,dots:dots?.count,presence:dots&&Array.from(dots.geometry.attributes.aTrafficPresence.array.slice(0,dots.count)),energy,
    navVisible,labels:(window.__polishLabels??[]).filter(t=>performance.now()-t.t<200),hover:window.__fly.hoverHex};
  });
  await page.waitForTimeout(5000);let s=await snapshot();report.quiet=s;
  check('quiet mode keeps every traffic item and subdues the far glint',s.items===3&&s.dots===1&&s.presence.every(v=>Math.abs(v-.22)<.001),s);
  check('quiet mode hides ordinary labels and skips invisible navigation draws',s.labels.length===0&&s.energy===0&&s.navVisible===false,s);
  await page.screenshot({path:path.join(out,'quiet.png')});
  await page.getByRole('button',{name:/Spotting.*Off/}).click();await page.mouse.move(5,60);await page.waitForTimeout(1200);s=await snapshot();report.spotting=s;
  check('Spotting restores labels, markers and ribbons without rebuilding tracks',s.items===3&&s.presence.every(v=>v===1)&&s.energy>0&&s.navVisible===true&&new Set(s.labels.map(l=>l.text)).size===3,s);
  const label=s.labels.find(l=>l.text.startsWith('POLISH0'));
  await page.screenshot({path:path.join(out,'spotting.png')});
  await page.getByRole('button',{name:/Spotting.*On/}).click();
  // The label is below the aircraft; use its known projected x and search the
  // short vertical marker neighbourhood with the actual hover hit tester.
  for(let dy=-34;dy<=-4;dy+=3){await page.mouse.move(label.x,label.y+dy);await page.waitForTimeout(60);s=await snapshot();if(s.hover==='faee00')break;}
  check('an unlabelled aircraft remains pickable in quiet flight',s.hover==='faee00',s);
  check('hovered aircraft regains its label',s.labels.some(l=>l.text.startsWith('POLISH0')),s);
  await page.mouse.click(label.x,label.y-15);await page.waitForTimeout(350);
  // Clicking the newly visible label uses the same pick rectangle.
  if(await page.evaluate(()=>window.__flyStore.getState().inspectHex)!=='faee00')await page.mouse.click(label.x,label.y);
  await page.waitForTimeout(350);
  check('quiet-mode selection opens the existing aircraft inspector',await page.evaluate(()=>window.__flyStore.getState().inspectHex==='faee00'));
  s=await snapshot();check('selected aircraft restores its navigation ribbon',s.navVisible===true&&s.energy>0,s);
  check('no page or shader errors',report.errors.length===0,report.errors);report.status='PASS';
 }catch(e){report.status='FAIL';report.reason=e.stack;console.error(e);process.exitCode=1;}
 finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(report.status);}
})();

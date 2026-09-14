// Frozen pose pixel regression, not a flight/performance certificate.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const[k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const url=args.url||'http://localhost:3029',dir=path.resolve(args.output||'.graphics-review/stylized-earth/review/terrain-bounds');
(async()=>{let browser;const r={status:'BLOCKED',errors:[],checks:[],purpose:'Hudson negative DEM pixel regression; actor frozen, culling/terrain/quality unmodified'};
 const check=(name,pass,detail)=>{r.checks.push({name,pass:!!pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);};
 try{
  fs.mkdirSync(dir,{recursive:true});browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>r.errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-map-style-2','satellite');window.__flySunOverride=Date.UTC(2026,6,18,4);window.__flyWeatherOverride='baseline';});
  await page.goto(`${url}/?earth=stylized&graphicsReview=1`);
  if(args['build-id'])r.servedBuild=await require('./ground-build-receipt.cjs')(page,url,args['build-id']);
  await page.waitForFunction(()=>window.__flyBoot?.pct===100,null,{timeout:120000});
  await page.evaluate(()=>{const r=window.__fly,f=r.flight;r.warpToGeo(40.7472,-74.0168,{altM:107.6,name:null});f.step=()=>{f.speed=60;f.pitch=-.65;f.heading=12*Math.PI/180;f.bank=.18;};});
  await page.waitForTimeout(25000);
  const stats=await page.evaluate(()=>{const r=window.__fly;let negative=0,empty=0,visibleNegative=0;r.engine.map.traverse(o=>{if(o.isTile&&o.model?.parent===o){if(o.BBox.isEmpty())empty++;if(o._maxZ<0){negative++;if(o.model.visible)visibleNegative++;}}});return{negative,empty,visibleNegative,ground:r.engine.getGroundAt(-74.0168,40.7472),earth:r.earthSurface,pins:[window.__flyTerraPin??null,window.__flyGovPin??null]};});
  check('fixture contains real negative DEM tiles',stats.negative>0&&stats.ground.elev<0,stats);
  check('no resident terrain has empty visibility bounds',stats.empty===0&&stats.visibleNegative>0,stats);
  check('production culling and management remain active',stats.pins.every(v=>v===null),stats.pins);
  const png=await page.screenshot({path:path.join(dir,'hudson.png')});
  const {data,info}=await sharp(png).extract({left:800,top:850,width:400,height:150}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let black=0;for(let i=0;i<data.length;i+=info.channels)if(data[i]+data[i+1]+data[i+2]<9)black++;
  r.blackFraction=black/(info.width*info.height);
  check('reported water wedge is filled',r.blackFraction<.01,{fraction:r.blackFraction,limit:.01,roi:[800,850,400,150]});
  r.status=r.errors.length||r.checks.some(c=>!c.pass)?'FAIL':'PASS';
 }catch(e){r.reason=e.stack;}finally{await browser?.close();fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(r,null,2));console.log(`TERRAIN BOUNDS: ${r.status}`);process.exitCode=r.status==='PASS'?0:r.status==='FAIL'?1:2;}
})();

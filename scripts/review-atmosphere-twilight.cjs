/** Fixed-pose, actual-sun twilight capture. Live providers / Chrome / D3D11.
 * node scripts/review-atmosphere-twilight.cjs --label=before
 * Options: --elevations=3,0,-3,-6,-12 --flags=BUILDING_REALISM,CITY_HORIZON
 * --date=2026-10-31 --url=http://localhost:3010 --settle=8000 --quality=high
 * The animation clock keeps running: freezing it can strand cadence-driven LUTs.
 * GPU screenshots and counters establish appearance/correctness, not fps.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { pathToFileURL } = require('node:url');
const { register } = require('node:module');
const args = Object.fromEntries(process.argv.slice(2).map(s => { const [k,...v]=s.replace(/^--/,'').split('='); return [k,v.join('=')||true]; }));
const label = args.label || 'before', url = args.url || 'http://localhost:3010';
const flags = args.flags || 'BUILDING_REALISM,CITY_HORIZON';
const out = path.resolve(args.out || `.graphics-review/atmosphere-twilight/${label}`);
const pose = { lat:40.7095, lon:-74.0463, altM:1250*.3048, headingDeg:260 };
const date = args.date || '2026-10-31';
const elevations = String(args.elevations || '3,0,-3,-6,-12').split(',').map(Number);
const mobile = args.mobile === true || args.mobile === '1';
const viewport = { width:Number(args.width||(mobile?430:1440)), height:Number(args.height||(mobile?932:1000)) };
const quality = args.quality || 'high';
const sourceFiles=['lib/fly/cinema-frame.js','lib/fly/cinema-environment.js','lib/fly/cinema-sky.js','lib/fly/architectural-daylight.js','lib/fly/atmosphere/runtime.js','lib/fly/atmosphere/model.js','lib/fly/atmosphere/gpu.js','lib/fly/atmosphere/glsl.js','lib/fly/atmosphere/twilight-balance.js','lib/fly/living-ground.js','lib/fly/night-lights-atlas.js','lib/fly/sky-lite.js','lib/fly/fly-constants.js','components/fly/AtmosphereRig.jsx','components/fly/AerialPerspective.jsx'];
const hashes=()=>Object.fromEntries(sourceFiles.map(f=>[f,fs.existsSync(f)?crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'):null]));
const report={label,url,flags,date,pose,viewport,quality,mobileEmulation:mobile,venue:'Installed Chrome / RTX 5080 D3D11 / live world; fixed camera, actual solar ephemeris, running animation clock; mobile emulation is not iPhone/Safari acceptance',source:hashes(),captures:[],errors:[],warnings:[],providers:{}};
fs.mkdirSync(out,{recursive:true});
const save=()=>fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(report,null,2));
let current='boot';
async function imageMetrics(file){
 const{data,info}=await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const regions={horizonBand:[0,.45,1,.025],nearCity:[.60,.65,.35,.25]};
 return Object.fromEntries(Object.entries(regions).map(([name,r])=>{
  const[left,top,width,height]=[Math.round(r[0]*info.width),Math.round(r[1]*info.height),Math.round(r[2]*info.width),Math.round(r[3]*info.height)];
  let sum=0,count=0;const rgb=[0,0,0];
  for(let y=top;y<top+height;y++)for(let x=left;x<left+width;x++){const i=(y*info.width+x)*info.channels;for(let c=0;c<3;c++)rgb[c]+=data[i+c];sum+=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];count++;}
  return[name,{region:{left,top,width,height},meanLuma:sum/count,meanRGB:rgb.map(v=>v/count),space:'display sRGB byte luma,0–255'}];
 }));
}

async function telemetry(page){
 return page.evaluate(()=>{
  const r=window.__fly,s=window.__flyStore.getState();let scene=r.engine.object;while(scene.parent)scene=scene.parent;
  const root=scene.__r3f?.root?.getState(),gl=root?.gl;
  const simple=v=>{if(v?.isTexture)return{texture:true,id:v.id,width:v.image?.width,height:v.image?.height,version:v.version};if(v?.toArray)return v.toArray();if(typeof v==='number'||typeof v==='boolean'||v==null)return v;return undefined;};
  const physical={},materials=[];
  scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m)continue;const u=m.uniforms||gl?.properties.get(m)?.uniforms;if(!u?.uPskyEye)continue;if(materials.length<8)materials.push({name:o.name,material:m.name,type:m.type,key:m.customProgramCacheKey?.()});for(const[k,v]of Object.entries(u))if(/^uPsky|^uCinema(Air|Light|Horizon|Zenith|Optics)/.test(k))physical[k]=simple(v.value);}});
  const stats=window.__flyStats||{};
  const effects=[];
  for(const pass of window.__flyComposer?.passes||[]){
   for(const effect of pass.effects||[]){
    const source=effect.getFragmentShader?.()||effect.fragmentShader||'';
    const u=effect.uniforms instanceof Map?Object.fromEntries(effect.uniforms):effect.uniforms||{};
    if(!/lgEmit|uR25Mode|livingGround/.test(source)&&!u.uR25Mode)continue;
    effects.push({name:effect.name,uniforms:Object.fromEntries(Object.entries(u).filter(([k])=>/^uR25|^uLiving|^uMaxMix|^uNL|^uGM/.test(k)).map(([k,v])=>[k,simple(v.value)])),emitterLines:source.split('\n').filter(line=>/lgEmit|uR25WorldFade|uR25Mode|nlGrazingVisibility/.test(line))});
   }
  }
  return {sun:r.sun,actualElevation:Math.asin(r.sun?.sinEl)*180/Math.PI,environment:r.cinemaEnvironment,physSky:r.physSky,physicalUniforms:physical,physicalMaterials:materials,
   aerialEffects:effects,
   urlFlags:window.__flyUrlFlags,flagPins:{PHYS_SKY:window.__flyPhysSkyOverride,SKY_LITE:window.__flySkyLiteOverride,BUILDING_REALISM:window.__flyBuildingRealismOverride,CITY_HORIZON:window.__flyCityHorizonOverride},livingGround:window.__flyLivingGround?.stats?.(),livingGroundBlocks:window.__flyLivingGround?.blocks,
   camera:{position:r.camera.position.toArray(),quaternion:r.camera.quaternion.toArray(),fov:r.camera.fov},geo:r.geo?.toArray?.()??r.geo,
   quality:s.qualityTier,visuals:s.visuals,clock:root?.clock?.elapsedTime,
   render:gl?{...gl.info.render,memory:{...gl.info.memory},programs:gl.info.programs.length}:null,
   terrain:r.terraStats,streamers:Object.fromEntries(['satBuildings','satSkyline','satRoads','satVeg'].map(k=>[k,r[k]?.stats??null])),
   stats:Object.fromEntries(Object.entries(stats).filter(([k])=>/aerial|haze|sky|tone|grade|sun|atmo|phys|environment/i.test(k)))};
 });
}

async function waitWorld(page){
 const t0=Date.now();
 await page.waitForFunction(()=>{
  const r=window.__fly;if(!r||r.worldLoading||!r.terraStats?.sharp)return false;
  for(const k of ['satBuildings','satSkyline','satRoads','satVeg']){const s=r[k]?.stats;if(s&&['queued','building','sampling','draping','births','dying'].some(f=>Number(s[f]||0)!==0))return false;}
  return true;
 },undefined,{timeout:150000,polling:1000});
 return Date.now()-t0;
}

(async()=>{
 register('./_node-resolve.mjs',pathToFileURL(__filename));
 const {computeSun}=await import('../lib/fly/sun-model.js');
 const day=Date.parse(date+'T00:00:00Z');
 const samples=elevations.map(el=>{
  let lo=day+17*3600000,hi=day+27*3600000;
  for(let i=0;i<50;i++){const mid=(lo+hi)/2,actual=Math.asin(computeSun(pose.lon,pose.lat,mid).sinEl)*180/Math.PI;if(actual>el)lo=mid;else hi=mid;}
  const utc=Math.round((lo+hi)/2);return{el,utc,iso:new Date(utc).toISOString(),id:`sun-${el<0?'minus':'plus'}${Math.abs(el)}`};
 });
 report.samples=samples;save();
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true,args:['--use-angle=d3d11','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--remote-debugging-port=9224']});
 let page;
 try{
  page=await browser.newPage({viewport,deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
  page.on('pageerror',e=>{report.errors.push({scene:current,kind:'pageerror',message:e.message});save();});
  page.on('console',m=>{const t=m.text();if(m.type()==='error'&&/shader|WebGL|GLSL|ReferenceError|TypeError/i.test(t)){report.errors.push({scene:current,kind:'console',message:t.slice(0,2500)});save();}else if(['error','warning'].includes(m.type())&&report.warnings.length<80)report.warnings.push({scene:current,level:m.type(),message:t.slice(0,900)});});
  page.on('response',res=>{const h=new URL(res.url()).hostname;if(/arcgis|openfreemap/.test(h)){const k=`${h}:${res.status()}`;report.providers[k]=(report.providers[k]||0)+1;}});
  await page.addInitScript(({quality,sun,mobile})=>{window.__flyGovPin='hold';window.__flyVisualsOverride='enhanced';window.__flyTitleBypass=true;window.__flyBoostInfinite=true;window.__flySunOverride=sun;window.__flyWeatherOverride='baseline';if(mobile){window.__flyDeviceClassOverride='phone';window.__flyCityDeviceClass='phone';}try{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier',quality);localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-explorer-preferences-v1',JSON.stringify({version:1,settings:{tutorial:'done'}}));}catch{}},{quality,sun:samples[0].utc,mobile});
  await page.route('**/api/aircraft?**',r=>r.fulfill({json:{ac:[],now:Date.now(),total:0,source:'twilight review'}}));
  await page.route('**/api/weather**',r=>r.fulfill({json:{found:false}}));
  await page.goto(`${url}/?graphicsReview=1&flags=${encodeURIComponent(flags)}`,{waitUntil:'domcontentloaded',timeout:180000});
  console.log(`BOOT ${label} loaded`);
  await page.waitForFunction(()=>!!window.__fly?.operations&&!!window.__flyStore,undefined,{timeout:180000});
  await page.evaluate(p=>{
   const r=window.__fly,s=window.__flyStore.getState();r.operations.phase='airborne';r.operations.profile=null;r.operations.warp(r.flight);s.setHangarOpen(false);s.setPhase('flying');
   r.warpToGeo(p.lat,p.lon,{altM:p.altM,headingRad:p.headingDeg*Math.PI/180,name:null});r.autopilot?.disengage?.();
   const f=r.flight,held={x:f.pos.x,y:f.pos.y,z:f.pos.z,heading:p.headingDeg*Math.PI/180};
   const step=f.step.bind(f);f.step=(dt,c)=>{step(dt,{...c,turn:0,pitch:0,boost:false});f.pos.x=held.x;f.pos.y=held.y;f.pos.z=held.z;f.heading=held.heading;f.bank=0;f.pitch=.02;f.agl=f.pos.y-f.groundElev;};r.chaseCam?.snap?.();
   let scene=r.engine.object;while(scene.parent)scene=scene.parent;const root=scene.__r3f.root.getState();root.gl.domElement.setAttribute('data-twilight-canvas','');
   Object.defineProperty(r.camera,'fov',{configurable:true,get:()=>60,set:()=>{}});r.camera.updateProjectionMatrix();
  },pose);
  report.worldSettleMs=await waitWorld(page);console.log(`BOOT ${label} settled ${report.worldSettleMs}ms`);
  report.gpu=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL);});
  for(const sample of samples){
   current=sample.id;await page.evaluate(utc=>{window.__flySunOverride=utc;},sample.utc);
   await page.waitForFunction(el=>Math.abs(Math.asin(window.__fly.sun.sinEl)*180/Math.PI-el)<.002,sample.el,{timeout:15000,polling:250});
   await page.waitForTimeout(Number(args.settle||8000));
   const t=await telemetry(page),file=sample.id+'.png';
   await page.screenshot({path:path.join(out,file),timeout:60000,style:'body *{visibility:hidden!important}canvas[data-twilight-canvas]{visibility:visible!important}'});
   report.captures.push({sample,file,telemetry:t,metrics:await imageMetrics(path.join(out,file))});save();
   console.log(`CAPTURE ${label} ${file} ${JSON.stringify({elevation:t.actualElevation,day:t.environment?.day,night:t.environment?.night,golden:t.environment?.golden,physSky:t.physSky,eye:t.physicalUniforms.uPskyEye,horizon:t.environment?.horizon,zenith:t.environment?.zenith})}`);
  }
  if(Number(args.hold)>0){console.log(`HOLD ${label} ${args.hold}ms; CDP localhost:9224`);await page.waitForTimeout(Number(args.hold));}
 }catch(e){report.errors.push({scene:current,kind:'fatal',message:e.message});if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.error(e.message);}
 finally{report.sourceAtEnd=hashes();report.sourceChanged=sourceFiles.filter(f=>report.source[f]!==report.sourceAtEnd[f]);save();await browser.close();console.log(`DONE ${label}: ${report.captures.length} captures; ${report.errors.length} errors; changed sources ${report.sourceChanged.join(',')||'none'}`);if(report.errors.length||report.sourceChanged.length)process.exitCode=1;}
})().catch(e=>{report.errors.push({kind:'fatal',message:e.message});save();console.error(e);process.exitCode=1;});

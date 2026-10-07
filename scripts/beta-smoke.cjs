/* Production fixture checks: real emitted JavaScript, workers and WebGL.
 * SwiftShader / viewport emulation prove correctness, never device performance. */
const {spawn}=require('node:child_process');
const {mkdirSync,writeFileSync,readdirSync,readFileSync}=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {attachFixture,fixturePin}=require('./_fixture');
const OUT=path.resolve('.graphics-review/beta');mkdirSync(OUT,{recursive:true});
const PORT=Number(process.env.PORT||3094),base=`http://127.0.0.1:${PORT}`;
const flags=process.env.BETA_FLAGS||'';
const rows=[];
function check(name,ok,detail){rows.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`);if(!ok)throw Error(name);}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function ready(){for(let i=0;i<120;i++){try{if((await fetch(base)).ok)return;}catch{}await delay(500);}throw Error('Production server did not become ready');}
(async()=>{
 let server,browser,fixture,page;let log='',renderer='unavailable';
 try{
  if(!process.env.BETA_EXTERNAL_SERVER){server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT)],{env:{...process.env,FLY_BUILD_DIR:'.next-explorer',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});server.stdout.on('data',b=>{log+=b;});server.stderr.on('data',b=>{log+=b;});}
  await ready();
  browser=await chromium.launch({args:[...(process.env.BETA_SOFTWARE==='1'?['--use-angle=swiftshader']:process.platform==='win32'?['--use-angle=d3d11']:[]),'--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  fixture=await attachFixture(context);
  await context.addInitScript(pin=>{window.__flyTileFixture=pin;localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-quality-tier','low');},fixturePin(fixture.url));
  page=await context.newPage();const errors=[];page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));
  // Review exposes the existing diagnostic handles. No feature, world-style,
  // title-bypass or quality-governor pins are applied.
  await page.goto(base+'/?graphicsReview=1'+(flags?'&flags='+encodeURIComponent(flags):''),{waitUntil:'domcontentloaded'});
  await page.getByTestId('title-screen').waitFor({timeout:60000});
  renderer=await page.evaluate(()=>{const g=document.createElement('canvas').getContext('webgl2');const e=g?.getExtension('WEBGL_debug_renderer_info');const name=e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown';g?.getExtension('WEBGL_lose_context')?.loseContext();return name;});
  console.log('Renderer',renderer);
  check('production title offers destination discovery',await page.getByTestId('title-explore').isVisible());
  await page.getByTestId('title-settings').click();
  await page.getByLabel('Steering sensitivity',{exact:true}).fill('1.25');
  await page.getByLabel('Invert pitch',{exact:true}).check();
  check('comfort settings persist',await page.evaluate(()=>JSON.parse(localStorage.getItem('fly-explorer-preferences-v1')).settings.invertPitch));
  await page.getByTestId('settings-close').click();
  await page.getByTestId('title-logbook').click();
  await page.getByText('Your world, one flight at a time',{exact:true}).waitFor();
  check('journal has six regional collections',await page.locator('.explorer-collections article').count()===6);
  await page.screenshot({path:path.join(OUT,'journal-desktop.png'),timeout:30000});
  await page.keyboard.press('Escape');
  await page.getByTestId('title-takeoff-landing').click();
  await page.getByTestId('hangar').waitFor();
  await page.getByLabel('Find an airport or runway').fill('LOWI');
  await page.getByRole('button').filter({hasText:'Innsbruck'}).first().click();
  await page.waitForFunction(()=>document.querySelector('#departure-airport')?.value.startsWith('LOWI:'));
  check('regional airport loads into preparation',await page.locator('#departure-airport').inputValue().then(v=>v.startsWith('LOWI:')));
  check('generic airport does not promise apron operations',await page.getByRole('button',{name:'Apron',exact:true}).count()===0);
  await page.screenshot({path:path.join(OUT,'airport-desktop.png'),timeout:30000});
  // Execute the actual webpack worker asset, using Comlink's wire protocol.
  // This catches errors hidden by a successful bundler/static lint pass.
  const chunks=path.resolve('.next-explorer/static/chunks');
  const workerModule=readdirSync(chunks).find(f=>f.endsWith('.js')&&readFileSync(path.join(chunks,f),'utf8').includes('async buildTile('));
  const moduleId=workerModule?.split('.')[0];
  // Webpack splits the worker module from its executable bootstrap. Loading
  // the module chunk alone only registers factories and cannot answer RPCs.
  const workerFile=moduleId&&readdirSync(chunks).find(f=>{if(!f.endsWith('.js'))return false;const code=readFileSync(path.join(chunks,f),'utf8');return code.includes('importScripts(')&&code.includes(`.e(${moduleId})`);});
  check('production vector worker asset located',!!workerFile,workerFile);
  const worker=await page.evaluate(async file=>{
    const w=new Worker('/_next/static/chunks/'+file);let n=0;
    const rpc=(method,args=[])=>new Promise((resolve,reject)=>{const id=String(++n),timer=setTimeout(()=>{w.removeEventListener('message',message);reject(Error('worker RPC timeout '+method));},30000);const message=e=>{if(e.data.id!==id)return;clearTimeout(timer);w.removeEventListener('message',message);e.data.type==='HANDLER'?reject(Error(JSON.stringify(e.data.value))):resolve(e.data.value);};w.addEventListener('message',message);w.postMessage({id,type:'APPLY',path:[method],argumentList:args.map(value=>({type:'RAW',value}))});});
    try{await rpc('init');const z=14,lon=-73.9857,lat=40.7484,x=Math.floor((lon+180)/360*2**z),y=Math.floor((1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2*2**z);const tile=await rpc('buildTile',[z,x,y,'full',{}]);return {empty:tile.empty,vertices:tile.building?.pos?.length||tile.land?.pos?.length||0,keys:Object.keys(tile)};}finally{w.terminate();}
  },workerFile);
  check('bundled worker builds real fixture geometry',worker.vertices>0&&!worker.empty,worker);
  await page.getByTestId('hangar-back').click();
  await page.getByTestId('title-explore').click();
  await page.getByTestId('hangar-fly').click();
  await page.getByTestId('explorer-guide').waitFor({timeout:90000});
  check('first flight starts with skippable guidance',await page.getByRole('button',{name:'Skip tips',exact:true}).isVisible());
  await page.getByRole('button',{name:'Skip tips',exact:true}).click();
  await page.waitForFunction(()=>window.__fly?.worldLoading!==true&&window.__flyBoot?.pct===100);
  await page.keyboard.press('p');await page.getByTestId('photo-composition').waitFor();
  check('photo mode uses its own weather controls without a competing pause shortcut',await page.getByTestId('flight-conditions').count()===0);
  const frozen=await page.evaluate(()=>({position:window.__fly.flight.pos.toArray(),time:window.__fly.explorerVisualTime}));
  await delay(2000);
  check('photo composition freezes flight and local animation time',await page.evaluate(before=>{const r=window.__fly;return r.flight.pos.toArray().every((v,i)=>v===before.position[i])&&r.explorerVisualTime===before.time;},frozen));
  await page.getByTestId('photo-conditions').click();
  await page.getByTestId('conditions-weather-fog').click();
  await page.waitForFunction(()=>window.__fly.weather.wx.fogT===1);
  await page.getByTestId('conditions-weather-clear').click();
  await page.waitForFunction(()=>window.__fly.weather.wx.fogT===0&&window.__fly.weather.wx.source==='player');
  check('manual weather changes apply inside frozen photo mode',await page.getByTestId('conditions-weather-clear').getAttribute('aria-pressed')==='true');
  await page.getByTestId('conditions-time').fill('0');
  await page.waitForFunction(()=>window.__fly.sun.sinEl<-.3);
  await page.getByTestId('conditions-time').fill('12');
  await page.waitForFunction(()=>window.__fly.sun.sinEl>.3);
  check('photo time changes relight the scene without moving the aircraft',await page.evaluate(before=>{const r=window.__fly;return r.flight.pos.toArray().every((v,i)=>v===before.position[i])&&r.explorerVisualTime===before.time;},frozen));
  await page.getByTestId('photo-conditions').click();
  // The failed encode must not earn a photograph or leave the shutter busy.
  await page.evaluate(()=>{window.__betaToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);};});
  await page.getByTestId('photo-shutter').click();await page.getByText('capture failed',{exact:true}).first().waitFor();
  check('failed photo encoding awards no photograph',await page.evaluate(()=>!(JSON.parse(localStorage.getItem('fly-exploration-v1')||'{"photos":[]}').photos?.length)));
  await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=window.__betaToBlob;delete window.__betaToBlob;});
  const downloading=page.waitForEvent('download');await page.getByTestId('photo-shutter').click();const download=await downloading;
  await download.saveAs(path.join(OUT,'flight-memory.png'));
  check('photo export produces a PNG',download.suggestedFilename().endsWith('.png'));
  await page.getByTestId('photo-exit').click();
  await page.getByTestId('flight-conditions').click();
  check('weather is immediately reachable from the flight HUD',await page.getByTestId('conditions-panel').isVisible());
  await page.getByTestId('conditions-weather-live').click();
  await page.getByTestId('conditions-time-live').click();
  await page.getByRole('button',{name:'Resume',exact:true}).click();
  await page.waitForFunction(()=>window.__fly.weather.wx.source!=='player');
  check('returning to Live resumes weather after photo composition',await page.evaluate(()=>window.__flyStore.getState().conditionsWeather===null&&window.__flyStore.getState().conditionsHour===null));
  await page.keyboard.press('l');
  await page.locator('.explorer-photos figure').first().waitFor();
  check('successful photograph appears in the journal',await page.locator('.explorer-photos figure').count()===1);
  await page.screenshot({path:path.join(OUT,'memory-journal.png'),timeout:30000});await page.keyboard.press('Escape');
  await context.route('**/api/aircraft?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ac:[],availability:'unavailable',error:'offline'})}));
  await page.getByText('Live traffic is unavailable. You can keep exploring.',{exact:true}).waitFor({timeout:60000});
  check('feed loss leaves exploration available',await page.getByTestId('title-screen').count()===0);
  await page.evaluate(()=>{const gl=[...document.querySelectorAll('canvas')].map(c=>c.getContext('webgl2')).find(Boolean);window.__betaContext=gl.getExtension('WEBGL_lose_context');if(!window.__betaContext)throw Error('Context-loss extension missing');window.__betaContext.loseContext();});
  await page.getByRole('alertdialog',{name:'Graphics recovery'}).waitFor();
  check('context loss exposes a recovery action',await page.getByRole('button',{name:'Restart Skyloom',exact:true}).isVisible());
  await page.evaluate(()=>window.__betaContext.restoreContext());await page.getByRole('button',{name:'Resume flight',exact:true}).click();
  check('restored graphics resume through an explicit action',await page.getByRole('alertdialog',{name:'Graphics recovery'}).count()===0);
  await context.close();
  const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});await attachFixture(phone);
  await phone.addInitScript(pin=>{window.__flyTileFixture=pin;localStorage.setItem('fly-quality-tier','low');Object.defineProperty(navigator,'webdriver',{get:()=>false});},fixturePin(fixture.url));
  const p=await phone.newPage();p.setDefaultTimeout(90000);p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/'+(flags?'?flags='+encodeURIComponent(flags):''),{waitUntil:'domcontentloaded'});await p.getByTestId('title-explore').waitFor({timeout:60000});
  check('phone viewport title has no horizontal overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.getByTestId('title-settings').click();await p.getByLabel('Steering sensitivity',{exact:true}).waitFor();
  check('ordinary players retain visual choices without review or automation exceptions',await p.getByTestId('settings-visuals-classic').isVisible()&&await p.getByTestId('settings-visuals-enhanced').isVisible());
  await p.screenshot({path:path.join(OUT,'settings-phone.png'),timeout:30000});
  await p.getByTestId('settings-close').click();await p.getByTestId('title-explore').click();await p.getByTestId('hangar').waitFor();await p.screenshot({path:path.join(OUT,'prepare-phone.png'),timeout:30000});
  check('phone preparation supports the same destination flow',await p.getByTestId('hangar-mode').getAttribute('data-mode')==='free');
  check('production browser has no uncaught errors',errors.length===0,errors);
  await phone.close();
 }catch(e){rows.push({name:'smoke completed',ok:false,detail:e.stack});console.error(e.message);if(page&&!page.isClosed()){await page.screenshot({path:path.join(OUT,'failure.png'),timeout:10000}).catch(()=>{});const state=await page.evaluate(()=>({boot:window.__flyBoot,loading:window.__fly?.worldLoading,phase:window.__flyStore?.getState().phase,camera:window.__flyStore?.getState().cameraMode,screen:window.__flyStore?.getState().screen})).catch(()=>null);console.error('Failure state',state);}process.exitCode=1;}
 finally{await browser?.close();await fixture?.close();server?.kill();writeFileSync(path.join(OUT,'production-server.log'),log);writeFileSync(path.join(OUT,'smoke.json'),JSON.stringify({at:new Date().toISOString(),venue:renderer+'; phone viewport emulated',flags,rows},null,2));}
})();

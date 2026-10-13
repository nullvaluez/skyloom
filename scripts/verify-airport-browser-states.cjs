// Airport observation — provider states and safety (desktop Chrome, mocked /api/aircraft).
//
// The aircraft proxy is mocked through four states (quiet, fresh, delayed,
// unavailable) so every lounge state is deterministic: a quiet airport stays
// usable; the browser shows featured lounges with a live clock and the
// golden-hour list; the board and spotter card reach the existing dossier;
// unsafe joins never move the player; delayed and unavailable feeds read
// distinctly; interface keys never steer; a safe join reaches the Escort and
// returns without rewards; an ultrawide HUD click never opens a dossier.
//
//   FLY_URL=http://localhost:3142/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on node scripts/verify-airport-browser-states.cjs
const {chromium}=require('playwright'),fs=require('fs');
const out='.graphics-review/living-airports',report={checks:[],errors:[],fixture:'Deterministic API responses through the existing aircraft worker and traffic pipeline.'};
fs.mkdirSync(out,{recursive:true});
let mode='quiet',contact=null;
const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);if(!pass)process.exitCode=1;};
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>report.errors.push(e.message));try{
 await page.addInitScript(()=>{window.__flyVisualsOverride='enhanced';localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');});
 await page.route('**/api/aircraft?**',route=>route.fulfill({json:{ac:mode==='quiet'||mode==='unavailable'?[]:[contact],now:Date.now()-(mode==='delayed'?40000:0),source:'QA airport fixture',...(mode==='delayed'?{error:'serving_stale'}:mode==='unavailable'?{error:'upstream_unavailable'}:{})}}));
 await page.goto(process.env.FLY_URL||'http://localhost:3097/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on');
 await page.waitForFunction(()=>!!window.__fly?.airportWatch,undefined,{timeout:120000});
 const journalBefore=await page.evaluate(()=>localStorage.getItem('fly-exploration-v1'));
 await page.getByTestId('watch-airport').click();
 await page.getByTestId('golden-hour-list').waitFor({timeout:20000});
 await page.waitForFunction(()=>!/Reading the sun/.test(document.querySelector('[data-testid=golden-hour-list]')?.innerText||''),undefined,{timeout:20000});
 check('the browser offers featured lounges with a local clock',/\d\d:\d\d/.test(await page.getByTestId('airport-featured-KCMH').innerText()));
 check('the golden-hour list answers from the live sun (rows or an honest empty state)',await page.getByTestId('golden-hour-list').locator('button,p').count()>0);
 await page.getByRole('button',{name:/KCMH Columbus/}).click();
 await page.waitForFunction(()=>window.__flyBoot?.pct===100&&!window.__fly.worldLoading,undefined,{timeout:90000});
 await page.getByTestId('warp-hold').waitFor({state:'hidden',timeout:10000});
 await page.waitForFunction(()=>document.body.innerText.includes('Live · quiet skies'),undefined,{timeout:20000});check('a genuinely quiet airport remains usable',await page.getByRole('button',{name:'Photo',exact:true}).isEnabled());
 check('the live board is up with an honest empty state',await page.getByTestId('lounge-board').isVisible());
 contact=await page.evaluate(()=>{const r=window.__fly,g=r.engine.worldToGeo(r.airportWatch.center);return {hex:'a0b1c2',flight:'QA SKY',r:'QA-TEST',t:'A320',lat:g.y,lon:g.x+.01,alt_baro:5500,alt_geom:5500,gs:r.flight.cfg.speeds.cruise/.514444,track:90,baro_rate:0,seen:0,seen_pos:0,type:'adsb_icao',category:'A3'};});mode='fresh';
 await page.waitForFunction(()=>window.__fly.traffic.tracks.get('a0b1c2')?.stale===0&&window.__fly.trafficStatus.state==='live',undefined,{timeout:20000});
 // A hover resolved by the world label canvas must not intercept a HUD click.
 // Before the overlay exclusion this opened the dossier on pointerdown and
 // shifted Photo away before pointerup, losing the first click at ultrawide.
 await page.setViewportSize({width:5120,height:1440});
 await page.evaluate(()=>{document.addEventListener('pointerdown',()=>{window.__fly.hoverHex='a0b1c2';},{once:true,capture:true});});
 const [photo]=await Promise.all([page.waitForEvent('download',{timeout:45000}),page.getByRole('button',{name:'Photo',exact:true}).click()]);
 await photo.delete();
 check('ultrawide Photo click cannot open a hovered aircraft dossier',await page.evaluate(()=>!window.__flyStore.getState().inspectHex));
 await page.setViewportSize({width:1920,height:1080});
 // The board lists the fixture (level flight nearby: Overhead, low level).
 let listed=false;
 for(const tab of ['arrivals','departures','ground','overhead']){await page.getByTestId(`lounge-board-tab-${tab}`).click();if(await page.getByTestId('lounge-board-row-a0b1c2').count()){listed=true;break;}}
 check('the fresh contact is on the live board',listed);
 if(listed)await page.getByTestId('lounge-board-row-a0b1c2').click();else await page.evaluate(()=>window.__fly.airportWatch.select('a0b1c2'));
 check('a board row opens the spotter card',await page.getByTestId('spotter-card').filter({hasText:'QA SKY'}).isVisible());
 await page.getByTestId('spotter-details').click();check('fresh contact opens the existing dossier',await page.getByTestId('inspect-card').isVisible());
 const reject=async(kind)=>page.evaluate(kind=>{const r=window.__fly,t=r.traffic.tracks.get('a0b1c2'),before=r.flight.pos.clone(),s=window.__flyStore.getState(),ground=r.engine.getGroundAt;const old={flags:t.flags,stale:t.stale,aircraft:s.aircraftId};if(kind==='ground')t.flags|=1;if(kind==='stale')t.stale=1;if(kind==='terrain')r.engine.getGroundAt=()=>null;if(kind==='glider')window.__flyStore.setState({aircraftId:'glider'});const result=r.airportWatch.join(t.hex);t.flags=old.flags;t.stale=old.stale;r.engine.getGroundAt=ground;window.__flyStore.setState({aircraftId:old.aircraft});return {pass:!result.ok&&r.airportWatch.active&&r.flight.pos.distanceTo(before)<.01,message:result.message};},kind);
 for(const kind of ['ground','stale','terrain','glider']){const result=await reject(kind);check(`${kind} contact cannot move the player`,result.pass,result.message);}
 mode='delayed';await page.waitForFunction(()=>document.querySelector('.airport-watch-header')?.innerText.includes('Positions delayed'),undefined,{timeout:20000});check('delayed provider state is visible',(await page.locator('.airport-watch-header').innerText()).includes('Positions delayed'));
 check('delayed feed prevents join',!(await page.evaluate(()=>window.__fly.airportWatch.join('a0b1c2'))).ok);
 mode='unavailable';await page.waitForFunction(()=>window.__fly.trafficStatus.state==='unavailable',undefined,{timeout:25000});await page.waitForTimeout(1200);check('provider failure is distinct from quiet',(await page.locator('.airport-watch-header').innerText()).includes('Traffic connection unavailable'));
 mode='fresh';await page.waitForFunction(()=>window.__fly.trafficStatus.state==='live'&&window.__fly.traffic.tracks.get('a0b1c2')?.stale===0,undefined,{timeout:25000});
 if(!(await page.getByTestId('inspect-card').count()))await page.evaluate(()=>window.__flyStore.getState().setInspectHex('a0b1c2'));
 await page.getByTestId('inspect-warp').click();
 check('fresh tracking keeps the airport camera owner',await page.evaluate(()=>window.__fly.airportWatch.active&&window.__fly.airportWatch.tracking));
 await page.getByRole('button',{name:'Face the runway',exact:true}).focus();await page.keyboard.press('w');
 check('interface keys do not leak into steering',await page.evaluate(()=>!window.__fly.input.keys.has('w')));
 const scoreBefore=await page.evaluate(()=>window.__flyStore.getState().sessionScore);
 check('Explorer tutorial stays out of the seated lounge',await page.getByTestId('explorer-guide').count()===0);
 const result=await page.evaluate(()=>window.__fly.airportWatch.join('a0b1c2'));check('terrain-safe join reaches actual Escort',result.ok,result);
 if(result.ok){await page.waitForTimeout(9500);check('join owns existing autopilot and keeps an airport return',await page.evaluate(()=>!!window.__fly.escort&&!!window.__flyStore.getState().airportReturn&&!window.__fly.airportWatch.active));check('joining does not grant session points',await page.evaluate(()=>window.__flyStore.getState().sessionScore)===scoreBefore);await page.getByRole('button',{name:'← Return to the lounge',exact:true}).click();await page.waitForFunction(()=>window.__fly.airportWatch.active,undefined,{timeout:30000});check('return restores observation and releases Escort',await page.evaluate(()=>!window.__fly.escort&&window.__fly.autopilot.mode==='off'));}
 check('observation, photography and joining do not add Explorer rewards',await page.evaluate(()=>localStorage.getItem('fly-exploration-v1'))===journalBefore);
 check('no browser errors',report.errors.length===0,report.errors);
}catch(e){report.failure=e.stack;console.error(e);process.exitCode=1;}finally{fs.writeFileSync(`${out}/browser-states-report.json`,JSON.stringify(report,null,2));await browser.close();}
const passed=report.checks.filter(c=>c.pass).length;console.log(`AIRPORT BROWSER STATES: ${passed}/${report.checks.length}`);})();

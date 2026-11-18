// Two camera views on the same approach. Both arms use the earlier cockpit
// and clarity flags; only the new relief treatment varies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { enterFlight } = require('./_skip-menus');

const root = path.resolve('.graphics-review/paris-relief');
const approach = { lat: 48.8784, lon: 2.2539, altM: 1103 * .3048, headingDeg: 339, name: null };
const panorama = { lat: 48.835, lon: 2.246, altM: 1160, headingDeg: 17, name: null };
async function compare() {
  const reports = ['before','after'].map(arm => JSON.parse(fs.readFileSync(path.join(root,arm,'flight.json'))));
  for (const name of ['approach','seine']) {
    const [a,b] = reports.map(r => r.shots[name]);
    for (const key of ['heading','speed','bank','pitch','fov','sun','dpr','pos','orientation']) {
      const left = [].concat(a[key]), right = [].concat(b[key]);
      assert.ok(left.every((v,i) => Math.abs(v-right[i]) < .0001), name+' camera/weather match: '+key);
    }
    assert.equal(a.tier,b.tier);
    assert.equal(a.sharp && b.sharp,true);
    assert.ok(b.clouds.reliefMapReady && b.clouds.reliefDaylight>.9);
  }
  for (const name of ['approach', 'seine', 'coaming','towers']) {
    const panels = [];
    for (const arm of ['before', 'after']) {
      const input = path.join(root, arm, name + '.png');
      const panel = await sharp(input).resize(810).png().toBuffer();
      panels.push(panel);
    }
    const { height } = await sharp(panels[0]).metadata();
    const label = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1628" height="36"><g font-family="Arial" font-size="18" fill="#ffffff"><text x="14" y="25">Before</text><text x="832" y="25">After</text></g></svg>');
    await sharp({ create: { width: 1628, height: height + 36, channels: 3, background: '#192029' } })
      .composite([{input: label, left: 0, top: 0}, {input: panels[0], left: 0, top: 36}, {input: panels[1], left: 818, top: 36}])
      .png().toFile(path.join(root, name + '-comparison.png'));
  }
}

async function main() {
  const [origin, arm] = process.argv.slice(2);
  if (origin === 'compare') return compare();
  assert.ok(['before','after'].includes(arm));
  const out = path.join(root, arm);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1672, height: 1224 }, deviceScaleFactor: 1 });
  const errors = [], shots = {};
  const textures = new Set();
  page.on('response', res => {
    if (res.ok()) textures.add(new URL(res.url()).pathname);
  });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error' && /shader|WebGL|GLSL|wp-reach/i.test(e.text())) errors.push(e.text()); });
  const link = new URL(origin);
  link.search = new URLSearchParams({ graphicsReview: '1', at: '48.8784,2.2539,1103', aircraft: 'f35',
    flags: 'F35_COCKPIT,FLIGHT_CLARITY,' + (arm === 'before' ? '-' : '') + 'FLIGHT_RELIEF',
    sunUtc: '2026-06-21T14:00:00Z', weather: 'baseline' });
  async function settle() {
    await page.waitForTimeout(3500);
    await page.waitForFunction(arm => {
      const r=window.__fly,b=r.satBuildings?.stats,s=r.satSkyline;
      return r.terraStats?.sharp && !r.worldLoading && !document.querySelector('[data-testid="warp-hold"]') &&
        (arm==='before' || (r.satBuildings?.material?.userData?.flightFacadeSurfaces?.state==='ready' && r.immersiveClouds?.reliefMapReady)) &&
        b?.ready >= 12 && s?.stats?.ready >= 20 && s?._photos?.stat?.fetched >= 24;
    }, arm, {timeout:150000});
    await page.waitForTimeout(5000);
  }
  async function capture(name) {
    shots[name] = await page.evaluate(() => {
      const r=window.__fly, f=r.flight, s=window.__flyStore.getState();
      const canvas=[...document.querySelectorAll('canvas')].find(c=>c.getContext('webgl2'));
      const gl=canvas.getContext('webgl2'), ext=gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu:ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), flags:window.__flyUrlFlags, heading:f.heading, pos:f.pos.toArray(),
        speed:f.speed, bank:f.bank, pitch:f.pitch, fov:r.camera.fov, orientation:r.camera.quaternion.toArray(),
        tier:s.qualityTier, dpr:canvas.width/canvas.clientWidth, sun:r.sun?.sinEl, photo:r.satSkyline?._photos?.stat,
        near:r.satBuildings?.stats?.ready, far:r.satSkyline?.stats?.ready, clouds:r.immersiveClouds,
        surfaces:r.satBuildings?.material?.userData?.flightFacadeSurfaces, sharp:r.terraStats?.sharp };
    });
    assert.ok(shots[name].sharp, name+' terrain is still refining');
    if (arm==='after') for (const asset of [
      '/materials/cockpit-v1/coaming.webp','/materials/cockpit-v1/edge.webp',
      '/materials/cinema-v1/day-cloud-relief.webp','/materials/cinema-v1/facade-surfaces.webp'
    ]) assert.ok(textures.has(asset),name+' must use '+asset);
    const png=await page.screenshot({ path:path.join(out,name+'.png'),style:'nextjs-portal{display:none!important}' });
    if(name==='approach') {
      await sharp(png).extract({left:220,top:660,width:1210,height:395}).png().toFile(path.join(out,'coaming.png'));
      await sharp(png).extract({left:584,top:470,width:810,height:260}).png().toFile(path.join(out,'towers.png'));
    }
    console.log(name, JSON.stringify({near:shots[name].near,far:shots[name].far,photo:shots[name].photo}));
  }
  try {
    // The changing live feed would otherwise put different contrails across
    // the sky in each arm. Geography, satellite imagery and DEMs stream live.
    await page.route('**/api/aircraft?*',route => route.fulfill({
      json:{ac:[],now:1782050400,source:'review'},status:200
    }));
    await page.addInitScript(() => {
      localStorage.setItem('fly-quality-tier','high'); localStorage.setItem('fly-sound-on','0');
      localStorage.setItem('fly-controls-seen','1');
      localStorage.setItem('fly-explorer-preferences-v1',JSON.stringify({version:1,settings:{tutorial:'done'}}));
      window.__flyGovPin='hold';
      window.__flyCloudFreeze=true;
    });
    await page.goto(link.href,{waitUntil:'domcontentloaded',timeout:150000});
    await page.waitForFunction(()=>window.__flyBoot?.pct===100 && window.__flyStore?.getState().screen==='flight',null,{timeout:180000});
    await enterFlight(page, approach);
    await page.evaluate(p => {
      const r=window.__fly,f=r.flight,step=f.step.bind(f);
      window.__releaseReliefPose = () => { f.step = step; };
      r.warpToGeo(p.lat,p.lon,{altM:p.altM,headingRad:p.headingDeg*Math.PI/180,name:null});
      window.__reliefPose = {p:f.pos.clone(), heading:p.headingDeg*Math.PI/180, bank:0, speed:126/1.94384449};
      window.__flyStore.getState().setSpotting(false);
      f.step = (dt,command) => {
        step(dt,command);
        const h=window.__reliefPose;
        f.pos.copy(h.p); f.heading=h.heading; f.pitch=0; f.bank=h.bank; f.speed=h.speed; f.turnRate=0; f.pitchRate=0;
        if(r.weather?.wx){r.weather.wx.windX=0;r.weather.wx.windZ=0;}
      };
    }, approach);
    await settle(); await capture('approach');
    await page.evaluate(p=>{
      const r=window.__fly, heading=p.headingDeg*Math.PI/180;
      assertWarp(r.warpToGeo(p.lat,p.lon,{altM:p.altM,headingRad:heading,name:null}));
      function assertWarp(ok){if(ok===false)throw Error('Paris warp refused');}
      window.__reliefPose={p:r.flight.pos.clone(),heading,bank:.115,speed:200};
    },panorama);
    await settle();
    await page.mouse.move(470,300);await page.mouse.down({button:'right'});
    await page.mouse.move(850,355,{steps:10});await settle();
    await capture('seine');await page.mouse.up({button:'right'});
    const motion = await page.evaluate(async () => {
      const r=window.__fly,start=r.flight.pos.clone();
      window.__releaseReliefPose();
      await new Promise(done => setTimeout(done,3500));
      return {travelWorldM:start.distanceTo(r.flight.pos), framesReady:r.satBuildings?.stats?.ready,
        surfaceState:r.satBuildings?.material?.userData?.flightFacadeSurfaces?.state};
    });
    assert.ok(motion.travelWorldM>10 && motion.framesReady>0,'flight advances with a resident city');
    if (arm==='after') assert.equal(motion.surfaceState,'ready');
    shots.flightResume=motion;
    assert.deepEqual(errors,[]);
  } finally {
    fs.writeFileSync(path.join(out,'flight.json'),JSON.stringify({arm,shots,errors},null,2));
    await browser.close();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

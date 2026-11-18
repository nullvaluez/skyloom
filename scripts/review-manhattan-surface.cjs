const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { enterFlight } = require('./_skip-menus');

const [origin, arm, mode = 'on', tier = 'auto', aircraft = 'fighter', governor = 'live'] = process.argv.slice(2);
// The user screenshot puts the Manhattan label 2.6 NM behind the aircraft.
// Latitude/longitude and exact angles are the reviewer's closest match.
const pose = { lat: 40.798, lon: -73.985, altM: 1930 * .3048, headingDeg: 25,
  speed: 350 / 1.94384449, bank: .95, pitch: -.065 };
const flags = 'F35_COCKPIT,FLIGHT_RELIEF,FLIGHT_CLARITY,' + (mode === 'off' ? '-' : '') + 'CITY_CONTINUITY';
const work = path.resolve('.graphics-review/manhattan-surface');
const output = path.join(work, arm ?? '', mode + '-' + tier);
const screenshotStyle = 'nextjs-portal{display:none!important}';

async function compare() {
  const paths = [arm ?? 'before-matched', mode === 'on' ? 'after-matched' : mode]
    .map(label => path.join(work,label,'on-ultra'));
  const reports = paths.map(dir => JSON.parse(fs.readFileSync(path.join(dir,'report.json'))));
  const [beforeImage,afterImage] = paths.map(dir => path.join(dir,'settled.png'));
  const { width,height } = await sharp(beforeImage).metadata();
  const size = await sharp(afterImage).metadata();
  assert.equal(size.width,width);
  assert.equal(size.height,height);
  assert.deepEqual(reports[0].pose, reports[1].pose);
  assert.ok(reports.every(report => report.stage === 'complete'));
  const proof = [];
  for (const shot of ['settled','endpoint']) {
    const [before, after] = reports.map(report => report[shot]);
    for (const key of ['pos','camera','cameraPos','bank','pitch','heading','speed','dpr']) {
      const left = [].concat(before[key]), right = [].concat(after[key]);
      assert.equal(left.length,right.length);
      assert.ok(left.every((value,i) => Math.abs(value-right[i]) < .001), shot + ': matched ' + key);
    }
    for (const state of [before, after]) {
      assert.equal(state.preset,'ultra');
      assert.equal(state.visuals,'enhanced');
      assert.equal(state.style,'satellite');
      assert.equal(state.aircraft,'fighter');
      for (const flag of ['F35_COCKPIT','FLIGHT_RELIEF','FLIGHT_CLARITY','CITY_CONTINUITY'])
        assert.equal(state.flags[flag],true);
    }
    assert.deepEqual(before.flags,after.flags);
    assert.equal(before.tier,after.tier);
    // A small FOV delta scales the perspective image about its center. At
    // the farthest corner this is still below one third of a native pixel.
    const fovScale = Math.tan(before.fov*Math.PI/360)/Math.tan(after.fov*Math.PI/360);
    const projectionDeltaPx = Math.abs(fovScale-1)*Math.hypot(width/2,height/2);
    assert.ok(projectionDeltaPx < .33,shot + ': subpixel projected FOV difference');
    const failed = before.programs.find(program => program.city && !program.linked && program.draws > 0);
    const working = after.programs.find(program => program.city && program.linked && program.draws > 0 &&
      program.passes.some(pass => pass.grade && pass.sharedAtlas));
    assert.ok(failed && /MAX_TEXTURE_IMAGE_UNITS/.test(failed.programLog ?? reports[0].console.join('\n')),
      shot + ': before submits draws to the over-limit terrain program');
    assert.ok(working,shot + ': after links and draws the shared-atlas terrain program');
    assert.ok(!after.programs.some(program => program.city && !program.linked && program.draws > 0));
    proof.push({ shot, beforeAttempts:failed.draws, afterDraws:working.draws,
      projectionDeltaPx, renderDpr:[before.dpr,after.dpr],
      imagery:[before.terrain.imagery,after.terrain.imagery] });
  }
  assert.ok(!reports[1].console.some(error => /shader|glsl|webglprogram/i.test(error)));
  const gap = 8, bar = 36;
  const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width * 2 + gap}" height="${bar}">
    <g font-family="Arial" font-size="20" fill="#ffffff"><text x="18" y="25">Before · Ultra</text>
    <text x="${width + gap + 18}" y="25">After · Ultra</text></g></svg>`);
  const comparison = path.join(work,'ultra-terrain-comparison.png');
  await sharp({create:{width:width * 2 + gap,height:height + bar,channels:3,background:'#172028'}})
    .composite([{input:labels,left:0,top:0},{input:beforeImage,left:0,top:bar},
      {input:afterImage,left:width + gap,top:bar}]).png().toFile(comparison);
  console.log(JSON.stringify({ comparison, matched:proof },null,2));
}

async function main() {
  if (origin === 'compare') return compare();
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1672, height: 1000 }, deviceScaleFactor: 1 });
  const report = { origin, arm, flags, tier, aircraft, governor, pose, samples: [], console: [], sourceFailures: [] };
  page.on('pageerror', error => report.console.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /shader|GLSL|WebGLProgram|validate_status/i.test(message.text())) {
      const error = message.text().slice(0, 4800);
      if (!report.console.includes(error)) report.console.push(error);
    }
  });
  page.on('requestfailed', request => {
    if (/arcgisonline|worldcover|city-height/.test(request.url()) && report.sourceFailures.length < 60)
      report.sourceFailures.push({ url: request.url(), error: request.failure()?.errorText });
  });
  page.on('response', response => {
    if (response.status() >= 400 && /arcgisonline|worldcover|city-height/.test(response.url()) && report.sourceFailures.length < 60)
      report.sourceFailures.push({ url: response.url(), status: response.status() });
  });
  await page.addInitScript(({ selected, hold }) => {
    if (selected !== 'auto') localStorage.setItem('fly-quality-tier', selected);
    if (hold) window.__flyGovPin = 'hold';
    localStorage.setItem('fly-controls-seen', '1');
    localStorage.setItem('fly-sound-on', '0');
    const audit = window.__terrainProgramAudit = { records: [] };
    const P = WebGL2RenderingContext.prototype;
    const links = P.linkProgram, attach = P.attachShader, bind = P.useProgram;
    const shaders = new WeakMap(), records = new WeakMap(), active = new WeakMap();
    P.attachShader = function(program, shader) {
      const list = shaders.get(program) ?? [];
      list.push(shader);
      shaders.set(program, list);
      return attach.call(this, program, shader);
    };
    P.linkProgram = function(program) {
      const result = links.call(this, program);
      const list = shaders.get(program) ?? [];
      const sources = list.map(shader => this.getShaderSource(shader) || '');
      if (sources.some(s => s.includes('vEarthFlat'))) {
        const record = { ctx: this, program, shaders: list, city: sources.some(s => s.includes('vec3 cityMass(')),
          passes: sources.map(s => ({ earth: s.includes('vEarthFlat'), grade: s.includes('cityResolved'),
            sharedAtlas: s.includes('uEarthAppearance') && s.includes('vec3 cityMass('),
            vertex: s.includes('gl_Position') })), uses: 0, draws: 0 };
        records.set(program, record);
        audit.records.push(record);
      }
      return result;
    };
    P.useProgram = function(program) {
      const record = program && records.get(program);
      if (record) record.uses++;
      active.set(this, record);
      return bind.call(this, program);
    };
    for (const method of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const original = P[method];
      P[method] = function(...args) {
        const record = active.get(this);
        if (record) record.draws++;
        return original.apply(this, args);
      };
    }
    audit.get = () => audit.records.map(({ctx, program, shaders: attached, city, passes, uses, draws}) => ({
      city, passes, uses, draws, linked: ctx.getProgramParameter(program, ctx.LINK_STATUS),
      programLog: ctx.getProgramInfoLog(program), compile: attached.map(shader => ({
        ok: ctx.getShaderParameter(shader, ctx.COMPILE_STATUS), log: ctx.getShaderInfoLog(shader)
      }))
    }));
  }, { selected:tier, hold:governor === 'hold' });
  const target = new URL(origin);
  target.search = new URLSearchParams({ graphicsReview: '1', at: [pose.lat, pose.lon, 1930].join(','),
    aircraft, flags, sunUtc: '2026-06-21T16:00:00Z', weather: 'baseline' });
  const snapshot = () => page.evaluate(() => {
    const r=window.__fly, f=r.flight, s=window.__flyStore.getState();
    const terrain = { attached: 0, visible: 0, imagery: 0, byZoom: {} };
    r.engine.map.traverse(o => {
      if (!o.isTile || o.model?.parent !== o) return;
      terrain.attached++;
      if (o.model.visible) terrain.visible++;
      terrain.byZoom[o.z]=(terrain.byZoom[o.z] || 0)+1;
      const materials=Array.isArray(o.model.material) ? o.model.material : [o.model.material];
      if (materials.some(m=>m?.map?.image)) terrain.imagery++;
    });
    const canvas=[...document.querySelectorAll('canvas')].find(c=>c.getContext('webgl2'));
    const gl=canvas.getContext('webgl2'), ext=gl.getExtension('WEBGL_debug_renderer_info');
    return { geo:r.geo?.toArray(),pos:f.pos.toArray(),bank:f.bank,pitch:f.pitch,heading:f.heading,speed:f.speed,
      camera:r.camera.quaternion.toArray(),cameraPos:r.camera.position.toArray(),fov:r.camera.fov,
      tier:s.qualityTier,preset:s.qualityPreset,aircraft:s.aircraftId,visuals:s.visuals,style:s.mapStyle,flags:window.__flyUrlFlags,
      dpr:canvas.width/canvas.clientWidth,gpu:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
      boot:window.__flyBoot?.pct,frames:r.framesRendered,terrain,terraStats:r.terraStats,
      earth:r.earthSurface,city:r.cityContinuity,near:r.satBuildings?.stats?.ready,far:r.satSkyline?.stats?.ready,
      moving:window.__surfaceRail?.distance, programs:window.__terrainProgramAudit.get() };
  });
  async function capture(name) {
    report[name] = await snapshot();
    await page.screenshot({ path:path.join(output,name+'.png'),style:screenshotStyle });
    console.log(JSON.stringify({ name,output,quality:report[name].tier,terrain:report[name].terrain,
      programs:report[name].programs.map(({city,uses,draws,linked})=>({city,uses,draws,linked})) }));
  }
  try {
    report.stage='boot';
    await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(() => window.__flyBoot?.pct===100 && window.__flyStore?.getState().screen==='flight',null,{timeout:180000});
    await enterFlight(page, {...pose,name:null});
    await page.evaluate(p=>{
      const r=window.__fly,f=r.flight,step=f.step.bind(f),hdg=p.headingDeg*Math.PI/180;
      window.__flyStore.setState({f35PilotSeat:false,cameraMode:'chase'});
      r.warpToGeo(p.lat,p.lon,{altM:p.altM,headingRad:hdg,name:null});
      const start=f.pos.clone(), k=1/Math.cos(p.lat*Math.PI/180);
      const rail=window.__surfaceRail={start:null,distance:0};
      f.step=(dt,command)=>{
        step(dt,command);
        if (rail.start!==null) rail.distance=Math.min(2100,(performance.now()-rail.start)*p.speed/1000);
        f.pos.set(start.x+Math.sin(hdg)*rail.distance*k,start.y,start.z-Math.cos(hdg)*rail.distance*k);
        f.speed=p.speed; f.heading=hdg; f.pitch=p.pitch; f.bank=p.bank; f.turnRate=f.pitchRate=0;
      };
    },pose);
    report.stage='settle';
    await page.waitForFunction(()=>window.__fly?.terraStats?.sharp && !window.__fly.worldLoading && (window.__fly.satBuildings?.stats?.ready??0)>0,null,{timeout:100000});
    await page.waitForTimeout(3500);
    await capture('settled');
    await page.evaluate(()=>window.__surfaceRail.start=performance.now());
    for(let i=0;i<32;i++){
      await page.waitForTimeout(650);
      const sample=await snapshot();
      report.samples.push(sample);
      if(!report.midmotion && sample.moving>=1100) await capture('midmotion');
      if(sample.moving>=2100) break;
    }
    await page.waitForTimeout(4500);
    await capture('endpoint');
    report.stage='complete';
  } catch(error) {
    report.failure=error.stack;
    if (!page.isClosed()) {
      try { await capture('partial'); } catch {}
    }
    process.exitCode=1;
  } finally {
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    await browser.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

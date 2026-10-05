// Visibility regression: counts alone cannot tell whether a long traffic
// indicator is readable. Inspect its actual projected width and on/off pixels.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { bootFly } = require('./_boot');
const label = process.argv[2] || 'current';
const standardDepth = process.env.FLY_STANDARD_DEPTH === '1';
const out = path.join('.graphics-review', 'traffic-indicators', label);
const median = a => [...a].sort((x,y) => x-y)[Math.floor(a.length / 2)];
const raw = async buffer => sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
function pixelDelta(a,b,point) {
  let peak=0;
  for(let y=Math.round(point.y)-2;y<=Math.round(point.y)+2;y++)
    for(let x=Math.round(point.x)-2;x<=Math.round(point.x)+2;x++) {
      if(x<0||y<0||x>=a.info.width||y>=a.info.height)continue;
      const i=(y*a.info.width+x)*3;
      for(let c=0;c<3;c++)peak=Math.max(peak,Math.abs(a.data[i+c]-b.data[i+c]));
    }
  return peak;
}
function inspectGeometry() {
  const m=window.__flyTracers, cam=window.__indicatorCamera;
  const shader={uniforms:{},vertexShader:'',fragmentShader:''};
  m.material.onBeforeCompile(shader); // inspect the real bend uniform holders
  const u=Object.fromEntries(Object.entries(shader.uniforms).map(([k,v])=>[k,v.value]));
  const smooth=(a,b,n)=>{const t=Math.max(0,Math.min(1,(n-a)/(b-a)));return t*t*(3-2*t);};
  const pos=m.geometry.attributes.position, color=m.geometry.attributes.color;
  const n=window.__flyStats.tracers, count=m.geometry.drawRange.count/(n*6)+1;
  const project=i=>{
    const p=window.__fly.flight.pos.clone().fromBufferAttribute(pos,i).applyMatrix4(m.matrixWorld);
    const d=Math.hypot(p.x-u.uBendCenter.x,p.z-u.uBendCenter.y);
    const a=smooth(u.uAirAgl.x,u.uAirAgl.y,p.y-u.uRefGroundY);
    const cap=u.uAirCapFrac+(u.uAirCapFar-u.uAirCapFrac)*smooth(u.uAirLiftRange.x,u.uAirLiftRange.y,d);
    const drop=d*d*u.uBendK;
    p.y-=drop+(Math.min(drop,Math.max(0,p.y-u.uEyeY)*cap)-drop)*a;
    p.project(cam);return{x:(p.x*.5+.5)*innerWidth,y:(.5-p.y*.5)*innerHeight,z:p.z};
  };
  const tracks=[];
  for(let slot=0;slot<n;slot++) {
    const samples=[];
    for(let j=8;j<=20;j++) {
      const i=(slot*count+j)*2,a=project(i),b=project(i+1);
      const p={x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:a.z,width:Math.hypot(a.x-b.x,a.y-b.y)};
      if(p.x>4&&p.x<innerWidth-4&&p.y>90&&p.y<innerHeight-60&&p.z>-1&&p.z<1)samples.push(p);
    }
    const first=slot*count*2, last=first+(count-1)*2;
    const span=Math.hypot(pos.getX(first)-pos.getX(last),pos.getZ(first)-pos.getZ(last));
    tracks.push({hex:window.__indicatorTracks[slot].hex,range:window.__indicatorTracks[slot].distM,span,
      headBrightness:Math.max(color.getX(last),color.getY(last),color.getZ(last)),samples});
  }
  let root=m;while(root.parent)root=root.parent;
  const sky=root.getObjectByName('immersive-sky-background');
  const gl=m.__r3f.root.getState().gl;
  const order=gl.renderLists.get(root,0).transparent;
  const skyIndex=order.findIndex(x=>x.object===sky),trailIndex=order.findIndex(x=>x.object===m);
  return {tracks,sunGain:window.__flyStats.tracerSunGain,profile:window.__flyStore.getState().visuals,
    background:sky?{visible:sky.visible,order:sky.renderOrder,day:sky.material.uniforms.day.value,
      reverse:sky.material.uniforms.reverseDepth.value}:null,
    cloudStats:window.__fly.immersiveClouds,
    backgroundBeforeTrails:!sky?.visible||(skyIndex>=0&&trailIndex>skyIndex),
    reversedDepth:gl.capabilities.reversedDepthBuffer,dpr:gl.getPixelRatio(),
    staleSkyProgram:gl.info.programs.some(p=>gl.getContext().getShaderSource(p.fragmentShader)?.includes('scene=mix(scene,sky')),
    pins:{visuals:window.__flyVisualsOverride??null,aerial:window.__flyAerialOverride??null}};
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:1});
  // Exercise the real renderer fallback used by devices without clip control.
  if(standardDepth)await page.addInitScript(()=>{
    const getExtension=WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension=function(name){
      return name==='EXT_clip_control'?null:getExtension.call(this,name);
    };
  });
  const errors=[],cases=[],failures=[];
  page.on('pageerror',e=>errors.push(e.stack));
  page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/i.test(m.text()))errors.push(m.text());});
  const check=(name,ok)=>{console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)failures.push(name);};
  try {
    await bootFly(page,{style:'toy',settleMs:500});
    await page.evaluate(()=>window.__fly.launchSetup({flightMode:'free',aircraftId:'fighter',dest:'columbus-practice'}));
    await page.waitForTimeout(7000);
    await page.evaluate(()=>{
      const r=window.__fly,f=r.flight;
      f.step=()=>{};f.pos.y=2000;f.speed=180;f.pitch=0;f.bank=0;f.heading=0;
      r.operations.advance=()=>false;
      r.chaseRig.update=(dt,f,cam)=>{
        window.__indicatorCamera=cam;
        cam.position.set(f.pos.x,f.pos.y+30,f.pos.z+40);
        cam.lookAt(f.pos.x,f.pos.y+1800,f.pos.z-18000);
      };
      window.__flyCloudFreeze=1;
      delete window.__flyVisualsOverride;delete window.__flyAerialOverride;
      const tracks=[8000,16000,32000].map((d,i)=>{
        const x=f.pos.x+2200,y=f.pos.y+[900,2200,5400][i],z=f.pos.z-d;
        return {hex:'face0'+i,meta:{flight:'CHECK'+i,t:i?'A320':'C172'},archetype:i?0:3,flags:0,
          rx:x,ry:y,ryd:y,rz:z,yaw:Math.PI/2,bank:0,opacity:1,scaleK:1,stale:0,distM:d,
          fix1:{x,y,z,vE:180,vN:0,vUp:0,latRad:f.latDeg*Math.PI/180,t:performance.now()/1000}};
      });
      window.__indicatorTracks=tracks;r.traffic.tracks=new Map(tracks.map(t=>[t.hex,t]));
      r.traffic.update=()=>{r.traffic.items=tracks;return tracks;};
    });
    const views=[
      {name:'enhanced-day-desktop',profile:'enhanced',tier:'high',width:1400,height:900,hour:17},
      {name:'classic-day-desktop',profile:'classic',tier:'high',width:1400,height:900,hour:17},
      {name:'enhanced-day-phone',profile:'enhanced',tier:'medium',width:390,height:844,hour:17},
      {name:'enhanced-day-phone-low',profile:'enhanced',tier:'low',width:390,height:844,hour:17},
      {name:'enhanced-day-phone-low-dpr',profile:'enhanced',tier:'low',width:390,height:844,hour:17,dpr:.65},
      {name:'enhanced-night-desktop',profile:'enhanced',tier:'high',width:1400,height:900,hour:5},
    ];
    for(const v of views) {
      console.log('CAPTURE '+v.name);
      await page.setViewportSize({width:v.width,height:v.height});
      await page.evaluate(v=>{
        window.__flySunOverride=Date.UTC(2026,8,25,v.hour);
        const s=window.__flyStore.getState();s.setMapStyle('toy');s.setVisuals(v.profile);s.setQualityTier(v.tier);
      },v);
      await page.waitForTimeout(300);
      await page.evaluate(()=>window.__flyStore.getState().setMapStyle('satellite'));
      await page.waitForTimeout(6500);
      if(v.dpr){
        await page.evaluate(dpr=>window.__flyTracers.__r3f.root.getState().setDpr(dpr),v.dpr);
        await page.waitForTimeout(500);
      }
      const g=await page.evaluate(inspectGeometry);
      check(v.name+' three tracks in the requested profile',g.tracks.length===3&&g.profile===v.profile);
      check(v.name+' requested depth mode',g.reversedDepth===!standardDepth);
      check(v.name+' daylight sky active',!!g.background?.visible===(v.hour===17));
      check(v.name+' sky draws before transparent trails',g.backgroundBeforeTrails&&!g.staleSkyProgram);
      await page.evaluate(()=>{window.__flyTracers.visible=false;});
      await page.waitForTimeout(150);
      const off=await raw(await page.screenshot());
      await page.waitForTimeout(150);
      const control=await raw(await page.screenshot());
      await page.evaluate(()=>{window.__flyTracers.visible=true;});
      await page.waitForTimeout(150);
      const png=await page.screenshot({path:path.join(out,v.name+'.png')}),on=await raw(png);
      for(const t of g.tracks) {
        t.width=median(t.samples.map(p=>p.width));
        t.noise=median(t.samples.map(p=>pixelDelta(off,control,p)));
        t.contrast=median(t.samples.map(p=>pixelDelta(off,on,p)));
        check(v.name+' '+t.hex+' full long indicator',t.span>=3800);
        check(v.name+' '+t.hex+' readable projected width',t.samples.length>=6&&t.width>=1.15);
        check(v.name+' '+t.hex+' visible pixels above control',t.contrast>=6&&t.contrast>=t.noise+4);
      }
      cases.push({view:v,...g});
    }
    check('zero page/shader errors',errors.length===0);
    console.log(failures.length?'VERIFY: FAIL ('+failures.length+')':'VERIFY: PASS');
  }finally{
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({cases,errors,failures},null,2));
    await browser.close();
  }
  if(failures.length)process.exitCode=1;
})().then(()=>process.exit(process.exitCode||0)).catch(e=>{console.error(e);process.exit(1);});

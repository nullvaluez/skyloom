// Diagnostic only: bisect material terms on the same held Ohio geometry.
const {chromium}=require('playwright');
const fs=require('node:fs');
const {enterFlight}=require('./_skip-menus');
const out=process.env.FACET_OUT||'.graphics-review/painterly/facets';
const nevada=process.env.FACET_SITE==='nevada';
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  try{
    const page=await browser.newPage({viewport:{width:1920,height:1080}});
    await page.addInitScript(()=>{
      localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');
      localStorage.setItem('fly-aircraft','prop');localStorage.setItem('fly-quality-tier','high');
      localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');
      window.__flyTitleBypass=true;window.__flyGovPin='hold';window.__flyCloudFreeze=1;
      window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,6,18,18);
    });
    await page.goto('http://localhost:3040/?graphicsReview=1');
    await enterFlight(page,nevada?{lat:36.9174,lon:-116.094,altM:1767,name:null}:{lat:40.20403,lon:-83.0896,altM:380,name:null},{timeoutMs:90000,waitReveal:true});
    await page.evaluate(nevada=>{const rt=window.__fly,f=rt.flight;rt.autopilot.disengage();f.step=()=>{};f.heading=nevada?79*Math.PI/180:3.9;f.pitch=-.04;f.bank=0;f.speed=0;window.__flyWeatherOverride='clear';window.__flySunOverride=Date.UTC(2026,6,18,nevada?20:18);},nevada);
    await page.waitForTimeout(22000);
    await page.evaluate(nevada=>{const f=window.__fly.flight;f.pos.y=f.groundElev+(nevada?192:100);f.agl=nevada?192:100;window.__fly.chaseCam?.snap?.();},nevada);
    await page.waitForTimeout(5000);
    for(const mode of (process.argv.slice(2).length?process.argv.slice(2):['base','no-relief','no-ref','no-detail','no-flat','no-shadow','no-paint','no-ground'])){
      await page.evaluate(mode=>{
        window.__flyPainterlyOverride=mode==='no-paint'?0:undefined;
        window.__flyR25Ground=mode==='no-ground'?0:undefined;
        window.__fly.engine.forEachTileMaterial(m=>{
          m.userData.facetBase??={compile:m.onBeforeCompile,key:m.customProgramCacheKey};
          const base=m.userData.facetBase;
          m.customProgramCacheKey=()=>base.key()+'-facet-probe-'+mode;
          m.onBeforeCompile=(s,r)=>{
            base.compile(s,r);
            if(mode==='no-relief')s.uniforms.uR25HasRelief={value:0};
            if(['no-ref','no-wood','no-structure','no-class'].includes(mode))s.uniforms.uR25RefGain={value:0};
            if(mode==='no-wood')s.fragmentShader=s.fragmentShader.replaceAll('float wood = float(identity==2.0);','float wood = 0.0;').replaceAll('wood=kinds.x;','wood=0.0;');
            if(mode==='no-palette')s.fragmentShader=s.fragmentShader.replaceAll('albedo=mix(source,paintAlbedo,paintNear*.90);','albedo=source;');
            if(mode==='strict-vegetation')s.fragmentShader=s.fragmentShader.replace('smoothstep(-0.02,0.16,','smoothstep(.04,.24,');
            if(mode==='dry-ground')s.fragmentShader=s.fragmentShader.replace(/float vegetationSupport = .*?;/,'float vegetationSupport=0.0;');
            if(mode==='kind-weight')s.fragmentShader=s.fragmentShader.replaceAll('authored = mix(authored,mix(earthFallback,mix(earthFallback,albedo,materialWeight),classified),amount);','authored=mix(authored,vec3(kinds.y,vegetationSupport,kinds.w),amount);');
            if(mode==='class-id')s.fragmentShader=s.fragmentShader.replaceAll('authored = mix(authored,mix(earthFallback,mix(earthFallback,albedo,materialWeight),classified),amount);',`authored=mix(authored,identity==1.?vec3(1,0,0):identity==2.?vec3(0,0,1):identity==3.?vec3(1,0,1):identity==9.?vec3(0,1,1):identity==14.?vec3(1,1,0):vec3(.5),amount);`);
            if(mode==='no-material')s.uniforms.uCinematicMaterials={value:0};
            if(mode==='no-water')s.fragmentShader=s.fragmentShader.replace('earthWater = mix(earthWater,water,amount);','earthWater = 0.0;').replaceAll('earthWater = mix(earthWater,water,amount);','earthWater = 0.0;');
            if(mode==='no-structure')s.fragmentShader=s.fragmentShader.replace('authored*=1.0+groundStructure*.28*mediumAmount;','');
            if(mode==='no-class')s.uniforms.uEarthOn={value:0};
            if(mode==='no-color-array')s.fragmentShader=s.fragmentShader.replace('earthTex=cmColor(earthUV,earthMaterial);','earthTex=vec4(vec3(1.0/2.05),.94);');
            if(mode==='natural-blend'){
              s.fragmentShader=s.fragmentShader.replaceAll('value=mix(value,soft,.85);','')
                .replaceAll('albedo=mix(albedo,paintAlbedo,paintNear*.55);','albedo=mix(albedo,paintAlbedo,paintNear);')
                .replaceAll('materialWeight=mix(materialWeight,.94,paintNear);',`materialWeight=mix(materialWeight,.94,paintNear);
                  if(identity==1.0||identity==2.0||identity==9.0)albedo=mix(source,albedo,vegetationSupport);
                  materialWeight*=paintConfidence;`);
            }
            if(mode==='no-detail'){
              s.fragmentShader=s.fragmentShader.replace('if(earthMaterialWeight>0.001) normal=cmNormal','if(false) normal=cmNormal').replace('normal = normalize(max(abs(ngDet), 0.00001) * normal - ngGradient);','');
            }
            if(mode==='no-flat')s.fragmentShader=s.fragmentShader.replace('if ( uHillStrength > 0.0 ) normal = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );','');
          };
          m.needsUpdate=true;
        });
        window.__fly.engine.forEachLoadedTile(t=>{t.model.receiveShadow=mode!=='no-shadow';});
      },mode);
      await page.waitForTimeout(1800);
      await page.screenshot({path:`${out}/${mode}.png`});console.log(mode);
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

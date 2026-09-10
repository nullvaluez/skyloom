import assert from 'node:assert/strict';
import fs from 'node:fs';
const url=`data:text/javascript;base64,${fs.readFileSync(new URL('../lib/fly/immersive.js',import.meta.url)).toString('base64')}`;
const {IMMERSIVE,immersiveOn,immersiveLighting,cloudPhase,cloudDensity}=await import(url);
assert.equal(immersiveOn(),true,'Server and browser use the same standard treatment');
globalThis.window={location:{search:''},__flyImmersiveArm:false,__flyImmersiveFeatures:{clouds:false}};
for(const query of ['', '?graphics=legacy', '?graphics=cinematic', '?graphics=immersive']) {
  window.location.search=query;
  assert.equal(immersiveOn(),true,'Old URLs and preview switches cannot disable immersive rendering');
  for(const feature of Object.keys(IMMERSIVE.features))assert.equal(immersiveOn(feature),true);
}
assert.equal(immersiveOn('unknown'),false);
delete window.__flyImmersiveArm;delete window.__flyImmersiveFeatures;
const noon=immersiveLighting({sinEl:1}),night=immersiveLighting({sinEl:-1}),overcast=immersiveLighting({sinEl:1},{overcastT:1});
assert.ok(noon.sun>noon.fill*4,'Directional daylight remains distinguishable');
assert.ok(overcast.sun<noon.sun&&overcast.fill>noon.fill,'Overcast redistributes direct light into fill');
assert.ok(night.sun<noon.sun&&night.environment>0,'Night retains readable material response');
const coverages=[.05,.3,.65,1].map(presenceFrac=>immersiveLighting({sinEl:1},{presenceFrac,overcastT:0}).cloudCoverage);
assert.ok(coverages.every((v,i)=>!i||v>coverages[i-1]),'Clear, few and scattered weather must change the volume, not only overcast');
assert.equal(coverages.at(-1),noon.cloudCoverage,'Baseline coverage stays unchanged');
const cloudAmounts=coverages.map(coverage=>{let sum=0;for(let x=0;x<100000;x+=127)sum+=cloudDensity(x,1850,x*.5,{coverage});return sum;});
assert.ok(cloudAmounts[0]<cloudAmounts[2]&&cloudAmounts[2]<cloudAmounts[3],'Weather coverage changes actual cloud density');
for(let angle=-90;angle<=90;angle+=.25){const s=immersiveLighting({sinEl:Math.sin(angle*Math.PI/180)});assert.ok(Object.values(s).every(Number.isFinite));}
for(const x of [-20000000,-131072,-1,0,1,12345678]){
  assert.ok(cloudPhase(x)>=0&&cloudPhase(x)<IMMERSIVE.clouds.periodM);
  assert.equal(cloudPhase(x),cloudPhase(x+IMMERSIVE.clouds.periodM));
  assert.ok(Math.abs(cloudDensity(x,1800,9847)-cloudDensity(x+IMMERSIVE.clouds.periodM,1800,9847))<1e-8,'Density repeats across phase wrap');
  // Exact absolute position reconstructed from either floating origin.
  const before=cloudDensity((x-10000)+10000,1800,2000),after=cloudDensity((x-25000)+25000,1800,2000);
  assert.equal(before,after,'Rebase does not change density');
}
assert.equal(cloudDensity(0,1400,0),0);assert.equal(cloudDensity(0,2700,0),0);
let cloudy=0,clear=0;for(let x=0;x<100000;x+=127){if(cloudDensity(x,1850,x*.5)>0)cloudy++;else clear++;}
assert.ok(cloudy>0&&clear>0,'Cloud layer has both cloud interiors and clear gaps');
for(const p of Object.values(IMMERSIVE.profiles)){assert.ok(p.shadowSize>=512);assert.ok(p.cloudSteps>0&&p.cloudSteps<=96);}
const foliageSource=fs.readFileSync(new URL('../lib/fly/immersive-foliage.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(import.meta.resolve('three')));
const {buildImmersiveFoliage}=await import(`data:text/javascript;base64,${Buffer.from(foliageSource).toString('base64')}`);
const geometry=buildImmersiveFoliage(12),positions=geometry.getAttribute('position'),indices=geometry.index;
assert.equal(indices.count/3,34,'Foliage stays below the previous 58-triangle crown');
for(let i=0;i<indices.count;i+=3){
 const a=indices.getX(i),b=indices.getX(i+1),c=indices.getX(i+2);
 const ab=[positions.getX(b)-positions.getX(a),positions.getY(b)-positions.getY(a),positions.getZ(b)-positions.getZ(a)];
 const ac=[positions.getX(c)-positions.getX(a),positions.getY(c)-positions.getY(a),positions.getZ(c)-positions.getZ(a)];
 assert.ok(Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])>1e-8,'No zero-area foliage triangles');
}
for(const name of ['position','normal','uv','color'])assert.ok([...geometry.getAttribute(name).array].every(Number.isFinite));
geometry.dispose();
console.log('PASS: unconditional immersive mode, solar/weather lighting, finite transitions, cloud gaps/bounds/period/rebase, quality continuity');

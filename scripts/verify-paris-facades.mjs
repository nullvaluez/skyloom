import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);

globalThis.window = { __flyWorldPassTierOverride: { preset:'high', mobile:false } };
const { worldPassRequest } = await import('../lib/fly/world-pass.js');
const { createTileCtx } = await import('../lib/fly/toy-world/worker/tile-ctx.js');
const { buildSatBuildings } = await import('../lib/fly/toy-world/worker/sat-buildings/index.js');
const { architectureContext, architectureStyle, architectureTags } = await import('../lib/fly/toy-world/worker/sat-buildings/typology.js');
const { colourOf, lookFarColour, lookFarPrepare, tagMaterial } = await import('../lib/fly/toy-world/worker/sat-buildings/colour.js');

const R=6378137, span=2*Math.PI*R/16384, extent=4096;
const features=Array.from({length:100}, (_,i) => {
  const x=900+(i%10)*210, y=900+Math.floor(i/10)*210;
  const ring=[[x,y],[x+30,y],[x+30,y+26],[x,y+26],[x,y]].map(([x,y])=>({x,y}));
  return {type:3,id:i+1,properties:{render_height:8,...(i===0?{colour:'white'}:{})},loadGeometry:()=>[ring]};
});
const vt={layers:{building:{length:features.length,extent,feature:i=>features[i]}}};
const wp=worldPassRequest();
const srgb=c=>Math.round(255*(c<=0.0031308?12.92*c:1.055*c**(1/2.4)-0.055));
function inspect(lat,lon) {
  const wx=R*lon*Math.PI/180, wy=R*Math.asinh(Math.tan(lat*Math.PI/180));
  const x=Math.floor(wx/span+8192), y=Math.floor(8192-wy/span);
  const cx=(x+0.5-8192)*span, cz=(y+0.5-8192)*span;
  const frame={cx,cz,k:Math.cosh(cz/R),mercX0:cx-span/2,mercYTop:-cz+span/2,tileSpan:span,
    visuals:true,trueAreas:true,t0:0,lookFallback:{regional:null}};
  const ctx=createTileCtx(vt,frame,{z:14,x,y,v:27,detail:'sat-buildings',options:{worldPass:wp},diag:true});
  const out=buildSatBuildings(ctx);
  assert.equal(out.wpStages.look.walls.tagOpaque,1);
  const far=createTileCtx(vt,frame,{z:14,x,y,v:27,detail:'sat-skyline',options:{worldPass:wp}});
  lookFarPrepare(ctx.look.items,far);
  const arch=architectureContext(vt,ctx), warm=[];
  for(const it of ctx.look.items){
    const style=()=>architectureStyle(it,arch,extent,ctx.kA);
    const near=colourOf(it,style(),ctx,'near',0.5);
    const distant=lookFarColour(it,style(),far,0);
    for(let i=0;i<3;i++){
      assert.ok(Math.abs(distant.wall[i]-near.wall[i]*wp.look.worker.far.wallShade)<1e-6);
      assert.ok(Math.abs(distant.roof[i]-near.roofCol[i]*wp.look.worker.far.roofShade)<1e-6);
    }
    const [r,g,b]=near.wall.map(srgb);
    warm.push(r>=165 && r-b>=20 && r>=g && g>=b);
  }
  assert.equal(warm.length,100);
  return warm.filter(Boolean).length;
}
const core=inspect(48.8566,2.3522), approach=inspect(48.905,2.264), argenteuil=inspect(48.9472,2.2467);
assert.ok(core>80 && approach<60 && argenteuil<60,JSON.stringify({core,approach,argenteuil}));
assert.deepEqual(tagMaterial(architectureTags({colour:'white'})),tagMaterial('#ffffff'));
assert.deepEqual(tagMaterial(architectureTags({colour:'LightGrey'})),tagMaterial('#d3d3d3'));
assert.deepEqual(tagMaterial(architectureTags({colour:'black'})).rgb,[0.04,0.04,0.04]);
assert.equal(tagMaterial(architectureTags({name:'White House'})),null);
assert.equal(tagMaterial(architectureTags({'roof:colour':'#ffbb00', name:'Hall #345'})),null);
assert.deepEqual(tagMaterial(architectureTags({'roof:colour':'#ffbb00',colour:'#27639b'})),tagMaterial('#27639b'));
assert.equal(tagMaterial(architectureTags({colour:'unknown'})),null);
console.log(`PASS pale warm facades per 100 homes: central Paris ${core}, approach ${approach}, Argenteuil ${argenteuil}. Named facade tags and near/far wall/roof agreement passed.`);

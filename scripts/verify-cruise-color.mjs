import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./_node-resolve.mjs',import.meta.url);
// Every assertion below is on a boolean or a number. node's AssertionError
// inspects and diffs its operands with no array limit: handed the atlas or its
// texture (a 1 MiB Uint8Array), a failing assert spends hours building the
// message and the gate appears to hang or die silently (measured: 50 KB 11 s).
// No network either: under node the atlas fetchers must stay inert.
let netCalls=0;globalThis.fetch=async()=>{netCalls++;throw Error('verify-cruise-color: no network');};
globalThis.window={location:{search:'?graphicsReview=1'},matchMedia:()=>({matches:false})};
const {useFlyStore}=await import('../stores/fly-store.js');
const {r25GroundFrame,__r25GroundInternals,releaseR25Ground}=await import('../lib/fly/r25-ground.js');
const {r25Uniforms}=await import('../lib/fly/toy-world/world-bend.js');
const {COASTAL_WATER_UNIFORMS,SEA_REGION_COMPILED}=await import('../lib/fly/coastal-water.js');
const st=__r25GroundInternals._st,seaGain=()=>COASTAL_WATER_UNIFORMS.uSeaRegionGain.value;
const settle=async()=>{for(let i=0;i<8;i++)await new Promise((r)=>setTimeout(r,0));};
const makeEngine=(imagerySource)=>({forEachLoadedTile(){},forEachTileMaterial(){},onTileEvents(){return()=>{};},setR25ReliefPx(){},setR25ResidentCapMiB(){},imagerySource});
const rt={engine:makeEngine(null),groundElevVis:200,flight:{pos:{y:1200},groundElev:200,latDeg:39.4,lonDeg:-83.4}};
const ctx={style:'satellite',tier:'low',dt:1/60,flight:rt.flight};
useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced',qualityTier:'low'});
assert.ok(SEA_REGION_COMPILED,'desktop Enhanced compiles the regional water colour');
// Low tier: the water keeps its uniform albedo, so the terrain reference is
// still allocated lazily (cruise only) and the descent stays quiet.
r25GroundFrame(rt,ctx);
assert.ok(st.atlas===null,'Low tier allocated the reference atlas at low altitude');
assert.equal(r25Uniforms.uR25RefGain.value,0);assert.equal(seaGain(),0);
rt.flight.pos.y=10200;r25GroundFrame(rt,ctx);
const lowAtlas=st.atlas;
assert.ok(lowAtlas!==null&&lowAtlas.seaWanted===false,'Low tier: cruise allocates the terrain reference; the water does not want it');
let lowUpdates=0;lowAtlas.update=()=>lowUpdates++;
rt.flight.pos.y=1200;r25GroundFrame(rt,ctx);
assert.equal(lowUpdates,0,'Low tier descent kept fetching the cruise reference');
assert.equal(r25Uniforms.uR25RefGain.value,0);assert.equal(seaGain(),0);
assert.ok(st.atlas===lowAtlas,'Low tier descent discarded the bounded cache');
// Desktop non-Low: the atlas exists at EVERY altitude in Enhanced satellite,
// because its level 1 is the water's regional colour (SEA_STATE.region). A new
// engine tears the old state down first.
rt.engine=makeEngine({getUrl:(x,y,z)=>`https://imagery.invalid/${z}/${y}/${x}`});ctx.tier='high';
useFlyStore.setState({qualityTier:'high'});
r25GroundFrame(rt,ctx);
const atlas=st.atlas;
assert.ok(atlas!==null&&atlas!==lowAtlas,'Enhanced desktop flight at 1,200 m did not allocate the reference atlas for the water');
assert.ok(atlas.seaWanted===true&&atlas.seaData!==null,'the atlas carries no wanted sea layer');
assert.equal(atlas.bytes(),1048576+262144,'reference bound: 1 MiB colour + 256 KiB water layer');
assert.equal(r25Uniforms.uR25RefGain.value,0,'the TERRAIN reference must stay off below 2.5 km');
assert.ok(r25Uniforms.uR25Ref.value===atlas.texture);
// Under node there is no createImageBitmap: every slot resolves to a miss
// with no request, and the water keeps its uniform albedo (gain 0).
await settle();r25GroundFrame(rt,ctx);
assert.ok(atlas.seaStats.misses>0&&atlas.seaStats.built===0,`sea slots: ${atlas.seaStats.misses} misses, ${atlas.seaStats.built} built`);
assert.equal(netCalls,0,'the atlas made a network request under node');
assert.equal(seaGain(),0);
atlas.loaded=64;
let updates=0;atlas.update=()=>updates++;
let previous=0;
for(let agl=2500;agl<=6000;agl+=25){rt.flight.pos.y=agl+200;r25GroundFrame(rt,ctx);const gain=r25Uniforms.uR25RefGain.value;assert.ok(gain>=previous&&gain<=1&&gain-previous<.02);previous=gain;}
assert.equal(previous,1);assert.equal(r25Uniforms.uR25RefLimits.value.x,.12);assert.equal(r25Uniforms.uR25RefLimits.value.y,8);
// Descent: quiet for the terrain (gain back to 0 at once, cache retained);
// the atlas keeps following the camera only because the water wants it.
rt.flight.pos.y=1200;const before=updates;r25GroundFrame(rt,ctx);
assert.equal(r25Uniforms.uR25RefGain.value,0);
assert.ok(updates===before+1&&atlas.seaWanted===true,'below 2.5 km the atlas follows the camera for the water, once a frame');
assert.ok(st.atlas===atlas,'descent discarded bounded cache');
useFlyStore.setState({visuals:'classic'});r25GroundFrame(rt,ctx);
assert.ok(r25Uniforms.uR25Ref.value===null);assert.equal(seaGain(),0);
useFlyStore.setState({visuals:'enhanced'});r25GroundFrame(rt,ctx);
assert.ok(r25Uniforms.uR25Ref.value===atlas.texture,'Enhanced did not restore retained atlas after Classic');
rt.flight.pos.y=10200;r25GroundFrame(rt,ctx);assert.equal(r25Uniforms.uR25RefGain.value,1);
useFlyStore.setState({mapStyle:'toy'});r25GroundFrame(rt,{...ctx,style:'toy'});
assert.equal(r25Uniforms.uR25RefGain.value,0);assert.ok(r25Uniforms.uR25Ref.value===null);assert.equal(seaGain(),0);
releaseR25Ground(rt.engine);
assert.equal(netCalls,0,'the atlas made a network request under node');
console.log('PASS cruise reference: lazy on Low, at every altitude for the water on desktop (1.25 MiB bound), terrain gain 0 below 2.5 km and continuous above, quiet descent, inert without a DOM, style cleanup');

/** Reuses the existing shadow camera and AO pass; never creates another light. */
export const GROUND_SHADING = {radiusM:350,steps:8,hysteresisM:40,aoRadiusM:5,aoIntensity:3.5};
/** The scene bus owns Three objects outside React's render state. */
export function attachGroundShadowLight(runtime,light){
  runtime.sunLight=light;
  return()=>{if(runtime.sunLight===light){runtime.sunLight=null;delete runtime.shadowRadiusM;}};
}
export function createGroundShadowState(){return {rung:null};}
export function groundShadowRadius(state,k,highM=1500,cfg=GROUND_SHADING){
  const value=Math.max(0,Math.min(1,k??0)),steps=Math.max(1,cfg.steps),low=Math.min(highM,cfg.radiusM);
  const raw=highM+(low-highM)*value,want=Math.round(value*steps);
  const radius=(r)=>highM+(low-highM)*r/steps;
  if(state.rung==null)state.rung=want;
  else if(want!==state.rung){
    const boundary=radius(state.rung+Math.sign(want-state.rung)*.5);
    if(Math.abs(raw-boundary)>cfg.hysteresisM)state.rung=want;
  }
  return radius(state.rung);
}
export function createShadingState(){return {camera:null,ao:null,shadow:createGroundShadowState(),epoch:null};}
function capture(state,key,target,keys){
  if(state[key]?.target!==target)restore(state,key);
  if(!state[key]){
    const base=Object.fromEntries(keys.map(k=>[k,target[k]]));
    state[key]={target,base,last:{...base}};
  }
  return state[key];
}
function restore(state,key){
  const snap=state[key];if(!snap)return;
  for(const k of Object.keys(snap.base))if(snap.target[k]===snap.last[k])snap.target[k]=snap.base[k];
  if(key==='camera')snap.target.updateProjectionMatrix();
  state[key]=null;
}
export function restoreGroundShading(runtime,state){
  restore(state,'camera');restore(state,'ao');state.shadow.rung=null;
  if(runtime)runtime.shadowRadiusM=undefined;
}
export function stepGroundShading(runtime,state){
  const light=runtime.sunLight,camera=light?.shadow?.camera,ao=runtime.aoPass?.configuration;
  const k=Math.max(0,Math.min(1,runtime.groundImmersion?.k??0));
  const epoch=runtime.groundImmersion?.epoch;
  if(state.epoch!==epoch){state.shadow.rung=null;state.epoch=epoch;}
  let radius=null;
  if(camera){
    const snap=capture(state,'camera',camera,['left','right','top','bottom']);
    // React can rewrite camera props after a style/tier change; that new base
    // takes precedence over the values this rig last wrote.
    for(const key of Object.keys(snap.base))if(camera[key]!==snap.last[key])snap.base[key]=camera[key];
    const base=Math.max(Math.abs(snap.base.left),Math.abs(snap.base.right));
    radius=groundShadowRadius(state.shadow,k,base);
    if(camera.right!==radius||camera.left!==-radius||camera.top!==radius||camera.bottom!==-radius){
      camera.left=camera.bottom=-radius;camera.right=camera.top=radius;camera.updateProjectionMatrix();
      light.shadow.needsUpdate=true;
    }
    for(const key of Object.keys(snap.last))snap.last[key]=camera[key];
    runtime.shadowRadiusM=radius;
  }else restore(state,'camera');
  if(ao){
    const snap=capture(state,'ao',ao,['aoRadius','intensity']);
    const r=snap.base.aoRadius+(GROUND_SHADING.aoRadiusM-snap.base.aoRadius)*k;
    const i=snap.base.intensity+(GROUND_SHADING.aoIntensity-snap.base.intensity)*k;
    // n8ao's configuration Proxy resets accumulation for every write.
    if(Math.abs(ao.aoRadius-r)>.05)ao.aoRadius=r;
    if(Math.abs(ao.intensity-i)>.02)ao.intensity=i;
    snap.last.aoRadius=ao.aoRadius;snap.last.intensity=ao.intensity;
  }else restore(state,'ao');
  return {k,radiusM:radius,texelM:radius&&light?.shadow?.mapSize?.x?radius*2/light.shadow.mapSize.x:null,aoRadiusM:ao?.aoRadius??null,aoIntensity:ao?.intensity??null};
}

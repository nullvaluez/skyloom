/** Presentation budgets. Geographic identities and simulation never depend on these. */
const MiB = 1048576;
const profiles = {
  ultra: { name:'ultra', targetFps:60, cloudSteps:96, cloudScale:.5, maxCloudPixels:2073600, shadowSize:2048, cascades:3, shadowRangeM:3000, reflection:[1024,512], materialSize:1024, textureBytes:768*MiB, geometryBytes:256*MiB, draws:900, triangles:8000000 },
  // The prior lower-profile gates bound textures/draws/triangles, but reported
  // attached geometry separately. Do not invent a new historical geometry cap.
  high: { name:'high', targetFps:60, cloudSteps:72, cloudScale:.4, maxCloudPixels:1105920, shadowSize:1024, cascades:2, shadowRangeM:1800, reflection:[768,512], materialSize:512, textureBytes:300*MiB, draws:375, triangles:2200000 },
  medium: { name:'medium', targetFps:60, cloudSteps:32, cloudScale:.3, maxCloudPixels:360000, shadowSize:1024, cascades:1, shadowRangeM:600, reflection:[384,256], materialSize:256, textureBytes:300*MiB, draws:375, triangles:2200000 },
  phone: { name:'phone', targetFps:60, cloudSteps:32, cloudScale:.3, maxCloudPixels:360000, shadowSize:1024, cascades:1, shadowRangeM:500, reflection:null, materialSize:256, textureBytes:300*MiB, draws:375, triangles:2200000 },
  low: { name:'low', targetFps:60, cloudSteps:24, cloudScale:.2, maxCloudPixels:120000, shadowSize:512, cascades:0, shadowRangeM:0, reflection:null, materialSize:128, textureBytes:300*MiB, draws:375, triangles:2200000 },
};
profiles.phone.cloudLightSamples=2;
profiles.low.cloudLightSamples=2;
profiles.phoneLow = { ...profiles.low, name:'phone-low', targetFps:60 };
// Every governor rung must reduce real GPU work. Previously High 0→1 and
// Phone 0→1→2 returned the SAME object and spent entire cooldowns doing nothing.
profiles.highBalanced = { ...profiles.high, name:'high-balanced', cloudSteps:56 };
profiles.phoneBalanced = { ...profiles.phone, name:'phone-balanced', cloudSteps:28 };
profiles.phoneEconomy = { ...profiles.phone, name:'phone-economy', cloudSteps:24, cloudScale:.25, maxCloudPixels:250000 };
// Keep the mobile lighting shader and material variant stable while shedding
// atmospheric cost. Removing the final cascade changes every lit program;
// a smaller depth target retains contact/shadow cues without that transition.
profiles.phoneLean = { ...profiles.phoneEconomy, name:'phone-lean', cloudSteps:24, cloudScale:.2, maxCloudPixels:120000, shadowSize:512 };
export const CINEMA_PROFILES = Object.freeze(Object.fromEntries(Object.entries(profiles).map(([k,v])=>[k,Object.freeze(v)])));

/** Desired preset is a ceiling. All expensive systems consume the SAME effective profile. */
// scaleDemotes (TRUE EARTH, DEVICE_TIERS.ladderOrder): when false, render
// scale no longer demotes the profile. Each demotion drops a shadow cascade and
// recompiles every lit material, so the governor sequences them explicitly
// after render scale is spent. true = the rule as it has always been.
export function resolveCinemaProfile({preset='high', tier='high', scale=1, phone=false,effectLevel=0,scaleDemotes=true}={}) {
  if(tier==='low'||(scaleDemotes&&scale<.8))return phone?CINEMA_PROFILES.phoneLow:CINEMA_PROFILES.low;
  if(effectLevel>=3)return phone?CINEMA_PROFILES.phoneLean:CINEMA_PROFILES.low;
  if(phone)return effectLevel>=2 ? CINEMA_PROFILES.phoneEconomy : effectLevel>=1 ? CINEMA_PROFILES.phoneBalanced : CINEMA_PROFILES.phone;
  if(tier==='medium'||(scaleDemotes&&scale<.9)||effectLevel>=2)return CINEMA_PROFILES.medium;
  if(preset==='ultra')return effectLevel===0?CINEMA_PROFILES.ultra:CINEMA_PROFILES.high;
  return effectLevel>=1?CINEMA_PROFILES.highBalanced:CINEMA_PROFILES.high;
}

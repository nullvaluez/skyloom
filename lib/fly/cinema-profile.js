/** Presentation budgets. Geographic identities and simulation never depend on these. */
const MiB = 1048576;
const profiles = {
  ultra: { name:'ultra', targetFps:60, cloudSteps:96, cloudScale:.5, maxCloudPixels:2073600, shadowSize:2048, cascades:3, shadowRangeM:3000, reflection:[1024,512], materialSize:1024, textureBytes:768*MiB, geometryBytes:256*MiB, draws:900, triangles:8000000 },
  // The prior lower-profile gates bound textures/draws/triangles, but reported
  // attached geometry separately. Do not invent a new historical geometry cap.
  high: { name:'high', targetFps:60, cloudSteps:72, cloudScale:.4, maxCloudPixels:1105920, shadowSize:1024, cascades:2, shadowRangeM:1800, reflection:[768,512], materialSize:512, textureBytes:300*MiB, draws:375, triangles:2200000 },
  medium: { name:'medium', targetFps:60, cloudSteps:32, cloudScale:.3, maxCloudPixels:360000, shadowSize:1024, cascades:1, shadowRangeM:600, reflection:[384,256], materialSize:256, textureBytes:300*MiB, draws:375, triangles:2200000 },
  phone: { name:'phone', targetFps:30, cloudSteps:32, cloudScale:.3, maxCloudPixels:360000, shadowSize:1024, cascades:1, shadowRangeM:500, reflection:null, materialSize:256, textureBytes:300*MiB, draws:375, triangles:2200000 },
  low: { name:'low', targetFps:60, cloudSteps:16, cloudScale:.25, maxCloudPixels:160000, shadowSize:512, cascades:0, shadowRangeM:0, reflection:null, materialSize:128, textureBytes:300*MiB, draws:375, triangles:2200000 },
};
profiles.phoneLow = { ...profiles.low, name:'phone-low', targetFps:30 };
export const CINEMA_PROFILES = Object.freeze(Object.fromEntries(Object.entries(profiles).map(([k,v])=>[k,Object.freeze(v)])));

/** Desired preset is a ceiling. All expensive systems consume the SAME effective profile. */
export function resolveCinemaProfile({preset='high', tier='high', scale=1, phone=false,effectLevel=0}={}) {
  if(effectLevel>=3)return phone?CINEMA_PROFILES.phoneLow:CINEMA_PROFILES.low;
  if(tier==='low'||scale<.8)return phone?CINEMA_PROFILES.phoneLow:CINEMA_PROFILES.low;
  if(phone)return CINEMA_PROFILES.phone;
  if(tier==='medium'||scale<.9||effectLevel>=2)return CINEMA_PROFILES.medium;
  return preset==='ultra'&&effectLevel===0?CINEMA_PROFILES.ultra:CINEMA_PROFILES.high;
}

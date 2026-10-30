/** Presentation budgets. Geographic identities and simulation never depend on these. */
// SHIP PASS FRAME (FR-6): draws / triangles / texture and geometry bytes are
// VERDICT thresholds and come from the one budget table (lib/fly/tier-budgets.js);
// every rendering number below is unchanged.
import { BUDGET_TABLE, budgetBytes } from './tier-budgets';
const budget = (id) => ({ ...budgetBytes(id), draws: BUDGET_TABLE[id].draws, triangles: BUDGET_TABLE[id].triangles });
const profiles = {
  ultra: { name:'ultra', targetFps:60, cloudSteps:96, cloudScale:.5, maxCloudPixels:2073600, shadowSize:2048, cascades:3, shadowRangeM:3000, reflection:[1024,512], materialSize:1024, ...budget('ultra') },
  // The prior lower-profile gates bound textures/draws/triangles, but reported
  // attached geometry separately. Do not invent a new historical geometry cap.
  high: { name:'high', targetFps:60, cloudSteps:72, cloudScale:.4, maxCloudPixels:1105920, shadowSize:1024, cascades:2, shadowRangeM:1800, reflection:[768,512], materialSize:512, ...budget('high') },
  medium: { name:'medium', targetFps:60, cloudSteps:32, cloudScale:.3, maxCloudPixels:360000, shadowSize:1024, cascades:1, shadowRangeM:600, reflection:[384,256], materialSize:256, ...budget('medium') },
  phone: { name:'phone', targetFps:60, cloudSteps:32, cloudScale:.3, maxCloudPixels:360000, shadowSize:1024, cascades:1, shadowRangeM:500, reflection:null, materialSize:256, ...budget('phone') },
  low: { name:'low', targetFps:60, cloudSteps:24, cloudScale:.2, maxCloudPixels:120000, shadowSize:512, cascades:0, shadowRangeM:0, reflection:null, materialSize:128, ...budget('low') },
};
profiles.phone.cloudLightSamples=2;
profiles.low.cloudLightSamples=2;
// A phone at Low renders Low's work but is held to the phone's budget row.
profiles.phoneLow = { ...profiles.low, name:'phone-low', targetFps:60, ...budget('phone') };
// Every governor rung must reduce real GPU work. Previously High 0→1 and
// Phone 0→1→2 returned the SAME object and spent entire cooldowns doing nothing.
profiles.highBalanced = { ...profiles.high, name:'high-balanced', cloudSteps:56 };
// Ultra is the desktop default, so its first rung must shed real cost while
// keeping the three cascades (a cascade drop recompiles every lit program and
// DEVICE_TIERS.ladderOrder would otherwise spend render scale first). It
// keeps Ultra's shadows, materials and reflection and marches clouds at High's
// density and resolution, about half of Ultra's cloud cost.
profiles.ultraBalanced = { ...profiles.ultra, name:'ultra-balanced', cloudSteps:72, cloudScale:.4, maxCloudPixels:1105920 };
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
  if(tier==='medium'||(scaleDemotes&&scale<.9))return CINEMA_PROFILES.medium;
  if(preset==='ultra')return effectLevel===0?CINEMA_PROFILES.ultra:effectLevel===1?CINEMA_PROFILES.ultraBalanced:CINEMA_PROFILES.highBalanced;
  if(effectLevel>=2)return CINEMA_PROFILES.medium;
  return effectLevel>=1?CINEMA_PROFILES.highBalanced:CINEMA_PROFILES.high;
}

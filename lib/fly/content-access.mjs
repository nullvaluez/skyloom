import { ADVENTURES, LIVERIES } from './adventures.mjs';
export const PACKS = Object.freeze({
  'first-flights':{id:'first-flights',name:'First Flights',access:'free'},
  'wild-earth':{id:'wild-earth',name:'Wild Earth',access:'preview',researchPrice:9.99,currency:'USD'},
});
export const CONTENT = Object.freeze(Object.fromEntries([
  ...Object.keys(LIVERIES).map(id=>[`aircraft:${id}`,{kind:'aircraft',access:'free'}]),
  ...['world','visuals','operations','spotting','photo'].map(id=>[id,{kind:'feature',access:'free'}]),
  ...ADVENTURES.map(a=>[a.id,{kind:'adventure',packId:a.packId}]),
  ...Object.keys(LIVERIES).map(id=>[`livery:${id}`,{kind:'livery',access:'earned',rewardId:id}]),
]));
// UI policy only. Grants must come from a trusted server before sales launch.
// Production preview has no expiry. Save imports never supply these grants.
export function contentAccess(id,progress={},grants=[],packs=PACKS) {
  const item=CONTENT[id];
  if(!item)return {allowed:false,reason:'unavailable'};
  if(item.access==='free')return {allowed:true,reason:'free'};
  if(item.access==='earned')return {allowed:!!progress.rewards?.includes(item.rewardId),reason:'earned'};
  const pack=packs[item.packId];
  if(!pack)return {allowed:false,reason:'unavailable'};
  if(pack.access==='free'||pack.access==='preview')return {allowed:true,reason:pack.access};
  return {allowed:grants.includes(item.packId),reason:'pack'};
}

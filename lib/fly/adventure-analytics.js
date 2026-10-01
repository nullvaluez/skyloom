// Explicit, optional product events. No location, aircraft, screenshots or replay.
const ALLOWED = new Set(['adventure_started','adventure_checkpoint','adventure_completed','adventure_retried','reward_claimed','return_visit','pack_interest']);
const FIELDS = new Set(['adventureId','checkpoint','medal','rewardId','answer','packId','day']);
let client=null,loading=null,consent=false,generation=0;
export function sanitizeAdventureEvent(event){
  if(!event||!ALLOWED.has(event.event))return null;
  const properties=Object.fromEntries(Object.entries(event.properties||{}).filter(([k,v])=>(FIELDS.has(k)||['token','distinct_id','$device_id','$session_id','$lib','$lib_version','$process_person_profile','$is_identified'].includes(k))&&['string','number','boolean'].includes(typeof v)));
  properties.$geoip_disable=true;
  return {event:event.event,properties,timestamp:event.timestamp,uuid:event.uuid};
}
export function analyticsEnabled(){try{return localStorage.getItem('fly-analytics-consent')==='yes';}catch{return false;}}
export async function setAnalyticsConsent(value){
  consent=!!value;const token=++generation;
  try{localStorage.setItem('fly-analytics-consent',value?'yes':'no');}catch{/* optional */}
  if(!value){client?.opt_out_capturing();client=null;return;}
  const key=process.env.NEXT_PUBLIC_POSTHOG_KEY,host=process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if(!key||!host)return;
  try{
    loading??=import('posthog-js');const {default:posthog}=await loading;
    if(!consent||token!==generation)return;
    posthog.init(key,{api_host:host,autocapture:false,capture_pageview:false,capture_pageleave:false,capture_performance:false,capture_exceptions:false,disable_session_recording:true,disable_surveys:true,advanced_disable_feature_flags:true,person_profiles:'never',ip:false,persistence:'localStorage',opt_out_capturing_by_default:true,
      // SDK defaults include page URLs/referrers. Keep only the explicit schema
      // plus the anonymous identity needed to measure subsequent visits.
      before_send:sanitizeAdventureEvent,
    });
    posthog.opt_in_capturing({captureEventName:false});client=posthog;
  }catch{/* Telemetry must never stop flight. */}
}
export function trackAdventure(event,data={}){
  if(!consent||!client||!ALLOWED.has(event))return;
  const properties=Object.fromEntries(Object.entries(data).filter(([k,v])=>FIELDS.has(k)&&['string','number','boolean'].includes(typeof v)));
  try{client.capture(event,{...properties,$process_person_profile:false});}catch{/* optional */}
}
export async function recordVisit(){
  await setAnalyticsConsent(analyticsEnabled());
  if(!consent)return;
  try{const today=new Date().toISOString().slice(0,10),last=localStorage.getItem('fly-last-visit');if(last&&last!==today)trackAdventure('return_visit',{day:today});localStorage.setItem('fly-last-visit',today);}catch{/* optional */}
}

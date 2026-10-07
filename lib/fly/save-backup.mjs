import { validateProgress } from './adventure-controller.mjs';
import { ENCOUNTER_KEY, validateEncounterSave } from './encounters.mjs';
import { EXPLORATION_KEY, validateExploration } from './exploration.mjs';
import { PREFERENCES_KEY, validatePreferences } from './explorer-preferences.mjs';
const RAW_PREFERENCES={
  'fly-aircraft':['fighter','military','warbird-jet','warbird-prop','prop','glider','bizjet','airliner','cargo','flying-wing'],
  'fly-quality-tier':['low','medium','high','ultra'],'fly-sound-on':['0','1'],'fly-crash-mode':['stakes','forgiving'],
  'fly-chase-framing':['close','world'],'fly-encounters':['0','1'],
};
export const BACKUP_KEYS=['shadowadsb-passport','fly-atlas','fly-contracts','fly-contracts-active-v1','fly-adventures-v1',ENCOUNTER_KEY,EXPLORATION_KEY,PREFERENCES_KEY,...Object.keys(RAW_PREFERENCES)];
export const RECOVERY_KEY='fly-backup-recovery-v1';
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const textOrNull=v=>v==null||typeof v==='string';
const numberOrNull=v=>v==null||Number.isFinite(v);
const counts=v=>object(v)&&Object.values(v).every(n=>Number.isFinite(n)&&n>=0);
const validSpot=x=>object(x)&&typeof x.hex==='string'&&Number.isFinite(x.timestamp)&&['flight','registration','type','classification'].every(k=>textOrNull(x[k]))&&numberOrNull(x.rarity)&&(x.location==null||object(x.location)&&Number.isFinite(x.location.lat)&&Number.isFinite(x.location.lon)&&Math.abs(x.location.lat)<=90&&Math.abs(x.location.lon)<=180);
function safeTree(value,depth=0){
  if(depth>16)throw Error('Backup is too deeply nested.');
  if(typeof value==='number'&&!Number.isFinite(value))throw Error('Backup has invalid numbers.');
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)&&value.length>20000)throw Error('Backup contains too many records.');
  for(const [k,v]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))throw Error('Backup contains an invalid field.');safeTree(v,depth+1);}
}
function validateRecord(key,v){
  if(key in RAW_PREFERENCES){if(!RAW_PREFERENCES[key].includes(v))throw Error('Invalid saved flight preference.');return v;}
  if(key===EXPLORATION_KEY)return validateExploration(v);
  if(key===PREFERENCES_KEY)return validatePreferences(v);
  if(key===ENCOUNTER_KEY)return validateEncounterSave(v);
  if(!object(v))throw Error(`Invalid ${key} record.`);
  if(key==='fly-adventures-v1'){
    if(![1,2].includes(v.version)||!object(v.progress))throw Error('Unsupported adventure save.');
    return {version:2,progress:validateProgress(v.progress)};
  }
  if(key==='fly-contracts-active-v1'){
    const entries=rows=>Array.isArray(rows)&&rows.every(x=>object(x)&&typeof x.id==='string'&&Number.isFinite(x.progress)&&x.progress>=0&&Array.isArray(x.hits)&&x.hits.every(h=>typeof h==='string'));
    if(v.v!==1||!entries(v.active)||!Number.isInteger(v.poolIdx)||v.poolIdx<0||v.daily!=null&&(!object(v.daily)||typeof v.daily.dayKey!=='string'||!entries(v.daily.entries)))throw Error('Invalid active contracts.');
    const clean=x=>({id:x.id,progress:x.progress,hits:x.hits,done:x.done===true});
    return {v:1,poolIdx:v.poolIdx,active:v.active.map(clean),daily:v.daily?{dayKey:v.daily.dayKey,entries:v.daily.entries.map(clean)}:null};
  }
  const s=v.state;if(!object(s)||v.version!==0)throw Error(`Unsupported ${key} save.`);
  if(key==='shadowadsb-passport'){
    if(!Array.isArray(s.spottedAircraft)||!Array.isArray(s.badges)||!object(s.stats)||!Array.isArray(s.stats.uniqueTypes)||!Array.isArray(s.weeklyRareFinds))throw Error('Invalid logbook.');
    if(s.spottedAircraft.length>1000||!s.spottedAircraft.every(validSpot)||!s.weeklyRareFinds.every(validSpot)||!s.badges.every(x=>object(x)&&typeof x.id==='string'&&['name','description','icon'].every(k=>textOrNull(x[k]))&&numberOrNull(x.earnedAt))||!s.stats.uniqueTypes.every(x=>typeof x==='string'))throw Error('Invalid logbook entries.');
    if(!Number.isFinite(s.stats.totalSpotted)||s.stats.totalSpotted<0||!counts(s.stats.spotsByDay)||!counts(s.stats.spotsByType)||!['militaryCount','emergencyCount','helicopterCount','firstSpotDate','lastSpotDate'].every(k=>numberOrNull(s.stats[k]))||(s.stats.rarestFind!=null&&(!object(s.stats.rarestFind)||typeof s.stats.rarestFind.hex!=='string'||!Number.isFinite(s.stats.rarestFind.rarity)||!Number.isFinite(s.stats.rarestFind.timestamp))))throw Error('Invalid logbook statistics.');
  }
  if(key==='fly-atlas'&&(!Array.isArray(s.recents)||!s.recents.every(x=>object(x)&&typeof x.key==='string'&&typeof x.name==='string'&&textOrNull(x.kind)&&numberOrNull(x.at))||!Array.isArray(s.favorites)||!s.favorites.every(x=>typeof x==='string')||!counts(s.visits)))throw Error('Invalid travel log.');
  if(key==='fly-contracts'&&(!Number.isFinite(s.totalScore)||s.totalScore<0||!Number.isFinite(s.completedCount)||s.completedCount<0))throw Error('Invalid contract totals.');
  // Never merge arbitrary imported properties into a Zustand store (actions or
  // future entitlement fields must not survive this boundary).
  const keys=key==='shadowadsb-passport'?['spottedAircraft','badges','stats','weeklyRareFinds']:key==='fly-atlas'?['recents','favorites','visits']:['totalScore','completedCount'];
  return {version:0,state:Object.fromEntries(keys.map(k=>[k,s[k]]))};
}
export function parseBackup(text){
  if(typeof text!=='string'||text.length>4_000_000)throw Error('Backup must be smaller than 4 MB.');
  let b;try{b=JSON.parse(text);}catch{throw Error('This is not a readable JSON backup.');}
  safeTree(b);
  if(b?.format!=='skyloom-guest-backup'||b.version!==1||!object(b.data))throw Error('Unsupported Skyloom backup.');
  const data={};for(const [key,v]of Object.entries(b.data)){if(!BACKUP_KEYS.includes(key))throw Error('Backup contains unsupported data. Purchase ownership cannot be imported.');data[key]=validateRecord(key,v);}
  if(!Object.keys(data).length)throw Error('This backup contains no progress.');
  return {format:b.format,version:1,createdAt:b.createdAt,data};
}
export function createBackup(storage,overrides={}){
  const data={};for(const key of BACKUP_KEYS){if(key in overrides)continue;const raw=storage.getItem(key);if(raw)data[key]=key in RAW_PREFERENCES?raw:JSON.parse(raw);}
  Object.assign(data,overrides);
  return parseBackup(JSON.stringify({format:'skyloom-guest-backup',version:1,createdAt:new Date().toISOString(),data}));
}
export function restoreBackup(storage,input){
  const backup=parseBackup(typeof input==='string'?input:JSON.stringify(input));
  const previous=Object.fromEntries(BACKUP_KEYS.map(k=>[k,storage.getItem(k)]));
  // Recovery must be durable before touching a single live key.
  storage.setItem(RECOVERY_KEY,JSON.stringify({version:1,previous}));
  const written=[];
  try{for(const [key,v]of Object.entries(backup.data)){storage.setItem(key,key in RAW_PREFERENCES?v:JSON.stringify(v));written.push(key);}}
  catch(error){
    // Restore only successfully changed keys. Clearing every key first loses
    // untouched progress if storage starts rejecting all writes mid-import.
    let incomplete=false;
    for(const key of written.reverse())try{if(previous[key]==null)storage.removeItem(key);else storage.setItem(key,previous[key]);}catch{incomplete=true;}
    throw new Error(incomplete?'Restore was interrupted. A recovery copy remains; export your current session before closing.':'Restore failed. Previous progress was restored; storage may be full or blocked.',{cause:error});
  }
  return Object.keys(backup.data).length;
}
export function recoveryBackup(storage){
  const saved=JSON.parse(storage.getItem(RECOVERY_KEY)||'null');
  if(saved?.version!==1||!object(saved.previous))throw Error('No recovery backup is available.');
  const data={};for(const key of BACKUP_KEYS)if(saved.previous[key])data[key]=key in RAW_PREFERENCES?saved.previous[key]:JSON.parse(saved.previous[key]);
  return parseBackup(JSON.stringify({format:'skyloom-guest-backup',version:1,data}));
}

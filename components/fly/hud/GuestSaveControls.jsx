'use client';
import { useRef, useState } from 'react';
import { useAdventureStore } from '@/stores/adventure-store';
import { useEncounterStore } from '@/stores/encounter-store';
import { useExplorationStore } from '@/stores/exploration-store';
import { PREFERENCES_KEY, explorerPreferences } from '@/lib/fly/explorer-preferences.mjs';
import { EXPLORATION_KEY } from '@/lib/fly/exploration.mjs';
import { createBackup, parseBackup, restoreBackup, recoveryBackup, RECOVERY_KEY } from '@/lib/fly/save-backup.mjs';
import { analyticsEnabled, setAnalyticsConsent } from '@/lib/fly/adventure-analytics';
import { usePassportStore } from '@/stores/passport-store';
import { useFlyAtlasStore } from '@/stores/fly-atlas-store';
import { useFlyContractsStore } from '@/stores/fly-contracts-store';
import { currentContractSnapshot } from '@/lib/fly/contract-progress';
function currentRecords(){
  useExplorationStore.getState().hydrate();
  useEncounterStore.getState().hydrate();
  const p=usePassportStore.getState(),a=useFlyAtlasStore.getState(),c=useFlyContractsStore.getState();
  const active=currentContractSnapshot();
  return {[EXPLORATION_KEY]:useExplorationStore.getState().journal,[PREFERENCES_KEY]:{version:1,settings:explorerPreferences()},...(active?{'fly-contracts-active-v1':active}:{}),'fly-adventures-v1':{version:2,progress:useAdventureStore.getState().progress},
    'fly-encounters-v1':{version:1,memories:useEncounterStore.getState().memories},
    'shadowadsb-passport':{version:0,state:{spottedAircraft:p.spottedAircraft,badges:p.badges,stats:{...p.stats,uniqueTypes:Array.from(p.stats.uniqueTypes||[])},weeklyRareFinds:p.weeklyRareFinds}},
    'fly-atlas':{version:0,state:{recents:a.recents,favorites:a.favorites,visits:a.visits}},
    'fly-contracts':{version:0,state:{totalScore:c.totalScore,completedCount:c.completedCount}},
  };
}
export function GuestSaveControls(){
  const input=useRef(),[pending,setPending]=useState(null),[message,setMessage]=useState(''),[consent,setConsent]=useState(analyticsEnabled);
  const sessionOnly=useAdventureStore(s=>s.sessionOnly);
  const explorerSessionOnly=useExplorationStore(s=>s.sessionOnly);
  const [hasRecovery,setHasRecovery]=useState(()=>{try{return !!localStorage.getItem(RECOVERY_KEY);}catch{return false;}});
  const exportSave=()=>{try{const storage={getItem(key){try{return localStorage.getItem(key);}catch{return null;}}};const data=createBackup(storage,currentRecords());const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`skyloom-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('Backup downloaded. Keep it somewhere safe.');}catch{setMessage('Backup could not be read. Your current game is unchanged.');}};
  const read=async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{if(file.size>4_000_000)throw Error('Backup must be smaller than 4 MB.');setPending(parseBackup(await file.text()));setMessage('');}catch(error){setMessage(error.message);}};
  const restore=()=>{try{restoreBackup(localStorage,pending);window.location.reload();}catch(error){setMessage(error.message||'Restore failed. Export your current progress before leaving.');setPending(null);try{setHasRecovery(!!localStorage.getItem(RECOVERY_KEY));}catch{}}};
  return <section className="journey-save" aria-label="Guest saves">
    <strong>Your progress</strong><p>{sessionOnly||explorerSessionOnly?'Some progress could not be saved. Export a backup before leaving.':'Saved in this browser. Export a backup to keep your discoveries safe.'}</p>
    <div className="journey-actions"><button type="button" onClick={exportSave}>Export backup</button><button type="button" onClick={()=>input.current?.click()}>Import backup</button></div>
    <input ref={input} type="file" accept="application/json,.json" hidden onChange={read}/>
    {hasRecovery&&<button onClick={()=>{try{setPending(recoveryBackup(localStorage));setMessage('Review the recovery before restoring.');}catch(error){setMessage(error.message);}}}>Recover previous save</button>}
    {pending&&<div role="alert"><p>Restore {Object.keys(pending.data).length} progress records? Matching local records will be replaced. A recovery copy is saved first.</p><div className="journey-actions"><button onClick={restore}>Restore and reload</button><button onClick={()=>setPending(null)}>Cancel</button></div></div>}
    {message&&<p role="status">{message}</p>}
    <label className="journey-consent"><input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);setAnalyticsConsent(e.target.checked);}}/><span>Share optional adventure usage to improve Skyloom</span></label>
    <p>No photos or flight locations. No session recordings. Play works with this off.</p>
  </section>;
}

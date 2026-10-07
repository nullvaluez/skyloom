'use client';
import { useSyncExternalStore } from 'react';
import { DEFAULT_PREFERENCES, explorerPreferences, setExplorerPreferences, subscribeExplorerPreferences } from '@/lib/fly/explorer-preferences.mjs';

export function FlightComfortSettings() {
  const prefs = useSyncExternalStore(subscribeExplorerPreferences, explorerPreferences, () => DEFAULT_PREFERENCES);
  return <section className="space-y-3 rounded-md border border-zinc-700/60 p-3" aria-label="Flight comfort">
    <h3 className="text-sm font-medium">Make yourself comfortable</h3>
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">Steering sensitivity
      <input aria-label="Steering sensitivity" type="range" min="0.5" max="1.75" step="0.05" value={prefs.sensitivity} onChange={e=>setExplorerPreferences({sensitivity:Number(e.target.value)})}/>
      <output>{prefs.sensitivity.toFixed(2)}×</output>
    </label>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={prefs.invertPitch} onChange={e=>setExplorerPreferences({invertPitch:e.target.checked})}/>Invert pitch</label>
    {[['master','Master volume'],['effects','Engine and effects'],['music','Music']].map(([key,label])=><label key={key} className="flex min-h-11 items-center justify-between gap-3 text-sm">{label}<input aria-label={label} type="range" min="0" max="1" step="0.05" value={prefs[key]} onChange={e=>setExplorerPreferences({[key]:Number(e.target.value)})}/><output>{Math.round(prefs[key]*100)}%</output></label>)}
    <button type="button" className="min-h-11 text-sm underline underline-offset-4" onClick={()=>setExplorerPreferences({tutorial:'new'})}>Show first-flight tips again</button>
  </section>;
}

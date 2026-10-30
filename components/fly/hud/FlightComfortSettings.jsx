'use client';
import { useSyncExternalStore } from 'react';
import { DEFAULT_PREFERENCES, explorerPreferences, setExplorerPreferences, subscribeExplorerPreferences } from '@/lib/fly/explorer-preferences.mjs';
import { useIsTouch } from '@/hooks/use-is-touch';

export function FlightComfortSettings() {
  const prefs = useSyncExternalStore(subscribeExplorerPreferences, explorerPreferences, () => DEFAULT_PREFERENCES);
  const touch = useIsTouch();
  return <section className="space-y-3 rounded-md border border-zinc-700/60 p-3" aria-label="Flight comfort">
    <h3 className="text-sm font-medium">Make yourself comfortable</h3>
    {!touch && <>
      <label className="flight-steering-input flex min-h-11 flex-wrap items-center justify-between gap-3 text-sm">Steering input
        <select aria-label="Steering input" className="min-h-11 min-w-0 rounded-md border border-zinc-600 bg-zinc-900 px-2 text-sm text-zinc-100" value={prefs.steeringInput} onChange={e=>setExplorerPreferences({steeringInput:e.target.value})}>
          <option value="mouse">Mouse + keyboard</option>
          <option value="keyboard">Keyboard / trackpad</option>
        </select>
      </label>
      <p className="flight-steering-note text-xs leading-relaxed text-zinc-400">{prefs.steeringInput === 'keyboard'
        ? 'WASD or arrows steer. Drag the view to look around; release to return.'
        : 'Move the pointer to steer. WASD or arrows take over when pressed. Choose Keyboard / trackpad to keep the cursor free.'}</p>
    </>}
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">Steering sensitivity
      <input aria-label="Steering sensitivity" type="range" min="0.5" max="1.75" step="0.05" value={prefs.sensitivity} onChange={e=>setExplorerPreferences({sensitivity:Number(e.target.value)})}/>
      <output>{prefs.sensitivity.toFixed(2)}×</output>
    </label>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={prefs.invertPitch} onChange={e=>setExplorerPreferences({invertPitch:e.target.checked})}/>Invert pitch</label>
    {[['master','Master volume'],['effects','Engine and effects'],['music','Music']].map(([key,label])=><label key={key} className="flex min-h-11 items-center justify-between gap-3 text-sm">{label}<input aria-label={label} type="range" min="0" max="1" step="0.05" value={prefs[key]} onChange={e=>setExplorerPreferences({[key]:Number(e.target.value)})}/><output>{Math.round(prefs[key]*100)}%</output></label>)}
    <button type="button" className="min-h-11 text-sm underline underline-offset-4" onClick={()=>setExplorerPreferences({tutorial:'new'})}>Show first-flight tips again</button>
  </section>;
}

'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Binoculars, Compass, Headphones, Moon, Navigation, Volume2, VolumeX, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import './observatory.css';

export function useObservatory(runtime, id) {
  const [state, setState] = useState(null);
  useEffect(() => {
    const read = () => setState(runtime.airportWatch?.observatory?.snapshot() ?? null);
    read();
    const timer = setInterval(read, 200);
    return () => clearInterval(timer);
  }, [runtime, id]);
  return state;
}

const viewName = (v) => v === 'back' ? 'Rear window' : v === 'upper' ? 'Upper lounge' : 'Front window';
const bearing = (v) => String(Math.round(((v || 0) % 360 + 360) % 360)).padStart(3, '0') + '°';
const distance = (m) => m < 1000 ? Math.round(m / 50) * 50 + ' m' : (m / 1000).toFixed(1) + ' km';

/** Fit the real airport and nearby contacts together; a selected distant
 * contact expands this same geographic frame instead of disappearing. */
export function AirportDiagram({ state, onSelect }) {
  const selected = state.contacts.find((c) => c.selected);
  const nearby = state.contacts.filter((c) => c.distanceM <= 18000).slice(0, 8);
  const points = [...state.runways.flatMap((r) => [r.a, r.b]), ...nearby, ...(selected ? [selected] : [])];
  const extent = Math.max(1200, ...points.flatMap((p) => [Math.abs(p.x), Math.abs(p.z)])) * 1.15;
  const scale = 112 / extent;
  const p = (v) => [180 + v.x * scale, 139 + v.z * scale];
  const km = extent > 6000 ? 5 : extent > 2500 ? 2 : 1;
  return <svg className="observatory-diagram" viewBox="0 0 360 278" role="group" aria-label="Airport map. Front window above; rear window below. Select an aircraft to show its direction.">
    <path className="observatory-map-axis" d="M180 34V244 M26 139H334" />
    <text x="180" y="22" textAnchor="middle">Front window</text>
    {state.runways.map((r) => {
      const a = p(r.a), b = p(r.b);
      return <g key={r.id}><line className="observatory-runway" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={Math.max(2.5, r.widthM * scale)} /><text x={Math.min(300, Math.max(20, a[0] + 5))} y={a[1] - 7}>{r.label}</text></g>;
    })}
    {selected && <line className="observatory-map-bearing" x1="180" y1="139" x2={p(selected)[0]} y2={p(selected)[1]} />}
    <circle cx="180" cy="139" r="12" className="observatory-map-origin" />
    <path d="M180 132 L185 144 L180 142 L175 144 Z" className="observatory-you" />
    <text x="195" y="143" className="observatory-map-you">You</text>
    {state.contacts.filter((c) => Math.abs(c.x) < extent && Math.abs(c.z) < extent).map((c) => {
      const [x, y] = p(c);
      return <g key={c.hex} className="observatory-dot" data-selected={c.selected ? '1' : '0'} role="button" tabIndex={0} aria-label={'Select ' + c.label} onClick={() => onSelect(c.hex)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.hex); } }}>
        <title>{c.label} · {distance(c.distanceM)} · {c.phaseLabel || 'Live position'}</title>
        <circle cx={x} cy={y} r="13" className="observatory-dot-hit" /><circle cx={x} cy={y} r={c.selected ? 5 : 3.5} />
        {(c.selected || nearby.slice(0, 3).includes(c)) && <text x={Math.min(x + 8, 300)} y={y - 7}>{c.label}</text>}
      </g>;
    })}
    <path className="observatory-map-scale" d={'M22 252v4h' + km * 1000 * scale + 'v-4'} />
    <text x="22" y="245">{km} km</text>
    <text x="180" y="264" textAnchor="middle">{state.stations.some((s) => s.side === 'back') ? 'Rear window' : 'Lounge entrance'}</text>
  </svg>;
}

export function ObservatoryHud({ runtime, state, hidden }) {
  const sound = useFlyStore((s) => s.soundOn);
  const o = runtime.airportWatch?.observatory;
  if (!o || !state || hidden) return null;
  const active = state.stations.find((s) => s.id === state.active);
  const selected = state.contacts.find((c) => c.selected);
  const choose = (hex) => o.selectContact(hex);
  const direct = (hex) => { o.showDirection(hex); o.release(); };
  const binocular = runtime.airportWatch.binocular;
  const windowControls = state.stations.filter((s) => s.available && s.nearby && ['listen', 'support'].includes(s.kind));
  const suggestion = active?.kind === 'compass' ? state.suggestions[active.side] : null;
  return <>
    {!active && !windowControls.length && state.prompt && !binocular && !runtime.airportWatch.seatMenu && <button type="button" className="observatory-prompt lounge-panel" data-testid="observatory-prompt" onClick={() => o.activate(state.prompt.id)}>
      <span>{state.prompt.action}</span><kbd>Enter</kbd>
    </button>}
    {!active && !!windowControls.length && !binocular && !runtime.airportWatch.seatMenu && <div className="observatory-nearby lounge-panel" aria-label="Controls at this window">
      {windowControls.map((s) => <button type="button" key={s.id} data-testid={'instrument-' + s.id} onClick={() => o.activate(s.id, { remote: true })}>{s.kind === 'listen' ? <Headphones size={16} /> : <Binoculars size={16} />}<span>{s.kind === 'listen' ? 'Hear outside' : 'Rest binoculars'}</span>{state.prompt?.id === s.id && <kbd>Enter</kbd>}</button>)}
    </div>}
    {state.cue && <div className="observatory-direction" role="status" data-testid="observatory-direction">
      <Navigation size={16} aria-hidden="true" /><span><strong>{state.cue.label}</strong> · {state.cue.viewLabel || (state.cue.side ? viewName(state.cue.side) : 'Look toward')} · {bearing(state.cue.bearing)}</span>
      <button type="button" aria-label="Dismiss direction" onClick={() => o.showDirection(null)}><X size={15} /></button>
    </div>}
    {active?.kind === 'table' && !binocular && <aside className="observatory-panel lounge-panel" data-testid="observatory-panel" aria-label="Airport map" data-overlay="observatory">
      <header><div><h2>Airport map</h2><p>Choose an aircraft. Find its window.</p></div><button type="button" className="observatory-close" aria-label="Close airport map" onClick={() => o.release()}><X size={19} /></button></header>
      <AirportDiagram state={state} onSelect={choose} />
      <div className="observatory-list-heading"><h3>Nearby aircraft</h3><span>{state.contacts.length} live</span></div>
      <div className="observatory-contact-list" aria-label="Aircraft near this airport">
        {state.contacts.slice(0, 12).map((c) => <button type="button" key={c.hex} aria-pressed={c.selected} onClick={() => choose(c.hex)}>
          <span className="observatory-contact-name"><strong>{c.label}</strong><small>{c.phaseLabel || 'Live position'}</small></span>
          <span className="observatory-contact-distance">{distance(c.distanceM)}<small>{c.bestViewLabel || (c.bestView ? viewName(c.bestView) : 'View unconfirmed')}</small></span>
          <ArrowUpRight size={15} aria-hidden="true" />
        </button>)}
        {!state.contacts.length && <p className="observatory-empty">{runtime.trafficStatus?.state === 'live' ? 'No live aircraft nearby right now.' : 'Waiting for current aircraft positions.'}<br />The runway map is still here to explore.</p>}
      </div>
      {selected ? <div className="observatory-selection">
        <p><strong>{selected.label}</strong>{selected.bestView ? <span>Walk to the {(selected.bestViewLabel || viewName(selected.bestView)).toLowerCase()}.</span> : <span>Its position is live; a clear window view isn’t confirmed.</span>}</p>
        <button type="button" className="observatory-action" onClick={() => direct(selected.hex)}><Navigation size={16} />Show me the direction</button>
      </div> : <p className="observatory-map-hint">Select a dot or an aircraft above to see where to look.</p>}
      {!state.runways.length && <p className="observatory-note">Runway details are still loading.</p>}
    </aside>}
    {active && !['table', 'support'].includes(active.kind) && !binocular && <aside className="observatory-window-panel lounge-panel" data-testid="observatory-panel" data-overlay="observatory" aria-label={active.kind === 'listen' ? 'Window audio' : active.label}>
      <button type="button" className="observatory-close" aria-label="Close window control" onClick={() => o.release()}><X size={17} /></button>
      {active.kind === 'listen' && <>
        <Headphones size={20} aria-hidden="true" /><h2>Hear outside</h2>
        <p>{sound ? 'Drag to look around. The microphone listens where you look.' : 'Sound is off. Turn it on to hear aircraft outside this window.'}</p>
        <div className="observatory-audio-status"><meter min="0" max="1" value={state.listening?.level || 0} aria-label="Estimated aircraft sound level" /><span>{(state.listening?.level || 0) > .015 ? 'Aircraft nearby' : 'Quiet in this direction'}</span><output>{bearing(state.listening?.worldBearing)}</output></div>
        <button type="button" className="observatory-text-action" onClick={() => useFlyStore.getState().setSoundOn(!sound)}>{sound ? <VolumeX size={15} /> : <Volume2 size={15} />}{sound ? 'Mute' : 'Turn sound on'}</button>
      </>}
      {active.kind === 'compass' && <>
        <Compass size={20} aria-hidden="true" /><h2>{suggestion?.text || 'The view is yours'}</h2>
        <p>{suggestion ? suggestion.label + ' · ' + viewName(active.side) : 'No live aircraft has a confirmed clear view from this window right now.'}</p>
        {suggestion && <button type="button" className="observatory-action" onClick={() => direct(suggestion.hex)}><Navigation size={15} />Show direction</button>}
      </>}
      {active.kind === 'night' && <>
        <Moon size={20} aria-hidden="true" /><h2>{state.night ? 'Lights dimmed' : 'Lounge lighting'}</h2><p>The stairs and walking routes stay lit.</p>
        <button type="button" className="observatory-action" aria-pressed={state.night} onClick={() => o.toggleNight()}>{state.night ? 'Restore lighting' : 'Dim the lounge'}</button>
      </>}
    </aside>}
  </>;
}

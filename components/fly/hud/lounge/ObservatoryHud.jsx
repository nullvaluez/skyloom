'use client';
import { useEffect, useState } from 'react';
import { Binoculars, Compass, Headphones, Map, Moon, Navigation, X } from 'lucide-react';
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

const icons = { table: Map, listen: Headphones, support: Binoculars, compass: Compass, night: Moon };
const viewName = (v) => v === 'back' ? 'Rear window' : 'Front window';
const bearing = (v) => `${String(Math.round(v || 0) % 360).padStart(3, '0')}°`;

/** Real runway geometry, scaled uniformly; the table and HUD share room-local metres. */
export function AirportDiagram({ state, onSelect }) {
  const points = state.runways.flatMap((r) => [r.a, r.b]);
  const extent = Math.max(1000, ...points.flatMap((p) => [Math.abs(p.x), Math.abs(p.z)]));
  const scale = 145 / extent;
  const p = (v) => [180 + v.x * scale, 175 + v.z * scale];
  return (
    <svg className="observatory-diagram" viewBox="0 0 360 350" role="group" aria-label="Live airport diagram. Top is the front window; bottom is the rear window.">
      <text x="180" y="21" textAnchor="middle">FRONT WINDOW</text>
      {state.runways.map((r) => {
        const a = p(r.a), b = p(r.b);
        return <g key={r.id}><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={Math.max(3, r.widthM * scale)} /><text x={a[0] + 6} y={a[1] - 6}>{r.label}</text></g>;
      })}
      <path d="M180 165 L187 182 L180 179 L173 182 Z" className="observatory-you" />
      <text x="191" y="182">LOUNGE</text>
      {state.contacts.filter((c) => Math.abs(c.x) < extent && Math.abs(c.z) < extent).map((c) => {
        const [x, y] = p(c);
        return <g key={c.hex} className="observatory-dot" data-selected={c.selected ? '1' : '0'} role="button" tabIndex={0} aria-label={`Select ${c.label}`} onClick={() => onSelect(c.hex)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.hex); } }}>
          <title>{c.label} · {c.phaseLabel || 'Live position'}</title><circle cx={x} cy={y} r="12" className="observatory-dot-hit" /><circle cx={x} cy={y} r={c.selected ? 5 : 3} />
        </g>;
      })}
      <text x="180" y="335" textAnchor="middle">{state.stations.some((s) => s.side === 'back') ? 'REAR WINDOW' : 'ROOM BEHIND YOU'}</text>
    </svg>
  );
}

export function ObservatoryHud({ runtime, state, hidden }) {
  const o = runtime.airportWatch?.observatory;
  if (!o || !state || hidden) return null;
  const active = state.stations.find((s) => s.id === state.active);
  const selected = state.contacts.find((c) => c.selected);
  const choose = (hex) => o.selectContact(hex);
  return <>
    {!active && state.prompt && !runtime.airportWatch.binocular && !runtime.airportWatch.seatMenu && <button type="button" className="observatory-prompt lounge-panel" data-testid="observatory-prompt" onClick={() => o.activate(state.prompt.id)}>
      <span>{state.prompt.action}</span><kbd>Enter</kbd>
    </button>}
    {state.cue && <div className="observatory-direction" role="status" data-testid="observatory-direction">
      <Navigation size={17} aria-hidden="true" /><span>{state.cue.label} · {state.cue.side ? viewName(state.cue.side) : 'Bearing'} · {bearing(state.cue.bearing)}</span>
      <button type="button" aria-label="Dismiss direction" onClick={() => o.showDirection(null)}><X size={15} /></button>
    </div>}
    {active && active.kind !== 'support' && !runtime.airportWatch.binocular && <aside className="observatory-panel lounge-panel" data-testid="observatory-panel" aria-label="Observatory instruments" data-overlay="observatory">
      <header><h2>{active.label}</h2><button type="button" className="tgt-iconbtn" aria-label="Close instruments" onClick={() => o.release()}><X size={18} /></button></header>
      <nav aria-label="Room instruments" className="observatory-tabs">
        {state.stations.map((s) => { const Icon = icons[s.kind]; return <button key={s.id} type="button" aria-label={s.label} title={s.reason || s.label} aria-pressed={s.id === active.id} disabled={!s.available} onClick={() => o.activate(s.id, { remote: true })} data-testid={`instrument-${s.id}`}><Icon size={16} aria-hidden="true" /><span>{s.side === 'back' ? 'Rear ' : ''}{s.kind === 'table' ? 'Table' : s.kind === 'listen' ? 'Listen' : s.kind === 'support' ? 'Rail' : s.kind === 'night' ? 'Night' : 'Compass'}</span></button>; })}
      </nav>
      {active.kind === 'table' && <>
        <AirportDiagram state={state} onSelect={choose} />
        <p className="observatory-note">Live positions · movement inferred from tracks</p>
        {!state.runways.length && <p className="observatory-note">Runway geometry is not available yet.</p>}
        <div className="observatory-contact-list" aria-label="Aircraft near this airport">
          {state.contacts.slice(0, 24).map((c) => <button type="button" key={c.hex} aria-pressed={c.selected} onClick={() => choose(c.hex)}><strong>{c.label}</strong><span>{c.phaseLabel || 'Live position'}</span><small>{c.bestView ? viewName(c.bestView) : 'View not verified'}</small></button>)}
          {!state.contacts.length && <p>No fresh aircraft positions. The airport diagram remains available.</p>}
        </div>
        {selected && <div className="observatory-selection"><span><strong>{selected.label}</strong>{selected.bestView ? ` · Best view: ${viewName(selected.bestView).toLowerCase()}` : ' · No clear window view verified'}</span><button type="button" onClick={() => { o.showDirection(selected.hex); o.release(); }}><Navigation size={15} />Show direction</button></div>}
      </>}
      {active.kind === 'listen' && <div className="observatory-listen">
        <Headphones size={28} aria-hidden="true" /><p>Turn the exterior microphone. Your view stays where it is.</p>
        <label htmlFor="observatory-bearing">Listening bearing <output>{bearing(state.listening?.worldBearing)}</output></label>
        <input id="observatory-bearing" type="range" min="0" max="359" step="1" value={Math.round(state.listening?.bearing || 0)} onChange={(e) => o.setBearing(Number(e.target.value))} />
        <meter min="0" max="1" value={state.listening?.level || 0} aria-label="Estimated aircraft sound level" />
        <p className="observatory-note">Estimated level from live tracks. Sound arrives after the aircraft moves. Walking away releases the microphone.</p>
      </div>}
      {active.kind === 'compass' && <div className="observatory-compass">
        <Compass size={32} aria-hidden="true" />
        {state.suggestions[active.side] ? <><h3>{state.suggestions[active.side].text}</h3><p>{state.suggestions[active.side].label}</p><button type="button" onClick={() => { o.showDirection(state.suggestions[active.side].hex); o.release(); }}>Show direction</button></> : <><h3>A quiet window</h3><p>No fresh activity with a verified clear view right now.</p></>}
        <p className="observatory-note">Suggestions follow the live sky. You choose when to look.</p>
      </div>}
      {active.kind === 'night' && <div className="observatory-night"><Moon size={30} aria-hidden="true" /><h3>Let the airport lights come through</h3><p>Dim decorative lighting and its reflection in the glass. Walking routes stay illuminated.</p><button type="button" aria-pressed={state.night} onClick={() => o.toggleNight()}>{state.night ? 'Restore lounge lighting' : 'Dim for Night Watch'}</button></div>}
      <p className="observatory-note observatory-access">Listening and the rail become available beside their window. Press I to open or close instruments.</p>
    </aside>}
  </>;
}

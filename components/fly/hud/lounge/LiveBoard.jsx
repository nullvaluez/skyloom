'use client';
import { Binoculars, ChevronDown, ChevronUp, PlaneLanding, PlaneTakeoff, Radar, TowerControl } from 'lucide-react';
import { fmtEta, landedRow } from './SpotterCard';
import { SheetGrabber } from './LoungeSheet';

/*
 * LIVE BOARD — what is happening at this airport right now, from
 * runtime.airportWatch.board() (lib/fly/airport-watch-board.mjs): arrivals
 * lined up with a runway (or descending toward the field) with an ETA,
 * departures climbing out, traffic on the ground here, and what passes
 * overhead. A row selects the aircraft (the head follows it); the
 * binoculars button also raises the glasses on it. Inferred from live
 * positions — the footer says so.
 */

export const BOARD_TABS = [
  { id: 'arrivals', label: 'Arrivals', icon: PlaneLanding, empty: 'Nothing is lined up to land right now.' },
  { id: 'departures', label: 'Departures', icon: PlaneTakeoff, empty: 'Nobody is climbing out right now.' },
  { id: 'ground', label: 'Ground', icon: TowerControl, empty: 'Nothing is moving on the ground here.' },
  { id: 'overhead', label: 'Overhead', icon: Radar, empty: 'The sky above is quiet.' },
];

const km = (m) => (m < 9500 ? (m / 1000).toFixed(1) : String(Math.round(m / 1000)));
/** Altitude as a board shows it: flight levels up high, feet below. */
const ft = (m) => {
  const f = m * 3.28084;
  if (f >= 18000) return `FL${Math.round(f / 100)}`;
  // Short final and the first climb read in tens of feet, the rest in hundreds.
  const step = f < 1000 ? 10 : 100;
  return `${(Math.max(0, Math.round(f / step)) * step).toLocaleString()} ft`;
};

function Row({ row, tab, selected, onSelect, onBinoculars }) {
  const sub = [row.airline, row.type || row.typeCode].filter(Boolean).join(' · ') || 'Unidentified';
  const landed = landedRow(row);
  const eta = tab === 'arrivals' ? (landed ? 'down' : fmtEta(row.etaS)) : null;
  return (
    <div className="lb-row" data-selected={selected ? '1' : '0'} data-stale={row.stale ? '1' : '0'}>
      <button type="button" className="lb-main" aria-pressed={selected} data-testid={`lounge-board-row-${row.hex}`} onClick={() => onSelect(row.hex)} title={`Select ${row.label}`}>
        <span className="lb-id">
          <strong>{row.label}</strong>
          <small>{sub}</small>
        </span>
        <span className="lb-phase">{row.phaseLabel}</span>
        <span className="lb-num">
          <b>{km(row.distanceM)}</b> km
          <small>{row.category === 'ground' || landed ? 'on ground' : ft(row.altM)}</small>
        </span>
        {tab === 'arrivals' && <span className="lb-eta" data-soon={row.etaS < 120 ? '1' : '0'}>{eta || '—'}</span>}
      </button>
      <button type="button" className="lb-bino" aria-label={`Binoculars on ${row.label}`} title="Binoculars" onClick={() => onBinoculars(row.hex)}>
        <Binoculars size={15} />
      </button>
    </div>
  );
}

/**
 * `sheet` (LOUNGE MOBILE, phones only): the board is the phone's bottom sheet,
 * always open while shown, with a grabber that closes it (onToggle); without
 * it the board is today's panel, unchanged.
 */
export function LiveBoard({ board, tab, onTab, open, onToggle, selected, onSelect, onBinoculars, feed, sheet = false }) {
  const lists = {
    arrivals: board.arrivals,
    departures: board.departures,
    ground: board.ground,
    overhead: [...board.overhead, ...board.local],
  };
  const total = lists.arrivals.length + lists.departures.length + lists.ground.length + lists.overhead.length;
  const current = BOARD_TABS.find((t) => t.id === tab) || BOARD_TABS[0];
  const rows = lists[current.id];
  const empty =
    feed === 'unavailable' ? 'The live provider is unavailable. The lounge stays open; traffic returns when the feed recovers.'
      : feed === 'delayed' ? 'Waiting for fresh aircraft positions…'
        : current.empty;
  return (
    <section className={`lounge-panel lounge-board${open ? '' : ' is-collapsed'}`} data-testid="lounge-board" data-overlay="airport-board" aria-label="Live board" data-sheet={sheet ? 'expanded' : undefined}>
      {sheet && <SheetGrabber expanded onToggle={onToggle} onExpand={() => {}} onCollapse={onToggle} label="Close the live board" />}
      <header className="lb-head">
        <span className="lb-title">
          <i aria-hidden="true" />
          Live board
        </span>
        <span className="lb-total">{total} tracked</span>
        <button type="button" className="tgt-iconbtn" onClick={onToggle} aria-expanded={open} aria-controls="lounge-board-body" aria-label={open ? 'Collapse the live board' : 'Expand the live board'}>
          {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>
      </header>
      {open && (
        <div id="lounge-board-body" className="lb-body">
          <div className="lb-tabs" role="tablist" aria-label="Board lists">
            {BOARD_TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-testid={`lounge-board-tab-${t.id}`} onClick={() => onTab(t.id)}>
                  <Icon size={14} aria-hidden="true" />
                  <span>{t.label}</span>
                  <em data-zero={lists[t.id].length ? '0' : '1'}>{lists[t.id].length}</em>
                </button>
              );
            })}
          </div>
          <div className="lb-list" role="tabpanel" aria-label={current.label}>
            {rows.map((row, i) => (
              <div key={row.hex}>
                {current.id === 'overhead' && row.category === 'local' && rows[i - 1]?.category !== 'local' && <p className="lb-section">Nearby, low level</p>}
                <Row row={row} tab={current.id} selected={selected === row.hex} onSelect={onSelect} onBinoculars={onBinoculars} />
              </div>
            ))}
            {!rows.length && <p className="lb-empty">{empty}</p>}
          </div>
          <p className="lb-foot">Inferred from live positions — not a schedule.</p>
        </div>
      )}
    </section>
  );
}

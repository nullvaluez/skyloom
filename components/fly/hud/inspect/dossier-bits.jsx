'use client';

import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Odometer, Sparkline, countryFlag } from './card-bits';

/**
 * Atoms for the target dossier (InspectModal). Styles live in
 * ../target-ui.css; every number here is written by the dossier's 500 ms
 * telemetry read — nothing in this file runs per frame.
 */

const fmtInt = (v) => Math.round(v).toLocaleString();

/** One live readout tile: label, rolling number, a sub-line and a meter. */
function Tile({ label, extra, value, format, sub, meter, delay = 0 }) {
  return (
    <div className="tgt-tile">
      <label>
        {label}
        {extra}
      </label>
      <output>{Number.isFinite(value) ? <Odometer value={value} format={format} /> : '—'}</output>
      {sub && <small>{sub}</small>}
      {meter != null && (
        <motion.i
          className="tgt-tile-meter"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: Math.max(0.02, Math.min(1, meter)) }}
          transition={{ delay, type: 'spring', stiffness: 120, damping: 22 }}
        />
      )}
    </div>
  );
}

/**
 * ALT · SPEED · HEADING · RANGE. `live` is the dossier's telemetry sample;
 * `samples` the V/S ring (sparkline keeps its harness testid).
 */
export function TelemetryTiles({ live }) {
  const vs = live?.vsFpm ?? 0;
  const climbing = vs > 50;
  const descending = vs < -50;
  return (
    <div className="tgt-tiles" data-testid="inspect-telemetry">
      <Tile
        label="Alt"
        value={live?.altFt}
        format={(v) => fmtInt(v)}
        sub={
          <>
            <span className={climbing ? 'tgt-vs-up' : descending ? 'tgt-vs-down' : undefined}>
              {climbing ? '▲' : descending ? '▼' : '■'}
            </span>{' '}
            {Math.abs(vs) < 50 ? 'level' : `${fmtInt(Math.abs(vs))} fpm`}
          </>
        }
        meter={live ? live.altFt / 45000 : null}
        delay={0.05}
      />
      <Tile
        label="Speed"
        value={live?.gsKt}
        format={(v) => fmtInt(v)}
        sub="knots"
        meter={live ? live.gsKt / 600 : null}
        delay={0.1}
      />
      <Tile
        label="Hdg"
        extra={
          live && (
            <span className="tgt-needle" style={{ transform: `rotate(${live.hdg}deg)` }} aria-hidden="true">
              ▲
            </span>
          )
        }
        value={live?.hdg}
        format={(v) => `${String(Math.round(v) % 360).padStart(3, '0')}°`}
        sub={live ? compassWord(live.hdg) : null}
        delay={0.15}
      />
      <Tile
        label="Range"
        value={live?.distNm}
        format={(v) => (v < 10 ? v.toFixed(1) : fmtInt(v))}
        sub="nautical mi"
        meter={live ? 1 - Math.min(1, live.distNm / 40) : null}
        delay={0.2}
      />
    </div>
  );
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function compassWord(deg) {
  return `heading ${COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]}`;
}

/**
 * Where it is from YOU: a dial whose arrow points off your nose, the clock
 * position, the height difference and the climb trend. Carries the
 * historical `inspect-bearing` testid.
 */
export function RelativeRow({ live, samples }) {
  if (!live?.rel) return null;
  const { clock, relAltM, offDeg } = live.rel;
  const ft = relAltM * 3.28084;
  const aft = Math.abs(ft);
  const height =
    aft < 300
      ? 'level with you'
      : `${aft >= 1000 ? `${(aft / 1000).toFixed(1)}k` : fmtInt(aft)} ft ${ft > 0 ? 'above' : 'below'}`;
  return (
    <div className="tgt-rel" data-testid="inspect-bearing">
      <span className="tgt-rel-dial" aria-hidden="true">
        <i style={{ transform: `rotate(${Math.round(offDeg)}deg)` }} />
      </span>
      <span>
        <b>{clock} o&apos;clock</b> · {height}
        {live.closingKt != null && Math.abs(live.closingKt) > 15 && (
          <>
            {' '}
            · {live.closingKt > 0 ? 'closing' : 'opening'} <b>{fmtInt(Math.abs(live.closingKt))} kt</b>
          </>
        )}
      </span>
      <Sparkline samples={samples} width={64} height={22} />
    </div>
  );
}

function clockOf(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

/** Origin ━━✈━━ destination, with city names, progress and ETA. */
export function RouteStrip({ route, loading }) {
  const o = route?.origin;
  const d = route?.destination;
  if (!o && !d) {
    return (
      <div className="tgt-empty" data-busy={loading ? '1' : '0'} data-testid="inspect-route-unknown">
        {loading ? 'Route lookup…' : 'No filed route'}
      </div>
    );
  }
  const pct = route.progressPercent;
  const eta = clockOf(route.eta);
  const end = (ap, side) => {
    const flag = countryFlag(ap?.country);
    return (
      <div className="tgt-route-end" data-side={side}>
        <strong>{ap?.iata || ap?.icao || '···'}</strong>
        <span title={ap?.name || undefined}>
          {flag ? `${flag} ` : ''}
          {ap?.city || ap?.name || ''}
        </span>
      </div>
    );
  };
  return (
    <div className="tgt-route" data-testid="inspect-route">
      <div className="tgt-route-row">
        {end(o, 'l')}
        <div className="tgt-route-track">
          {pct != null && (
            <>
              <motion.i
                className="tgt-route-fill"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1], delay: 0.3 }}
              />
              <motion.svg
                className="tgt-route-plane"
                viewBox="0 0 24 24"
                initial={{ left: '0%', opacity: 0 }}
                animate={{ left: `${pct}%`, opacity: 1 }}
                transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1], delay: 0.3 }}
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"
                  transform="rotate(90 12 12)"
                />
              </motion.svg>
            </>
          )}
        </div>
        {end(d, 'r')}
      </div>
      {(route.distanceRemainingNm != null || eta || route.timeRemaining) && (
        <div className="tgt-route-sub">
          {route.distanceRemainingNm != null && (
            <span>
              <b>{route.distanceRemainingNm.toLocaleString()}</b> nm to go
            </span>
          )}
          {route.timeRemaining && (
            <span>
              <b>{route.timeRemaining}</b> left
            </span>
          )}
          {eta && (
            <span>
              ETA <b>{eta}</b>
            </span>
          )}
          {pct != null && (
            <span>
              <b>{Math.round(pct)}%</b> flown
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Collapsible registry / transponder facts. */
export function Facts({ open, onToggle, rows, provenance, provenanceBusy, children }) {
  return (
    <div className="tgt-facts">
      <button type="button" aria-expanded={open} onClick={onToggle}>
        Dossier
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <>
          <dl className="tgt-facts-grid" style={{ margin: 0 }}>
            {rows.map(([label, value, wide, testid]) => (
              <div key={label} className={`tgt-fact${wide ? ' tgt-fact-wide' : ''}`} data-testid={testid}>
                <dt>{label}</dt>
                <dd data-none={value ? '0' : '1'} title={typeof value === 'string' ? value : undefined}>
                  {value || '—'}
                </dd>
              </div>
            ))}
          </dl>
          {children}
          <div
            className="tgt-provenance"
            data-testid="inspect-registry-source"
            style={provenanceBusy ? { animation: 'tgt-pulse 1.4s ease-in-out infinite' } : undefined}
          >
            {provenance}
          </div>
        </>
      )}
    </div>
  );
}

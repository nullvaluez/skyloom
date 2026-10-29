'use client';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Binoculars, Camera, Crosshair, Info, Plane, PlaneLanding, PlaneTakeoff, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { useRoute } from '@/hooks/use-route';
import { useAircraftPhoto } from '@/hooks/use-aircraft-photo';
import { useAircraftInfo } from '@/hooks/use-aircraft-info';
import { M_TO_FT, MPS_TO_KT } from '@/lib/fly/coords';
import { LOUNGE_ROOM } from '@/lib/fly/observation-config';
import { trackPhase } from '@/lib/fly/flight-phase';
import { airlineFor, contactLabel, phaseLabel, typeNameFor } from '@/lib/fly/airport-watch-board.mjs';
import { CardToggle, SheetGrabber } from './LoungeSheet';

/*
 * SPOTTER CARD — the selected aircraft, in the target-ui language: the real
 * planespotters photo, callsign, operator (from the ICAO callsign tables,
 * then the route's airline, then the registry owner), the full type name,
 * the registration, the route, live altitude / speed / range / vertical
 * speed and the visual flight phase. Telemetry is read from the runtime at
 * 4 Hz; nothing here runs per frame.
 * Actions: Binoculars (B), Follow (F), Details (T, the existing dossier),
 * Join flight (the existing safe join) and Photo.
 */

const fmt = (n) => Math.round(n).toLocaleString();
const fmtKm = (m) => (m < 9500 ? (m / 1000).toFixed(1) : String(Math.round(m / 1000)));
export const fmtEta = (s) => {
  if (!Number.isFinite(s)) return null;
  if (s < 45) return 'now';
  const r = Math.round(s);
  if (r < 600) return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
  return `${Math.round(s / 60)} min`;
};
/** An arrival row whose aircraft is already on the ground has landed: no ETA. */
export const landedRow = (row) => row?.category === 'arrival' && (row.phase === 'runway' || row.phase === 'taxi' || row.phase === 'parked');

function readLive(runtime, hex, fieldElev) {
  const t = runtime.traffic?.tracks.get(hex);
  const w = runtime.airportWatch;
  if (!t?.fix1 || !w) return t ? { stale: t.stale ?? 2 } : null;
  const k = w.frame?.k || 1;
  // Ranged from the observer's eye (it walks with LOUNGE_WALK).
  const e = w.eyeWorld ? w.eyeWorld() : { x: w.seat.x, y: w.seat.y + LOUNGE_ROOM.eye[1], z: w.seat.z };
  const dx = (t.rx - e.x) / k, dz = (t.rz - e.z) / k, dy = (t.ry ?? 0) - e.y;
  let lat = null, lon = null;
  if (runtime.engine) {
    const g = runtime.engine.worldToGeo({ x: t.rx, y: t.ry, z: t.rz });
    lat = g.y;
    lon = g.x;
  }
  const phase = trackPhase(t, fieldElev);
  return {
    stale: t.stale ?? 0,
    grounded: !!(t.flags & 1),
    altFt: Math.max(0, (t.ry ?? 0) * M_TO_FT), // never a negative readout (GNSS heights dip below zero near sea level)
    gsKt: Math.hypot(t.fix1.vE, t.fix1.vN) * MPS_TO_KT,
    vsFpm: (t.fix1.vUp || 0) * M_TO_FT * 60,
    rangeM: Math.hypot(dx, dy, dz),
    trackDeg: ((Math.atan2(t.fix1.vE, t.fix1.vN) * 180) / Math.PI + 360) % 360,
    phase,
    visible: w.contactVisible(hex),
    lat,
    lon,
  };
}

/**
 * Callsign route databases lag reality (a reused flight number keeps last
 * season's city pair). When the aircraft is visibly landing here or taking
 * off from here and the filed route disagrees, the card says so instead of
 * presenting a contradiction as fact.
 */
function routeConflict(route, row, ident) {
  if (!route || !row || !ident) return false;
  if (row.category === 'arrival' && route.destination?.icao) return route.destination.icao !== ident;
  if (row.category === 'departure' && route.origin?.icao) return route.origin.icao !== ident;
  return false;
}

function RouteLine({ route, loading, conflict }) {
  const o = route?.origin, d = route?.destination;
  if (!o && !d) {
    return <div className="lc-route lc-route-empty">{loading ? 'Looking up the route…' : 'Route not published for this flight'}</div>;
  }
  const code = (a) => a?.iata || a?.icao || '···';
  const pct = Number.isFinite(route?.progressPercent) ? route.progressPercent : null;
  return (
    <div className="lc-route" data-testid="spotter-route" data-conflict={conflict ? '1' : '0'} title={conflict ? 'The route on file for this callsign does not match what the aircraft is doing here — it may be outdated.' : undefined}>
      {conflict && <span className="lc-route-flag">Route on file · may be outdated</span>}
      <div className="lc-route-end">
        <strong>{code(o)}</strong>
        <span title={o?.name}>{o?.city || o?.name || 'Origin'}</span>
      </div>
      <div className="lc-route-track" aria-hidden="true">
        <i style={{ width: `${pct ?? 50}%` }} />
        <Plane size={13} style={{ left: `${pct ?? 50}%` }} />
      </div>
      <div className="lc-route-end" data-side="r">
        <strong>{code(d)}</strong>
        <span title={d?.name}>{d?.city || d?.name || 'Destination'}</span>
      </div>
    </div>
  );
}

/**
 * `sheet` (LOUNGE MOBILE, phones only): { expanded, onToggle, onClose } makes
 * the card a bottom sheet — a grabber on top, the identity, phase and the
 * primary actions as its peek, and the route, figures and minor actions once
 * expanded (lounge-mobile.css). Without it the card is today's, unchanged.
 */
export function SpotterCard({ runtime, hex, boardRow, fieldElev, airportIdent, onPhoto, savingPhoto, sheet }) {
  const tracking = useFlyStore((s) => s.airportWatch?.tracking);
  const binocular = useFlyStore((s) => s.airportWatch?.binocular);
  const validated = useFlyStore((s) => s.airportWatch?.validated);
  const [live, setLive] = useState(() => readLive(runtime, hex, fieldElev));
  const [notice, setNotice] = useState('');
  const track = runtime.traffic?.tracks.get(hex);
  const meta = track?.meta || null;

  useEffect(() => {
    setNotice('');
    const tick = () => setLive(readLive(runtime, hex, fieldElev));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [runtime, hex, fieldElev]);

  // A callsign that is just the registration (most private flights) has no
  // published route: no lookup, so no failed request per selection.
  const routable = !!meta?.flight?.trim() && meta.flight.trim().replace(/-/g, '') !== String(meta.r || '').replace(/-/g, '');
  const shim = useMemo(
    () => (meta && routable ? { hex, flight: meta.flight, r: meta.r, t: meta.t, category: meta.category, lat: live?.lat ?? undefined, lon: live?.lon ?? undefined, gs: live?.gsKt, track: live?.trackDeg } : null),
    // The route lookup only needs the identity and a position; re-keying it
    // on every telemetry tick would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hex, meta, routable, live?.lat == null],
  );
  const { route, isLoading: routeLoading } = useRoute(shim);
  const { data: photo, isPending: photoPending } = useAircraftPhoto(hex);
  const { data: info } = useAircraftInfo(hex);
  const photoSrc = photo?.thumbnail_large?.src || photo?.thumbnail?.src || null;

  const w = runtime.airportWatch;
  const title = contactLabel(meta, hex);
  const operator = airlineFor(meta?.flight) || route?.airline?.name || info?.owner || (meta?.r ? 'Private or unlisted operator' : 'Operator unknown');
  const type = [info?.manufacturer, info?.model].filter(Boolean).join(' ') || typeNameFor(meta) || meta?.t || 'Type not broadcast';
  const reg = meta?.r || info?.registration || null;
  const lost = !track || live?.stale === 2;
  const phase = boardRow?.phaseLabel || (live?.phase ? phaseLabel(live.phase) : null);
  const eta = boardRow?.category === 'arrival' && !landedRow(boardRow) ? fmtEta(boardRow.etaS) : null;
  const PhaseIcon = boardRow?.category === 'arrival' ? PlaneLanding : boardRow?.category === 'departure' ? PlaneTakeoff : Plane;

  const join = () => {
    const result = w?.join(hex);
    if (result && !result.ok) setNotice(result.message);
  };

  return (
    <motion.aside
      className="lounge-panel lounge-card"
      data-testid="spotter-card"
      data-overlay="airport-spotter"
      aria-label={`Selected aircraft ${title}`}
      data-sheet={sheet ? (sheet.expanded ? 'expanded' : 'peek') : undefined}
      data-lounge-avoid={sheet ? '' : undefined}
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 340, damping: 30 }}
    >
      {sheet && <SheetGrabber expanded={sheet.expanded} onToggle={sheet.onToggle} onExpand={sheet.expanded ? () => {} : sheet.onToggle} onCollapse={sheet.expanded ? sheet.onToggle : sheet.onClose} label={sheet.expanded ? 'Show less of the selected aircraft' : 'Show more of the selected aircraft'} />}
      <div className="lc-hero">
        <div className="lc-photo" data-empty={photoSrc ? '0' : '1'}>
          {photoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- planespotters thumbnails are remote and already sized
            <img src={photoSrc} alt={`${title} — photograph`} />
          ) : (
            <Plane size={30} aria-hidden="true" />
          )}
          {photoSrc && photo?.photographer && (
            <a className="lc-credit" href={photo.link || 'https://www.planespotters.net'} target="_blank" rel="noreferrer" data-testid="spotter-photo-credit">
              © {photo.photographer}
            </a>
          )}
          {!photoSrc && <span className="lc-photo-state">{photoPending ? 'Photo lookup…' : 'No photo on file'}</span>}
        </div>
        <div className="lc-ident">
          <span className="lc-kicker" data-lost={lost ? '1' : '0'}>
            <i />
            {lost ? 'Signal lost' : live?.visible === false ? 'Out of view' : tracking ? (binocular ? 'Binoculars locked' : 'Following') : 'Selected'}
          </span>
          <h2 title={title}>{title}</h2>
          <p className="lc-operator" title={operator}>{operator}</p>
          <p className="lc-type" title={type}>
            <span>{type}</span>
            {reg && reg !== title && <em data-testid="spotter-reg">{reg}</em>}
          </p>
        </div>
        <button type="button" className="tgt-iconbtn lc-close" onClick={() => w?.clearSelection()} aria-label="Clear the selected aircraft" title="Clear (Esc)">
          <X size={17} />
        </button>
      </div>

      <RouteLine route={route} loading={routeLoading} conflict={routeConflict(route, boardRow, airportIdent)} />

      <div className="lc-tiles" data-testid="spotter-telemetry">
        <div>
          <label>Altitude</label>
          <output>{live?.altFt != null ? (live.grounded ? 'Ground' : fmt(live.altFt)) : '—'}</output>
          <small>{live?.grounded ? 'on the airfield' : 'feet'}</small>
        </div>
        <div>
          <label>Speed</label>
          <output>{live?.gsKt != null ? fmt(live.gsKt) : '—'}</output>
          <small>knots</small>
        </div>
        <div>
          <label>Range</label>
          <output>{live?.rangeM != null ? fmtKm(live.rangeM) : '—'}</output>
          <small>km from you</small>
        </div>
        <div>
          <label>V/S</label>
          <output data-trend={live?.vsFpm > 150 ? 'up' : live?.vsFpm < -150 ? 'down' : 'level'}>
            {live?.vsFpm != null ? (Math.abs(live.vsFpm) < 150 ? 'Level' : `${live.vsFpm > 0 ? '▲' : '▼'}${fmt(Math.abs(live.vsFpm))}`) : '—'}
          </output>
          <small>ft / min</small>
        </div>
      </div>

      <div className="lc-phase" data-testid="spotter-phase">
        <PhaseIcon size={15} aria-hidden="true" />
        <span>{phase || 'Phase unknown'}</span>
        {eta && <b>ETA {eta}</b>}
        <small>Inferred from its live track</small>
      </div>

      <div className="lc-actions">
        <button type="button" className="tgt-btn tgt-btn-primary lc-act" data-testid="spotter-binoculars" disabled={lost} aria-pressed={!!binocular} onClick={() => (binocular ? w?.binoculars(false) : w?.select(hex, { binoculars: true }))} title="Binoculars, locked on this aircraft (B)">
          <Binoculars size={19} aria-hidden="true" />
          <span className="tgt-btn-label">
            <strong>{binocular ? 'Lower' : 'Binoculars'}</strong>
            <span>Lock on and magnify</span>
          </span>
          <span className="tgt-kbd">B</span>
        </button>
        <button type="button" className="lc-chip lc-follow" data-testid="spotter-follow" disabled={lost} aria-pressed={!!tracking} onClick={() => w?.track()} title="Follow it from your seat (F)">
          <Crosshair size={16} aria-hidden="true" />
          {tracking ? 'Following' : 'Follow'}
          <span className="tgt-kbd">F</span>
        </button>
        {sheet && <CardToggle expanded={sheet.expanded} onToggle={sheet.onToggle} />}
      </div>
      <div className="lc-actions lc-actions-minor">
        <button type="button" className="lc-chip" data-testid="spotter-details" onClick={() => useFlyStore.getState().setInspectHex(hex)} title="Open the full dossier (T)">
          <Info size={15} aria-hidden="true" />
          Details
        </button>
        <button type="button" className="lc-chip" data-testid="spotter-join" disabled={!validated || lost} onClick={join} title="Leave the lounge and fly alongside it">
          <ArrowUpRight size={15} aria-hidden="true" />
          Join flight
        </button>
        <button type="button" className="lc-chip" data-testid="spotter-photo" disabled={savingPhoto || !validated} aria-busy={savingPhoto} onClick={onPhoto} title="Save a photograph of the view">
          <Camera size={15} aria-hidden="true" />
          Photo
        </button>
      </div>
      {notice && (
        <p className="lc-notice" role="alert" data-testid="spotter-notice">
          {notice}
        </p>
      )}
    </motion.aside>
  );
}

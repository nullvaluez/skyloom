'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useFlyStore } from '@/stores/fly-store';
import { VIEW, LOUNGE_ROOM } from '@/lib/fly/observation-config';
import { DEG } from '@/lib/fly/airport-watch-camera.mjs';
import { contactLabel, typeNameFor } from '@/lib/fly/airport-watch-board.mjs';
import { useObservatory } from './ObservatoryHud';
import { M_TO_FT, MPS_TO_KT } from '@/lib/fly/coords';

/*
 * BINOCULAR HUD — the readouts inside the twin-lens view (the mask and the
 * reticle are drawn frame-synced by LoungeOverlay): a magnification scale
 * with the 7x / 12x / 20x presets, the bearing and elevation you are
 * looking at, and the rangefinder line for the locked aircraft — callsign,
 * type, altitude, speed, range and vertical speed. Read at 8 Hz.
 */

const fmt = (n) => Math.round(n).toLocaleString();

function read(runtime) {
  const w = runtime.airportWatch;
  if (!w?.active) return null;
  const heading = (((-(w.roomHeading + w.yaw) / DEG) % 360) + 360) % 360;
  const out = { mag: w.optics.mag, bearing: heading, elevation: w.pitch / DEG, lock: null };
  const t = w.selected && runtime.traffic?.tracks.get(w.selected);
  if (t?.fix1) {
    const k = w.frame?.k || 1;
    // Ranged from the observer's eye (it walks with LOUNGE_WALK).
    const e = w.eyeWorld ? w.eyeWorld() : { x: w.seat.x, y: w.seat.y + LOUNGE_ROOM.eye[1], z: w.seat.z };
    const dx = (t.rx - e.x) / k, dz = (t.rz - e.z) / k, dy = (t.ry ?? 0) - e.y;
    const fov = (runtime.camera?.fov ?? 58) * DEG;
    out.lock = {
      hex: t.hex,
      label: contactLabel(t.meta, t.hex),
      type: typeNameFor(t.meta) || t.meta?.t || 'Type not broadcast',
      // Feed heights near sea-level fields can dip below zero (GNSS height
      // over the ellipsoid); an altitude readout never shows a negative.
      altFt: Math.max(0, (t.ry ?? 0) * M_TO_FT),
      grounded: !!(t.flags & 1),
      gsKt: Math.hypot(t.fix1.vE, t.fix1.vN) * MPS_TO_KT,
      rangeKm: Math.hypot(dx, dy, dz) / 1000,
      vsFpm: (t.fix1.vUp || 0) * M_TO_FT * 60,
      locked: w.tracking && w.lockError() < fov / 8,
      tracking: w.tracking,
      stale: t.stale,
    };
  }
  return out;
}

export function BinocularHud({ runtime }) {
  const observatory = useObservatory(runtime, runtime.airportWatch?.airport?.id);
  const target = useFlyStore((s) => s.airportWatch?.mag ?? 1);
  const [s, setS] = useState(() => read(runtime));
  useEffect(() => {
    const id = setInterval(() => setS(read(runtime)), 125);
    return () => clearInterval(id);
  }, [runtime]);
  if (!s) return null;
  const w = runtime.airportWatch;
  const lock = s.lock;
  const status = !lock ? 'search' : lock.stale === 2 ? 'lost' : lock.locked ? 'lock' : lock.tracking ? 'acquire' : 'free';
  return (
    <motion.div className="bino-hud" data-testid="binocular-view" data-status={status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <div className="bino-top">
        <span>
          BRG <b>{String(Math.round(s.bearing) % 360).padStart(3, '0')}°</b>
        </span>
        <span>
          ELV <b>{s.elevation >= 0 ? '+' : '−'}{Math.abs(s.elevation).toFixed(1)}°</b>
        </span>
      </div>
      {(!observatory || observatory.readouts) && <div className="bino-readout" data-testid="binocular-readout" aria-live="polite">
        <div className="bino-status">
          <i aria-hidden="true" />
          {status === 'lock' ? 'Locked' : status === 'acquire' ? 'Acquiring' : status === 'lost' ? 'Signal lost' : status === 'free' ? 'Free look' : 'Searching'}
          {lock && <strong>{lock.label}</strong>}
          {lock && <span>{lock.type}</span>}
        </div>
        {lock ? (
          <div className="bino-figures">
            <span><small>ALT</small><b>{lock.grounded ? 'GND' : fmt(lock.altFt)}</b><em>{lock.grounded ? '' : 'ft'}</em></span>
            <span><small>SPD</small><b>{fmt(lock.gsKt)}</b><em>kt</em></span>
            <span><small>RNG</small><b>{lock.rangeKm < 9.5 ? lock.rangeKm.toFixed(2) : lock.rangeKm.toFixed(1)}</b><em>km</em></span>
            <span><small>V/S</small><b>{Math.abs(lock.vsFpm) < 150 ? 'LVL' : `${lock.vsFpm > 0 ? '▲' : '▼'}${fmt(Math.abs(lock.vsFpm))}`}</b><em>{Math.abs(lock.vsFpm) < 150 ? '' : 'fpm'}</em></span>
          </div>
        ) : (
          <p className="bino-hint">Drag to search · click an aircraft to lock on</p>
        )}
      </div>
      }
      <div className="bino-mag" role="group" aria-label="Magnification">
        {observatory && <>
          {observatory.supported && <span className="observatory-supported">Resting on rail</span>}
          <button type="button" aria-pressed={observatory.readouts} onClick={() => w?.observatory?.setReadouts(!observatory.readouts)}>Readouts</button>
        </>}
        <span className="bino-mag-now" data-testid="binocular-mag">{s.mag.toFixed(s.mag < 9.95 ? 1 : 0)}×</span>
        {VIEW.optics.steps.map((m, i) => (
          <button key={m} type="button" aria-pressed={Math.abs(target - m) < 0.05} onClick={() => w?.setMagnification(m)} title={`${m}× (${i + 1})`}>
            {m}×
          </button>
        ))}
        <button type="button" className="bino-lower" onClick={() => w?.binoculars(false)} title="Lower the binoculars (B or Esc)">
          Lower <span className="tgt-kbd">B</span>
        </button>
      </div>
    </motion.div>
  );
}

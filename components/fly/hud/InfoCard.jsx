'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { useRoute } from '@/hooks/use-route';
import { useAircraftPhoto } from '@/hooks/use-aircraft-photo';
import { TARGETING } from '@/lib/fly/fly-constants';
import { M_TO_FT, MPS_TO_KT, RAD2DEG } from '@/lib/fly/coords';
import { formatSquawk } from '@/lib/format';
import { Zone } from '../LayoutRoot';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { onTouchInfoDismiss } from '@/hooks/use-touch-actions';
import { releaseEscort, startEscort } from '@/lib/fly/escort';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { isRemote } from '@/lib/fly/mp/mp-flag';
import { aircraftName } from '@/lib/fly/player-aircraft';
import { AIRCRAFT_SILHOUETTES, getBestSilhouette } from '@/lib/aircraft-silhouettes';
import './target-ui.css';

/**
 * Soft-lock info card: auto-shows when the locked target is inside
 * infoCardRangeM, hides beyond infoCardReleaseM (hysteresis), and after a
 * manual dismiss suppresses re-trigger for that hex for
 * infoCardSuppressSec. Distance checks poll the runtime at 5Hz — the card
 * itself renders only on discrete open/close. Route + photo come from the
 * existing 2D-map hooks (shared React Query cache).
 */
export function InfoCard({ runtime }) {
  const infoCardHex = useFlyStore((s) => s.infoCardHex);
  const suppressed = useRef(new Map()); // hex -> suppress-until epoch ms
  useEffect(
    () =>
      onTouchInfoDismiss(() => {
        const hex = useFlyStore.getState().infoCardHex;
        if (hex) suppressed.current.set(hex, Date.now() + TARGETING.infoCardSuppressSec * 1000);
        useFlyStore.getState().setInfoCardHex(null);
      }),
    [],
  );

  // 5Hz visibility controller
  useEffect(() => {
    const id = setInterval(() => {
      const store = useFlyStore.getState();
      const { lockedHex } = store;
      const track = lockedHex ? runtime.traffic?.tracks.get(lockedHex) : null;
      const until = lockedHex ? suppressed.current.get(lockedHex) : null;
      const isSuppressed = until != null && Date.now() < until;

      if (store.infoCardHex) {
        const current = runtime.traffic?.tracks.get(store.infoCardHex);
        if (!current || store.lockedHex !== store.infoCardHex || current.distM > TARGETING.infoCardReleaseM) {
          store.setInfoCardHex(null);
        }
      } else if (track && !isSuppressed && track.distM < TARGETING.infoCardRangeM) {
        store.setInfoCardHex(lockedHex);
      }
    }, 200);
    return () => clearInterval(id);
  }, [runtime]);

  const dismiss = () => {
    if (infoCardHex) {
      suppressed.current.set(infoCardHex, Date.now() + TARGETING.infoCardSuppressSec * 1000);
    }
    useFlyStore.getState().setInfoCardHex(null);
  };

  if (!infoCardHex) return null;
  return <InfoCardBody hex={infoCardHex} runtime={runtime} onDismiss={dismiss} />;
}

function InfoCardBody({ hex, runtime, onDismiss }) {
  const track = runtime.traffic?.tracks.get(hex);
  const meta = track?.meta;
  const { isTouch } = useDeviceLayout();
  const lockState = useFlyStore((s) => s.lockState);
  const chasing = lockState === 'intercepting' || lockState === 'formation';
  const [notice, setNotice] = useState(null);

  // Live-ish numbers at 2Hz without re-rendering per frame
  const [live, setLive] = useState(null);
  useEffect(() => {
    const read = () => {
      const t = runtime.traffic?.tracks.get(hex);
      if (!t || !t.fix1) return;
      setLive({
        altFt: Math.round(t.ry * M_TO_FT),
        gsKt: Math.round(Math.hypot(t.fix1.vE, t.fix1.vN) * MPS_TO_KT),
        hdg: Math.round((((t.yaw * RAD2DEG) % 360) + 360) % 360),
        distNm: (t.distM / 1852).toFixed(1),
      });
    };
    read();
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, [hex, runtime]);
  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(id);
  }, [notice]);

  // Reuse the 2D map's data hooks — geo position for route progress math
  const aircraftShim = useMemo(() => {
    if (!meta) return null;
    const t = runtime.traffic?.tracks.get(hex);
    let lat;
    let lon;
    if (t && runtime.engine) {
      const geo = runtime.engine.worldToGeo({ x: t.rx, y: t.ry, z: t.rz });
      lat = geo.y;
      lon = geo.x;
    }
    return {
      hex,
      flight: meta.flight,
      r: meta.r,
      t: meta.t,
      category: meta.category,
      lat,
      lon,
      gs: live?.gsKt,
      track: live?.hdg,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex, meta]);

  // MULTIPLAYER: another pilot is never looked up (null disables each query).
  const remote = isRemote(hex);
  const { route } = useRoute(remote ? null : aircraftShim);
  const { data: photo } = useAircraftPhoto(remote ? null : hex);
  const photoSrc = photo?.thumbnail_large?.src || photo?.thumbnail?.src || null;

  if (!meta) return null;
  const title = meta.flight?.trim() || meta.r || hex.toUpperCase();
  const typeName = remote ? aircraftName(meta.aircraftId) : getAircraftTypeName(meta.t, meta.category);
  const inspect = () => useFlyStore.getState().setInspectHex(hex);
  const escort = () => {
    if (chasing) {
      releaseEscort(runtime);
      return;
    }
    const res = startEscort(runtime, hex, { cinematic: true, source: 'lock' });
    setNotice(res.ok ? null : res.message);
  };
  const silhouette =
    AIRCRAFT_SILHOUETTES[getBestSilhouette({ t: meta.t }, meta.iconType || 'airliner')] ??
    AIRCRAFT_SILHOUETTES.unknown;

  // ---- TOUCH: a chip you can act on ---------------------------------------
  // Round 17 made the phone card a 48 px chip docked above the stick (the old
  // card covered the stick and swallowed steering). It was pointer-events-none,
  // so a locked plane could only be inspected through the Actions menu. The
  // chip is now two real targets: the body opens the dossier, Escort flies.
  if (isTouch) {
    return (
      <Zone name="info-dock">
        <div className="tgt" style={{ '--hero': meta.color || '#4fe3ff' }}>
          <div
            className="tgt-lock-chip"
            data-testid="infocard-chip"
            role="group"
            aria-label={`Selected aircraft ${title}`}
          >
            <button
              type="button"
              onClick={inspect}
              aria-label={`Details for ${title}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flex: 1,
                minWidth: 0,
                height: '100%',
                background: 'none',
                border: 0,
                padding: 0,
                textAlign: 'left',
              }}
            >
              <Crosshair size={18} aria-hidden="true" />
              <strong>{title}</strong>
              <small>{[live ? `${live.distNm} nm` : null, remote ? typeName : meta.t].filter(Boolean).join(' · ')}</small>
            </button>
            <button type="button" className="tgt-lock-open" onClick={escort} aria-pressed={chasing}>
              {chasing ? 'Release' : 'Escort'}
            </button>
          </div>
          {notice && (
            <p className="tgt-result" role="alert" style={{ position: 'static', marginTop: 6 }}>
              {notice}
            </p>
          )}
        </div>
      </Zone>
    );
  }

  return (
    <Zone name="info-dock">
      <div className="tgt" style={{ '--hero': meta.color || '#4fe3ff' }}>
        <div className="tgt-lock" data-testid="infocard">
          <div className="tgt-lock-thumb">
            {photoSrc ? (
              // Round 15: the photographer credit + link back is a planespotters
              // REQUIREMENT wherever the photo is shown (`bottom-1 left-1`, never
              // `bottom-2 left-2` — verify-fly-style finds the Esri bar by that pair).
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoSrc} alt={title} />
                {photo?.photographer && (
                  <a
                    href={photo.link || 'https://www.planespotters.net'}
                    target="_blank"
                    rel="noreferrer"
                    className="absolute bottom-1 left-1 max-w-[92%] truncate rounded bg-zinc-950/75 px-1 py-0.5 font-mono text-[8px] text-zinc-300 hover:underline"
                    data-testid="infocard-photo-credit"
                    title={`Photo ${photo.photographer} · planespotters.net`}
                  >
                    📷 {photo.photographer}
                  </a>
                )}
              </>
            ) : (
              <svg viewBox={silhouette.viewBox} width="62" height="62" aria-hidden="true">
                {silhouette.paths.map((p, i) => (
                  <path key={i} d={p.d} fill="currentColor" />
                ))}
              </svg>
            )}
          </div>
          <div className="tgt-lock-body">
            <div className="tgt-lock-kicker">
              <i aria-hidden="true" />
              {chasing ? 'Escorting' : 'Locked'}
              <button type="button" onClick={onDismiss} aria-label="Dismiss info card" title="Hide">
                <X size={13} />
              </button>
            </div>
            <div className="tgt-lock-name" title={title}>
              {title}
            </div>
            <div className="tgt-lock-sub">
              {[
                route?.airline?.name || typeName || meta.t,
                live ? `${live.distNm} nm` : null,
                live ? `${live.altFt.toLocaleString()} ft` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {(route?.origin || route?.destination) && (
              <div className="tgt-lock-sub" style={{ color: 'var(--t-ice)' }}>
                {route.origin?.iata || route.origin?.icao || '···'} →{' '}
                {route.destination?.iata || route.destination?.icao || '···'}
                {meta.squawk ? ` · sqk ${formatSquawk(meta.squawk)}` : ''}
              </div>
            )}
            <div className="tgt-lock-actions">
              <button type="button" onClick={escort} aria-pressed={chasing}>
                {chasing ? (
                  <>
                    Release <kbd className="tgt-kbd">F</kbd>
                  </>
                ) : (
                  'Escort'
                )}
              </button>
              <button type="button" onClick={inspect}>
                Details <kbd className="tgt-kbd">T</kbd>
              </button>
            </div>
            {notice && (
              <div
                className="tgt-lock-sub"
                role="alert"
                style={{ color: 'var(--t-rose)', whiteSpace: 'normal' }}
              >
                {notice}
              </div>
            )}
          </div>
        </div>
      </div>
    </Zone>
  );
}

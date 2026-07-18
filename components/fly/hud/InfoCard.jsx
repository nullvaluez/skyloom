'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { useRoute } from '@/hooks/use-route';
import { useAircraftPhoto } from '@/hooks/use-aircraft-photo';
import { TARGETING } from '@/lib/fly/fly-constants';
import { M_TO_FT, MPS_TO_KT, RAD2DEG } from '@/lib/fly/coords';
import { formatSquawk } from '@/lib/format';

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
        if (
          !current ||
          store.lockedHex !== store.infoCardHex ||
          current.distM > TARGETING.infoCardReleaseM
        ) {
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

  const { route } = useRoute(aircraftShim);
  const { data: photo } = useAircraftPhoto(hex);
  const photoSrc = photo?.thumbnail_large?.src || photo?.thumbnail?.src || null;

  if (!meta) return null;
  const title = meta.flight || meta.r || hex.toUpperCase();

  return (
    <div className="pointer-events-auto absolute bottom-10 left-4 z-10 w-72 overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-900/80 text-zinc-100 shadow-xl backdrop-blur">
      {photoSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoSrc} alt={title} className="h-28 w-full object-cover" />
      )}
      <div className="space-y-1.5 p-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-sm font-semibold tracking-wide">{title}</div>
            <div className="text-xs text-zinc-400">
              {route?.airline?.name || (meta.r ? `Reg ${meta.r}` : 'Unknown operator')}
              {meta.t ? ` · ${meta.t}` : ''}
            </div>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Dismiss info card"
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {(route?.origin || route?.destination) && (
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono font-medium">
              {route.origin?.iata || route.origin?.icao || '???'}
            </span>
            <span className="h-px flex-1 bg-zinc-600" />
            <span className="text-zinc-400">✈</span>
            <span className="h-px flex-1 bg-zinc-600" />
            <span className="font-mono font-medium">
              {route.destination?.iata || route.destination?.icao || '???'}
            </span>
          </div>
        )}

        {live && (
          <div className="grid grid-cols-4 gap-1 pt-1 text-center">
            {[
              ['ALT', `${live.altFt.toLocaleString()}ft`],
              ['GS', `${live.gsKt}kt`],
              ['HDG', `${live.hdg}°`],
              ['DIST', `${live.distNm}nm`],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
                <div className="font-mono text-[11px]">{value}</div>
              </div>
            ))}
          </div>
        )}

        {meta.squawk && (
          <div className="text-[10px] text-zinc-500">Squawk {formatSquawk(meta.squawk)}</div>
        )}
      </div>
    </div>
  );
}

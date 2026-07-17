'use client';

import { ATTRIBUTIONS_BY_STYLE } from '@/lib/fly/tile-sources';
import { useFlyStore } from '@/stores/fly-store';

/**
 * Data-provider attribution. Esri's terms require this to stay visible in
 * every Fly-mode state (flying, paused, credits) — never cover or remove.
 * The imagery line follows the active map style (Esri satellite vs
 * CARTO/OSM night tiles).
 */
export function AttributionBar() {
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const attributions = ATTRIBUTIONS_BY_STYLE[mapStyle] ?? ATTRIBUTIONS_BY_STYLE.satellite;
  return (
    <div className="pointer-events-auto absolute bottom-2 left-2 z-10 flex flex-wrap gap-x-3 rounded bg-zinc-950/60 px-2 py-1 text-[10px] leading-4 text-zinc-300">
      {attributions.map((a) => (
        <a
          key={a.label}
          href={a.href}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-zinc-100 hover:underline"
        >
          {a.label}
        </a>
      ))}
    </div>
  );
}

'use client';

import { ATTRIBUTIONS_BY_STYLE } from '@/lib/fly/tile-sources';
import { useFlyStore } from '@/stores/fly-store';
import { Zone } from '../LayoutRoot';

/**
 * Data-provider attribution. Esri's terms require this to stay visible in
 * every Fly-mode state (flying, paused, credits) — never cover or remove.
 * The imagery line follows the active map style (Esri satellite vs
 * CARTO/OSM night tiles).
 *
 * ROUND 17 — READ BEFORE EDITING THE CLASS LIST. The pair `bottom-2 left-2`
 * on the div below is a FROZEN harness contract: verify-fly-style finds the
 * Esri credit with the selector `.bottom-2.left-2`. That is why this bar,
 * alone among the migrated overlays, keeps its own offsets instead of handing
 * them to its zone — and why the `attribution` zone is a full-bleed
 * `inset-0` passthrough, which makes its containing block identical to the
 * fly root so these two utilities still land on the same pixels.
 *
 * The safe-area clearance is applied as a MARGIN in inline style, for the
 * same reason: a margin composes with `bottom-2 left-2` instead of replacing
 * it. On a notchless device env() is 0 and the margins are 0 — desktop and
 * the existing phone rendering are both unchanged.
 */
export function AttributionBar() {
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const attributions = ATTRIBUTIONS_BY_STYLE[mapStyle] ?? ATTRIBUTIONS_BY_STYLE.satellite;
  return (
    <Zone name="attribution">
      <div
        className="pointer-events-auto absolute bottom-2 left-2 z-10 flex flex-wrap gap-x-3 rounded bg-zinc-950/60 px-2 py-1 text-[10px] leading-4 text-zinc-300"
        style={{
          marginBottom: 'env(safe-area-inset-bottom)',
          marginLeft: 'env(safe-area-inset-left)',
          marginRight: 'env(safe-area-inset-right)',
        }}
      >
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
    </Zone>
  );
}

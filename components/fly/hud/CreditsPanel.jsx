'use client';

import { FLY_ASSETS } from '@/lib/fly/assets';
import { TERRAIN_ATTRIBUTIONS } from '@/lib/fly/tile-sources';

/**
 * Credits & licenses (CC-BY requirement), rendered from the lib/fly/assets.js
 * manifest. R25 A: extracted from PauseMenu so the title's Credits button and
 * the pause menu show the SAME panel — markup unchanged from the pause copy.
 */
export function CreditsPanel({ onClose }) {
  return (
    // `w-[440px]` was a hard 440 with no cap: on a 390px phone the credits
    // panel overflowed the viewport by 50px and took the horizontal scrollbar
    // with it. The clamp resolves to exactly 440 at any width >= 472px, so
    // desktop is unchanged. `my-auto` matches the pause card so the scrolling
    // backdrop centres it when it fits.
    <div className="pointer-events-auto my-auto max-h-[70vh] w-[min(440px,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-zinc-700/60 bg-zinc-900/90 p-5 text-zinc-100 shadow-2xl backdrop-blur">
      <h2 className="text-base font-semibold">Credits &amp; licenses</h2>

      <h3 className="mt-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Assets
      </h3>
      <ul className="mt-1 space-y-2 text-xs text-zinc-300">
        {FLY_ASSETS.map((a) => (
          <li key={a.file}>
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-zinc-100 hover:underline"
            >
              {a.name}
            </a>{' '}
            — {a.author}, {a.source} · {a.license}
            {a.modifications && a.modifications !== 'none' && (
              <span className="text-zinc-500"> · modified: {a.modifications}</span>
            )}
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Map data &amp; imagery
      </h3>
      <ul className="mt-1 space-y-1 text-xs text-zinc-300">
        {TERRAIN_ATTRIBUTIONS.map((t) => (
          <li key={t.label}>
            <a href={t.href} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {t.label}
            </a>
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Live flight data
      </h3>
      <p className="mt-1 text-xs text-zinc-300">
        ADS-B data by{' '}
        <a
          href="https://adsb.lol"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          adsb.lol
        </a>{' '}
        — community-run, ODbL.
      </p>

      <button
        onClick={onClose}
        className="mt-4 w-full rounded-md bg-zinc-800 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 phone:min-h-11"
      >
        Back
      </button>
    </div>
  );
}

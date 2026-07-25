'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAtlasList } from '@/lib/fly/poi-data';
import { getRuntimeAction } from '@/lib/fly/runtime-bus';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { useFlyStore } from '@/stores/fly-store';
import { useFlyAtlasStore } from '@/stores/fly-atlas-store';
import { AtlasMap } from './atlas/AtlasMap';
import { DestinationCard } from './atlas/DestinationCard';
import { ATLAS_KIND, CARD_THEME } from './atlas/atlas-tokens';

const FILTER_KINDS = ['city', 'airport', 'military', 'hotspot', 'landmark'];
const DEFAULT_FILTERS = { city: true, airport: true, military: true, hotspot: true, landmark: false };
const MAX_RESULTS = 9;

/** Warp spawn parameters per destination kind (FLY_ATLAS_REWORK §4.1). */
function warpOptsFor(entry) {
  if (entry.kind === 'military' || entry.kind === 'hotspot') {
    // The planes are AROUND a base, not on it: arrive ~4km out at ~1200m,
    // nose toward the point (bearing randomized so revisits vary).
    return { altM: 1200, offsetM: 4000, offsetBearingRad: Math.random() * Math.PI * 2 };
  }
  return { altM: 800 };
}

/**
 * The Atlas — fast travel (FLY_ATLAS_REWORK §4.1). Full-screen INK CODEX
 * surface over the live world: canvas world map, search with keyboard warp,
 * destination card, recents/favorites, random-city die. The world keeps
 * flying behind it (FlyScene neutralizes the stick while open).
 */
export function Atlas({ runtime }) {
  const atlasOpen = useFlyStore((s) => s.atlasOpen);
  return atlasOpen ? <AtlasBody runtime={runtime} /> : null;
}

function AtlasBody({ runtime }) {
  // Round 17. `isTouch` gates the two things that make the Atlas unusable on a
  // phone: the search AUTOFOCUS (below) and the desktop-sized tap targets.
  const { isTouch } = useDeviceLayout();
  const entries = useMemo(() => buildAtlasList(), []);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selectedKey, setSelectedKey] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [focus, setFocus] = useState(null); // {lat, lon, seq} → AtlasMap centers
  const [warpNotice, setWarpNotice] = useState(null); // { key, msg } | null
  const inputRef = useRef(null);
  const focusSeq = useRef(0);

  const recents = useFlyAtlasStore((s) => s.recents);
  const favorites = useFlyAtlasStore((s) => s.favorites);

  const selected = useMemo(
    () => entries.find((e) => e.key === selectedKey) ?? null,
    [entries, selectedKey]
  );

  const mapEntries = useMemo(
    () => entries.filter((e) => filters[e.kind]),
    [entries, filters]
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits = [];
    for (const e of entries) {
      const idx = e.search.indexOf(q);
      if (idx < 0) continue;
      // rank: name-start match first, then any-name match, then tags/sub
      const nameIdx = e.name.toLowerCase().indexOf(q);
      hits.push({ e, rank: nameIdx === 0 ? 0 : nameIdx > 0 ? 1 : 2, idx });
      if (hits.length > 400) break;
    }
    hits.sort((a, b) => a.rank - b.rank || a.idx - b.idx || a.e.name.length - b.e.name.length);
    return hits.slice(0, MAX_RESULTS).map((h) => h.e);
  }, [entries, query]);

  // Autofocus is a DESKTOP affordance: the Atlas opens, you type, Enter warps.
  // On a phone the same line summons the software keyboard the instant the
  // screen opens, which eats roughly half the viewport — the map you came here
  // to look at — before you have touched anything. Touch users tap the field
  // when they actually want to search.
  useEffect(() => {
    if (isTouch) return;
    inputRef.current?.focus();
  }, [isTouch]);

  const select = (entry) => {
    setSelectedKey(entry.key);
    focusSeq.current += 1;
    setFocus({ lat: entry.lat, lon: entry.lon, seq: focusSeq.current });
  };

  const warp = (entry) => {
    // Round 8 fix (F5): resolve through the runtime bus AT CALL TIME (the
    // InspectModal pattern) — the old `if (!runtime.warpToGeo) return` was
    // a silent dead button across the scene unmount→remount window.
    const fn =
      getRuntimeAction('warpToGeo') ??
      (typeof runtime.warpToGeo === 'function' ? runtime.warpToGeo : null);
    const ok =
      !!fn &&
      fn(entry.lat, entry.lon, {
        ...warpOptsFor(entry),
        name: entry.name,
        kind: entry.kind,
      });
    if (ok) {
      setWarpNotice(null);
      useFlyAtlasStore.getState().logVisit(entry.key, entry.name, entry.kind);
    } else {
      setWarpNotice({
        key: Date.now(),
        msg: useFlyStore.getState().runtimeReady
          ? 'warp failed — try again'
          : 'scene rebuilding — try again',
      });
    }
  };

  const randomCity = () => {
    const cities = entries.filter((e) => e.kind === 'city');
    warp(cities[Math.floor(Math.random() * cities.length)]);
  };

  // M closes (mirror of the open key); ignore while typing in the field
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'm') useFlyStore.getState().setAtlasOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSearchKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      warp(results[Math.min(cursor, results.length - 1)]);
    }
  };

  // favorites first (starred), then recents not already shown
  const quickChips = useMemo(() => {
    const favEntries = favorites
      .map((key) => entries.find((e) => e.key === key))
      .filter(Boolean)
      .map((e) => ({ key: e.key, name: e.name, kind: e.kind, fav: true }));
    const rest = recents
      .filter((r) => !favorites.includes(r.key))
      .map((r) => ({ ...r, fav: false }));
    return [...favEntries, ...rest].slice(0, 7);
  }, [favorites, recents, entries]);

  return (
    <div
      className="absolute inset-x-0 top-0 bottom-8 z-20 flex items-center justify-center"
      style={{ background: CARD_THEME.scrim }}
      data-testid="atlas"
    >
      <div
        className="pointer-events-auto flex h-[min(92%,760px)] w-[min(94%,1180px)] flex-col rounded-xl border p-4 shadow-2xl backdrop-blur-md"
        style={{
          background: `linear-gradient(180deg, ${CARD_THEME.bgTop}, ${CARD_THEME.bgBottom})`,
          borderColor: CARD_THEME.edge,
        }}
      >
        {/* header: title · search · close */}
        <div className="flex items-center gap-4 max-sm:flex-wrap max-sm:gap-x-2 max-sm:gap-y-2">
          <h2
            className="text-lg uppercase tracking-[0.3em]"
            style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
          >
            Atlas
          </h2>
          <div className="relative flex-1">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onSearchKey}
              placeholder="Search cities, bases, spots… (enter warps)"
              className={`w-full rounded-md border bg-transparent px-3 font-mono text-sm outline-none ${
                isTouch ? 'h-11 py-0' : 'py-1.5'
              }`}
              style={{ borderColor: CARD_THEME.edgeSoft, color: CARD_THEME.ice }}
              data-testid="atlas-search"
              spellCheck={false}
              // The software keyboard's action key should say GO, because Enter
              // here WARPS. `inputMode` is deliberately left at its default:
              // 'search' swaps the key for a magnifier on several Android
              // keyboards, which is the wrong promise for a control that flies
              // you across the planet.
              enterKeyHint="go"
            />
            {results.length > 0 && (
              <div
                className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border shadow-xl"
                style={{
                  background: CARD_THEME.bgBottom,
                  borderColor: CARD_THEME.edgeSoft,
                }}
              >
                {results.map((e, i) => {
                  const kind = ATLAS_KIND[e.kind] ?? ATLAS_KIND.city;
                  return (
                    <button
                      key={e.key}
                      onClick={() => select(e)}
                      onMouseEnter={() => setCursor(i)}
                      className={`flex w-full items-center gap-2 px-3 text-left font-mono text-xs ${
                        isTouch ? 'min-h-11 py-2' : 'py-1.5'
                      }`}
                      style={{
                        background: i === cursor ? CARD_THEME.panelHover : 'transparent',
                        color: CARD_THEME.ice,
                      }}
                      data-testid="atlas-result"
                    >
                      <span
                        className="w-14 shrink-0 rounded px-1 py-0.5 text-center text-[8px] font-bold tracking-[0.15em]"
                        style={{ color: kind.color, background: `${kind.color}1a` }}
                      >
                        {kind.label}
                      </span>
                      <span className="truncate">{e.name}</span>
                      {(e.icao || e.sub) && (
                        <span className="ml-auto truncate pl-2 text-[10px]" style={{ color: CARD_THEME.iceFaint }}>
                          {e.icao ?? e.sub}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {warpNotice && (
            <span
              key={warpNotice.key}
              className="font-mono text-[10px] uppercase tracking-[0.2em]"
              style={{ color: '#ff6b6b' }}
              data-testid="atlas-warp-notice"
            >
              {warpNotice.msg}
            </span>
          )}
          <span className="font-mono text-[10px] max-sm:hidden" style={{ color: CARD_THEME.iceFaint }}>
            esc / M close
          </span>
          <button
            onClick={() => useFlyStore.getState().setAtlasOpen(false)}
            className={`shrink-0 rounded-md border font-mono transition-colors hover:bg-white/10 ${
              isTouch ? 'grid h-11 w-11 place-items-center text-base' : 'px-2 py-1 text-xs'
            }`}
            style={{ borderColor: CARD_THEME.edgeSoft, color: CARD_THEME.iceDim }}
            aria-label="Close Atlas"
            data-testid="atlas-close"
          >
            ✕
          </button>
        </div>

        {/* map + destination card — side by side on desktop, stacked on phone
            (map a fixed band on top, card scrolls below) */}
        <div className="mt-3 flex min-h-0 flex-1 gap-3 max-sm:flex-col max-sm:gap-2 max-sm:overflow-y-auto">
          <div
            className="min-w-0 flex-1 overflow-hidden rounded-lg border max-sm:h-[32svh] max-sm:flex-none"
            style={{ borderColor: CARD_THEME.edgeSoft }}
          >
            <AtlasMap
              entries={mapEntries}
              selectedKey={selectedKey}
              onSelect={select}
              runtime={runtime}
              focus={focus}
            />
          </div>
          <div className="w-72 shrink-0 max-sm:w-full max-sm:shrink">
            <DestinationCard entry={selected} runtime={runtime} onWarp={warp} />
          </div>
        </div>

        {/* footer: random · recents · filters.
            CHIP SIZING (round 17): the chips are held at 36 px on touch, NOT
            the 44 px `MOBILE_UI.minTargetPx` floor the buttons use. Five
            filter chips at 44 px plus their gaps is 260 px of a 390 px screen
            for a row that also has to carry the random-city button and up to
            seven recents — the row would wrap three deep and push the map off
            the sheet. 36 px is the documented, deliberate exception: they are
            a dense filter STRIP, they are spaced further apart on touch so the
            gap does the disambiguating, and every one of them is a toggle
            whose state is visible, i.e. a mis-tap is instantly seen and
            instantly undone. (verify-mobile-layout's ≥44 px sweep is A4's;
            these chips are the reason this comment exists.) */}
        <div className={`mt-3 flex items-center max-sm:flex-wrap max-sm:gap-y-2 ${isTouch ? 'gap-3' : 'gap-2'}`}>
          <button
            onClick={randomCity}
            className={`shrink-0 rounded-md border font-mono text-[11px] transition-colors hover:bg-white/10 ${
              isTouch ? 'h-11 px-3' : 'px-2.5 py-1'
            }`}
            style={{ borderColor: CARD_THEME.edgeSoft, color: CARD_THEME.ice }}
            title="Warp to a random city"
            data-testid="atlas-random"
          >
            ⚄ random city
          </button>
          <div
            className={`flex min-w-0 flex-1 items-center overflow-hidden ${isTouch ? 'gap-2' : 'gap-1.5'}`}
          >
            {quickChips.map((c) => {
              const kind = ATLAS_KIND[c.kind] ?? ATLAS_KIND.city;
              return (
                <button
                  key={c.key}
                  onClick={() => {
                    const e = entries.find((x) => x.key === c.key);
                    if (e) select(e);
                  }}
                  className={`truncate rounded font-mono text-[10px] transition-colors hover:bg-white/10 ${
                    isTouch ? 'h-9 px-3' : 'px-2 py-1'
                  }`}
                  style={{ background: CARD_THEME.panel, color: CARD_THEME.iceDim }}
                  title={c.name}
                >
                  {c.fav ? '★ ' : ''}
                  {c.name}
                </button>
              );
            })}
          </div>
          <div className={`flex items-center ${isTouch ? 'gap-2' : 'gap-1'}`}>
            {FILTER_KINDS.map((k) => {
              const kind = ATLAS_KIND[k];
              const on = filters[k];
              return (
                <button
                  key={k}
                  onClick={() => setFilters((f) => ({ ...f, [k]: !f[k] }))}
                  className={`shrink-0 rounded font-mono text-[9px] font-bold tracking-[0.12em] transition-opacity ${
                    isTouch ? 'h-9 px-2.5' : 'px-1.5 py-0.5'
                  }`}
                  style={{
                    color: kind.color,
                    background: `${kind.color}${on ? '26' : '0d'}`,
                    opacity: on ? 1 : 0.4,
                  }}
                  title={`Toggle ${kind.label.toLowerCase()} dots`}
                  aria-pressed={on}
                >
                  ● {kind.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

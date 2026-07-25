'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useFlyStore } from '@/stores/fly-store';
import { usePassportStore } from '@/stores/passport-store';
import { useRoute } from '@/hooks/use-route';
import { useAircraftPhoto } from '@/hooks/use-aircraft-photo';
import { useAircraftInfo } from '@/hooks/use-aircraft-info';
import { useSheetLayout } from '@/hooks/use-sheet-layout';
import { getRuntimeAction } from '@/lib/fly/runtime-bus';
import { INSPECT } from '@/lib/fly/fly-constants';
import { trackSpotAttrs } from '@/lib/fly/spot-attrs';
import { M_TO_FT, MPS_TO_KT, RAD2DEG } from '@/lib/fly/coords';
import { formatSquawk } from '@/lib/format';
import { calculateRarity, getRarityTier } from '@/lib/rarity';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { CARD_THEME } from './inspect/inspect-tokens';
import {
  BearingChip,
  DataCell,
  FactRow,
  MonogramChip,
  Odometer,
  RarityChip,
  RouteProgress,
  Sparkline,
  StatBar,
  countryFlag,
} from './inspect/card-bits';
import { ModelTurntable, preloadTurntable } from './inspect/ModelTurntable';

/**
 * INK CODEX — the click-to-inspect target panel.
 *
 * Round 8.5 (§B) gave it a right-DOCKED column (no full-screen scrim, so
 * clicks outside the panel keep flying) with the planespotters photo as the
 * HERO and the 3D turntable demoted to a secondary section (the turntable
 * still takes the hero when no photo exists).
 *
 * Round 15 "Ground Truth" EVOLVES that identity — same INK+ICE holo voice
 * (hero color from track.meta.color + rarity are still the only saturated
 * voices, chunky beveled buttons, one-shot holo sweep) with a reworked
 * hierarchy around real data:
 *   · REGISTRY identity (hooks/use-aircraft-info → keyless adsbdb → hexdb):
 *     manufacturer + the real model name, the registered owner, the registry
 *     country. ADS-B alone only ever knew an ICAO type code.
 *   · Richer route: airport names/cities + flags under the codes, ETA clock
 *     and distance-to-run under the progress bar.
 *   · The photo hero actually WORKS again (planespotters started 403ing our
 *     old User-Agent — see app/api/aircraft/[hex]/photo/route.js) and states
 *     its state honestly: looking up… / no photo on file.
 *   · A real phone bottom sheet: full-bleed, drag-handle affordance,
 *     safe-area padding, 50px WARP/CHASE targets, svh-capped height. Short
 *     landscape viewports shrink the desktop dock's vertical inset instead of
 *     clipping (top/bottom use min(4rem, 8svh)).
 *
 * Reliability (the round-8 complaint) is UNCHANGED: WARP/CHASE resolve their
 * actions AT CALL TIME through the runtime bus (scene remounts heal, captured
 * nulls don't orphan), WARP arms on runtimeReady && track (warpTo
 * dead-reckons), CHASE disables with a reason on frozen (stale === 2) tracks,
 * and a failed action flashes the WHOLE panel + auto-retries once ~400ms later.
 *
 * Wiring preserved exactly: opens via store.inspectHex (click a hovered
 * plane, or T on a lock), Esc closes (FlyMode), 1s stale auto-close, 500ms
 * live telemetry (per-frame data never touches React). Testids kept:
 * inspect-card/-warp/-chase/-hex/-action-notice/-photo-credit/-spot-log
 * (plus -turntable/-bearing/-sparkline from the child atoms).
 */
export function InspectModal({ runtime }) {
  const inspectHex = useFlyStore((s) => s.inspectHex);

  // Pre-parse the hovered/locked plane's GLB so the card opens instantly
  // (HTTP is already immutable-cached; this warms the parse).
  useEffect(() => {
    const id = setInterval(() => {
      const hex = runtime.hoverHex ?? useFlyStore.getState().lockedHex;
      if (!hex) return;
      const t = runtime.traffic?.tracks.get(hex);
      if (t) preloadTurntable(t.archetype);
    }, 500);
    return () => clearInterval(id);
  }, [runtime]);

  if (!inspectHex) return null;
  // keyed: per-plane state (spot capture, odometers, retry arm) never leaks
  // across targets if inspectHex ever changes while open
  return <ModalBody key={inspectHex} hex={inspectHex} runtime={runtime} />;
}

// R16: the phone-sheet breakpoint hook moved VERBATIM to
// hooks/use-sheet-layout.js — the Logbook overlay needs the same one source
// of truth for "this is a phone". Import swap only; behavior identical.

function ModalBody({ hex, runtime }) {
  const runtimeReady = useFlyStore((s) => s.runtimeReady);
  const isSheet = useSheetLayout();
  const track = runtime.traffic?.tracks.get(hex);
  const meta = track?.meta;
  const close = () => useFlyStore.getState().setInspectHex(null);

  // Track vanished (stale-removed) while open — bail out gracefully
  useEffect(() => {
    const id = setInterval(() => {
      if (!runtime.traffic?.tracks.get(hex)) close();
    }, 1000);
    return () => clearInterval(id);
  }, [hex, runtime]);

  // Live telemetry at 500ms — the ONLY recurring React state here (plus
  // the frozen flag). stale is read BEFORE the fix1 gate so CHASE can
  // disable-with-reason even when telemetry never acquired.
  const [live, setLive] = useState(null);
  const [frozen, setFrozen] = useState(false);
  const vsSamplesRef = useRef([]);
  useEffect(() => {
    const read = () => {
      const t = runtime.traffic?.tracks.get(hex);
      if (!t) return;
      setFrozen(t.stale === 2);
      if (!t.fix1) return;
      const vsFpm = Math.round(t.fix1.vUp * M_TO_FT * 60);
      const ring = vsSamplesRef.current;
      ring.push(vsFpm);
      if (ring.length > 12) ring.shift();
      let bearingDeg = null;
      let relAltFt = null;
      const f = runtime.flight;
      const o = runtime.origin;
      if (f && o) {
        const dx = t.rx - (f.pos.x - o.anchor.x);
        const dz = t.rz - (f.pos.z - o.anchor.z);
        bearingDeg = ((Math.atan2(dx, -dz) * RAD2DEG) % 360 + 360) % 360;
        relAltFt = (t.ry - f.pos.y) * M_TO_FT;
      }
      setLive({
        altFt: Math.round(t.ry * M_TO_FT),
        gsKt: Math.round(Math.hypot(t.fix1.vE, t.fix1.vN) * MPS_TO_KT),
        vsFpm,
        hdg: Math.round((((t.yaw * RAD2DEG) % 360) + 360) % 360),
        distNm: t.distM / 1852,
        bearingDeg,
        relAltFt,
      });
    };
    read();
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, [hex, runtime]);

  // Passport: capture BEFORE logging (dedup is per hex per hour), then log
  // this sighting — inspecting a plane now counts as spotting it.
  const [spot] = useState(() => {
    const p = usePassportStore.getState();
    const prev = p.spottedAircraft.filter((s) => s.hex === hex);
    return {
      isNew: !p.hasSpotted(hex),
      count: prev.length,
      // logSpot prepends ([spot, ...list]) — the array is newest-first, so
      // "since <date>" must read the LAST element (oldest sighting), not [0]
      firstAt: prev.length ? prev[prev.length - 1].timestamp : null,
    };
  });
  useEffect(() => {
    const t = runtime.traffic?.tracks.get(hex);
    if (!t?.meta) return;
    const geo = runtime.engine?.worldToGeo({ x: t.rx, y: t.ry, z: t.rz });
    usePassportStore.getState().logSpot(trackSpotAttrs(t, geo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  // R17: the SAME builder the logSpot above uses, so the tier printed on this
  // card and the rarity written into the passport can no longer disagree
  // (before, this memo saw `squawk` and the log did not, and neither saw
  // gs/alt). `track` is this render's live track — the effect logs off the
  // same object microseconds apart.
  const rarity = useMemo(() => {
    if (!meta) return null;
    return getRarityTier(calculateRarity(trackSpotAttrs(track)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex, meta]);

  // Geo shim for the shared 2D-map data hooks (gs/track feed ETA/progress)
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
  }, [hex, meta, live?.gsKt == null]);

  const { route, isLoading: routeLoading } = useRoute(aircraftShim);
  const { data: photo, isPending: photoPending } = useAircraftPhoto(hex);
  const { data: info, isPending: infoPending } = useAircraftInfo(hex);
  const photoSrc = photo?.thumbnail_large?.src || photo?.thumbnail?.src || null;

  // ---- Actions: resolve AT CALL TIME (bus first, legacy runtime prop as
  // fallback), LOUD panel-level failure flash + ONE auto-retry ~400ms.
  const [notice, setNotice] = useState(null); // { key, msg } | null
  const retryTimer = useRef(null);
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  const resolveAction = (name) => {
    const fn = getRuntimeAction(name);
    if (fn) return fn;
    return typeof runtime[name] === 'function' ? runtime[name] : null;
  };
  const failMsg = (kind) => {
    if (!useFlyStore.getState().runtimeReady) return 'scene rebuilding';
    const t = runtime.traffic?.tracks.get(hex);
    if (!t) return 'target lost — signal gone';
    if (kind === 'chase' && t.stale === 2) return 'signal frozen — chase unavailable';
    return kind === 'warp' ? 'warp failed' : 'chase failed';
  };
  const runAction = (kind, isRetry = false) => {
    const fn = resolveAction(kind === 'warp' ? 'warpTo' : 'interceptHex');
    const ok = !!fn && fn(hex) === true;
    if (ok) {
      setNotice(null);
      if (kind === 'chase') {
        runtime.audio?.lockBlip?.();
        close();
      }
      return; // warp closes the card via warpTo itself
    }
    setNotice({
      key: Date.now(),
      msg: `${failMsg(kind)}${isRetry ? ' — retry failed' : ' — retrying…'}`,
    });
    if (!isRetry) {
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(
        () => runAction(kind, true),
        INSPECT.actionRetryMs
      );
    }
  };
  const onWarp = () => runAction('warp');
  const onChase = () => runAction('chase');

  if (!meta || !track) return null;
  const title = meta.flight || meta.r || hex.toUpperCase();
  const heroColor = meta.color || '#22d3ee';
  const warpReady = runtimeReady; // track is non-null here by the guard above
  const photoLeads = !!photoSrc;

  // ---- Identity: registry FIRST, local tables as the honest fallback ------
  // meta.t is the ADS-B type designator (may be absent); the registry knows
  // the real model ("R172K", "UH-72A Lakota"), the manufacturer and who owns
  // the tail. Registration prefers the LIVE ADS-B value — adsbdb mangles some
  // non-US tails (C-GNWK comes back as "CA-GNWK").
  const reg = meta.r || info?.registration || null;
  const typeCode = meta.t || info?.typeCode || null;
  const typeName = getAircraftTypeName(typeCode, meta.category);
  const registryModel = [info?.manufacturer, info?.model].filter(Boolean).join(' ') || null;
  // Some registry models are bare series numbers ("Beech 36") — the friendly
  // table reads better there ("Beechcraft Bonanza 36"). Anything with real
  // model detail ("R172K", "UH-72A Lakota") beats the generic ICAO name.
  const thinModel = !info?.model || /^[0-9]{1,4}$/.test(info.model);
  const headlineIsRegistry = !!registryModel && !(thinModel && typeName);
  const modelPrimary = (headlineIsRegistry ? registryModel : typeName) || registryModel || 'UNKNOWN TYPE';
  const modelSub = [
    headlineIsRegistry ? typeName : registryModel,
    typeCode,
  ]
    .filter((v) => v && v !== modelPrimary)
    .join(' · ');

  const airlineName = route?.airline?.name || null;
  const owner = info?.owner || null;
  const operatorLine =
    airlineName || owner || (reg ? `Registered ${reg}` : 'Unknown operator');
  // Only surface OWNER separately when it says something the operator line
  // didn't (leased airline fleets: operator ≠ registered owner).
  const ownerFact = owner && owner !== operatorLine ? owner : null;
  const flag = countryFlag(info?.countryIso);
  const monogram =
    route?.airline?.iata || route?.airline?.icao || info?.operatorFlagCode || null;

  // ---- Geometry: desktop right dock vs phone bottom sheet -----------------
  const dockStyle = isSheet
    ? {
        left: 0,
        right: 0,
        top: 'auto',
        bottom: 0,
        maxHeight: `${INSPECT.sheetMaxSvh}svh`,
        borderRadius: '1.5rem 1.5rem 0 0',
      }
    : {
        right: '1rem',
        // Short landscape phones: shrink the inset instead of clipping.
        top: 'min(4rem, 8svh)',
        bottom: 'min(4rem, 8svh)',
        width: `min(${INSPECT.panelW}px, calc(100vw - 1rem))`,
        borderRadius: '1.5rem',
      };

  return (
    <motion.div
      initial={isSheet ? { y: 80, opacity: 0.4 } : { x: INSPECT.panelW + 60, opacity: 0.4 }}
      animate={isSheet ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      style={{
        ...dockStyle,
        '--hero': heroColor,
        backgroundImage: `linear-gradient(180deg, ${CARD_THEME.bgTop}, ${CARD_THEME.bgBottom})`,
        borderColor: CARD_THEME.edge,
        boxShadow: `0 24px 80px rgba(2, 4, 10, 0.45), 0 0 44px color-mix(in srgb, var(--hero) 14%, transparent)`,
      }}
      className="pointer-events-auto absolute z-20 flex flex-col overflow-hidden border backdrop-blur-sm"
      data-testid="inspect-card"
    >
      {/* One-shot holo sweep */}
      <motion.div
        initial={{ y: '-130%' }}
        animate={{ y: '420%' }}
        transition={{ delay: 0.3, duration: 0.9, ease: 'easeInOut' }}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1/3"
        style={{
          background: `linear-gradient(180deg, transparent, ${CARD_THEME.shine}, transparent)`,
          mixBlendMode: 'screen',
        }}
      />

      {/* LOUD action-failure flash: the whole panel blinks red once */}
      {notice && (
        <motion.div
          key={notice.key}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-0 z-20"
          style={{
            background: CARD_THEME.dangerFlash,
            boxShadow: `inset 0 0 0 2px ${CARD_THEME.danger}`,
            borderRadius: dockStyle.borderRadius,
          }}
        />
      )}

      {/* ---- Sheet grab handle (phone only): the affordance AND a fat,
           thumb-reachable close target at the top of the sheet ---- */}
      {isSheet && (
        <button
          onClick={close}
          aria-label="Close inspect panel"
          className="flex w-full shrink-0 items-center justify-center pb-1 pt-2.5"
          data-testid="inspect-sheet-handle"
        >
          <span
            className="block h-1 w-11 rounded-full"
            style={{ background: CARD_THEME.edge }}
          />
        </button>
      )}

      {/* ---- Header band ---- */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 px-4 py-2.5"
        style={{ borderBottom: `1px solid color-mix(in srgb, var(--hero) 30%, transparent)` }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {spot.isNew ? (
            <motion.span
              initial={{ scale: 1.6, rotate: -14, opacity: 0 }}
              animate={{ scale: 1, rotate: -3, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 14, delay: 0.18 }}
              className="whitespace-nowrap text-[11px] uppercase tracking-[0.2em]"
              style={{ fontFamily: CARD_THEME.fontDisplay, color: 'var(--hero)' }}
            >
              ⟬ new spot! ⟭
            </motion.span>
          ) : (
            <span
              className="whitespace-nowrap text-[11px] uppercase tracking-[0.2em]"
              style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.iceDim }}
            >
              spotted ×{spot.count}
            </span>
          )}
          <RarityChip tier={rarity} />
        </div>
        <div
          className="shrink-0 font-mono text-[10px] uppercase tracking-widest"
          style={{ color: CARD_THEME.iceDim }}
          data-testid="inspect-hex"
        >
          {hex.toUpperCase()}
        </div>
      </div>

      {/* ---- HERO: real photo when planespotters has one, else turntable ---- */}
      <div
        className="relative shrink-0 overflow-hidden"
        style={{ height: isSheet ? INSPECT.heroHMobile : INSPECT.heroH }}
      >
        {photoLeads ? (
          <>
            <Image src={photoSrc} alt={title} fill unoptimized className="object-cover" />
            {/* legibility scrim + required planespotters credit/link */}
            <div className="absolute inset-0" style={{ background: CARD_THEME.heroScrim }} />
            {photo?.photographer && (
              <a
                href={photo.link || 'https://www.planespotters.net'}
                target="_blank"
                rel="noreferrer"
                className="absolute truncate rounded-md px-2 py-1 font-mono text-[9px] hover:underline"
                // Positioned inline, NOT with `bottom-2 left-2`: verify-fly-style
                // finds the Esri AttributionBar with the class selector
                // `.bottom-2.left-2`, and the credit pill would shadow it now
                // that photos actually come back (they never did while the
                // planespotters UA was being 403'd).
                style={{
                  bottom: '0.5rem',
                  left: '0.5rem',
                  background: 'rgba(4, 6, 13, 0.72)',
                  color: CARD_THEME.iceDim,
                  maxWidth: 'calc(100% - 1rem)',
                }}
                data-testid="inspect-photo-credit"
              >
                📷 {photo.photographer} · planespotters.net
              </a>
            )}
          </>
        ) : (
          <>
            <ModelTurntable archetype={track.archetype} meta={meta} heroColor={heroColor} />
            {/* Honest photo state: a lookup in flight is not "no photo". */}
            <span
              className={`pointer-events-none absolute right-2 top-2 rounded-md px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.18em] ${photoPending ? 'animate-pulse' : ''}`}
              style={{ background: 'rgba(4, 6, 13, 0.55)', color: CARD_THEME.iceFaint }}
              data-testid="inspect-photo-state"
            >
              {photoPending ? 'photo lookup…' : 'no photo on file'}
            </span>
          </>
        )}
      </div>

      {/* ---- Scroll column: the data stack (uncramped — vertical room) ---- */}
      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 pb-3 pt-3"
        style={{ background: CARD_THEME.textPanel }}
      >
        {/* Identity — the round-15 headline: what this actually IS */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <div
              className="min-w-0 truncate text-[26px] leading-tight"
              style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
              title={title}
            >
              {title}
            </div>
            {reg && reg !== title && (
              <div
                className="shrink-0 font-mono text-[11px]"
                style={{ color: CARD_THEME.iceDim }}
                data-testid="inspect-reg"
              >
                {reg}
              </div>
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <MonogramChip code={monogram} />
            <span
              className="min-w-0 flex-1 truncate text-[13px]"
              style={{ color: CARD_THEME.iceDim }}
              title={operatorLine}
            >
              {operatorLine}
            </span>
            {flag && (
              <span
                className="shrink-0 text-[13px] leading-none"
                title={info?.country || undefined}
              >
                {flag}
              </span>
            )}
          </div>

          <div
            className="mt-1.5 truncate text-[14px] leading-snug"
            style={{ color: CARD_THEME.ice }}
            title={modelPrimary}
            data-testid="inspect-model"
          >
            {modelPrimary}
          </div>
          {modelSub && (
            <div
              className="truncate font-mono text-[10px] uppercase tracking-wider"
              style={{ color: CARD_THEME.iceDim }}
              title={modelSub}
            >
              {modelSub}
            </div>
          )}
          {ownerFact && (
            <div className="mt-1.5">
              <FactRow label="owner" value={ownerFact} testid="inspect-owner" />
            </div>
          )}

          {live && (
            <div className="mt-2">
              <BearingChip bearingDeg={live.bearingDeg} relAltFt={live.relAltFt} />
            </div>
          )}
        </div>

        {/* Route progress */}
        <RouteProgress route={route} loading={routeLoading} />

        {/* Stat meters */}
        <div className="space-y-1.5">
          {live ? (
            <>
              <StatBar label="ALT" pct={live.altFt / 45000} delay={0.05}>
                <Odometer value={live.altFt} format={(v) => `${Math.round(v).toLocaleString()} ft`} />
              </StatBar>
              <StatBar label="GS" pct={live.gsKt / 600} delay={0.11}>
                <Odometer value={live.gsKt} format={(v) => `${Math.round(v)} kt`} />
              </StatBar>
              <StatBar label="V/S" pct={Math.min(1, Math.abs(live.vsFpm) / 4000)} delay={0.17}>
                <span style={{ color: 'var(--hero)' }}>{live.vsFpm > 50 ? '▲ ' : live.vsFpm < -50 ? '▼ ' : ''}</span>
                <Odometer value={Math.abs(live.vsFpm)} format={(v) => `${Math.round(v)} fpm`} />
              </StatBar>
              <div className="flex items-center justify-between gap-2 pt-0.5 font-mono text-[11px]" style={{ color: CARD_THEME.iceDim }}>
                <span className="whitespace-nowrap">
                  HDG <span style={{ color: CARD_THEME.ice }}>{live.hdg}°</span>
                </span>
                <Sparkline samples={vsSamplesRef.current} />
                <span className="whitespace-nowrap">
                  DIST{' '}
                  <span style={{ color: CARD_THEME.ice }}>
                    <Odometer value={live.distNm} format={(v) => `${v.toFixed(1)} nm`} />
                  </span>
                </span>
              </div>
            </>
          ) : (
            <div
              className="animate-pulse rounded-lg py-3 text-center font-mono text-[10px] uppercase tracking-[0.3em]"
              style={{ background: CARD_THEME.panel, color: CARD_THEME.iceFaint }}
            >
              acquiring telemetry…
            </div>
          )}
        </div>

        {/* Data grid: squawk / type code / category / class / reg / country,
            with the registry provenance line underneath (honest about where
            the identity above came from, or that nothing was on file). */}
        <div
          className="rounded-xl px-3 py-2 font-mono text-[11px]"
          style={{ background: CARD_THEME.panel }}
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <DataCell label="SQUAWK" value={meta.squawk ? formatSquawk(meta.squawk) : null} />
            <DataCell label="TYPE" value={typeCode} align="right" />
            <DataCell label="CAT" value={meta.category} />
            <DataCell label="CLASS" value={(meta.iconType || 'unknown').toUpperCase()} align="right" />
            <DataCell label="REG" value={reg} />
            <DataCell
              label="CTRY"
              value={info?.countryIso ? `${flag} ${info.countryIso}` : null}
              title={info?.country || undefined}
              align="right"
            />
          </div>
          <div
            className={`mt-1.5 border-t pt-1.5 text-[9px] uppercase tracking-[0.2em] ${infoPending ? 'animate-pulse' : ''}`}
            style={{ borderColor: CARD_THEME.edgeSoft, color: CARD_THEME.iceFaint }}
            data-testid="inspect-registry-source"
          >
            {infoPending
              ? 'registry lookup…'
              : info?.found
                ? `registry · ${info.source}`
                : 'registry · no public record'}
          </div>
        </div>

        {/* Spot log */}
        <div
          className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 font-mono text-[10px] uppercase tracking-wider"
          style={{ background: CARD_THEME.panel, color: CARD_THEME.iceDim }}
          data-testid="inspect-spot-log"
        >
          <span className="shrink-0">spot log</span>
          <span className="min-w-0 truncate text-right" style={{ color: CARD_THEME.ice }}>
            {spot.isNew
              ? 'first sighting'
              : `×${spot.count}${
                  spot.firstAt
                    ? ` · since ${new Date(spot.firstAt).toLocaleDateString()}`
                    : ''
                }`}
          </span>
        </div>

        {/* Secondary 3D model section (the photo took the hero slot) */}
        {photoLeads && (
          <div>
            <div
              className="mb-1 font-mono text-[9px] uppercase tracking-[0.25em]"
              style={{ color: CARD_THEME.iceFaint }}
            >
              3D model — drag to spin
            </div>
            <div
              className="overflow-hidden rounded-2xl"
              style={{ height: INSPECT.turntableH }}
            >
              <ModelTurntable archetype={track.archetype} meta={meta} heroColor={heroColor} />
            </div>
          </div>
        )}
      </div>

      {/* ---- Actions (pinned) ---- */}
      <div className="shrink-0 px-4 pb-1 pt-3" style={{ background: CARD_THEME.textPanel }}>
        <div className="grid grid-cols-2 gap-3">
          <motion.button
            whileHover={warpReady ? { scale: 1.04, rotate: -1 } : undefined}
            whileTap={warpReady ? { scale: 0.94 } : undefined}
            onClick={onWarp}
            disabled={!warpReady}
            className="rounded-2xl border-b-4 py-2.5 text-[13px] disabled:cursor-not-allowed"
            style={{
              fontFamily: CARD_THEME.fontDisplay,
              background: CARD_THEME.warpBg,
              borderColor: CARD_THEME.warpEdge,
              color: CARD_THEME.warpText,
              opacity: warpReady ? 1 : 0.45,
              minHeight: isSheet ? INSPECT.sheetActionH : undefined,
            }}
            data-testid="inspect-warp"
          >
            {warpReady ? '⚡ WARP' : 'SCENE SYNC…'}
          </motion.button>
          <motion.button
            whileHover={!frozen ? { scale: 1.04, rotate: 1 } : undefined}
            whileTap={!frozen ? { scale: 0.94 } : undefined}
            onClick={onChase}
            disabled={frozen}
            className="rounded-2xl border-b-4 py-2.5 text-[13px] disabled:cursor-not-allowed"
            style={{
              fontFamily: CARD_THEME.fontDisplay,
              background: 'var(--hero)',
              borderColor: 'color-mix(in srgb, var(--hero) 55%, black)',
              color: '#0b0e1a',
              opacity: frozen ? 0.45 : 1,
              minHeight: isSheet ? INSPECT.sheetActionH : undefined,
            }}
            data-testid="inspect-chase"
          >
            {frozen ? 'SIGNAL FROZEN' : '◎ CHASE'}
          </motion.button>
        </div>
        {frozen && !notice && (
          <div
            className="pt-1.5 text-center font-mono text-[9px] uppercase tracking-[0.2em]"
            style={{ color: CARD_THEME.iceFaint }}
          >
            no fresh fixes — chase needs a live signal
          </div>
        )}
        {notice && (
          <motion.div
            key={notice.key}
            initial={{ x: 0 }}
            animate={{ x: [0, -7, 7, -4, 4, 0] }}
            transition={{ duration: 0.35 }}
            className="pt-2 text-center font-mono text-[10px] uppercase tracking-[0.25em]"
            style={{ color: CARD_THEME.danger }}
            data-testid="inspect-action-notice"
          >
            {notice.msg}
          </motion.div>
        )}
      </div>

      <button
        onClick={close}
        className="w-full shrink-0 py-2 text-center font-mono text-[11px] tracking-widest transition-colors"
        style={{
          color: CARD_THEME.iceDim,
          background: CARD_THEME.textPanel,
          // Phone: clear the home indicator / gesture bar.
          paddingBottom: isSheet
            ? 'max(0.5rem, env(safe-area-inset-bottom, 0px))'
            : undefined,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = CARD_THEME.ice)}
        onMouseLeave={(e) => (e.currentTarget.style.color = CARD_THEME.iceDim)}
      >
        esc / close
      </button>
    </motion.div>
  );
}

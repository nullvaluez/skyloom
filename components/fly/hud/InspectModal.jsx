'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useFlyStore } from '@/stores/fly-store';
import { usePassportStore } from '@/stores/passport-store';
import { useRoute } from '@/hooks/use-route';
import { useAircraftPhoto } from '@/hooks/use-aircraft-photo';
import { getRuntimeAction } from '@/lib/fly/runtime-bus';
import { INSPECT } from '@/lib/fly/fly-constants';
import { M_TO_FT, MPS_TO_KT, RAD2DEG } from '@/lib/fly/coords';
import { formatSquawk } from '@/lib/format';
import { calculateRarity, getRarityTier } from '@/lib/rarity';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { CARD_THEME } from './inspect/inspect-tokens';
import {
  BearingChip,
  MonogramChip,
  Odometer,
  RarityChip,
  RouteProgress,
  Sparkline,
  StatBar,
} from './inspect/card-bits';
import { ModelTurntable, preloadTurntable } from './inspect/ModelTurntable';

/**
 * INK CODEX — the click-to-inspect target panel. Round 8.5 (§B) re-layout:
 * a right-DOCKED column (~420px, springs in from the right edge) instead of
 * the centered card — NO full-screen scrim, so clicks outside the panel
 * keep flying (the stick is still neutralized while open via
 * store.inspectHex). The planespotters photo is the HERO when one exists
 * (photographer credit + link kept — planespotters requirement); the 3D
 * turntable demotes to a secondary section, and takes the hero slot when
 * no photo comes back. Same INK+ICE holo identity: hero color (--hero from
 * track.meta.color) + rarity are the only saturated voices, chunky beveled
 * buttons, one-shot holo sweep.
 *
 * Reliability (the round-8 complaint): WARP/CHASE resolve their actions AT
 * CALL TIME through the runtime bus (scene remounts heal, captured nulls
 * don't orphan), WARP arms on runtimeReady && track (no more eternal
 * "ACQUIRING…" while a fix is missing — warpTo dead-reckons), CHASE
 * disables with a reason on frozen (stale === 2) tracks, and a failed
 * action flashes the WHOLE panel + auto-retries once ~400ms later.
 *
 * Wiring preserved exactly: opens via store.inspectHex (click a hovered
 * plane, or T on a lock), Esc closes (FlyMode), 1s stale auto-close, 500ms
 * live telemetry (per-frame data never touches React). Testids kept:
 * inspect-card/-warp/-chase/-hex/-action-notice.
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

function ModalBody({ hex, runtime }) {
  const runtimeReady = useFlyStore((s) => s.runtimeReady);
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
    usePassportStore.getState().logSpot({
      hex,
      flight: t.meta.flight,
      r: t.meta.r,
      t: t.meta.t,
      category: t.meta.category,
      lat: geo?.y,
      lon: geo?.x,
      _classification: t.meta.iconType,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  const rarity = useMemo(() => {
    if (!meta) return null;
    return getRarityTier(
      calculateRarity({
        hex,
        flight: meta.flight,
        t: meta.t,
        squawk: meta.squawk,
        category: meta.category,
        _classification: meta.iconType,
      })
    );
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
  const { data: photo } = useAircraftPhoto(hex);
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
  const typeName = getAircraftTypeName(meta.t, meta.category);
  const warpReady = runtimeReady; // track is non-null here by the guard above
  const photoLeads = !!photoSrc;

  return (
    <motion.div
      initial={{ x: INSPECT.panelW + 60, opacity: 0.4 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      style={{
        width: INSPECT.panelW,
        '--hero': heroColor,
        backgroundImage: `linear-gradient(180deg, ${CARD_THEME.bgTop}, ${CARD_THEME.bgBottom})`,
        borderColor: CARD_THEME.edge,
        boxShadow: `0 24px 80px rgba(2, 4, 10, 0.45), 0 0 44px color-mix(in srgb, var(--hero) 14%, transparent)`,
      }}
      className="pointer-events-auto absolute inset-y-16 right-4 z-20 flex flex-col overflow-hidden rounded-3xl border backdrop-blur-sm"
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
          className="pointer-events-none absolute inset-0 z-20 rounded-3xl"
          style={{
            background: CARD_THEME.dangerFlash,
            boxShadow: `inset 0 0 0 2px ${CARD_THEME.danger}`,
          }}
        />
      )}

      {/* ---- Header band ---- */}
      <div
        className="flex shrink-0 items-center justify-between px-4 py-2.5"
        style={{ borderBottom: `1px solid color-mix(in srgb, var(--hero) 30%, transparent)` }}
      >
        <div className="flex items-center gap-2.5">
          {spot.isNew ? (
            <motion.span
              initial={{ scale: 1.6, rotate: -14, opacity: 0 }}
              animate={{ scale: 1, rotate: -3, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 14, delay: 0.18 }}
              className="text-[11px] uppercase tracking-[0.2em]"
              style={{ fontFamily: CARD_THEME.fontDisplay, color: 'var(--hero)' }}
            >
              ⟬ new spot! ⟭
            </motion.span>
          ) : (
            <span
              className="text-[11px] uppercase tracking-[0.2em]"
              style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.iceDim }}
            >
              spotted ×{spot.count}
            </span>
          )}
          <RarityChip tier={rarity} />
        </div>
        <div
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: CARD_THEME.iceDim }}
          data-testid="inspect-hex"
        >
          {hex.toUpperCase()}
        </div>
      </div>

      {/* ---- HERO: real photo when planespotters has one, else turntable ---- */}
      <div
        className="relative shrink-0 overflow-hidden"
        style={{ height: INSPECT.heroH }}
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
                className="absolute bottom-2 left-2 rounded-md px-2 py-0.5 font-mono text-[9px] hover:underline"
                style={{ background: 'rgba(4, 6, 13, 0.72)', color: CARD_THEME.iceDim }}
                data-testid="inspect-photo-credit"
              >
                📷 {photo.photographer} · planespotters.net
              </a>
            )}
          </>
        ) : (
          <ModelTurntable archetype={track.archetype} meta={meta} heroColor={heroColor} />
        )}
      </div>

      {/* ---- Scroll column: the data stack (uncramped — vertical room) ---- */}
      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3 pt-3"
        style={{ background: CARD_THEME.textPanel }}
      >
        {/* Identity */}
        <div>
          <div className="flex items-baseline justify-between">
            <div
              className="truncate text-[26px] leading-tight"
              style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
            >
              {title}
            </div>
            {meta.r && meta.r !== title && (
              <div className="font-mono text-[11px]" style={{ color: CARD_THEME.iceDim }}>
                {meta.r}
              </div>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <MonogramChip code={route?.airline?.iata || route?.airline?.icao} />
            <span className="truncate text-[13px]" style={{ color: CARD_THEME.iceDim }}>
              {route?.airline?.name || (meta.r ? `Registered ${meta.r}` : 'Unknown operator')}
            </span>
          </div>
          <div className="mt-1 font-mono text-[11px]" style={{ color: CARD_THEME.iceDim }}>
            {typeName || 'UNKNOWN TYPE'}
          </div>
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
              <div className="flex items-center justify-between pt-0.5 font-mono text-[11px]" style={{ color: CARD_THEME.iceDim }}>
                <span>
                  HDG <span style={{ color: CARD_THEME.ice }}>{live.hdg}°</span>
                </span>
                <Sparkline samples={vsSamplesRef.current} />
                <span>
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

        {/* Data grid: squawk / type code / category / wake class */}
        <div
          className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl px-3 py-2 font-mono text-[11px]"
          style={{ background: CARD_THEME.panel }}
        >
          <span style={{ color: CARD_THEME.iceDim }}>
            SQUAWK{' '}
            <span style={{ color: meta.squawk ? CARD_THEME.ice : CARD_THEME.iceFaint }}>
              {meta.squawk ? formatSquawk(meta.squawk) : '····'}
            </span>
          </span>
          <span className="text-right" style={{ color: CARD_THEME.iceDim }}>
            TYPE{' '}
            <span style={{ color: meta.t ? CARD_THEME.ice : CARD_THEME.iceFaint }}>
              {meta.t || '—'}
            </span>
          </span>
          <span style={{ color: CARD_THEME.iceDim }}>
            CAT{' '}
            <span style={{ color: meta.category ? CARD_THEME.ice : CARD_THEME.iceFaint }}>
              {meta.category || '—'}
            </span>
          </span>
          <span className="text-right" style={{ color: CARD_THEME.iceDim }}>
            CLASS{' '}
            <span style={{ color: CARD_THEME.ice }}>
              {(meta.iconType || 'unknown').toUpperCase()}
            </span>
          </span>
        </div>

        {/* Spot log */}
        <div
          className="flex items-center justify-between rounded-xl px-3 py-2 font-mono text-[10px] uppercase tracking-wider"
          style={{ background: CARD_THEME.panel, color: CARD_THEME.iceDim }}
          data-testid="inspect-spot-log"
        >
          <span>spot log</span>
          <span style={{ color: CARD_THEME.ice }}>
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
        style={{ color: CARD_THEME.iceDim, background: CARD_THEME.textPanel }}
        onMouseEnter={(e) => (e.currentTarget.style.color = CARD_THEME.ice)}
        onMouseLeave={(e) => (e.currentTarget.style.color = CARD_THEME.iceDim)}
      >
        esc / close
      </button>
    </motion.div>
  );
}

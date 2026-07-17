'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useFlyStore } from '@/stores/fly-store';
import { usePassportStore } from '@/stores/passport-store';
import { useRoute } from '@/hooks/use-route';
import { useAircraftPhoto } from '@/hooks/use-aircraft';
import { M_TO_FT, MPS_TO_KT, RAD2DEG } from '@/lib/fly/coords';
import { formatSquawk } from '@/lib/format';
import { calculateRarity, getRarityTier } from '@/lib/rarity';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { CARD_THEME } from './inspect/inspect-tokens';
import { MonogramChip, Odometer, RarityChip, RouteProgress, StatBar } from './inspect/card-bits';
import { ModelTurntable, preloadTurntable } from './inspect/ModelTurntable';

/**
 * INK CODEX — the click-to-inspect target card. A dark glass codex entry
 * matching the world's INK+ICE direction: the ONLY saturated voices are the
 * aircraft-class hero color (--hero, from track.meta.color) and the rarity
 * tier. Arcade motion stays: spring entrance, pointer-parallax tilt, holo
 * sweep, chunky beveled buttons, a live 3D turntable of the target's
 * archetype (photo as a polaroid inset / tab).
 *
 * Wiring preserved exactly: opens via store.inspectHex (click a hovered
 * plane, or T on a lock), the stick is neutralized while open (FlyScene),
 * WARP = runtime.warpTo(hex), CHASE = runtime.interceptHex(hex), 1s stale
 * auto-close, 500ms live telemetry (per-frame data never touches React).
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
  // keyed: per-plane state (spot capture, tab, odometers) never leaks
  // across targets if inspectHex ever changes while open
  return <ModalBody key={inspectHex} hex={inspectHex} runtime={runtime} />;
}

function ModalBody({ hex, runtime }) {
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

  // Live telemetry at 500ms — the ONLY recurring React state here.
  const [live, setLive] = useState(null);
  useEffect(() => {
    const read = () => {
      const t = runtime.traffic?.tracks.get(hex);
      if (!t || !t.fix1) return;
      setLive({
        altFt: Math.round(t.ry * M_TO_FT),
        gsKt: Math.round(Math.hypot(t.fix1.vE, t.fix1.vN) * MPS_TO_KT),
        vsFpm: Math.round(t.fix1.vUp * M_TO_FT * 60),
        hdg: Math.round((((t.yaw * RAD2DEG) % 360) + 360) % 360),
        distNm: t.distM / 1852,
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
    return {
      isNew: !p.hasSpotted(hex),
      count: p.spottedAircraft.filter((s) => s.hex === hex).length,
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

  const { route } = useRoute(aircraftShim);
  const { data: photo } = useAircraftPhoto(hex);
  const photoSrc = photo?.thumbnail_large?.src || photo?.thumbnail?.src || null;

  const [tab, setTab] = useState('3d'); // '3d' | 'photo'
  const draggingRef = useRef(false);

  // Pointer-parallax tilt (suppressed while turntable-dragging): the
  // entrance spring owns the outer transform; live tilt rides an inner div.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const smx = useSpring(mx, { stiffness: 160, damping: 20 });
  const smy = useSpring(my, { stiffness: 160, damping: 20 });
  const tiltX = useTransform(smy, [-1, 1], [3.5, -3.5]);
  const tiltY = useTransform(smx, [-1, 1], [-4, 4]);
  const onTiltMove = (e) => {
    if (draggingRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
    my.set(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onTiltLeave = () => {
    mx.set(0);
    my.set(0);
  };

  if (!meta || !track) return null;
  const title = meta.flight || meta.r || hex.toUpperCase();
  const heroColor = meta.color || '#22d3ee';
  const typeName = getAircraftTypeName(meta.t, meta.category);

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center"
      style={{ perspective: '1100px', background: CARD_THEME.scrim }}
    >
      <motion.div
        initial={{ opacity: 0, y: 48, scale: 0.82, rotateX: 24 }}
        animate={{ opacity: 1, y: 0, scale: 1, rotateX: 7 }}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
        style={{ rotateY: -6, transformStyle: 'preserve-3d', '--hero': heroColor }}
        className="pointer-events-auto"
        data-testid="inspect-card"
      >
        <motion.div
          onPointerMove={onTiltMove}
          onPointerLeave={onTiltLeave}
          style={{
            rotateX: tiltX,
            rotateY: tiltY,
            transformStyle: 'preserve-3d',
            backgroundImage: `linear-gradient(180deg, ${CARD_THEME.bgTop}, ${CARD_THEME.bgBottom})`,
            borderColor: CARD_THEME.edge,
            boxShadow: `0 24px 80px rgba(2, 4, 10, 0.72), 0 0 44px color-mix(in srgb, var(--hero) 14%, transparent)`,
          }}
          className="relative w-[420px] overflow-hidden rounded-3xl border backdrop-blur-md"
        >
          {/* One-shot holo sweep */}
          <motion.div
            initial={{ x: '-130%' }}
            animate={{ x: '420%' }}
            transition={{ delay: 0.3, duration: 0.9, ease: 'easeInOut' }}
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12"
            style={{
              background: `linear-gradient(90deg, transparent, ${CARD_THEME.shine}, transparent)`,
              mixBlendMode: 'screen',
            }}
          />

          {/* ---- Header band ---- */}
          <div
            className="flex items-center justify-between px-5 py-2.5"
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

          {/* ---- Hero viewport: 3D turntable ⇄ photo ---- */}
          <div
            className="relative mx-4 mt-3 h-[210px] overflow-hidden rounded-2xl"
            style={{ background: CARD_THEME.panel, border: `1px solid ${CARD_THEME.edgeSoft}` }}
          >
            <ModelTurntable
              archetype={track.archetype}
              meta={meta}
              heroColor={heroColor}
              onDraggingChange={(d) => {
                draggingRef.current = d;
                if (d) onTiltLeave();
              }}
            />

            {/* Photo view overlays the (still-mounted) turntable */}
            {photoSrc && tab === 'photo' && (
              <div className="absolute inset-0">
                <Image src={photoSrc} alt={title} fill unoptimized className="object-cover" />
                {photo?.photographer && (
                  <div
                    className="absolute bottom-2 left-2 rounded-md px-2 py-0.5 font-mono text-[9px]"
                    style={{ background: 'rgba(4, 6, 13, 0.72)', color: CARD_THEME.iceDim }}
                    data-testid="inspect-photo-credit"
                  >
                    📷 {photo.photographer}
                  </div>
                )}
              </div>
            )}

            {/* Polaroid inset → jump to photo */}
            {photoSrc && tab === '3d' && (
              <motion.button
                initial={{ opacity: 0, y: 10, rotate: 6 }}
                animate={{ opacity: 1, y: 0, rotate: 3 }}
                transition={{ delay: 0.45 }}
                whileHover={{ scale: 1.08, rotate: 0 }}
                onClick={() => setTab('photo')}
                className="absolute bottom-2 right-2 block overflow-hidden rounded-md border-2 shadow-lg"
                style={{ borderColor: CARD_THEME.edge, width: 92, height: 60 }}
                aria-label="Show photo"
              >
                <Image src={photoSrc} alt="" fill unoptimized className="object-cover" />
              </motion.button>
            )}

            {/* Tab toggle */}
            <div className="absolute right-2 top-2 flex overflow-hidden rounded-md border" style={{ borderColor: CARD_THEME.edgeSoft }}>
              {[
                ['3d', '3D', true],
                ['photo', photoSrc ? 'PHOTO' : 'NO PHOTO', !!photoSrc],
              ].map(([key, label, enabled]) => (
                <button
                  key={key}
                  disabled={!enabled}
                  onClick={() => enabled && setTab(key)}
                  className="px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider transition-colors disabled:cursor-not-allowed"
                  style={{
                    background: tab === key ? 'rgba(207, 238, 248, 0.16)' : 'rgba(4, 6, 13, 0.5)',
                    color: enabled ? (tab === key ? CARD_THEME.ice : CARD_THEME.iceDim) : CARD_THEME.iceFaint,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

          </div>

          {/* ---- Identity ---- */}
          <div className="px-5 pt-3">
            <div className="flex items-baseline justify-between">
              <div
                className="text-[26px] leading-tight"
                style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
              >
                {title}
              </div>
              {meta.r && (
                <div className="font-mono text-[11px]" style={{ color: CARD_THEME.iceDim }}>
                  {meta.r}
                </div>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <MonogramChip code={route?.airline?.iata || route?.airline?.icao} />
              <span className="text-[13px]" style={{ color: CARD_THEME.iceDim }}>
                {route?.airline?.name || (meta.r ? `Registered ${meta.r}` : 'Unknown operator')}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px]" style={{ color: CARD_THEME.iceDim }}>
              {typeName || 'UNKNOWN TYPE'}
              {meta.squawk ? ` · squawk ${formatSquawk(meta.squawk)}` : ''}
            </div>
          </div>

          {/* ---- Route progress ---- */}
          <div className="px-5 pt-3">
            <RouteProgress route={route} />
          </div>

          {/* ---- Stat meters ---- */}
          <div className="space-y-1.5 px-5 pt-3">
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

          {/* ---- Actions ---- */}
          <div className="grid grid-cols-2 gap-3 px-5 pb-1 pt-4">
            <motion.button
              whileHover={{ scale: 1.04, rotate: -1 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => runtime.warpTo?.(hex)}
              className="rounded-2xl border-b-4 py-2.5 text-[13px]"
              style={{
                fontFamily: CARD_THEME.fontDisplay,
                background: CARD_THEME.warpBg,
                borderColor: CARD_THEME.warpEdge,
                color: CARD_THEME.warpText,
              }}
              data-testid="inspect-warp"
            >
              ⚡ WARP
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.04, rotate: 1 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => {
                runtime.interceptHex?.(hex);
                close();
              }}
              className="rounded-2xl border-b-4 py-2.5 text-[13px]"
              style={{
                fontFamily: CARD_THEME.fontDisplay,
                background: 'var(--hero)',
                borderColor: 'color-mix(in srgb, var(--hero) 55%, black)',
                color: '#0b0e1a',
              }}
              data-testid="inspect-chase"
            >
              ◎ CHASE
            </motion.button>
          </div>

          <button
            onClick={close}
            className="w-full py-2 text-center font-mono text-[11px] tracking-widest transition-colors"
            style={{ color: CARD_THEME.iceDim }}
            onMouseEnter={(e) => (e.currentTarget.style.color = CARD_THEME.ice)}
            onMouseLeave={(e) => (e.currentTarget.style.color = CARD_THEME.iceDim)}
          >
            esc / close
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}

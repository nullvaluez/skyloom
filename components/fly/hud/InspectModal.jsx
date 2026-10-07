'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { motion, useDragControls } from 'framer-motion';
import { useGLTF } from '@react-three/drei';
import { ChevronLeft, ChevronRight, Crosshair, X, Zap } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { usePassportStore } from '@/stores/passport-store';
import { useRoute } from '@/hooks/use-route';
import { useAircraftPhoto } from '@/hooks/use-aircraft-photo';
import { useAircraftInfo } from '@/hooks/use-aircraft-info';
import { useSheetLayout } from '@/hooks/use-sheet-layout';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { getRuntimeAction } from '@/lib/fly/runtime-bus';
import { INSPECT } from '@/lib/fly/fly-constants';
import { trackSpotAttrs } from '@/lib/fly/spot-attrs';
import { M_TO_FT, MPS_TO_KT, RAD2DEG } from '@/lib/fly/coords';
import { formatSquawk } from '@/lib/format';
import { calculateRarity, getRarityTier } from '@/lib/rarity';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { relativeTo, startEscort } from '@/lib/fly/escort';
import { isRemote } from '@/lib/fly/mp/mp-flag';
import { F as MP_FLAG } from '@/lib/fly/mp/protocol.mjs';
import { aircraftName, resolveAircraft } from '@/lib/fly/player-aircraft';
import { aircraftPresentation } from '@/lib/fly/cinematic-earth';
import { isPhoneClass } from '@/lib/fly/device-class';
import { countryFlag } from './inspect/card-bits';
import { Facts, RelativeRow, RouteStrip, TelemetryTiles } from './inspect/dossier-bits';
import { ModelTurntable, preloadTurntable } from './inspect/ModelTurntable';
import './target-ui.css';

/**
 * TARGET DOSSIER — the click-to-inspect panel (2026-10 redesign).
 *
 * The INK CODEX card read as a data sheet; this is a game target screen:
 *   · a hero stage (the real planespotters photo when one exists, else the
 *     archetype on a lit turntable) framed by lock-on brackets, a LIVE tag
 *     and the callsign set big over it;
 *   · four live telemetry tiles, a "where is it from me" row (clock position,
 *     height difference, closing speed) and the route strip;
 *   · the registry/transponder facts folded into a Dossier disclosure;
 *   · two big actions pinned to the bottom (thumb reach on a phone):
 *       ESCORT — fly alongside with the cinematic camera (lib/fly/escort.js;
 *                was CHASE, which only engaged the autopilot and closed);
 *       WARP   — jump in behind it.
 *   · ‹ › (Q / E) cycles through nearby contacts without closing.
 * Desktop: a frosted dock on the right. Phone portrait: a bottom sheet you
 * drag down to dismiss. Phone landscape: a full-height side dock.
 *
 * Wiring kept from rounds 8.5/15/17: opens via store.inspectHex (click a
 * plane, T on a lock, tap the lock chip), Esc closes (FlyMode), 1 s
 * stale auto-close, 500 ms telemetry (nothing per frame reaches React),
 * actions resolve AT CALL TIME through the runtime bus, a failed action
 * flashes the panel and retries ONCE ~400 ms later when the failure can be a
 * scene remount. Testids kept: inspect-card/-warp/-chase/-hex/-action-notice/
 * -photo-credit/-photo-state/-spot-log/-reg/-model/-owner/-route/
 * -registry-source/-sheet-handle, plus -turntable/-bearing/-sparkline.
 *
 * MULTIPLAYER: another pilot (isRemote) gets the same dossier minus everything
 * that would score, persist or look up a fake aircraft — no passport spot, no
 * rarity/NEW chips, and the route/photo/registry hooks receive null so no
 * /api/aircraft/p:* request is ever made. The hero is the pilot's own airframe
 * (the hangar's presentation entry).
 */

/** The hangar presentation entry a remote pilot's dossier shows. */
function pilotEntry(aircraftId) {
  return aircraftPresentation(resolveAircraft(aircraftId), isPhoneClass());
}
export function InspectModal({ runtime }) {
  const inspectHex = useFlyStore((s) => s.inspectHex);

  // Pre-parse the hovered/locked plane's GLB so the card opens instantly
  // (HTTP is already immutable-cached; this warms the parse).
  useEffect(() => {
    const id = setInterval(() => {
      const hex = runtime.hoverHex ?? useFlyStore.getState().lockedHex;
      if (!hex) return;
      const t = runtime.traffic?.tracks.get(hex);
      if (t?.remote === true) useGLTF.preload(pilotEntry(t.meta?.aircraftId).url); // MULTIPLAYER: the pilot's own airframe
      else if (t) preloadTurntable(t.archetype);
    }, 500);
    return () => clearInterval(id);
  }, [runtime]);

  if (!inspectHex) return null;
  // keyed: per-plane state (spot capture, odometers, retry arm) never leaks
  // across targets when ‹ › cycles to the next contact
  return <ModalBody key={inspectHex} hex={inspectHex} runtime={runtime} />;
}

// Session memory for the Dossier disclosure (a preference, not a save).
let factsOpenPref = false;

/** Nearby contacts ordered by range, for ‹ › cycling. */
function cycleList(runtime) {
  const items = runtime.traffic?.items ?? [];
  return items
    .filter((t) => t.meta && t.stale !== 2)
    .sort((a, b) => a.distM - b.distM)
    .slice(0, 40)
    .map((t) => t.hex);
}

function ModalBody({ hex, runtime }) {
  const runtimeReady = useFlyStore((s) => s.runtimeReady);
  const isSheet = useSheetLayout();
  const { isPhone, isTouch, orientation } = useDeviceLayout();
  const track = runtime.traffic?.tracks.get(hex);
  const meta = track?.meta;
  const remote = isRemote(hex);
  const close = useCallback(() => useFlyStore.getState().setInspectHex(null), []);
  const dragControls = useDragControls();

  // Track vanished (stale-removed) while open — bail out gracefully
  useEffect(() => {
    const id = setInterval(() => {
      if (!runtime.traffic?.tracks.get(hex)) close();
    }, 1000);
    return () => clearInterval(id);
  }, [hex, runtime, close]);

  // Live telemetry at 500 ms — the ONLY recurring React state here (plus the
  // frozen flag). stale is read BEFORE the fix1 gate so ESCORT can
  // disable-with-reason even when telemetry never acquired.
  const [live, setLive] = useState(null);
  const [frozen, setFrozen] = useState(false);
  const [pilotTag, setPilotTag] = useState(null); // MULTIPLAYER: 'Paused' | 'Signal lost' | null
  const vsSamplesRef = useRef([]);
  const rangeRef = useRef(null);
  useEffect(() => {
    const read = () => {
      const t = runtime.traffic?.tracks.get(hex);
      if (!t) return;
      // A remote pilot's stale 2 is usually "paused": Escort stays pressable
      // and startEscort says why (lib/fly/escort.js remoteEscortBlocker); the
      // live tag says it on its own state, matching the label's ' · paused'.
      setFrozen(t.stale === 2 && t.remote !== true);
      if (t.remote === true) setPilotTag(t.mpFlags & MP_FLAG.HELD ? 'Paused' : t.stale === 2 ? 'Signal lost' : null);
      if (!t.fix1) return;
      const vsFpm = Math.round(t.fix1.vUp * M_TO_FT * 60);
      const ring = vsSamplesRef.current;
      ring.push(vsFpm);
      if (ring.length > 12) ring.shift();
      const now = performance.now() / 1000;
      const prev = rangeRef.current;
      const closingKt = prev && now - prev.t > 0.2 ? ((prev.d - t.distM) / (now - prev.t)) * MPS_TO_KT : null;
      rangeRef.current = { d: t.distM, t: now };
      const rel = relativeTo(runtime, t);
      const heading = runtime.flight ? (((runtime.flight.heading * RAD2DEG) % 360) + 360) % 360 : 0;
      setLive({
        altFt: Math.round(t.ry * M_TO_FT),
        gsKt: Math.round(Math.hypot(t.fix1.vE, t.fix1.vN) * MPS_TO_KT),
        vsFpm,
        hdg: Math.round((((t.yaw * RAD2DEG) % 360) + 360) % 360),
        distNm: t.distM / 1852,
        closingKt,
        rel: rel && { ...rel, offDeg: rel.bearing - heading },
      });
    };
    read();
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, [hex, runtime]);

  // Passport: capture BEFORE logging (dedup is per hex per hour), then log
  // this sighting — inspecting a plane counts as spotting it.
  const [spot] = useState(() => {
    const p = usePassportStore.getState();
    const prev = p.spottedAircraft.filter((s) => s.hex === hex);
    return {
      isNew: !p.hasSpotted(hex),
      count: prev.length,
      // logSpot prepends — the OLDEST sighting is the last element
      firstAt: prev.length ? prev[prev.length - 1].timestamp : null,
    };
  });
  useEffect(() => {
    const t = runtime.traffic?.tracks.get(hex);
    if (!t?.meta || t.remote === true) return; // MULTIPLAYER: a pilot is never a spot
    const geo = runtime.engine?.worldToGeo({ x: t.rx, y: t.ry, z: t.rz });
    usePassportStore.getState().logSpot(trackSpotAttrs(t, geo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  // R17: the SAME builder logSpot uses, so the printed tier and the passport
  // can never disagree.
  const rarity = useMemo(() => {
    if (!meta || remote) return null;
    return getRarityTier(calculateRarity(trackSpotAttrs(track)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex, meta]);

  // Geo shim for the shared data hooks (gs/track feed ETA/progress)
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

  // null disables each query (enabled: !!arg): a pilot is never looked up.
  const { route, isLoading: routeLoading } = useRoute(remote ? null : aircraftShim);
  const { data: photo, isPending: photoPending } = useAircraftPhoto(remote ? null : hex);
  const { data: info, isPending: infoPending } = useAircraftInfo(remote ? null : hex);
  const photoSrc = photo?.thumbnail_large?.src || photo?.thumbnail?.src || null;
  const heroEntry = useMemo(() => (remote ? pilotEntry(meta?.aircraftId) : undefined), [remote, meta?.aircraftId]);

  // ---- Actions -------------------------------------------------------------
  const [notice, setNotice] = useState(null); // { key, msg } | null
  const retryTimer = useRef(null);
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  const resolveAction = (name) => {
    const fn = getRuntimeAction(name);
    if (fn) return fn;
    return typeof runtime[name] === 'function' ? runtime[name] : null;
  };
  const warpFailMsg = () => {
    if (!useFlyStore.getState().runtimeReady) return 'Scene rebuilding';
    if (!runtime.traffic?.tracks.get(hex)) return 'Target lost — signal gone';
    return 'Warp failed';
  };
  const runAction = (kind, isRetry = false) => {
    if (kind === 'chase') {
      const res = startEscort(runtime, hex, { cinematic: true, source: 'inspect' });
      if (res.ok) {
        setNotice(null);
        close();
        return;
      }
      // Only a remount window is worth one silent retry; the rest are facts.
      const retriable = res.reason === 'scene' || res.reason === 'failed';
      setNotice({ key: Date.now(), msg: `${res.message}${retriable && !isRetry ? ' Retrying…' : ''}` });
      if (retriable && !isRetry) {
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => runAction(kind, true), INSPECT.actionRetryMs);
      }
      return;
    }
    const fn = resolveAction('warpTo');
    const ok = !!fn && fn(hex) === true;
    if (ok) {
      setNotice(null);
      return; // warp closes the card via warpTo itself
    }
    setNotice({ key: Date.now(), msg: `${warpFailMsg()}${isRetry ? ' — retry failed' : ' — retrying…'}` });
    if (!isRetry) {
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => runAction(kind, true), INSPECT.actionRetryMs);
    }
  };
  const onWarp = () => runAction('warp');
  const onEscort = () => runAction('chase');

  const cycle = useCallback(
    (dir) => {
      const list = cycleList(runtime);
      if (list.length < 2) return;
      const i = list.indexOf(hex);
      const next = list[(i < 0 ? 0 : i + dir + list.length) % list.length];
      if (next && next !== hex) useFlyStore.getState().setInspectHex(next);
    },
    [runtime, hex],
  );

  // Keyboard: F escort · G warp · Q/E (or [ ]) cycle. Capture phase + stop,
  // so the flight input never also sees the key (an F reaching FlyScene the
  // next frame would release the escort it just started).
  const actionsRef = useRef({});
  actionsRef.current = { onEscort, onWarp, cycle, frozen, warpReady: runtimeReady };
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key.toLowerCase();
      const a = actionsRef.current;
      let handled = true;
      if (k === 'f') {
        if (!a.frozen) a.onEscort();
      } else if (k === 'g') {
        if (a.warpReady) a.onWarp();
      } else if (k === 'q' || k === '[') a.cycle(-1);
      else if (k === 'e' || k === ']') a.cycle(1);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const [factsOpen, setFactsOpen] = useState(() => factsOpenPref);
  const toggleFacts = () => {
    factsOpenPref = !factsOpen;
    setFactsOpen(!factsOpen);
  };

  if (!meta || !track) return null;
  const title = meta.flight?.trim() || meta.r || hex.toUpperCase();
  const heroColor = meta.color || '#4fe3ff';
  const tierColor = rarity && rarity.tier !== 'common' ? rarity.color : '#4fe3ff';
  const warpReady = runtimeReady;
  const photoLeads = !!photoSrc;

  // ---- Identity: registry FIRST, local tables as the honest fallback ------
  const reg = meta.r || info?.registration || null;
  const typeCode = meta.t || info?.typeCode || null;
  const typeName = remote ? aircraftName(meta.aircraftId) : getAircraftTypeName(typeCode, meta.category);
  const registryModel = [info?.manufacturer, info?.model].filter(Boolean).join(' ') || null;
  const thinModel = !info?.model || /^[0-9]{1,4}$/.test(info.model);
  const headlineIsRegistry = !!registryModel && !(thinModel && typeName);
  const modelPrimary = (headlineIsRegistry ? registryModel : typeName) || registryModel || 'Unknown type';
  const airlineName = route?.airline?.name || null;
  const owner = info?.owner || null;
  const operatorLine = remote
    ? 'Skyloom pilot · online'
    : airlineName || owner || (reg ? `Registered ${reg}` : 'Unknown operator');
  const ownerFact = owner && owner !== operatorLine ? owner : null;
  const flag = countryFlag(info?.countryIso);
  const monogram = route?.airline?.iata || route?.airline?.icao || info?.operatorFlagCode || null;
  const canCycle = (runtime.traffic?.items?.length ?? 0) > 1;

  // ---- Geometry: desktop dock · phone sheet · landscape-phone dock --------
  const landDock = isPhone && orientation === 'landscape';
  const sheetMotion = isSheet && !landDock;
  const dockStyle = landDock
    ? {
        right: 'max(env(safe-area-inset-right), 0.5rem)',
        top: 'max(env(safe-area-inset-top), 0.5rem)',
        bottom: 'max(env(safe-area-inset-bottom), 0.5rem)',
        width: 'min(58vw, 440px)',
        borderRadius: '1.25rem',
        '--tgt-hero-h': '128px',
      }
    : sheetMotion
      ? {
          left: 0,
          right: 0,
          top: 'auto',
          bottom: 0,
          maxHeight: `${INSPECT.sheetMaxSvh}svh`,
          borderRadius: '1.6rem 1.6rem 0 0',
          '--tgt-hero-h': `${INSPECT.heroHMobile}px`,
        }
      : {
          right: '1rem',
          top: 'min(4rem, 8svh)',
          bottom: 'min(4rem, 8svh)',
          width: `min(${INSPECT.panelW}px, calc(100vw - 1rem))`,
          borderRadius: '1.5rem',
          '--tgt-hero-h': '232px',
        };

  const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.12 } } };
  const rise = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 26 } },
  };

  const facts = remote ? [
    ['Aircraft', typeName],
    ['Class', (meta.iconType || 'unknown').replace(/^\w/, (c) => c.toUpperCase())],
    ['Pilot', 'Skyloom pilot · online · nothing is saved', true],
  ] : [
    ['Squawk', meta.squawk ? formatSquawk(meta.squawk) : null],
    ['Type code', typeCode],
    ['Registration', reg],
    ['Category', meta.category],
    ['Class', (meta.iconType || 'unknown').replace(/^\w/, (c) => c.toUpperCase())],
    ['Country', info?.countryIso ? `${flag} ${info.country || info.countryIso}` : null],
    ['Registered owner', ownerFact || owner, true, 'inspect-owner'],
    [
      'Spot log',
      spot.isNew
        ? 'First sighting — logged'
        : `Seen ${spot.count}×${spot.firstAt ? ` since ${new Date(spot.firstAt).toLocaleDateString()}` : ''}`,
      true,
      'inspect-spot-log',
    ],
  ];

  return (
    <motion.aside
      className="tgt tgt-dossier hud-flat-phone"
      data-testid="inspect-card"
      data-overlay="inspect"
      aria-label={`Aircraft ${title}`}
      drag={sheetMotion ? 'y' : false}
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.7 }}
      onDragEnd={(_, info) => {
        if (info.offset.y > 110 || info.velocity.y > 650) close();
      }}
      initial={sheetMotion ? { y: '60%', opacity: 0 } : { x: 70, opacity: 0, scale: 0.98 }}
      animate={sheetMotion ? { y: 0, opacity: 1 } : { x: 0, opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      style={{ ...dockStyle, '--hero': heroColor, '--tier': tierColor }}
    >
      {/* LOUD action-failure flash: the whole panel blinks once */}
      {notice && (
        <motion.div
          key={notice.key}
          className="tgt-flash"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          style={{ borderRadius: dockStyle.borderRadius }}
        />
      )}

      {sheetMotion && (
        <button
          type="button"
          className="tgt-grab"
          onClick={close}
          onPointerDown={(e) => dragControls.start(e)}
          aria-label="Close aircraft details"
          data-testid="inspect-sheet-handle"
          style={{ touchAction: 'none' }}
        >
          <span />
        </button>
      )}

      {/* ---- Header: rarity, spot stamp, cycle, hex, close ---- */}
      <div className="tgt-head" onPointerDown={sheetMotion ? (e) => dragControls.start(e) : undefined}>
        {rarity && (
          <span className="tgt-rarity" style={{ '--tier': rarity.color }}>
            {rarity.name}
          </span>
        )}
        {remote ? null : spot.isNew ? (
          <motion.span
            className="tgt-stamp"
            initial={{ scale: 1.8, rotate: -16, opacity: 0 }}
            animate={{ scale: 1, rotate: -4, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 330, damping: 13, delay: 0.25 }}
          >
            New spot
          </motion.span>
        ) : (
          <span className="tgt-seen">Seen ×{spot.count}</span>
        )}
        <div className="tgt-head-tools">
          {canCycle && (
            <>
              <button
                type="button"
                className="tgt-iconbtn"
                onClick={() => cycle(-1)}
                aria-label="Previous nearby aircraft"
                title="Previous (Q)"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="tgt-iconbtn"
                onClick={() => cycle(1)}
                aria-label="Next nearby aircraft"
                title="Next (E)"
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}
          {!isPhone && (
            <span className="tgt-hex" data-testid="inspect-hex">
              {hex.toUpperCase()}
            </span>
          )}
          <button
            type="button"
            className="tgt-iconbtn"
            onClick={close}
            aria-label="Close aircraft details"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ---- Hero stage ---- */}
      <div className="tgt-hero-band">
        <div className="tgt-hero">
          <div className="tgt-hero-floor" aria-hidden="true" />
          {photoLeads ? (
            <>
              <Image src={photoSrc} alt={title} fill unoptimized sizes="440px" />
              {photo?.photographer && (
                <a
                  className="tgt-credit"
                  href={photo.link || 'https://www.planespotters.net'}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="inspect-photo-credit"
                >
                  📷 {photo.photographer} · planespotters.net
                </a>
              )}
            </>
          ) : (
            <>
              <div style={{ position: 'absolute', inset: '0 0 52px 0' }}>
                <ModelTurntable archetype={track.archetype} entry={heroEntry} meta={meta} heroColor={heroColor} />
              </div>
              {!remote && (
                <span
                  className="tgt-photo-state"
                  data-testid="inspect-photo-state"
                  data-busy={photoPending ? '1' : '0'}
                >
                  {photoPending ? 'Photo lookup…' : 'No photo on file'}
                </span>
              )}
            </>
          )}
          <div className="tgt-hero-shade" aria-hidden="true" />
          {['tl', 'tr', 'bl', 'br'].map((c, i) => (
            <motion.span
              key={c}
              className="tgt-bracket"
              data-c={c}
              aria-hidden="true"
              initial={{ opacity: 0, scale: 1.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 + i * 0.04, type: 'spring', stiffness: 380, damping: 20 }}
            />
          ))}
          <motion.div
            className="tgt-scan"
            aria-hidden="true"
            initial={{ y: '-110%' }}
            animate={{ y: '300%' }}
            transition={{ delay: 0.2, duration: 1, ease: [0.4, 0, 0.2, 1] }}
          />
          <span className="tgt-live" data-frozen={frozen || pilotTag ? '1' : '0'}>
            <i />
            {frozen
              ? 'Signal frozen'
              : pilotTag
                ? pilotTag
                : live
                  ? `Live · ${live.distNm < 10 ? live.distNm.toFixed(1) : Math.round(live.distNm)} nm`
                  : 'Acquiring'}
          </span>
          <div className="tgt-callsign">
            <motion.h2
              title={title}
              initial={{ opacity: 0, y: 8, letterSpacing: '0.12em' }}
              animate={{ opacity: 1, y: 0, letterSpacing: '-0.005em' }}
              transition={{ delay: 0.1, duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {title}
            </motion.h2>
            <p title={modelPrimary}>{modelPrimary}</p>
          </div>
        </div>
      </div>

      {/* ---- Scrolling body ---- */}
      <motion.div className="tgt-body" data-scroll="" variants={stagger} initial="hidden" animate="show">
        <motion.div className="tgt-ident" variants={rise}>
          <span className="tgt-monogram" data-empty={monogram ? '0' : '1'}>
            {monogram || '✈'}
          </span>
          <div className="tgt-ident-text">
            <div className="tgt-operator" title={operatorLine}>
              <span>{operatorLine}</span>
              {flag && <span title={info?.country || undefined}>{flag}</span>}
            </div>
            <div className="tgt-model" data-testid="inspect-model" title={modelPrimary}>
              {[headlineIsRegistry ? typeName : registryModel, typeCode]
                .filter((v) => v && v !== modelPrimary)
                .join(' · ') || modelPrimary}
            </div>
          </div>
          {reg && reg !== title && (
            <span className="tgt-chip" data-testid="inspect-reg">
              {reg}
            </span>
          )}
          {isPhone && (
            <span className="tgt-chip" data-testid="inspect-hex">
              {hex.toUpperCase()}
            </span>
          )}
        </motion.div>

        <motion.div variants={rise}>
          {live ? (
            <TelemetryTiles live={live} />
          ) : (
            <div className="tgt-empty" data-busy="1">
              Acquiring telemetry…
            </div>
          )}
        </motion.div>

        <motion.div variants={rise}>
          <RelativeRow live={live} samples={vsSamplesRef.current} />
        </motion.div>

        {!remote && (
          <motion.div variants={rise}>
            <RouteStrip route={route} loading={routeLoading} />
          </motion.div>
        )}

        <motion.div variants={rise}>
          <Facts
            open={factsOpen}
            onToggle={toggleFacts}
            rows={facts}
            provenanceBusy={!remote && infoPending}
            provenance={
              remote
                ? 'Another Skyloom pilot · no registry lookup'
                : infoPending
                  ? 'Registry lookup…'
                  : info?.found
                    ? `Registry · ${info.source}`
                    : 'Registry · no public record'
            }
          />
        </motion.div>

        {/* The photo took the stage — the 3D model rides along below it. */}
        {photoLeads && (
          <motion.div className="tgt-model3d" variants={rise}>
            <span>3D model · drag to spin</span>
            <ModelTurntable archetype={track.archetype} meta={meta} heroColor={heroColor} />
          </motion.div>
        )}
      </motion.div>

      {/* ---- Actions (pinned) ---- */}
      <div className="tgt-actions">
        <div className="tgt-actions-row">
          <button
            type="button"
            className="tgt-btn tgt-btn-primary"
            onClick={onEscort}
            disabled={frozen}
            data-testid="inspect-chase"
            title={
              frozen
                ? 'No fresh position — escort needs a live signal'
                : 'Fly alongside with the cinematic camera (F)'
            }
          >
            <Crosshair size={22} strokeWidth={2.4} aria-hidden="true" />
            <span className="tgt-btn-label">
              <strong>{frozen ? 'Signal frozen' : 'Escort'}</strong>
              <span>{frozen ? 'Needs a live signal' : 'Fly alongside · cinematic'}</span>
            </span>
            {!frozen && <span className="tgt-kbd">F</span>}
          </button>
          <button
            type="button"
            className="tgt-btn tgt-btn-secondary"
            onClick={onWarp}
            disabled={!warpReady}
            data-testid="inspect-warp"
            title="Jump in right behind it (G)"
          >
            <Zap size={20} strokeWidth={2.3} aria-hidden="true" />
            <span className="tgt-btn-label">
              <strong>{warpReady ? 'Warp' : 'Syncing…'}</strong>
              <span>Jump behind it</span>
            </span>
            <span className="tgt-kbd">G</span>
          </button>
        </div>
        {notice ? (
          <motion.div
            key={notice.key}
            className="tgt-notice"
            data-tone="bad"
            role="alert"
            initial={{ x: 0 }}
            animate={{ x: [0, -7, 7, -4, 4, 0] }}
            transition={{ duration: 0.35 }}
            data-testid="inspect-action-notice"
          >
            {notice.msg}
          </motion.div>
        ) : frozen ? (
          <div className="tgt-notice">No fresh fixes — escort needs a live signal.</div>
        ) : (
          !isTouch && (
            <div className="tgt-foot" aria-hidden="true">
              <span>
                <span className="tgt-kbd">Q</span>
                <span className="tgt-kbd">E</span> cycle
              </span>
              <span>
                <span className="tgt-kbd">Esc</span> close
              </span>
            </div>
          )
        )}
      </div>
    </motion.aside>
  );
}

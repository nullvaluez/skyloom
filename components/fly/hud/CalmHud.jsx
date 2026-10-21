'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFlyStore, inFlight } from '@/stores/fly-store';
import { useFlyContractsStore } from '@/stores/fly-contracts-store';
import { usePassportStore } from '@/stores/passport-store';
import { useEncounterStore } from '@/stores/encounter-store';
import { anyOverlayOpen } from '@/hooks/use-overlay-back';
import { explorerPreferences, subscribeExplorerPreferences, DEFAULT_PREFERENCES } from '@/lib/fly/explorer-preferences.mjs';
import { FLIGHT } from '@/lib/fly/fly-constants';
import { MPS_TO_KT, M_TO_FT, RAD2DEG } from '@/lib/fly/coords';
import {
  CALM_CFG, cardinal, fmtThousands, hudModeLabel, lastWake, legendMode, nextHudMode, placeDock,
  readHudMode, readLegendFlights, saveHudMode, saveLegendFlights, steerCue,
} from './calm-hud';
import './calm-hud.css';

/**
 * PLAY PASS — CALM_HUD (FLY_PLAY_PASS.md F1–F3, F7): the explorer HUD.
 *
 * Mounted by FlyHUD only with the flag on. It owns, on a pointer device:
 *   · the DOCK at the bottom centre — speed, altitude, heading and the
 *     throttle state in one quiet row (Explorer), the Spotting toggle, the
 *     keyboard legend for the first flights and then a one-line hint, the
 *     Spotting telemetry row. It finds its own height every half second: just
 *     above the attribution bar, lifted over whatever already sits in the
 *     bottom band (the lock card, Nearby, the escort card) so it never lands
 *     on another surface (placeDock, calm-hud.js);
 *   · the STEERING CUE — a ring at the centre and a needle toward the cursor,
 *     only while the mouse is off-centre and moving (the input controller's
 *     own shaping, so the needle is the command the aircraft gets);
 *   · CALM — after CALM_HUD.calm.afterSec without input or an event the
 *     chrome dims (data-calm on this root; calm-hud.css carries the rest of
 *     the HUD along with :has), and any input, notice, lock or gain wakes it;
 *   · the HUD MODE: restored from storage on mount, cycled by H, captioned.
 * On every device it also publishes data-scored / data-gain, which keep the
 * points chip away until something has scored and pulse it on a gain.
 *
 * Text is written at 10 Hz from the shared runtime through refs (the FlyHUD
 * cadence); nothing here runs per frame and nothing logs.
 */
const CUE = { deadzone: FLIGHT.mouseDeadzone, expo: FLIGHT.mouseExpo, ...(CALM_CFG.cue ?? {}) };
const DIM = CALM_CFG.calm ?? {};
// The obstacles of the bottom band the dock steps over (visible ones only).
const BAND = ['[data-testid="infocard"]', '[data-testid="infocard-chip"]', '.tgt-scope-btn', '[data-testid="encounter-card"]', '.tgt-mission', '.tgt-ec', '.tgt-moment', '.tgt-result', '[data-zone="minimap"] canvas', '[data-testid="juice-hud"]', '[data-testid="operations-hud"]'];
// The dimmed opacities as custom properties: the root carries its own; the
// <style> hands the shared ones to the chrome calm-hud.css dims with :has.
const ROOT_VARS = `[data-fly-root]{--calm-dim-cluster:${DIM.cluster ?? 0.5};--calm-dim-chrome:${DIM.chrome ?? 0.38};--calm-dim-minimap:${DIM.minimap ?? 0.55};--calm-night:${DIM.nightScale ?? 0.8}}`;

const LEGEND = [
  ['Mouse', 'steer'],
  ['1 2 3', 'speed'],
  ['Shift', 'boost'],
  ['N', 'nearby'],
  ['M', 'atlas'],
  ['P', 'photo'],
  ['H', 'HUD'],
  ['Esc', 'menu'],
];

export function CalmHud({ runtime, mode, isTouch, newEarth, spotting }) {
  const cinema = useFlyStore((s) => s.cameraMode === 'cinema');
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const qualityPreset = useFlyStore((s) => s.qualityPreset);
  const totalScore = useFlyContractsStore((s) => s.totalScore);
  const prefs = useSyncExternalStore(subscribeExplorerPreferences, explorerPreferences, () => DEFAULT_PREFERENCES);
  const rootRef = useRef(null);
  const dockRef = useRef(null);
  const cueRef = useRef(null);
  const spdRef = useRef(null);
  const altRef = useRef(null);
  const altCellRef = useRef(null);
  const altLabelRef = useRef(null);
  const vsRef = useRef(null);
  const hdgRef = useRef(null);
  const cardRef = useRef(null);
  const thrRef = useRef(null);
  const latRef = useRef(null);
  const lonRef = useRef(null);
  const spotsRef = useRef(null);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const [flights] = useState(() => readLegendFlights()); // this session's count, read once
  const [shown, setShown] = useState(false); // this flight's legend time is up
  const [caption, setCaption] = useState(null);
  const [gain, setGain] = useState(false);
  const live = useRef({ lastInput: -Infinity, lastMove: -Infinity, centredAt: null, cueOn: false, legendSec: 0, counted: false });

  // The saved mode, once (the store literal is the default until then); a
  // later change, from H or the Settings row, gets the caption.
  useEffect(() => {
    let hydrated = false;
    const off = useFlyStore.subscribe(
      (s) => s.hudMode,
      (m) => {
        if (hydrated) setCaption({ mode: m, at: performance.now() });
      },
    );
    useFlyStore.getState().setHudMode(readHudMode());
    hydrated = true;
    return off;
  }, []);
  useEffect(() => {
    if (!caption) return undefined;
    const id = setTimeout(() => setCaption(null), CALM_CFG.captionMs ?? 1800);
    return () => clearTimeout(id);
  }, [caption]);

  // H cycles the HUD mode while flying (never while typing or over a menu).
  useEffect(() => {
    const key = String(CALM_CFG.key ?? 'h').toLowerCase();
    const onKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || String(e.key).toLowerCase() !== key) return;
      const t = e.target;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT' || t?.isContentEditable) return;
      const s = useFlyStore.getState();
      if (!inFlight(s) || s.phase !== 'flying' || anyOverlayOpen(s) || s.airportWatch || s.airportBrowserOpen) return;
      s.setHudMode(saveHudMode(nextHudMode(s.hudMode)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A gain pulses the points chip (and wakes the HUD); nothing scored yet
  // keeps it away (calm-hud.css).
  const prevScore = useRef(totalScore);
  useEffect(() => {
    const before = prevScore.current;
    prevScore.current = totalScore;
    if (!(totalScore > before)) return undefined;
    live.current.lastInput = performance.now();
    setGain(true);
    const id = setTimeout(() => setGain(false), CALM_CFG.gainMs ?? 1600);
    return () => clearTimeout(id);
  }, [totalScore]);

  // Input and events keep the chrome awake; the cue follows the cursor.
  useEffect(() => {
    const L = live.current;
    const mark = () => {
      L.lastInput = performance.now();
    };
    const writeCue = (now) => {
      const el = cueRef.current;
      const inp = runtime.input;
      if (!el) return;
      const ok = !isTouch && modeRef.current !== 'instruments' && inp?.mouseActive && !inp.freeLook?.active;
      const c = ok ? steerCue(inp.mouse.x, inp.mouse.y, window.innerWidth, window.innerHeight, CUE) : null;
      if (!c) {
        if (L.cueOn) {
          L.cueOn = false;
          el.dataset.on = '0';
        }
        return;
      }
      el.style.setProperty('--calm-cue-ang', `${c.angle.toFixed(1)}deg`);
      el.style.setProperty('--calm-cue-len', `${c.len}px`);
      el.style.setProperty('--calm-cue-mag', c.mag.toFixed(2));
      if (c.centred) L.centredAt ??= now;
      else L.centredAt = null;
      if (c.on && !L.cueOn) {
        L.cueOn = true;
        el.dataset.on = '1';
      }
    };
    const move = (e) => {
      if (!e.movementX && !e.movementY) return;
      const now = performance.now();
      L.lastInput = now;
      L.lastMove = now;
      if (e.pointerType !== 'touch') writeCue(now);
    };
    window.addEventListener('pointermove', move, { passive: true });
    for (const t of ['keydown', 'pointerdown', 'wheel', 'touchstart']) window.addEventListener(t, mark, { passive: true });
    // The soft lock comes and goes with the traffic ahead (the world shows it,
    // not the chrome): only an escort starting or ending is an event.
    const escorting = (s) => s.lockState === 'intercepting' || s.lockState === 'formation';
    const offFly = useFlyStore.subscribe((s, p) => {
      if (escorting(s) !== escorting(p) || s.inspectHex !== p.inspectHex || s.cameraMode !== p.cameraMode || s.warpEpoch !== p.warpEpoch || s.spotting !== p.spotting || s.hudMode !== p.hudMode || s.combo !== p.combo || s.phase !== p.phase) mark();
    });
    const offEnc = useEncounterStore.subscribe((s, p) => {
      if (s.offer !== p.offer || s.active !== p.active || s.nearbyOpen !== p.nearbyOpen || s.result !== p.result) mark();
    });
    return () => {
      window.removeEventListener('pointermove', move);
      for (const t of ['keydown', 'pointerdown', 'wheel', 'touchstart']) window.removeEventListener(t, mark);
      offFly();
      offEnc();
    };
  }, [runtime, isTouch]);

  // 10 Hz: the readouts, calm, the cue's fade, the legend clock and (2 Hz)
  // the dock's height.
  useEffect(() => {
    const L = live.current;
    // Write caches live on the nodes: a mode change remounts the cluster, and
    // a fresh node must take the current value even when it has not changed.
    const last = new Map();
    const put = (el, key, value, attr = 'text') => {
      if (!el) return;
      const seen = (el.__calmLast ??= {});
      if (seen[attr] === value) return;
      seen[attr] = value;
      if (attr === 'text') el.textContent = value;
      else el.setAttribute(attr, value);
    };
    let tick = 0;
    let vs = 0;
    let prevFt = NaN;
    let prevT = 0;
    const id = setInterval(() => {
      tick++;
      const now = performance.now();
      const root = rootRef.current;
      const f = runtime.flight;
      const s = useFlyStore.getState();
      if (!root || !f) return;
      const m = modeRef.current;
      const flying = inFlight(s) && s.phase === 'flying' && !anyOverlayOpen(s) && !s.airportWatch;

      // --- readouts ---------------------------------------------------------
      const ft = f.pos.y * M_TO_FT;
      const dt = (now - prevT) / 1000;
      if (Number.isFinite(prevFt) && dt > 0 && dt < 1) vs += (((ft - prevFt) / dt) * 60 - vs) * Math.min(1, dt / 0.8);
      else vs = 0;
      prevFt = ft;
      prevT = now;
      const aglFt = Number.isFinite(f.agl) ? f.agl * M_TO_FT : NaN;
      const low = Number.isFinite(aglFt) && aglFt < (CALM_CFG.lowAglFt ?? 1000) && !runtime.operations?.grounded;
      const cmd = runtime.input?.read?.();
      if (!isTouch) {
        put(spdRef.current, 'spd', String(Math.round((f.speed || 0) * MPS_TO_KT)));
        put(altRef.current, 'alt', fmtThousands(Math.round(ft / 10) * 10));
        put(altCellRef.current, 'low', low ? '1' : '0', 'data-low');
        put(altLabelRef.current, 'altl', low ? `AGL ${fmtThousands(Math.round(aglFt / 10) * 10)}` : 'Altitude');
        const arrow = Math.abs(vs) >= (CALM_CFG.vsArrowFpm ?? 400) ? (vs > 0 ? '▲' : '▼') : '';
        put(vsRef.current, 'vs', arrow);
        let deg = Math.round(f.heading * RAD2DEG) % 360;
        if (deg < 0) deg += 360;
        put(hdgRef.current, 'hdg', `${String(deg).padStart(3, '0')}°`);
        put(cardRef.current, 'card', cardinal(deg));
        const ops = runtime.operations;
        const thr = ops?.lowSpeed ? `${Math.round(ops.throttle * 100)}%` : cmd?.boost ? 'BOOST' : (cmd?.speedPreset ?? 'cruise').toUpperCase();
        put(thrRef.current, 'thr', thr);
        put(thrRef.current, 'thrs', thr === 'BOOST' ? 'boost' : ops?.lowSpeed ? 'ops' : 'steady', 'data-state');
        const g = runtime.geo;
        if (g && latRef.current) {
          put(latRef.current, 'lat', `${Math.abs(g.y).toFixed(4)}°${g.y >= 0 ? 'N' : 'S'}`);
          put(lonRef.current, 'lon', `${Math.abs(g.x).toFixed(4)}°${g.x >= 0 ? 'E' : 'W'}`);
          put(spotsRef.current, 'spots', String(usePassportStore.getState().stats.totalSpotted));
        }
      }

      // --- calm ---------------------------------------------------------------
      if (cmd && (Math.abs(cmd.turn) > 0.05 || Math.abs(cmd.pitch) > 0.05 || cmd.boost || cmd.throttleDelta)) L.lastInput = now;
      if (low) L.lastInput = now;
      const quiet = now - Math.max(L.lastInput, lastWake()) > (DIM.afterSec ?? 6) * 1000;
      put(root, 'calm', flying && quiet ? '1' : '0', 'data-calm');
      const sin = runtime.sun?.sinEl;
      put(root, 'night', Number.isFinite(sin) && sin < -0.04 ? '1' : '0', 'data-night');

      // --- the cue fades when the cursor rests or comes home --------------------
      if (L.cueOn && cueRef.current) {
        const rest = now - L.lastMove > (CUE.idleSec ?? 2.2) * 1000;
        const home = L.centredAt !== null && now - L.centredAt > (CUE.centreSec ?? 0.5) * 1000;
        if (rest || home || !flying || modeRef.current === 'instruments') {
          L.cueOn = false;
          cueRef.current.dataset.on = '0';
        }
      }

      // --- the legend clock (counted while actually flying, after the reveal) ---
      if (tick % 10 === 0 && !L.counted && flying && !document.hidden && (window.__flyBoot?.pct ?? 100) >= 100 && explorerPreferences().tutorial !== 'new') {
        L.legendSec += 1;
        if (L.legendSec >= (CALM_CFG.legend?.seconds ?? 40)) {
          L.counted = true;
          const n = readLegendFlights() + 1;
          saveLegendFlights(n);
          setShown(true);
        }
      }

      // --- the dock finds its height (2 Hz) -------------------------------------
      const dock = dockRef.current;
      if (dock && tick % 5 === 0 && m !== 'clean') {
        const vh = window.innerHeight;
        const bar = document.querySelector('[data-zone="attribution"] > div')?.getBoundingClientRect();
        const base = Math.round(bar && bar.height > 0 ? vh - bar.top + 12 : 56);
        const d = dock.getBoundingClientRect();
        const rows = [];
        for (const row of dock.children) {
          const q = row.getBoundingClientRect();
          if (q.width > 1 && q.height > 1) rows.push({ left: q.left, right: q.right, y0: d.bottom - q.bottom, y1: d.bottom - q.top });
        }
        const obstacles = [];
        for (const sel of BAND) {
          for (const el of document.querySelectorAll(sel)) {
            if (root.contains(el)) continue;
            const o = el.getBoundingClientRect();
            if (o.width < 2 || o.height < 2) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
            obstacles.push({ left: o.left, right: o.right, top: o.top, bottom: o.bottom });
          }
        }
        const b = placeDock(rows, obstacles, { base, vh, maxBottom: vh * 0.42 });
        if (last.get('bottom') !== b) {
          last.set('bottom', b);
          root.style.setProperty('--calm-bottom', `${b}px`);
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, [runtime, isTouch]);

  const scored = totalScore > 0 ? '1' : '0';
  const tier = `Q ${qualityPreset === 'ultra' && qualityTier === 'high' ? 'ultra' : qualityTier}`;
  const legend = legendMode({ flights, shownSec: shown ? Infinity : 0, tutorial: prefs.tutorial });
  return (
    <>
      <style>{ROOT_VARS}</style>
      <div ref={rootRef} className="calm-root" data-testid="hud-calm" data-mode={mode} data-scored={scored} data-gain={gain ? '1' : '0'} data-touch={isTouch ? '1' : undefined} data-cinema={cinema ? '1' : undefined}>
        {!isTouch && (
          <>
            <div ref={cueRef} className="calm-cue" data-testid="hud-steer-cue" data-on="0" aria-hidden="true">
              <i className="calm-cue-ring" />
              <i className="calm-cue-needle" />
            </div>
            <div ref={dockRef} className="calm-dock" data-testid="hud-dock">
              <div className="calm-keys" data-legend={legend}>
                {legend === 'full'
                  ? LEGEND.map(([k, v]) => (
                      <span key={k} className="calm-key">
                        <kbd>{k}</kbd>
                        {v}
                      </span>
                    ))
                  : legend === 'hint' && (
                      <>
                        <span className="calm-key">
                          <kbd>Esc</kbd>controls
                        </span>
                        <span className="calm-key">
                          <kbd>H</kbd>HUD
                        </span>
                      </>
                    )}
                <span data-testid="hud-quality-tier" className="calm-tier">
                  {tier}
                </span>
              </div>
              {spotting && (
                <div className="calm-spot-row" data-testid="hud-spotting-row">
                  <span ref={latRef}>—</span>
                  <span ref={lonRef}>—</span>
                  <span>
                    <b ref={spotsRef}>—</b> spots
                  </span>
                </div>
              )}
              <div className="calm-row">
                {mode === 'explorer' && (
                  <div className="calm-cluster" data-testid="hud-cluster" aria-label="Flight data">
                    <div className="calm-cell" data-k="spd">
                      <span className="calm-label">Speed</span>
                      <span className="calm-value">
                        <b ref={spdRef}>—</b>
                        <small>kt</small>
                      </span>
                    </div>
                    <div className="calm-cell" data-k="alt" ref={altCellRef} data-low="0">
                      <span className="calm-label" ref={altLabelRef}>
                        Altitude
                      </span>
                      <span className="calm-value">
                        <b ref={altRef}>—</b>
                        <small>ft</small>
                        <i className="calm-vs" ref={vsRef} aria-hidden="true" />
                      </span>
                    </div>
                    <div className="calm-cell" data-k="hdg">
                      <span className="calm-label">Heading</span>
                      <span className="calm-value">
                        <b ref={hdgRef}>—</b>
                        <small ref={cardRef}>—</small>
                      </span>
                    </div>
                    <div className="calm-cell" data-k="thr">
                      <span className="calm-label">Throttle</span>
                      <span className="calm-value">
                        <b ref={thrRef} className="calm-thr" data-state="steady">
                          —
                        </b>
                      </span>
                    </div>
                  </div>
                )}
                {newEarth && (
                  <button type="button" className="calm-spotting" aria-pressed={spotting} onClick={() => useFlyStore.getState().setSpotting(!spotting)}>
                    <i aria-hidden="true" />
                    {spotting ? 'Spotting · On' : 'Spotting · Off'}
                  </button>
                )}
              </div>
            </div>
            {caption && (
              <div className="calm-caption" key={caption.at} role="status" data-testid="hud-mode-caption" style={{ '--calm-caption-ms': `${CALM_CFG.captionMs ?? 1800}ms` }}>
                <span>HUD</span>
                <b>{hudModeLabel(caption.mode)}</b>
                <small>
                  <kbd>{String(CALM_CFG.key ?? 'h').toUpperCase()}</kbd> to switch
                </small>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, CheckCircle2, Info, LogOut, MapPin, Plane, X } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { useEncounterStore } from '@/stores/encounter-store';
import { useAdventureStore } from '@/stores/adventure-store';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { readMemoryPhoto } from '@/lib/fly/encounter-photo';
import { ENCOUNTER_LIMITS } from '@/lib/fly/encounters.mjs';
import { bearingDeg } from '@/lib/fly/adventure-geometry.mjs';
import { relativeTo } from '@/lib/fly/escort';
import { RAD2DEG } from '@/lib/fly/coords';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import './encounters.css';
import './target-ui.css';

/**
 * NEARBY — live aircraft you can fly alongside and Skyloom discoveries within
 * reach, as a radar scope instead of a text list.
 *
 *   · the SCOPE button (beside the minimap, N on the keyboard) shows how many
 *     contacts are in reach and glows amber while an invitation is waiting.
 *     Touch has no scope button — a closed touch HUD keeps one gameplay
 *     button — so Nearby opens from the Actions menu (useNearbyEntry);
 *   · the PANEL plots every contact on a sweep relative to your nose and
 *     lists them as cards with ONE action: "Fly alongside" (live traffic —
 *     accepts the encounter AND starts the cinematic escort) or "Go"
 *     (discoveries — guidance to the approach marker). Traffic also opens its
 *     dossier;
 *   · an INVITATION slides in for 12 s with a draining timer;
 *   · an accepted experience becomes a compact MISSION card (gate progress or
 *     the 30 s alongside timer, bearing/range/altitude, Photo, Leave). While
 *     the escort flies, the escort HUD carries the timer and this card shrinks.
 *
 * The encounter rules (lib/fly/encounters.mjs) and the runtime adapter
 * (lib/fly/encounter-runtime.js) are unchanged in what they offer; only
 * assistance changed — it now starts the shared escort (lib/fly/escort.js),
 * closes this UI and reports why when it cannot.
 */
export function EncounterExperience({ runtime }) {
  const state = useFlyStore();
  const encounter = useEncounterStore();
  const adventure = useAdventureStore((s) => s.progress.active?.status);
  const hidden = nearbyHidden(state, adventure);
  return hidden ? null : (
    <Nearby runtime={runtime} encounter={encounter} lockState={state.lockState} lockedHex={state.lockedHex} />
  );
}

function nearbyHidden(state, adventure) {
  return (
    state.screen !== 'flight' ||
    state.flightMode !== 'free' ||
    state.phase !== 'flying' ||
    state.cameraMode === 'photo' ||
    state.hangarOpen ||
    state.atlasOpen ||
    state.logbookOpen ||
    !!state.inspectHex ||
    state.adventureOpen ||
    state.settingsOpen ||
    ['flying', 'finish'].includes(adventure) ||
    !state.encountersEnabled
  );
}

/**
 * Touch entry point: whether the Actions menu should offer "Nearby" (the same
 * rule that mounts this UI), and how many contacts are in reach.
 */
export function useNearbyEntry() {
  const adventure = useAdventureStore((s) => s.progress.active?.status);
  const available = useFlyStore((s) => !nearbyHidden(s, adventure));
  const count = useEncounterStore((s) => s.candidates.length);
  return { available, count };
}

const DISCOVERY_RANGE_M = 16000;

function trafficLabel(track) {
  const m = track?.meta;
  if (!m) return null;
  return [getAircraftTypeName(m.t, m.category), m.t]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' · ');
}

/** Contacts with live geometry for the scope and the cards (1 Hz while shown). */
function useContacts(runtime, candidates, active) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  void tick;
  const f = runtime.flight;
  const heading = f ? (((f.heading * RAD2DEG) % 360) + 360) % 360 : 0;
  const geo = runtime.geo ? { lat: runtime.geo.y, lon: runtime.geo.x } : null;
  const full = runtime.encounters?.controller?.candidates ?? [];
  return candidates.map((c) => {
    if (c.kind === 'traffic') {
      const t = runtime.traffic?.tracks.get(c.hex);
      const rel = relativeTo(runtime, t);
      return {
        ...c,
        distM: t?.distM ?? c.distanceM,
        offDeg: rel ? rel.bearing - heading : null,
        clock: rel?.clock ?? null,
        relAltFt: rel ? rel.relAltM * 3.28084 : null,
        sub: trafficLabel(t) || 'Live aircraft',
      };
    }
    const course = full.find((x) => x.id === c.id)?.course;
    const point = course?.approach;
    const brg = point && geo ? bearingDeg(geo, point) : null;
    const off = brg == null ? null : brg - heading;
    return {
      ...c,
      distM: c.distanceM,
      offDeg: off,
      clock: off == null ? null : Math.round((((off % 360) + 360) % 360) / 30) % 12 || 12,
      relAltFt: null,
      sub: c.place || 'Skyloom discovery',
    };
  });
}

const fmtRange = (m) =>
  m == null ? '—' : m < 1852 * 10 ? `${(m / 1852).toFixed(1)} nm` : `${Math.round(m / 1852)} nm`;
const fmtHeight = (ft) =>
  ft == null
    ? ''
    : Math.abs(ft) < 300
      ? 'level'
      : `${Math.abs(ft) >= 1000 ? `${(Math.abs(ft) / 1000).toFixed(1)}k` : Math.round(Math.abs(ft))} ft ${ft > 0 ? 'above' : 'below'}`;

function Nearby({ runtime, encounter, lockState, lockedHex }) {
  const { active, offer, result, candidates, nearbyOpen, guidance } = encounter;
  const { isPhone, isTouch } = useDeviceLayout();
  const [hot, setHot] = useState(null);
  const [error, setError] = useState(null);
  const escorting = lockState === 'intercepting' || lockState === 'formation';
  const contacts = useContacts(runtime, candidates, nearbyOpen || !!active);
  const count = candidates.length;
  const rootRef = useRef(null);

  // N toggles the scope; Esc closes it before anything else in the Esc chain.
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const open = useEncounterStore.getState().nearbyOpen;
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        e.stopImmediatePropagation();
        useEncounterStore.getState().setNearbyOpen(false);
      } else if ((e.key === 'n' || e.key === 'N') && !useEncounterStore.getState().active) {
        e.preventDefault();
        runtime.encounters?.nearby();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [runtime]);

  // A failure message lives a few seconds, then gets out of the way.
  useEffect(() => {
    if (!error) return undefined;
    const id = setTimeout(() => setError(null), 4200);
    return () => clearTimeout(id);
  }, [error]);

  const fly = (id) => {
    const res = runtime.encounters?.fly?.(id) ?? {
      ok: false,
      message: 'Nearby is still starting. Try again.',
    };
    if (!res.ok) setError(res.message || 'That contact has moved out of reach.');
    else setError(null);
  };
  const assist = () => {
    const res = runtime.encounters?.escortActive?.() ?? {
      ok: false,
      message: 'Nearby is still starting. Try again.',
    };
    if (!res.ok) setError(res.message);
    else setError(null);
  };
  const inspect = (hex) => {
    useEncounterStore.getState().setNearbyOpen(false);
    useFlyStore.getState().setInspectHex(hex);
  };

  const stop = (e) => e.stopPropagation();

  return (
    <div
      className="tgt tgt-nearby"
      ref={rootRef}
      aria-label="Nearby experiences"
      data-overlay="nearby"
      onPointerDown={stop}
    >
      {!active && !isTouch && (
        <button
          type="button"
          className="tgt-scope-btn"
          aria-expanded={nearbyOpen}
          data-offer={offer ? '1' : '0'}
          data-testid="nearby-button"
          onClick={() => runtime.encounters?.nearby()}
          title="Nearby (N)"
        >
          <span className="tgt-scope-mini" aria-hidden="true" />
          <span className="tgt-scope-label">
            <strong>NEARBY</strong>
            <small>{count ? `${count} in reach` : 'scanning'}</small>
          </span>
          <span className="tgt-count" data-zero={count ? '0' : '1'}>
            {count}
          </span>
          <kbd className="tgt-kbd">N</kbd>
        </button>
      )}

      <AnimatePresence>
        {nearbyOpen && !active && (
          <motion.section
            key="panel"
            className="tgt-panel"
            aria-label="Nearby list"
            data-testid="nearby-panel"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            style={isPhone ? undefined : { right: 56 }}
          >
            <header className="tgt-panel-head">
              <div className="tgt-radar" aria-hidden="true">
                <div className="tgt-radar-axis" />
                {contacts.map((c) => {
                  if (c.offDeg == null) return null;
                  const r = Math.min(1, (c.distM ?? 0) / DISCOVERY_RANGE_M) * 44;
                  const a = (c.offDeg * Math.PI) / 180;
                  return (
                    <i
                      key={c.id}
                      className="tgt-blip"
                      data-kind={c.kind === 'traffic' ? 'traffic' : 'discovery'}
                      data-hot={hot === c.id ? '1' : '0'}
                      style={{
                        left: `${50 + (Math.sin(a) * r * 100) / 92}%`,
                        top: `${50 - (Math.cos(a) * r * 100) / 92}%`,
                      }}
                    />
                  );
                })}
                <span className="tgt-radar-me" />
              </div>
              <div style={{ minWidth: 0 }}>
                <h2>NEARBY</h2>
                <p>
                  {count ? 'Live aircraft and discoveries within reach.' : 'Scanning the sky around you…'}
                </p>
              </div>
              <button
                type="button"
                className="tgt-iconbtn"
                onClick={() => useEncounterStore.getState().setNearbyOpen(false)}
                aria-label="Close nearby"
                title="Close (Esc)"
              >
                <X size={18} />
              </button>
            </header>
            <div className="tgt-panel-list">
              {escorting && (
                <div className="tgt-quiet">
                  <strong>ESCORT IN PROGRESS</strong>
                  Release your current escort to pick a new contact.
                </div>
              )}
              {!escorting && !contacts.length && (
                <div className="tgt-quiet">
                  <strong>QUIET SKY</strong>
                  Nothing within reach right now. Keep flying — live traffic and discoveries appear as you
                  explore.
                </div>
              )}
              {!escorting && contacts.some((c) => c.kind === 'traffic') && (
                <div className="tgt-section">Live traffic</div>
              )}
              {!escorting &&
                contacts
                  .filter((c) => c.kind === 'traffic')
                  .map((c) => (
                    <ContactCard
                      key={c.id}
                      c={c}
                      onHot={setHot}
                      onFly={() => fly(c.id)}
                      onInspect={() => inspect(c.hex)}
                    />
                  ))}
              {!escorting && contacts.some((c) => c.kind !== 'traffic') && (
                <div className="tgt-section">Discoveries</div>
              )}
              {!escorting &&
                contacts
                  .filter((c) => c.kind !== 'traffic')
                  .map((c) => <ContactCard key={c.id} c={c} onHot={setHot} onFly={() => fly(c.id)} />)}
            </div>
            <div className="tgt-panel-foot">
              {error ? (
                <span role="alert" style={{ color: 'var(--t-rose)' }}>
                  {error}
                </span>
              ) : (
                'Fly alongside a live aircraft for 30 s, or finish a discovery, to save a flight memory.'
              )}
            </div>
          </motion.section>
        )}

        {offer && !active && !nearbyOpen && (
          <Invitation
            key={offer.id}
            offer={offer}
            runtime={runtime}
            onFly={() => fly(offer.id)}
            isPhone={isPhone}
          />
        )}

        {active && (
          <Mission
            key={active.id}
            active={active}
            guidance={guidance}
            runtime={runtime}
            escorting={escorting && lockedHex === active.hex}
            onAssist={assist}
            error={error}
            isPhone={isPhone}
          />
        )}

        {result && !active && !offer && !nearbyOpen && (
          <motion.p
            key="result"
            className="tgt-result"
            role="status"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            style={isPhone ? undefined : { right: 56 }}
          >
            <CheckCircle2 size={18} aria-hidden="true" />
            {result}
          </motion.p>
        )}
      </AnimatePresence>
      {error && !nearbyOpen && !active && (
        <p className="tgt-result" role="alert" style={isPhone ? undefined : { right: 56 }}>
          {error}
        </p>
      )}
    </div>
  );
}

function ContactCard({ c, onFly, onInspect, onHot }) {
  const traffic = c.kind === 'traffic';
  return (
    <div
      className="tgt-contact"
      data-kind={traffic ? 'traffic' : 'discovery'}
      data-testid={`nearby-contact-${c.id}`}
      onPointerEnter={() => onHot(c.id)}
      onPointerLeave={() => onHot(null)}
    >
      <span className="tgt-contact-icon" aria-hidden="true">
        {traffic ? <Plane size={20} /> : <MapPin size={20} />}
      </span>
      {/* Traffic: the whole text block opens its dossier (the ⓘ button is the
          desktop affordance; phones drop it to give the text room). */}
      {traffic ? (
        <button
          type="button"
          className="tgt-contact-text"
          onClick={onInspect}
          aria-label={`Details for ${c.name}`}
        >
          <strong>{c.name}</strong>
          <small>
            {[fmtRange(c.distM), c.clock ? `${c.clock} o'clock` : null, fmtHeight(c.relAltFt)].filter(Boolean).join(' · ')}
          </small>
          <small style={{ marginTop: 2 }}>{c.sub}</small>
        </button>
      ) : (
        <span className="tgt-contact-text">
          <strong>{c.name}</strong>
          <small>{[fmtRange(c.distM), c.clock ? `${c.clock} o'clock` : null, c.sub].filter(Boolean).join(' · ')}</small>
        </span>
      )}
      <span className="tgt-contact-actions">
        {traffic && (
          <button
            type="button"
            className="tgt-ghost"
            onClick={onInspect}
            aria-label={`Details for ${c.name}`}
            title="Details"
          >
            <Info size={17} />
          </button>
        )}
        <button
          type="button"
          className="tgt-go"
          data-kind={traffic ? 'traffic' : 'discovery'}
          onClick={onFly}
        >
          {traffic ? 'Fly alongside' : 'Go'}
        </button>
      </span>
    </div>
  );
}

function Invitation({ offer, onFly, runtime, isPhone }) {
  const traffic = offer.kind === 'traffic';
  return (
    <motion.section
      className="tgt-invite"
      data-testid="encounter-card"
      initial={{ opacity: 0, x: isPhone ? 0 : 40, y: isPhone ? 20 : 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: isPhone ? 0 : 30, y: isPhone ? 14 : 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      style={{
        '--accent': traffic ? 'var(--t-cyan)' : 'var(--t-amber)',
        ...(isPhone ? null : { right: 56 }),
      }}
    >
      <div className="tgt-invite-body">
        <span
          className="tgt-contact-icon"
          data-kind={traffic ? 'traffic' : 'discovery'}
          aria-hidden="true"
          style={
            traffic
              ? undefined
              : {
                  color: 'var(--t-amber)',
                  background: 'rgba(255,197,97,.1)',
                  boxShadow: 'inset 0 0 0 1px rgba(255,197,97,.32)',
                }
          }
        >
          {traffic ? <Plane size={21} /> : <MapPin size={21} />}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="tgt-invite-kicker">
            {traffic ? 'Invitation · Live traffic' : `Invitation · ${offer.place || 'Discovery'}`}
          </div>
          <h3>{offer.name}</h3>
          <p>
            {traffic
              ? 'A real flight is passing close by. Fly alongside it for 30 seconds.'
              : offer.description}
          </p>
        </div>
      </div>
      <div className="tgt-invite-actions">
        <button
          type="button"
          className="tgt-go"
          data-kind={traffic ? 'traffic' : 'discovery'}
          onClick={onFly}
        >
          {traffic ? 'Fly alongside' : 'Explore'}
        </button>
        <button type="button" className="tgt-later" onClick={() => runtime.encounters?.dismiss()}>
          Not now
        </button>
      </div>
      <div className="tgt-timer" aria-hidden="true">
        <motion.i
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: ENCOUNTER_LIMITS.offerSec, ease: 'linear' }}
        />
      </div>
    </motion.section>
  );
}

function Mission({ active, guidance, runtime, escorting, onAssist, error, isPhone }) {
  const traffic = active.kind === 'traffic';
  const f = runtime.flight;
  const heading = f ? (((f.heading * RAD2DEG) % 360) + 360) % 360 : 0;
  const clock = guidance
    ? Math.round(((((guidance.bearing - heading) % 360) + 360) % 360) / 30) % 12 || 12
    : null;
  const t = traffic ? runtime.traffic?.tracks.get(active.hex) : null;
  const held = traffic ? Math.min(1, (active.seconds || 0) / ENCOUNTER_LIMITS.holdSec) : null;
  const gates = active.kind === 'course' ? (active.approached ? active.gate / 5 : 0) : null;
  const kicker = traffic
    ? 'Live traffic · Crossing paths'
    : `${active.kind === 'photo' ? 'Photo' : 'Course'} · ${active.place || 'Discovery'}`;
  const status = active.stale
    ? 'Waiting for a fresh live position.'
    : traffic
      ? escorting
        ? 'Escorting — hold the wing to save a memory.'
        : 'Stay alongside for 30 seconds. Let the escort fly it for you.'
      : active.kind === 'course'
        ? active.approached
          ? `Fly through gate ${active.gate + 1} of 5.`
          : 'Fly to the approach marker.'
        : active.description;
  return (
    <motion.section
      className="tgt-mission"
      data-kind={active.kind}
      data-testid="encounter-card"
      initial={{ opacity: 0, x: isPhone ? 0 : 40, y: isPhone ? 20 : 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: isPhone ? 0 : 30 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      style={isPhone ? undefined : { right: 56 }}
    >
      <div className="tgt-mission-top">
        <div>
          <div
            className="tgt-invite-kicker"
            style={{ '--accent': traffic ? 'var(--t-cyan)' : 'var(--t-amber)' }}
          >
            {kicker}
          </div>
          <h3>{active.name}</h3>
          {!escorting && <p>{status}</p>}
        </div>
        <button
          type="button"
          className="tgt-iconbtn"
          onClick={() => runtime.encounters?.end()}
          aria-label="Leave this experience"
          title="Leave"
        >
          <X size={17} />
        </button>
      </div>
      {!escorting && (
        <dl className="tgt-mission-stats" style={{ margin: 0 }}>
          {traffic ? (
            <>
              <div>
                <dt>Alongside</dt>
                <dd role="status">
                  {active.seconds || 0} / {ENCOUNTER_LIMITS.holdSec} s
                </dd>
              </div>
              <div>
                <dt>Range</dt>
                <dd>{fmtRange(t?.distM)}</dd>
              </div>
              <div>
                <dt>Position</dt>
                <dd>{clock ? `${clock} o'clock` : '—'}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>{active.kind === 'course' ? (active.approached ? 'Gate' : 'Next') : 'Subject'}</dt>
                <dd>
                  {active.kind === 'course'
                    ? active.approached
                      ? `${active.gate + 1} / 5`
                      : 'Approach'
                    : 'Frame it'}
                </dd>
              </div>
              <div>
                <dt>Range</dt>
                <dd>{guidance ? fmtRange(guidance.distanceM) : '—'}</dd>
              </div>
              <div>
                <dt>{clock ? 'Position' : 'Altitude'}</dt>
                <dd>
                  {clock
                    ? `${clock} o'clock`
                    : guidance
                      ? `${Math.round(guidance.altM * 3.28084).toLocaleString()} ft`
                      : '—'}
                </dd>
              </div>
            </>
          )}
        </dl>
      )}
      {(held != null || gates != null) && (
        <div className="tgt-progress" aria-hidden="true">
          <i style={{ width: `${Math.round((held ?? gates) * 100)}%` }} />
        </div>
      )}
      <div className="tgt-mission-actions">
        {traffic && !escorting && (
          <button type="button" className="tgt-go" data-kind="traffic" onClick={onAssist}>
            Fly alongside
          </button>
        )}
        {active.kind !== 'course' && (
          <button
            type="button"
            className="tgt-later"
            onClick={() => useFlyStore.getState().setCameraMode('photo')}
            style={traffic && !escorting ? undefined : { flex: 1 }}
          >
            <Camera
              size={14}
              style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }}
              aria-hidden="true"
            />
            Photo
          </button>
        )}
        <button type="button" className="tgt-later" onClick={() => runtime.encounters?.end()}>
          <LogOut
            size={14}
            style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }}
            aria-hidden="true"
          />
          Leave
        </button>
      </div>
      {error && (
        <p role="alert" style={{ margin: '0 14px 12px', color: 'var(--t-rose)', fontSize: 12 }}>
          {error}
        </p>
      )}
    </motion.section>
  );
}

function MemoryPhoto({ id }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true,
      objectURL;
    readMemoryPhoto(id).then((blob) => {
      if (live && blob) {
        objectURL = URL.createObjectURL(blob);
        setUrl(objectURL);
      }
    });
    return () => {
      live = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [id]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- Locally stored bounded photo thumbnail.
    <img src={url} alt="Your view during this encounter" loading="lazy" />
  ) : (
    <small>Photo is unavailable in this browser.</small>
  );
}

export function FlightMemories() {
  const memories = useEncounterStore((s) => s.memories),
    sessionOnly = useEncounterStore((s) => s.sessionOnly);
  const [limit, setLimit] = useState(12);
  useEffect(() => useEncounterStore.getState().hydrate(), []);
  return (
    <section className="flight-memories" aria-label="Flight memories">
      <h3>Flight memories</h3>
      <p>A record of the places and real flights you crossed paths with.</p>
      {sessionOnly && <p role="status">Saved for this visit only. Export a backup before leaving.</p>}
      {!memories.length && <p>Your first memory starts with a Nearby experience in Free Flight.</p>}
      {memories.slice(0, limit).map((m) => (
        <article key={m.id}>
          <div>
            <small>
              {m.kind === 'traffic' ? 'Live traffic' : 'Skyloom discovery'} ·{' '}
              {new Date(m.at).toLocaleDateString()}
            </small>
            <h4>{m.name}</h4>
            <p>
              {m.place} · {m.aircraftId}
            </p>
            <p>
              {m.position.lat.toFixed(3)}°, {m.position.lon.toFixed(3)}°
            </p>
            {m.traffic && (
              <p>
                {[m.traffic.flight, m.traffic.type, m.traffic.registration].filter(Boolean).join(' · ') ||
                  m.traffic.hex}
              </p>
            )}
          </div>
          {m.photoRef && <MemoryPhoto id={m.photoRef} />}
        </article>
      ))}
      {memories.length > limit && <button onClick={() => setLimit(limit + 12)}>More memories</button>}
      <small>
        Photos stay in this browser; progress backups contain journal records only. The latest 200 memories
        and 24 photos are retained.
      </small>
    </section>
  );
}

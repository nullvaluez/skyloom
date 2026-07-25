'use client';

import { CONTRAIL, FLIGHT, HANGAR, PLAYER } from './fly-constants';
import { useFlyStore } from '@/stores/fly-store';

/**
 * THE PLAYER HANGAR (round 17 "Your Wings") — the selectable fleet.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM lib/fly/assets.js: the player fleet
 * REUSES GLBs that are already in the FLY_ASSETS manifest (no new downloads, no
 * new CC-BY credits this round — the credits panel and CREDITS.md still render
 * from that one manifest, unchanged). assets.js is also parsed by
 * scripts/verify-fleet.js, which counts `{ url: '/models/` literals to derive
 * the mapped-archetype count, and by scripts/verify-warbirds.mjs, which
 * hard-pins `TRAFFIC_MODELS.length === 13`. Appending nine player entries there
 * would silently move both gates. So: manifest here, credits there.
 *
 * targetLenM and yawFixRad are COPIED VERBATIM from TRAFFIC_MODELS /
 * PLAYER_MODEL. They are measured ground truth (scripts/inspect-glb.mjs prints
 * each GLB's end-slab profile; several of these files were re-axised or
 * levelled offline in round 15), NOT taste — do not "improve" them here without
 * re-measuring the file on disk.
 *
 * NO HELICOPTER. The flight model is a fixed-wing coordinated-turn rig with no
 * hover state, and traffic-helicopter.glb's rotor is static geometry — a
 * "helicopter" you cannot hover in is worse than no helicopter. It needs a
 * `hover` capability flag and a rotor animation, which is a future round.
 *
 * Everything numeric lives in HANGAR (lib/fly/fly-constants.js). The FIGHTER
 * deliberately has no HANGAR.byId entry, so resolveAircraft('fighter') falls
 * through to the round-16 FLIGHT / PLAYER.afterburner / CONTRAIL /
 * PLAYER.groundShadow values — the no-pick default is bit-identical BY
 * CONSTRUCTION rather than by hand-matched numbers.
 *
 * `unlock: null` is reserved for the future economy round (FLY_ROUND17_PLAN §1:
 * everything is free this round). Nothing reads it yet — deliberately, so the
 * shape is already in place when it does.
 */
export const PLAYER_AIRCRAFT = [
  {
    id: 'fighter',
    name: 'Vector',
    blurb: 'The house jet. Silly fast, turns on a thought, lights the burner.',
    url: '/models/player-jet.glb',
    targetLenM: 20,
    yawFixRad: Math.PI,
    // Materials in this GLB are named by hex color, so the generic
    // /canopy|glass|cockpit/i match cannot find the canopy — name it.
    canopyMaterial: '80DEEA',
    unlock: null,
  },
  {
    id: 'military',
    name: 'Talon',
    blurb: 'Heavier fighter, more authority in the pitch, same top end.',
    url: '/models/traffic-military.glb',
    targetLenM: 17,
    yawFixRad: Math.PI,
    forceVertexColors: true, // R15 baked its texture to COLOR_0
    unlock: null,
  },
  {
    id: 'warbird-jet',
    name: 'Dart',
    blurb: 'Little delta from the jet age. Short legs, enormous grin.',
    url: '/models/traffic-warbird-jet.glb',
    targetLenM: 12,
    yawFixRad: Math.PI,
    forceVertexColors: true,
    unlock: null,
  },
  {
    id: 'warbird-prop',
    name: 'Mustang',
    blurb: 'Low-wing piston fighter. Rolls like nothing else in the hangar.',
    url: '/models/traffic-warbird-prop.glb',
    targetLenM: 10,
    yawFixRad: Math.PI,
    forceVertexColors: true,
    unlock: null,
  },
  {
    id: 'prop',
    name: 'Skylark',
    blurb: 'A little single. Slow enough to actually look at the world.',
    url: '/models/traffic-prop.glb',
    targetLenM: 9,
    yawFixRad: 0,
    unlock: null,
  },
  {
    id: 'glider',
    name: 'Whisper',
    blurb: 'No engine at all — just airflow, a long wing and patience.',
    url: '/models/traffic-glider.glb',
    targetLenM: 8,
    yawFixRad: Math.PI,
    forceVertexColors: true,
    unlock: null,
  },
  {
    id: 'bizjet',
    name: 'Meridian',
    blurb: 'Business jet. Smooth, quiet, quick — the civilised way to travel.',
    url: '/models/traffic-jet.glb',
    targetLenM: 20,
    yawFixRad: Math.PI / 2,
    unlock: null,
  },
  {
    id: 'airliner',
    name: 'Stratoliner',
    blurb: 'Widebody. Ponderous, majestic, and it draws real contrails.',
    url: '/models/traffic-airliner.glb',
    targetLenM: 57,
    yawFixRad: Math.PI,
    unlock: null,
  },
  {
    id: 'cargo',
    name: 'Leviathan',
    blurb: 'The 747. Seventy metres of freight hauler. Plan your turns.',
    url: '/models/traffic-cargo.glb',
    targetLenM: 70,
    yawFixRad: 0,
    forceVertexColors: true,
    unlock: null,
  },
];

export const AIRCRAFT_KEY = 'fly-aircraft';
export const DEFAULT_AIRCRAFT_ID = 'fighter';

const BY_ID = new Map(PLAYER_AIRCRAFT.map((a) => [a.id, a]));

/** True if `id` names a real hangar aircraft. */
export function isAircraftId(id) {
  return typeof id === 'string' && BY_ID.has(id);
}

/** Display name for an id — used by the PauseMenu button label. */
export function aircraftName(id) {
  return BY_ID.get(id)?.name ?? BY_ID.get(DEFAULT_AIRCRAFT_ID).name;
}

// resolveAircraft is called from render paths (a useMemo in FlyScene, the
// hangar's card list) — memoize so the frozen configs are also STABLE
// identities, which keeps the FlyScene setConfig effect from re-firing.
const _resolved = new Map();

/**
 * The one runtime shape every consumer reads: manifest entry + HANGAR numbers,
 * merged and frozen.
 *
 *   .cfg            FLIGHT-shaped envelope (+ cameraOffsetScale) — FlightModel,
 *                   ChaseCamera, Autopilot and the warp seeding all read this
 *                   via `flight.cfg`, never the FLIGHT import.
 *   .afterburner    {enabled, startMps, fullMps, scale}
 *   .contrail       {enabled, twin, engineSpanM, backM}
 *   .shadowRadiusM  satellite contact-blob radius
 *   .audio          FlyAudio profile {mode, hzMul, gainMul, subMul, thrumHz?}
 *   .entry          the manifest entry (url / targetLenM / yawFixRad / …)
 *
 * An unknown id resolves to the fighter rather than throwing: this runs on the
 * boot path, and a corrupt storage value must not brick the session.
 */
export function resolveAircraft(id) {
  const key = BY_ID.has(id) ? id : DEFAULT_AIRCRAFT_ID;
  const cached = _resolved.get(key);
  if (cached) return cached;

  const entry = BY_ID.get(key);
  const over = HANGAR.byId[key] ?? {};
  const ab = PLAYER.afterburner;

  const resolved = Object.freeze({
    id: entry.id,
    name: entry.name,
    blurb: entry.blurb,
    entry: Object.freeze({ ...entry }),
    // {...FLIGHT, ...override} guarantees every field step() reads is present,
    // and that un-overridden FEEL constants (rateLambda, bankLambda, the floor
    // and auto-level assists, highSpeedTurnCutover) stay fleet-wide.
    cfg: Object.freeze({
      ...FLIGHT,
      cameraOffsetScale: HANGAR.defaults.cameraOffsetScale,
      ...(over.flight ?? null),
      speeds: Object.freeze({ ...FLIGHT.speeds, ...(over.flight?.speeds ?? null) }),
    }),
    // Fighter defaults ARE the round-16 constants — no numbers restated here.
    afterburner: Object.freeze(
      over.afterburner ?? {
        enabled: true,
        startMps: ab.startMps,
        fullMps: ab.fullMps,
        scale: HANGAR.defaults.afterburnerScale,
      }
    ),
    contrail: Object.freeze(
      over.contrail ?? {
        enabled: true,
        twin: CONTRAIL.twin,
        engineSpanM: CONTRAIL.engineSpanM,
        backM: CONTRAIL.backM,
      }
    ),
    shadowRadiusM: over.shadowRadiusM ?? PLAYER.groundShadow.blobRadiusM,
    audio: Object.freeze({ mode: 'jet', hzMul: 1, gainMul: 1, subMul: 1, ...(over.audio ?? null) }),
  });
  _resolved.set(key, resolved);
  return resolved;
}

/**
 * Resolve the persisted aircraft pick into the fly store BEFORE the canvas
 * mounts (FlyMode's spawn effect, beside resolveInitialMapStyle /
 * resolveInitialSettings). Same pattern, same reasons: the FlightModel and the
 * PlayerPlane GLB should be built for the aircraft the player actually chose
 * instead of building the fighter and hot-swapping a frame later (the round-11
 * boot-hot-swap lesson).
 *
 * Unknown / corrupt / absent values are IGNORED — the store default ('fighter')
 * stands and is NEVER written back. A default is not a choice; only the hangar's
 * "Fly this" button writes storage. Idempotent under StrictMode's double mount
 * (it compares before setting), and a silent no-op when storage is blocked or
 * HANGAR.enabled is false (the one-line rollback).
 */
export function resolveInitialAircraft() {
  if (typeof window === 'undefined') return;
  if (!HANGAR.enabled) return;
  let saved = null;
  try {
    saved = window.localStorage.getItem(AIRCRAFT_KEY);
  } catch {
    // storage blocked — the store default (the fighter) stands
    return;
  }
  if (!BY_ID.has(saved)) return;
  const store = useFlyStore.getState();
  if (store.aircraftId !== saved) store.setAircraftId(saved);
}

/** Persist a PLAYER-CHOSEN aircraft (the hangar's "Fly this" button only). */
export function saveAircraft(id) {
  if (typeof window === 'undefined' || !BY_ID.has(id)) return;
  try {
    window.localStorage.setItem(AIRCRAFT_KEY, id);
  } catch {
    // storage full/blocked — the pick still applies to this session
  }
}

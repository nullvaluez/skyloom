/**
 * MULTIPLAYER — how a remote pilot is described to the existing traffic
 * consumers (MULTIPLAYER.md §Engine). Pure data + one builder, shared by the
 * session (which creates the tracks) and the render/HUD gates (which read
 * them). No React, no three.
 */
import { AIRCRAFT_IDS } from './protocol.mjs';
import { MULTIPLAYER } from '../fly-constants.js';

/**
 * Hangar aircraft -> the traffic archetype that stands in for it until its
 * real airframe (the player-*-mobile GLB) has loaded into the remote fleet.
 * Indices are lib/workers/aircraft-processor.worker.js FLY_ARCHETYPES order:
 * 0 airliner · 1 jet · 2 prop · 4 military · 5 cargo · 6 glider · 9 warbird-prop
 * · 10 warbird-jet. Vector and Umbra have no traffic twin; military reads closest.
 */
export const REMOTE_ARCHETYPE = Object.freeze({
  fighter: 4,
  military: 4,
  'warbird-jet': 10,
  'warbird-prop': 9,
  prop: 2,
  glider: 6,
  bizjet: 1,
  airliner: 0,
  cargo: 5,
  'flying-wing': 4,
});

/** Classification string per aircraft (InfoCard / turntable silhouettes read meta.iconType). */
export const REMOTE_ICON = Object.freeze({
  fighter: 'military',
  military: 'military',
  'warbird-jet': 'warbird-jet',
  'warbird-prop': 'warbird-prop',
  prop: 'prop',
  glider: 'glider',
  bizjet: 'jet',
  airliner: 'airliner',
  cargo: 'cargo',
  'flying-wing': 'military',
});

export const pilotColor = (c) => MULTIPLAYER.palette[((c | 0) % MULTIPLAYER.palette.length + MULTIPLAYER.palette.length) % MULTIPLAYER.palette.length];

/**
 * The meta object a remote track carries. Shaped like the ADS-B worker's meta
 * ({hex, flight, r, t, squawk, category, iconType, color}) so every reader
 * works, with r/t/squawk/category null (no registry, no type code, never a
 * SPICY or rarity input) plus the multiplayer fields.
 */
export function remoteMeta(id, callsign, aIndex, colorIndex) {
  const aircraftId = AIRCRAFT_IDS[aIndex] ?? AIRCRAFT_IDS[0];
  return {
    hex: id,
    flight: callsign,
    r: null,
    t: null,
    squawk: null,
    category: null,
    iconType: REMOTE_ICON[aircraftId],
    color: pilotColor(colorIndex),
    remote: true,
    ac: AIRCRAFT_IDS.indexOf(aircraftId),
    aircraftId,
  };
}

export const remoteArchetype = (aircraftId) => REMOTE_ARCHETYPE[aircraftId] ?? 4;

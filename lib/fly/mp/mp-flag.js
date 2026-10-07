/**
 * MULTIPLAYER flag + relay URL (MULTIPLAYER.md). Tiny on purpose: the app
 * imports this eagerly; everything heavier (lib/fly/mp/session.js) is a
 * dynamic import behind mpAvailable().
 */
import { pinned } from '../fly-pins.js';
import { MULTIPLAYER } from '../fly-constants.js';

export const MP_ACTIVE = pinned(MULTIPLAYER, '__flyMultiplayerOverride');

function envUrl() {
  // A literal reference so Next inlines it at build time; unset -> undefined.
  try {
    return process.env.NEXT_PUBLIC_MP_URL || null;
  } catch {
    return null;
  }
}

/**
 * The relay's WebSocket URL, or null when none is usable.
 *   '/mp'        -> same origin (ws: on http pages, wss: on https pages)
 *   'wss://…'    -> as is
 *   'ws://…'     -> only from an http: page (an https page would block it)
 */
export function mpUrl(raw = MP_ACTIVE.url ?? envUrl(), loc = globalThis.location) {
  if (typeof raw !== 'string' || !raw) return null;
  const s = raw.trim();
  if (s.startsWith('/')) {
    if (!loc?.host) return null;
    return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${s}`;
  }
  if (s.startsWith('wss://')) return s;
  if (s.startsWith('ws://')) return loc?.protocol === 'https:' ? null : s;
  return null;
}

/** True only when the flag is on AND a relay URL resolves. */
export function mpAvailable() {
  return MP_ACTIVE.enabled === true && mpUrl() != null;
}

/** Remote pilot ids are 'p:<base36>' — never a 6-hex ICAO address or a readsb '~' id. */
export function isRemote(id) {
  return typeof id === 'string' && id.startsWith('p:');
}

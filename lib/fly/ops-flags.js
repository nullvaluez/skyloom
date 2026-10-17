/**
 * GATE TO GATE — the one accessor for the fifteen flag blocks at the end of
 * fly-constants.js (FLY_GATE_TO_GATE.md, "Flag registry").
 *
 * Every read is a literal pinned(BLOCK, '__fly<Name>Override') evaluated at
 * call time, so a harness pin, a pasted console pin or `?flags=NAME` wins over
 * the shipped value, and node gates can pin through globalThis.window.
 * scripts/verify-true-earth-flags.mjs (5) greps for exactly this form.
 *
 * Consumers call the readers; they never import the blocks directly.
 */
import { pinned } from './fly-pins.js';
import { isMobileGraphicsClass } from './device-class.js';
import { useFlyStore } from '../../stores/fly-store.js';
import {
  OPS_AIRFIELD,
  OPS_APRON,
  GATE_TO_GATE,
  PLAYER_GLOW_LIGHTS,
  OPS_FEEL,
  OPS_FX,
  OPS_AUDIO,
  CAMERA_DIRECTOR,
  FLIGHT_DECK,
  OPS_HANGAR,
  OPS_DEBRIEF,
  REPLAY,
  LOUNGE_PIER,
  LOUNGE_WALK,
  LOUNGE_BRIDGE,
  LOUNGE_INSTRUMENTS,
} from './fly-constants.js';

export const opsAirfield = () => pinned(OPS_AIRFIELD, '__flyOpsAirfieldOverride');
export const opsApron = () => pinned(OPS_APRON, '__flyOpsApronOverride');
export const gateToGate = () => pinned(GATE_TO_GATE, '__flyGateToGateOverride');
export const playerGlowLights = () => pinned(PLAYER_GLOW_LIGHTS, '__flyPlayerGlowLightsOverride');
export const opsFeel = () => pinned(OPS_FEEL, '__flyOpsFeelOverride');
export const opsFx = () => pinned(OPS_FX, '__flyOpsFxOverride');
export const opsAudio = () => pinned(OPS_AUDIO, '__flyOpsAudioOverride');
export const cameraDirector = () => pinned(CAMERA_DIRECTOR, '__flyCameraDirectorOverride');
export const flightDeck = () => pinned(FLIGHT_DECK, '__flyFlightDeckOverride');
export const opsHangar = () => pinned(OPS_HANGAR, '__flyOpsHangarOverride');
export const opsDebrief = () => pinned(OPS_DEBRIEF, '__flyOpsDebriefOverride');
export const replay = () => pinned(REPLAY, '__flyReplayOverride');
export const loungePier = () => pinned(LOUNGE_PIER, '__flyLoungePierOverride');
export const loungeWalk = () => pinned(LOUNGE_WALK, '__flyLoungeWalkOverride');
export const loungeBridge = () => pinned(LOUNGE_BRIDGE, '__flyLoungeBridgeOverride');
export const loungeInstruments = () => pinned(LOUNGE_INSTRUMENTS, '__flyLoungeInstrumentsOverride');

/** The fifteen readers by block name (device report, harnesses, the record). */
export const OPS_FLAG_READERS = Object.freeze({
  OPS_AIRFIELD: opsAirfield,
  OPS_APRON: opsApron,
  GATE_TO_GATE: gateToGate,
  PLAYER_GLOW_LIGHTS: playerGlowLights,
  OPS_FEEL: opsFeel,
  OPS_FX: opsFx,
  OPS_AUDIO: opsAudio,
  CAMERA_DIRECTOR: cameraDirector,
  FLIGHT_DECK: flightDeck,
  OPS_HANGAR: opsHangar,
  OPS_DEBRIEF: opsDebrief,
  REPLAY: replay,
  LOUNGE_PIER: loungePier,
  LOUNGE_WALK: loungeWalk,
  LOUNGE_BRIDGE: loungeBridge,
  LOUNGE_INSTRUMENTS: loungeInstruments,
});

/** Is the named block on? opsFlag('OPS_FEEL'). Unknown names are off. */
export function opsFlag(name) {
  const read = OPS_FLAG_READERS[name];
  return !!read && read().enabled === true;
}

/** A sub-switch of an enabled block: opsSub('OPS_FX', 'smoke'). Off when the block is off. */
export function opsSub(name, key) {
  const read = OPS_FLAG_READERS[name];
  if (!read) return false;
  const block = read();
  return block.enabled === true && !!block[key];
}

const currentMapStyle = () => useFlyStore.getState().mapStyle;

/** OPS_AIRFIELD on for this map style (the airfield stack is satellite only). */
export function opsAirfieldOn(mapStyle = currentMapStyle()) {
  return opsAirfield().enabled === true && mapStyle === 'satellite';
}

/**
 * The airfield tier: 'off' (flag off or not satellite), 'registry' (phones and
 * tablets: runway shader, markings and runway lights only), 'full' (desktop
 * High) or 'lite' (desktop Medium/Low).
 */
export function opsTier({ mapStyle = currentMapStyle(), qualityTier = useFlyStore.getState().qualityTier, mobile = isMobileGraphicsClass() } = {}) {
  if (!opsAirfieldOn(mapStyle)) return 'off';
  // Review pin (scripts/review-operations-airfield.cjs --tier): a string, never a URL flag.
  const pin = globalThis.window?.__flyOpsTierOverride;
  if (pin === 'registry' || pin === 'lite' || pin === 'full') return pin;
  if (mobile) return opsAirfield().phoneTier === 'off' ? 'off' : 'registry';
  return qualityTier === 'high' ? 'full' : 'lite';
}

/**
 * The gate journey is available: GATE_TO_GATE plus its dependencies
 * (OPS_AIRFIELD, OPS_APRON, FLIGHT_DECK) and a tier that draws the apron.
 * Whether a given airport has a gate is the service's question
 * (runtime.airports.prefetchState(ident).hasGate), not this one.
 */
export function gateToGateOn(ctx) {
  if (gateToGate().enabled !== true || opsApron().enabled !== true || flightDeck().enabled !== true) return false;
  const tier = opsTier(ctx);
  return tier === 'full' || tier === 'lite';
}

/** The lounge room variant everywhere (sets, seats, areas): one source of truth. */
export function loungeVariant() {
  return loungePier().enabled === true ? 'pier' : 'classic';
}

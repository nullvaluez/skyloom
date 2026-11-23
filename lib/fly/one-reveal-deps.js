/**
 * ONE REVEAL (stream L): the live providers the gate's terms read, in one
 * place for BootScreen and WarpFlash (scripts/verify-one-reveal.mjs injects
 * fakes instead).
 */
import { lookRoofPending } from './look-roof-patch.js';
import { birthsRunning } from './settle.js';
import { currentColorRef } from './one-reveal-state.js';

export const REVEAL_DEPS = Object.freeze({
  roofPending: lookRoofPending,
  birthsRunning,
  colorRef: currentColorRef,
  photoStatus: (engine, key) => engine?._photos?.status?.(key) ?? 'none',
});

/** A compact copy of the terms for the published record. */
export function termsRecord(terms) {
  if (!terms) return null;
  const out = {};
  for (const k of ['terrain', 'roofs', 'colorRef', 'farPhotos', 'births']) out[k] = { done: terms[k].done, total: terms[k].total };
  return out;
}

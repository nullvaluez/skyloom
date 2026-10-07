// Discrete preferences, cached in memory: never read storage in the frame loop.
export const PREFERENCES_KEY = 'fly-explorer-preferences-v1';
export const DEFAULT_PREFERENCES = Object.freeze({ sensitivity: 1, invertPitch: false, master: 1, effects: 1, music: 0.65, tutorial: 'new' });
const listeners = new Set();
let current = DEFAULT_PREFERENCES;
const bounded = (v, low, high, fallback) => typeof v === 'number' && Number.isFinite(v) ? Math.max(low, Math.min(high, v)) : fallback;
export function validatePreferences(value) {
  if (value?.version !== 1 || !value.settings || typeof value.settings !== 'object') throw Error('Unsupported flight preferences.');
  const s = value.settings;
  return { version: 1, settings: {
    sensitivity: bounded(s.sensitivity, 0.5, 1.75, 1), invertPitch: s.invertPitch === true,
    master: bounded(s.master, 0, 1, 1), effects: bounded(s.effects, 0, 1, 1), music: bounded(s.music, 0, 1, 0.65),
    tutorial: ['new', 'done', 'skipped'].includes(s.tutorial) ? s.tutorial : 'new',
  } };
}
export const explorerPreferences = () => current;
export function loadExplorerPreferences(storage) {
  try { const raw = (storage ?? globalThis.window?.localStorage)?.getItem(PREFERENCES_KEY); current = raw ? validatePreferences(JSON.parse(raw)).settings : DEFAULT_PREFERENCES; }
  catch { current = DEFAULT_PREFERENCES; }
  listeners.forEach(fn => fn(current));
  return current;
}
export function setExplorerPreferences(patch, storage) {
  current = validatePreferences({version:1, settings:{...current,...patch}}).settings;
  try { (storage ?? globalThis.window?.localStorage)?.setItem(PREFERENCES_KEY, JSON.stringify({version:1,settings:current})); } catch { /* Session settings still apply. */ }
  listeners.forEach(fn => fn(current));
  return current;
}
export function subscribeExplorerPreferences(fn) { listeners.add(fn); return () => listeners.delete(fn); }

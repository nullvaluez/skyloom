'use client';

import { useSyncExternalStore } from 'react';

// Ephemeral HUD state. Contract progress and saved flight settings remain in
// their existing stores; opening a panel must never become a saved preference.
let surface = null; // null | 'actions' | 'contracts'
const listeners = new Set();
const infoDismissListeners = new Set();
export function onTouchInfoDismiss(listener) {
  infoDismissListeners.add(listener);
  return () => infoDismissListeners.delete(listener);
}
export function dismissTouchInfo() {
  for (const listener of infoDismissListeners) listener();
}
export const readTouchSurface = () => surface;
export function setTouchSurface(next) {
  if (surface === next) return;
  surface = next;
  for (const listener of listeners) listener();
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useTouchSurface() {
  return useSyncExternalStore(subscribe, readTouchSurface, () => null);
}

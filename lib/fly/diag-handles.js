/**
 * TRUE EARTH — the renderer handle the diagnostics overlay reads. Set once in
 * FlyCanvas onCreated in every build (window.__flyGl stays dev-only); holding
 * a reference costs nothing and the overlay only reads it while open.
 */
let renderer = null;
export function setDiagRenderer(gl) {
  renderer = gl || null;
}
export function getDiagRenderer() {
  return renderer;
}

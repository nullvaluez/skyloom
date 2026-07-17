/**
 * Loads the packed Natural Earth coastline blob for the Atlas map canvas.
 * Format (scripts/gen-atlas-map.mjs): uint32 lineCount · uint32[] counts ·
 * float32 (lon,lat) pairs. Returns an array of Float32Array views (no
 * copies) — [lon0, lat0, lon1, lat1, …] per polyline. Cached module-wide;
 * resolves to [] on any failure (the atlas still works, just ocean-only).
 */
let promise = null;

export function loadCoastlines() {
  if (!promise) {
    promise = fetch('/atlas/coastlines.bin')
      .then((r) => {
        if (!r.ok) throw new Error(`coastlines ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const n = new Uint32Array(buf, 0, 1)[0];
        const counts = new Uint32Array(buf, 4, n);
        const lines = [];
        let off = 4 + n * 4;
        for (let i = 0; i < n; i++) {
          lines.push(new Float32Array(buf, off, counts[i] * 2));
          off += counts[i] * 8;
        }
        return lines;
      })
      .catch(() => []);
  }
  return promise;
}

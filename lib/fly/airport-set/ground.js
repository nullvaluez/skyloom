// The ground under the airport set, as a height field relative to the apron
// plane (apronY = runtime.airportWatch.floorY - site.floorM).
//
// The DEM under a real apron is not flat to the centimetre: at the KCMH site
// it measured +0.45 .. -1.62 m against the validated apron plane, enough to
// bury flat paint in one place and float a tug in another. The set therefore
// drapes everything that TOUCHES the ground (markings, floodlight pools,
// vehicles) on this field, while the buildings keep the apron plane and carry
// plinths/columns that run below it.
//
// Samples come from the terrain engine's getGroundAt(), which answers a
// registered airport surface first — so if the apron is ever flattened as an
// airport surface (workstream D), the field follows it with no change here.
// Sampling is progressive (a fixed number of probes per frame) and repeats
// while tiles refine; `version` bumps whenever the field moves enough to
// re-drape.
export class SetGround {
  /**
   * @param bounds room-local { x0, x1, z0, z1 } to cover
   * @param step   grid spacing, metres
   */
  constructor(bounds, step = 8) {
    this.x0 = bounds.x0; this.z0 = bounds.z0; this.step = step;
    this.nx = Math.max(2, Math.ceil((bounds.x1 - bounds.x0) / step) + 1);
    this.nz = Math.max(2, Math.ceil((bounds.z1 - bounds.z0) / step) + 1);
    this.h = new Float32Array(this.nx * this.nz); // metres above the apron plane
    this.zoom = new Uint8Array(this.nx * this.nz); // tile zoom of each sample (0 = none)
    this.cursor = 0;
    this.version = 0;
    this.pendingChange = 0;
    this.done = false;
    this.passes = 0;
  }

  /** Bilinear height (metres above the apron plane) at a room-local point. */
  at(x, z) {
    const fx = Math.max(0, Math.min(this.nx - 1.0001, (x - this.x0) / this.step));
    const fz = Math.max(0, Math.min(this.nz - 1.0001, (z - this.z0) / this.step));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const k = j * this.nx + i, H = this.h;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + this.nx] * (1 - u) + H[k + this.nx + 1] * u) * v;
  }

  /**
   * Advance sampling by up to `budget` probes. `sample(x, z)` returns
   * { dy, zoom } for a room-local point (dy relative to the apron plane) or
   * null. Returns true when the field changed enough to re-drape.
   */
  advance(sample, budget = 160) {
    if (this.done) return false;
    const n = this.nx * this.nz;
    for (let b = 0; b < budget; b++) {
      const k = this.cursor;
      const s = sample(this.x0 + (k % this.nx) * this.step, this.z0 + Math.floor(k / this.nx) * this.step);
      if (s && Number.isFinite(s.dy) && s.zoom >= this.zoom[k]) {
        const dy = Math.max(-6, Math.min(6, s.dy));
        this.pendingChange = Math.max(this.pendingChange, Math.abs(dy - this.h[k]));
        this.h[k] = dy;
        this.zoom[k] = Math.min(255, s.zoom);
      }
      this.cursor = (k + 1) % n;
      if (this.cursor === 0) {
        this.passes++;
        // Settled when every probe answered from a refined tile.
        let min = 255;
        for (let i = 0; i < n; i++) min = Math.min(min, this.zoom[i]);
        if (min >= 16 || this.passes >= 12) this.done = true;
        if (this.pendingChange > 0.03) {
          this.version++;
          this.pendingChange = 0;
          return true;
        }
        this.pendingChange = 0;
        return false;
      }
    }
    return false;
  }
}

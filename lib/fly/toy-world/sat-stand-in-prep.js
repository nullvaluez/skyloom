/** Resumable REACH assembly. Each step has at most BATCH buildings; the
 * engine grants a frame deadline and publishes only the completed result.
 * The synchronous helpers remain the byte-equivalence oracle for this path.
 */
import { drapeStandIns } from './sat-stand-ins';
import { applyPhoto } from './sat-stand-in-photo-core';

const BATCH = 128;
const TAU = Math.PI * 2;
const quantize = (v, scale) => Math.max(0, Math.min(65535, Math.round((v / scale) * 65535)));

export function createStandInPreparation(parts, grid, gridN, gspan, photo = null, slot = -1, radiusPx = 1) {
  const job = { stage: 'allocate', bytes: 0, result: null, done: false, steps: 0 };
  job.iterator = prepare(job, parts, grid, gridN, gspan, photo, slot, radiusPx);
  return job;
}

function* prepare(job, parts, grid, gridN, gspan, photo, slot, radiusPx) {
  let n = 0;
  for (const p of parts) n += p.si.n;
  const m = { n, maxH: 0 };
  // Allocation is separate from each scan so a dense group's buffers cannot
  // all be zeroed in the same step before the deadline is consulted again.
  for (const [name, Type, count] of [
    ['ax', Float32Array, n], ['az', Float32Array, n],
    ['dim', Uint16Array, n * 4], ['wall', Uint8Array, n * 4],
    ['roof', Uint8Array, n * 4], ['gnd', Uint8Array, n * 4], ['size', Float32Array, n],
  ]) {
    m[name] = new Type(count); job.bytes += m[name].byteLength; yield;
  }
  const head = new Int32Array(parts.length);
  job.bytes += head.byteLength;
  job.stage = 'merge';
  for (let start = 0; start < n; start += BATCH) {
    const end = Math.min(n, start + BATCH);
    for (let o = start; o < end; o++) {
      // The original k-way merge's strict > comparison preserves part order
      // on equal size keys. Quantization and Float32 writes keep their order.
      let best = -1, bestS = -Infinity;
      for (let j = 0; j < parts.length; j++) {
        const h = head[j];
        if (h < parts[j].si.n && parts[j].si.size[h] > bestS) { bestS = parts[j].si.size[h]; best = j; }
      }
      const part = parts[best], si = part.si, i = head[best]++;
      if (si.parentOffsets?.[i]) (m.parent ??= new Map()).set(o,o-si.parentOffsets[i]);
      m.ax[o] = si.pos[i * 2] + part.dx;
      m.az[o] = si.pos[i * 2 + 1] + part.dz;
      const yaw = ((si.dim[i * 4 + 3] % TAU) + TAU) % TAU;
      m.dim[o * 4] = quantize(si.dim[i * 4], 1000);
      m.dim[o * 4 + 1] = quantize(si.dim[i * 4 + 1], 1000);
      m.dim[o * 4 + 2] = quantize(si.dim[i * 4 + 2], 1000);
      m.dim[o * 4 + 3] = quantize(yaw, TAU);
      if (si.dim[i * 4 + 2] > m.maxH) m.maxH = si.dim[i * 4 + 2];
      for (let c = 0; c < 4; c++) {
        m.wall[o * 4 + c] = si.col[i * 8 + c];
        m.roof[o * 4 + c] = si.col[i * 8 + 4 + c];
        m.gnd[o * 4 + c] = si.gnd ? si.gnd[i * 4 + c] : m.roof[o * 4 + c];
      }
      m.size[o] = si.size[i];
    }
    yield;
  }
  if (photo) {
    job.stage = 'photo';
    for (let start = 0; start < n; start += BATCH) {
      const end = Math.min(n, start + BATCH);
      applyPhoto(photo, m.ax.subarray(start, end), m.az.subarray(start, end), end - start,
        gspan, m.gnd.subarray(start * 4, end * 4), slot, radiusPx);
      yield;
    }
  }
  job.stage = 'drape';
  const baseY = new Float32Array(n);
  job.bytes += baseY.byteLength; yield;
  for (let start = 0; start < n; start += BATCH) {
    const end = Math.min(n, start + BATCH);
    drapeStandIns({ n: end - start, ax: m.ax.subarray(start, end), az: m.az.subarray(start, end) },
      grid, gridN, gspan, baseY.subarray(start, end));
    if (m.parent) for (let i=start;i<end;i++) {
      const parent = m.parent.get(i);
      if (parent !== undefined) baseY[i] = baseY[parent];
    }
    yield;
  }
  job.stage = 'geometry';
  const anchor = new Float32Array(n * 2); job.bytes += anchor.byteLength; yield;
  const hx = new Float32Array(n); job.bytes += hx.byteLength; yield;
  const gz = new Uint8Array(n); job.bytes += gz.byteLength; yield;
  let lo = Infinity, hi = -Infinity;
  for (let start = 0; start < n; start += BATCH) {
    const end = Math.min(n, start + BATCH);
    for (let i = start; i < end; i++) {
      anchor[i * 2] = m.ax[i]; anchor[i * 2 + 1] = m.az[i];
      hx[i] = (Math.hypot(m.dim[i * 4], m.dim[i * 4 + 1]) / 65535) * 1000;
      if (baseY[i] < lo) lo = baseY[i];
      if (baseY[i] > hi) hi = baseY[i];
    }
    yield;
  }
  job.result = { m, baseY, anchor, hx, gz, lo, hi };
  job.stage = 'ready';
}

/** Run bounded batches until the frame deadline; no clock read per building. */
export function advanceStandInPreparation(job, deadline, now = () => performance.now()) {
  while (!job.done && now() < deadline) {
    job.done = job.iterator.next().done;
    job.steps++;
  }
  return job.done;
}

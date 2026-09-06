#!/usr/bin/env node
/**
 * R24 C LIGHT — verify-worker-normals (recon T6 / L8 / T7). A NODE gate.
 *
 * WHY NODE AND ONLY NODE, stated up front: the spliced DEM worker runs on
 * three-tile's Esri LERC path only — the terrain-rgb loader E's fixture serves
 * builds its geometry on the MAIN thread — and elevation3d.arcgis.com is
 * 403-blocked in this container. So this code cannot be exercised in a browser
 * here at all, and every claim below is an arithmetic claim about the function,
 * not a pixel claim about a frame. The pixel half is "could not measure here".
 *
 * The gate loads the REAL worker source (the same text the splice injects),
 * evaluates it in a sandbox, and runs the normal pass over a synthetic Martini-
 * shaped mesh whose true normals are known in closed form.
 *
 * Run: node scripts/verify-worker-normals.mjs
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const src = readFileSync(`${ROOT}/lib/fly/vendor/three-tile/workers/skirt-tail.src.js`, 'utf8');

// Evaluate only the function bodies — the message handler references __DECODE__
// and `self`, neither of which exists here.
// The FILE HEADER also mentions `self.onmessage`, so anchor on the real
// statement, not on the first mention of it.
const cut = src.lastIndexOf('self.onmessage = function');
const body = src.slice(0, cut);
const load = new Function(`${body}\nreturn { r24SmoothNormals: r24SmoothNormals, r24AddSkirt: r24AddSkirt, r24BoundaryEdges: r24BoundaryEdges };`);
const { r24SmoothNormals, r24AddSkirt } = load();

const fails = [];
let n = 0;
const gate = (name, ok, detail = '') => {
  n++;
  if (!ok) fails.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/**
 * A tile-local grid mesh over a SMOOTH analytic surface. Positions are (x, y, z)
 * with z = height, which is the convention the skirt builder proves (it drops
 * `position[i*3+2]`). The triangulation is deliberately IRREGULAR — every other
 * quad flips its diagonal — because a regular one hides exactly the defect this
 * gate is about: with last-writer normals a regular grid still looks plausible,
 * and Martini's real output is anything but regular.
 */
function buildGrid(N, h) {
  const pos = [];
  const nrm = [];
  const idx = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      const y = j / N;
      pos.push(x, y, h(x, y));
      nrm.push(0, 0, 1);
    }
  }
  const at = (i, j) => j * (N + 1) + i;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if ((i + j) % 2 === 0) {
        idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1));
        idx.push(at(i, j), at(i + 1, j + 1), at(i, j + 1));
      } else {
        idx.push(at(i, j), at(i + 1, j), at(i, j + 1));
        idx.push(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
      }
    }
  }
  return {
    attributes: {
      position: { value: new Float32Array(pos), size: 3 },
      texcoord: { value: new Float32Array((N + 1) * (N + 1) * 2), size: 2 },
      normal: { value: new Float32Array(nrm), size: 3 },
    },
    indices: new Uint32Array(idx),
  };
}

/** Upstream's pass, transcribed: last writer wins, no accumulate, no normalise. */
function lastWriterNormals(g) {
  const pos = g.attributes.position.value;
  const nrm = g.attributes.normal.value;
  const idx = g.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    let x = e1[1] * e2[2] - e1[2] * e2[1];
    let y = e1[2] * e2[0] - e1[0] * e2[2];
    let z = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    if (z < 0) { x = -x; y = -y; z = -z; }
    for (const v of [a, b, c]) { nrm[v] = x; nrm[v + 1] = y; nrm[v + 2] = z; }
  }
}

// A smooth bump: h = 0.25 * sin(pi x) * sin(pi y). True normal is
// normalize(-dh/dx, -dh/dy, 1).
const H = (x, y) => 0.25 * Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
const TRUE_N = (x, y) => {
  const dx = 0.25 * Math.PI * Math.cos(Math.PI * x) * Math.sin(Math.PI * y);
  const dy = 0.25 * Math.PI * Math.sin(Math.PI * x) * Math.cos(Math.PI * y);
  const l = Math.hypot(-dx, -dy, 1);
  return [-dx / l, -dy / l, 1 / l];
};

const N = 16;
function meanAngleErrDeg(g) {
  const pos = g.attributes.position.value;
  const nrm = g.attributes.normal.value;
  let sum = 0;
  let cnt = 0;
  const V = (N + 1) * (N + 1);
  for (let v = 0; v < V; v++) {
    const x = pos[v * 3];
    const y = pos[v * 3 + 1];
    if (x <= 0 || x >= 1 || y <= 0 || y >= 1) continue; // interior only
    const t = TRUE_N(x, y);
    const d = Math.min(1, Math.max(-1, nrm[v * 3] * t[0] + nrm[v * 3 + 1] * t[1] + nrm[v * 3 + 2] * t[2]));
    sum += (Math.acos(d) * 180) / Math.PI;
    cnt++;
  }
  return sum / cnt;
}

const gRed = buildGrid(N, H);
lastWriterNormals(gRed);
const errRed = meanAngleErrDeg(gRed);

const gGreen = buildGrid(N, H);
const ok = r24SmoothNormals(gGreen.attributes, gGreen.indices);
const errGreen = meanAngleErrDeg(gGreen);

console.log(`\nSynthetic Martini-shaped mesh, ${N}x${N} quads, flipped diagonals, smooth analytic surface.`);
console.log(`mean angular error vs the TRUE surface normal, interior vertices:`);
console.log(`  RED   (upstream last-writer) : ${errRed.toFixed(2)}°`);
console.log(`  GREEN (r24SmoothNormals)     : ${errGreen.toFixed(2)}°\n`);

gate('r24SmoothNormals reports success on a well-formed mesh', ok === true);
gate(
  'GREEN normals are strictly closer to the true surface normal',
  errGreen < errRed,
  `${errGreen.toFixed(2)}° vs ${errRed.toFixed(2)}°`
);
gate('GREEN mean angular error is under 2°', errGreen < 2, `${errGreen.toFixed(2)}°`);
gate(
  'every GREEN normal is unit length',
  (() => {
    const nrm = gGreen.attributes.normal.value;
    for (let v = 0; v < nrm.length; v += 3) {
      const l = Math.hypot(nrm[v], nrm[v + 1], nrm[v + 2]);
      if (Math.abs(l - 1) > 1e-5) return false;
    }
    return true;
  })(),
  'upstream never normalises at all'
);
gate(
  'every GREEN normal points up (+z), independent of winding',
  (() => {
    const nrm = gGreen.attributes.normal.value;
    for (let v = 2; v < nrm.length; v += 3) if (nrm[v] <= 0) return false;
    return true;
  })()
);
// Reversed winding must produce the SAME field — the orientation assert is what
// makes this independent of a convention recon WB-1 already caught being wrong.
const gFlip = buildGrid(N, H);
for (let t = 0; t < gFlip.indices.length; t += 3) {
  const tmp = gFlip.indices[t + 1];
  gFlip.indices[t + 1] = gFlip.indices[t + 2];
  gFlip.indices[t + 2] = tmp;
}
r24SmoothNormals(gFlip.attributes, gFlip.indices);
gate(
  'reversed winding yields an identical normal field',
  (() => {
    const a = gGreen.attributes.normal.value;
    const b = gFlip.attributes.normal.value;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
    return true;
  })()
);
// Degenerate inputs must bail, never throw and never write garbage.
gate(
  'a non-triangle index count bails',
  r24SmoothNormals(buildGrid(2, H).attributes, new Uint32Array([0, 1])) === false
);
gate('an empty index list bails', r24SmoothNormals(buildGrid(2, H).attributes, new Uint32Array(0)) === false);

// ---- skirt inheritance ----------------------------------------------------
const gSk = buildGrid(8, H);
r24SmoothNormals(gSk.attributes, gSk.indices);
const before = Float32Array.from(gSk.attributes.normal.value);
const vertsBefore = gSk.attributes.position.value.length / 3;
const sk = r24AddSkirt(gSk.attributes, gSk.indices, 5, true);
gate('r24AddSkirt returns a skirted mesh', !!sk);
const nrmAfter = sk.attributes.normal.value;
gate(
  'the surface normals are untouched by the skirt build',
  (() => {
    for (let i = 0; i < before.length; i++) if (before[i] !== nrmAfter[i]) return false;
    return true;
  })()
);
gate(
  'no skirt vertex keeps upstream\'s hard-coded (0,0,1)',
  (() => {
    let flat = 0;
    for (let v = vertsBefore * 3; v < nrmAfter.length; v += 3) {
      if (nrmAfter[v] === 0 && nrmAfter[v + 1] === 0 && nrmAfter[v + 2] === 1) flat++;
    }
    return flat === 0;
  })(),
  'inherited from the edge vertex instead'
);
// Flag OFF must reproduce upstream byte for byte.
const gOff = buildGrid(8, H);
const vOff = gOff.attributes.position.value.length / 3;
const skOff = r24AddSkirt(gOff.attributes, gOff.indices, 5, false);
gate(
  'with the switch off every skirt normal is exactly (0,0,1)',
  (() => {
    const a = skOff.attributes.normal.value;
    for (let v = vOff * 3; v < a.length; v += 3) {
      if (!(a[v] === 0 && a[v + 1] === 0 && a[v + 2] === 1)) return false;
    }
    return true;
  })(),
  'A\'s skirt output stays element-for-element identical'
);

console.log(fails.length ? `\nVERIFY: FAIL (${fails.join(', ')})` : `\nVERIFY: PASS (${n} gates)`);
console.log('NOTE: pixels are NOT measurable in this container — the spliced worker runs');
console.log('only on the Esri LERC path (403 here) and the fixture builds terrain-rgb');
console.log('geometry on the main thread. Every number above is arithmetic, not a frame.');
process.exit(fails.length ? 1 : 0);

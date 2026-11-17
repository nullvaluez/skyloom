'use client';
/**
 * WORLD PASS E (GROUND), M2 `ground.bridges`: a real deck for every mapped
 * bridge that is not one of the six landmark models (desktop High and Ultra,
 * latched; FLY_WORLD_PASS.md). Mounted by SatRoadLayer while WORLD_GROUND is
 * on; the chains come from the road engine's 'sat-roads' chunks
 * (worker/ground-bridges.js decides width, clearance target and landings).
 *
 * The deck, per chain, on the main thread because only here is the DRAWN
 * terrain mesh (rule 4, runtime.engine.getGroundAt):
 *   - every station (<= 20 m apart) samples the drawn ground;
 *   - the deck runs on the straight line between its two landing grounds plus
 *     the clearance target, eased in over a ramp of clearance / 6 % at each
 *     LANDING end (an open end, cut at the tile edge, stays at clearance), and
 *     never closer than 0.15 m above the ground under it;
 *   - geometry: deck top (asphalt or ballast, centre dashes and edge lines),
 *     two sides carried 1 m up as parapets, a soffit, and a pier every 50 m
 *     (90 m on high decks) where the deck stands more than 4 m above the
 *     ground.
 * Landing heights along the deck, clearance and piers at a fixed spacing
 * after FableFlight src/roads.rs lines 580 to 640 (MIT); which ends are
 * landings is decided in the worker (worker/ground-bridges.js).
 *
 * NIGHT (round 2). The deck carries the flat road's own night ribbon: the same
 * road material (SatRoadEngine.material, the same program and uniforms, so
 * the same glow, lamp dots and traffic as the road it continues), one ribbon
 * per deck that has one on the ground, 0.3 m above the deck top. The flat
 * ribbon of a bridge way stays on the ground unless a drawn deck carries it:
 * the worker records each bridge way's index range in the road chunk
 * (`wpBridges.ribbon`), and after each rebuild the ranges under a drawn deck
 * are blanked in that chunk's index buffer (and restored when the deck goes).
 * A bridge beyond the deck range or over the vertex ceiling keeps its glow.
 *
 * Two merged meshes, two draws (+ the deck's shadow into cascade 0 only).
 * Rebuilt when the set of resident bridge chunks changes, and every few
 * seconds while the terrain under them is still refining.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { applyBendFade } from '@/lib/fly/toy-world/world-bend';
import { installCascadeZeroShadow } from './WpCanopyLayer';
import { groundArrivalHeld } from '@/lib/fly/ground-arrival';
import { worldPassRequest } from '@/lib/fly/world-pass';
import { SAT_ROADS } from '@/lib/fly/fly-constants';
import { hexToRGB } from '@/lib/fly/toy-world/toy-palette';
import { satelliteVisualsOn } from '@/lib/fly/satellite-visuals';

const R = 6378137, RAD = 180 / Math.PI;
const toLon = (x) => (x / R) * RAD;
const toLat = (z) => (2 * Math.atan(Math.exp(-z / R)) - Math.PI / 2) * RAD;
const smooth = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

// Lean (measured first build at the Tokyo title stop: 1,904 chains, 260 k
// triangles, 19.4 MiB): every deck to 4 km, only decks of 10 m clearance or
// more beyond it to 7 km, piers every 50 m (90 m on high decks) only where the
// deck stands 4 m up, 36 bytes a vertex (no colour attribute: the surface code
// picks the colour), a vertex ceiling of 200 k at Ultra (7.2 MiB) and 100 k at
// High (3.6 MiB), filled nearest chunk first. A rebuild runs as a
// job, at most `frameMs` of a frame (one deck at a time: Tokyo's 695 decks
// cost 250 ms of ground samples in one frame before this), and the finished
// geometry replaces the old one in a single frame.
export const BRIDGE_DRAW = Object.freeze({ nearM: 4000, maxDistM: 7000, farMinClearM: 10, maxVerts: 200000, maxVertsHigh: 100000, grade: 0.06, parapetM: 1.0, minAboveM: 0.15, pierM: 50, pierHighM: 90, pierMinM: 4, frameMs: 1.5, glowLiftM: 0.3, hideNearM: 12 });

/** The flat road ribbon's look, per class code (SAT_ROADS.classes / colors). */
const GLOW = (() => {
  const w = [];
  for (const c of Object.values(SAT_ROADS.classes)) w[c.cls] = c.w;
  return { w, artery: hexToRGB(SAT_ROADS.colors.artery), street: hexToRGB(SAT_ROADS.colors.street) };
})();

function createDeckMaterial() {
  const m = new MeshStandardMaterial({ roughness: 0.88, metalness: 0, envMapIntensity: 0.5 });
  applyBendFade(m);
  const uniforms = {};
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aDeck;\nvarying vec3 vDeck;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDeck = aDeck;');
    // aDeck = (u across 0..1, arc metres, surface: 0 side, 1 road top, 2 rail top, 3 soffit and piers)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDeck;')
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= vDeck.z < 0.5 ? vec3(0.42, 0.41, 0.39) : vDeck.z < 1.5 ? vec3(0.17, 0.17, 0.18) : vDeck.z < 2.5 ? vec3(0.2, 0.18, 0.16) : vec3(0.28, 0.28, 0.27);
if (vDeck.z > 0.5 && vDeck.z < 1.5) {
  float u = vDeck.x, a = vDeck.y;
  float aa = fwidth(a) + 1e-3;
  float edge = step(u, 0.035) + step(0.965, u);
  float dash = (1.0 - smoothstep(0.012, 0.012 + fwidth(u), abs(u - 0.5))) * step(fract(a / 12.0), 0.5);
  float paint = clamp(edge + dash, 0.0, 1.0) * (1.0 - smoothstep(0.5, 3.0, aa));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.61, 0.57), paint * 0.75);
}`);
  };
  m.customProgramCacheKey = () => `${key}-wp-bridge-deck-v2`;
  return { material: m, uniforms };
}

/**
 * Build one merged deck geometry and one glow ribbon geometry from the ready
 * chunks' bridge chains; a generator that yields after each deck.
 * `side`: also write aRoadSide (the road material's R23 lane attribute).
 */
function* buildDecks(chunks, sample, ox, oz, kOf, px, pz, maxVerts, side) {
  const P = [], N = [], D = [], I = [];
  const GP = [], GC = [], GA = [], GL = [], GI = [];
  const drawn = []; // [x, z, reach] of every drawn deck station (absolute world)
  let held = 0, built = 0, piers = 0, maxZ = 0, minZ = 99, glowChains = 0;
  const heights = [];
  const vtx = (x, y, z, nx, ny, nz, col, u, arc, surf) => {
    P.push(x - ox, y, z - oz); N.push(nx, ny, nz); D.push(u, arc, surf);
    return P.length / 3 - 1;
  };
  const quadStrip = (a, b) => { // a, b: arrays of vertex ids along two rails
    for (let i = 0; i + 1 < a.length; i++) I.push(a[i], b[i], a[i + 1], a[i + 1], b[i], b[i + 1]);
  };
  for (const ch of chunks) {
    const br = ch.bridges, pts = br.pts, cs = br.chains;
    for (let c = 0; c < cs.length; c += 10) {
      if (P.length / 3 + GP.length / 3 > maxVerts) break;
      const first = cs[c], n = cs[c + 1], widthM = cs[c + 2], clear = cs[c + 3], cls = cs[c + 4];
      const landA = cs[c + 5] > 0.5, landB = cs[c + 6] > 0.5;
      {
        const mid = first + (n >> 1), k0 = kOf(ch.cz);
        const dm = Math.hypot(ch.cx + pts[mid * 2] - px, ch.cz + pts[mid * 2 + 1] - pz) / k0;
        if (dm > BRIDGE_DRAW.maxDistM || (dm > BRIDGE_DRAW.nearM && clear < BRIDGE_DRAW.farMinClearM)) continue;
      }
      const xs = new Float64Array(n), zs = new Float64Array(n), g = new Float64Array(n), arc = new Float64Array(n);
      let ok = true;
      for (let i = 0; i < n; i++) {
        xs[i] = ch.cx + pts[(first + i) * 2];
        zs[i] = ch.cz + pts[(first + i) * 2 + 1];
        const s = sample(xs[i], zs[i]);
        if (!s || !Number.isFinite(s.elev)) { ok = false; break; }
        g[i] = s.elev; maxZ = Math.max(maxZ, s.tileZ); minZ = Math.min(minZ, s.tileZ);
        if (i) arc[i] = arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
      }
      if (!ok) { held++; yield; continue; }
      const k = kOf(zs[0]);
      const L = arc[n - 1] || 1, Ltrue = L / k;
      // round 2: a clearance per station (each OSM way's own, ramped between ways)
      const cl = br.clr ? (i) => br.clr[first + i] : () => clear;
      const rampOf = (c) => Math.min(c / BRIDGE_DRAW.grade, Ltrue * (landA && landB ? 0.45 : 0.9)) * k;
      const rampA = rampOf(cl(0)), rampB = rampOf(cl(n - 1));
      const gA = g[0], gB = g[n - 1];
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const t = arc[i] / L;
        const fa = landA ? smooth(arc[i] / Math.max(1e-3, rampA)) : 1;
        const fb = landB ? smooth((L - arc[i]) / Math.max(1e-3, rampB)) : 1;
        y[i] = Math.max(gA + (gB - gA) * t + cl(i) * fa * fb, g[i] + BRIDGE_DRAW.minAboveM);
      }
      heights.push(+(Math.max(...Array.from(y, (v, i) => v - Math.min(gA, gB))).toFixed(1)));
      // per-station side vector (miter, world units)
      const half = (widthM / 2) * k, thick = (clear > 3 ? 1.4 : 0.7), par = BRIDGE_DRAW.parapetM;
      const top = cls >= 8 ? [0.2, 0.18, 0.16] : [0.17, 0.17, 0.18];
      const side = [0.42, 0.41, 0.39], under = [0.28, 0.28, 0.27];
      const TL = [], TR = [], LT = [], LB = [], RT = [], RB = [], BL = [], BR = [];
      for (let i = 0; i < n; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
        let dx = xs[i1] - xs[i0], dz = zs[i1] - zs[i0];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const nx = -dz, nz = dx; // left
        const lx = xs[i] + nx * half, lz = zs[i] + nz * half, rx = xs[i] - nx * half, rz = zs[i] - nz * half;
        const a = arc[i] / k, surf = cls >= 8 ? 2 : 1;
        TL.push(vtx(lx, y[i], lz, 0, 1, 0, top, 0, a, surf));
        TR.push(vtx(rx, y[i], rz, 0, 1, 0, top, 1, a, surf));
        LT.push(vtx(lx, y[i] + par, lz, nx, 0, nz, side, 0, a, 0));
        LB.push(vtx(lx, y[i] - thick, lz, nx, 0, nz, side, 0, a, 0));
        void under;
        RT.push(vtx(rx, y[i] + par, rz, -nx, 0, -nz, side, 0, a, 0));
        RB.push(vtx(rx, y[i] - thick, rz, -nx, 0, -nz, side, 0, a, 0));
        BL.push(vtx(lx, y[i] - thick, lz, 0, -1, 0, under, 0, a, 3));
        BR.push(vtx(rx, y[i] - thick, rz, 0, -1, 0, under, 0, a, 3));
      }
      // The flat road's night ribbon, carried onto the deck top (same layout
      // as worker pushSatRoadQuads: four vertices a quad, a+n, a-n, b+n, b-n).
      const gcls = cs[c + 9];
      if (gcls > 0) {
        const hw = (Math.min(GLOW.w[gcls] ?? widthM, widthM) / 2) * k, col = gcls <= 3 ? GLOW.artery : GLOW.street;
        for (let i = 0; i + 1 < n; i++) {
          let dx = xs[i + 1] - xs[i], dz = zs[i + 1] - zs[i];
          const l = Math.hypot(dx, dz);
          if (l < 0.01) continue;
          dx /= l; dz /= l;
          const nx = -dz * hw, nz = dx * hw, b = GP.length / 3;
          const ya = y[i] + BRIDGE_DRAW.glowLiftM, yb = y[i + 1] + BRIDGE_DRAW.glowLiftM;
          GP.push(xs[i] + nx - ox, ya, zs[i] + nz - oz, xs[i] - nx - ox, ya, zs[i] - nz - oz, xs[i + 1] + nx - ox, yb, zs[i + 1] + nz - oz, xs[i + 1] - nx - ox, yb, zs[i + 1] - nz - oz);
          for (let q = 0; q < 4; q++) { GC.push(col[0], col[1], col[2]); GL.push(gcls); }
          const a0 = arc[i] / k, a1 = arc[i + 1] / k;
          GA.push(a0, a0, a1, a1);
          GI.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        }
        glowChains++;
      }
      for (let i = 0; i < n; i++) drawn.push(xs[i], zs[i], half);
      quadStrip(TR, TL); // top, facing up
      quadStrip(LT, LB); // left side, facing out
      quadStrip(RB, RT); // right side
      quadStrip(BL, BR); // soffit, facing down
      // piers where the deck stands well above its ground
      const spacing = (clear > 15 ? BRIDGE_DRAW.pierHighM : BRIDGE_DRAW.pierM) * k;
      for (let s = spacing * 0.5; s < L - spacing * 0.25; s += spacing) {
        let i = 1;
        while (i < n - 1 && arc[i] < s) i++;
        const t = (s - arc[i - 1]) / Math.max(1e-6, arc[i] - arc[i - 1]);
        const qx = xs[i - 1] + (xs[i] - xs[i - 1]) * t, qz = zs[i - 1] + (zs[i] - zs[i - 1]) * t;
        const py = y[i - 1] + (y[i] - y[i - 1]) * t - thick, pg = g[i - 1] + (g[i] - g[i - 1]) * t;
        if (py - pg < BRIDGE_DRAW.pierMinM) continue;
        let dx = xs[i] - xs[i - 1], dz = zs[i] - zs[i - 1];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const ax = dx * 1.6 * k, az = dz * 1.6 * k, bx = -dz * half * 0.55, bz = dx * half * 0.55;
        const corners = [[ax + bx, az + bz], [-ax + bx, -az + bz], [-ax - bx, -az - bz], [ax - bx, az - bz]];
        for (let f = 0; f < 4; f++) {
          const [x0, z0] = corners[f], [x1, z1] = corners[(f + 1) % 4];
          let fnx = (z1 - z0), fnz = -(x1 - x0);
          const fl = Math.hypot(fnx, fnz) || 1; fnx /= fl; fnz /= fl;
          const a = vtx(qx + x0, pg - 2, qz + z0, fnx, 0, fnz, under, 0, 0, 3), b = vtx(qx + x1, pg - 2, qz + z1, fnx, 0, fnz, under, 0, 0, 3);
          const c2 = vtx(qx + x1, py, qz + z1, fnx, 0, fnz, side, 0, 0, 3), d = vtx(qx + x0, py, qz + z0, fnx, 0, fnz, side, 0, 0, 3);
          I.push(a, c2, b, a, d, c2);
        }
        piers++;
      }
      built++;
      yield;
    }
  }
  if (!I.length) return { geometry: null, glow: null, drawn, held, built, piers, heights, maxZ, minZ, glowChains };
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(N), 3));
  geometry.setAttribute('aDeck', new BufferAttribute(new Float32Array(D), 3));
  geometry.setIndex(P.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(I), 1) : new BufferAttribute(new Uint16Array(I), 1));
  geometry.computeBoundingSphere();
  let glow = null;
  if (GI.length) {
    glow = new BufferGeometry();
    glow.setAttribute('position', new BufferAttribute(new Float32Array(GP), 3));
    glow.setAttribute('color', new BufferAttribute(new Float32Array(GC), 3));
    glow.setAttribute('aRoadArc', new BufferAttribute(new Float32Array(GA), 1));
    glow.setAttribute('aRoadCls', new BufferAttribute(new Float32Array(GL), 1));
    if (side) {
      const sd = new Float32Array(GL.length);
      for (let i = 0; i < sd.length; i++) sd[i] = i & 1 ? -1 : 1;
      glow.setAttribute('aRoadSide', new BufferAttribute(sd, 1));
    }
    glow.setIndex(GP.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(GI), 1) : new BufferAttribute(new Uint16Array(GI), 1));
    glow.computeBoundingSphere();
  }
  return { geometry, glow, drawn, held, built, piers, heights, maxZ, minZ, glowChains };
}

/**
 * Hide the flat glow ribbon of every bridge way a drawn deck carries, and show
 * it again where no deck is drawn: blank (or restore) its index range in the
 * road chunk's own index buffer. `hash` is the drawn deck stations, or null.
 */
function applyRibbonHide(engine, hash, cell) {
  let hidden = 0, shown = 0;
  for (const ch of engine.chunks.values()) {
    const rib = ch.bridges?.ribbon, mesh = ch.mesh;
    if (ch.state !== 'ready' || !rib || !mesh) continue;
    const idx = mesh.geometry.index;
    if (ch._wpRibMesh !== mesh) {
      // a new mesh carries a pristine index: remember the ranges once
      ch._wpRibMesh = mesh;
      ch._wpRibSave = [];
      ch._wpRibHid = new Uint8Array(rib.length / 8);
      for (let r = 0; r < rib.length; r += 8) ch._wpRibSave.push(idx.array.slice(rib[r], rib[r] + rib[r + 1]));
    }
    let dirty = false;
    // (three clears the update ranges itself after the upload)
    for (let r = 0, row = 0; r < rib.length; r += 8, row++) {
      let hide = !!hash;
      for (let p = 0; p < 3 && hide; p++) {
        const x = ch.cx + rib[r + 2 + p * 2], z = ch.cz + rib[r + 3 + p * 2];
        const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
        let hit = false;
        for (let a = -1; a <= 1 && !hit; a++) for (let b = -1; b <= 1 && !hit; b++) {
          const list = hash.get((gx + a) * 73856093 + (gz + b) * 19349663);
          if (list) for (let i = 0; i < list.length; i += 3) if ((list[i] - x) ** 2 + (list[i + 1] - z) ** 2 <= list[i + 2] * list[i + 2]) { hit = true; break; }
        }
        hide = hit;
      }
      if (hide) hidden++; else shown++;
      if ((hide ? 1 : 0) === ch._wpRibHid[row]) continue;
      ch._wpRibHid[row] = hide ? 1 : 0;
      const a = idx.array, o = rib[r], save = ch._wpRibSave[row];
      if (hide) a.fill(0, o, o + save.length); else a.set(save, o);
      idx.addUpdateRange(o, save.length);
      dirty = true;
    }
    if (dirty) idx.needsUpdate = true;
  }
  return { hidden, shown };
}

/** One frame: (once a second) a rebuild if the chunk set changed, and the flat ribbons kept in step. */
function tickBridges(t, deck, s, engine, runtime, flight) {
    if (s.job) {
      // a rebuild in progress: at most frameMs of this frame
      const j = s.job, t0 = performance.now();
      let r;
      do r = j.it.next(); while (!r.done && performance.now() - t0 < BRIDGE_DRAW.frameMs);
      j.ms += performance.now() - t0;
      j.frames++;
      if (!r.done) return;
      s.job = null;
      const v = r.value;
      const old = deck.mesh.geometry, oldGlow = deck.glow.geometry;
      deck.mesh.geometry = v.geometry ?? new BufferGeometry();
      deck.glow.geometry = v.glow ?? new BufferGeometry();
      old.dispose();
      oldGlow.dispose();
      deck.mesh.position.set(j.ox, 0, j.oz);
      deck.glow.position.set(j.ox, 0, j.oz);
      deck.mesh.visible = !!v.geometry;
      deck.glow.visible = !!v.glow;
      // the drawn stations, hashed for the flat-ribbon test
      const cell = 40 * j.k0, hash = new Map(), reach = BRIDGE_DRAW.hideNearM * j.k0;
      for (let i = 0; i < v.drawn.length; i += 3) {
        const key = Math.floor(v.drawn[i] / cell) * 73856093 + Math.floor(v.drawn[i + 1] / cell) * 19349663;
        let list = hash.get(key);
        if (!list) hash.set(key, (list = []));
        list.push(v.drawn[i], v.drawn[i + 1], v.drawn[i + 2] + reach);
      }
      s.hide = { hash: v.drawn.length ? hash : null, cell };
      const rh = applyRibbonHide(engine, s.hide.hash, cell);
      s.stats = { chains: v.built, held: v.held, piers: v.piers, chunks: j.chunks, heights: v.heights, triangles: v.geometry ? v.geometry.index.count / 3 : 0, minZ: v.minZ, maxZ: v.maxZ, buildMs: +j.ms.toFixed(1), buildFrames: j.frames, arrivalHeld: false, vertices: v.geometry ? v.geometry.attributes.position.count : 0, glowChains: v.glowChains, glowTriangles: v.glow ? v.glow.index.count / 3 : 0, glowVertices: v.glow ? v.glow.attributes.position.count : 0, ribbonsHidden: rh.hidden, ribbonsShown: rh.shown };
      return;
    }
    if (t - s.t < 1) return;
    s.t = t;
    // A road chunk rebuilt since the last rebuild carries a pristine index:
    // keep its flat ribbons in step with the decks drawn now.
    if (s.hide) for (const ch of engine.chunks.values()) if (ch.bridges?.ribbon && ch.mesh && ch._wpRibMesh !== ch.mesh) { applyRibbonHide(engine, s.hide.hash, s.hide.cell); break; }
    // The arrival hold (lib/fly/ground-arrival.js): decks wait for the buildings.
    if (groundArrivalHeld(runtime, t)) { s.stats.arrivalHeld = true; return; }
    const px = flight.pos.x, pz = flight.pos.z;
    const k0 = 1 / Math.cos(((flight.latDeg ?? 0) * Math.PI) / 180);
    const ready = [];
    for (const [key, ch] of engine.chunks) {
      if (ch.state !== 'ready' || !ch.bridges) continue;
      if (Math.hypot(ch.cx - px, ch.cz - pz) > (BRIDGE_DRAW.maxDistM + 2500) * k0) continue;
      ready.push(ch);
      void key;
    }
    const sig = ready.map((c) => `${c.cx},${c.cz}`).sort().join('|');
    // nearest chunk first, so the vertex ceiling cuts the far decks
    ready.sort((a, b) => (a.cx - px) ** 2 + (a.cz - pz) ** 2 - ((b.cx - px) ** 2 + (b.cz - pz) ** 2));
    const refining = t < s.refineUntil && t - s.builtAt > 4;
    if (sig === s.sig && !refining) return;
    if (sig !== s.sig) s.refineUntil = t + 40;
    s.sig = sig;
    s.builtAt = t;
    const ox = Math.round(px / 1000) * 1000, oz = Math.round(pz / 1000) * 1000;
    const sample = (x, z) => runtime.engine?.getGroundAt(toLon(x), toLat(z));
    const kOf = (z) => 1 / Math.cos((toLat(z) * Math.PI) / 180);
    s.job = { it: buildDecks(ready, sample, ox, oz, kOf, px, pz, worldPassRequest().tier === 'high' ? BRIDGE_DRAW.maxVertsHigh : BRIDGE_DRAW.maxVerts, !!engine.r23), ox, oz, k0, chunks: ready.length, ms: 0, frames: 0 };
}

export function WpBridgeLayer({ engine, runtime, flight }) {
  const deck = useMemo(() => {
    const { material, uniforms } = createDeckMaterial();
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.name = 'wp-bridge-decks';
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    installCascadeZeroShadow(mesh);
    // the deck's night ribbon: the road engine's own shared material (no new program)
    const glow = new Mesh(new BufferGeometry(), engine.material);
    glow.name = 'wp-bridge-glow';
    glow.visible = false;
    glow.frustumCulled = false;
    glow.renderOrder = satelliteVisualsOn('lighting') ? -4 : 3;
    return { mesh, glow, material, uniforms };
  }, [engine]);
  useEffect(() => () => { deck.mesh.geometry.dispose(); deck.glow.geometry.dispose(); deck.material.dispose(); }, [deck]);
  const st = useRef({ t: -Infinity, sig: '', job: null, builtAt: 0, refineUntil: 0, stats: { chains: 0, held: 0, piers: 0, chunks: 0, heights: [], triangles: 0, minZ: 0, maxZ: 0 } });
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return undefined;
    const handle = { mesh: deck.mesh, glow: deck.glow, get stats() { return { ...st.current.stats }; } };
    window.__wpBridges = handle;
    return () => { if (window.__wpBridges === handle) delete window.__wpBridges; };
  }, [deck]);
  useFrame(({ clock }) => tickBridges(clock.elapsedTime, deck, st.current, engine, runtime, flight), -46);
  return (
    <>
      <primitive object={deck.mesh} />
      <primitive object={deck.glow} />
    </>
  );
}

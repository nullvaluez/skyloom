'use client';

import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { LABELS, LETTERS, TOY_WORLD, TRAFFIC, WARP } from '@/lib/fly/fly-constants';
import { M_TO_FT } from '@/lib/fly/coords';
import { airDrop, bendDrop, getBend } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

const _v = new Vector3();
const _sample = new Vector3();
const _camFwd = new Vector3();

/**
 * True when a (rebased) world point sits meaningfully in FRONT of the
 * camera. The NDC z-range check alone is not a behind-camera cull: points
 * behind the eye can project mirrored into [-1,1] and produced phantom
 * labels/hover targets for planes nowhere near the field of view.
 */
function inFront(x, y, z, camera) {
  return (
    (x - camera.position.x) * _camFwd.x +
      (y - camera.position.y) * _camFwd.y +
      (z - camera.position.z) * _camFwd.z >
    25
  );
}

const LOCK_COLORS = {
  soft: '#fbbf24',
  intercepting: '#60a5fa',
  formation: '#4ade80',
};

// POI tooltip kind badges (military/hotspot only — everything else stays
// on the neutral ramp; matches ATLAS_KIND colors)
const POI_BADGES = {
  military: { label: 'BASE', color: '#f87171' },
  hotspot: { label: 'SPOT', color: '#fbbf24' },
};

/**
 * Bracket + leading pip + range/closure for the locked target.
 * @param prev {hex, dist, t} from the previous frame (for closure rate)
 * @returns updated prev sample, or null when nothing is locked
 */
function drawReticle(ctx, w, h, runtime, prev) {
  const { lockedHex, lockState } = useFlyStore.getState();
  if (!lockedHex || lockState === 'none') return null;
  const track = runtime.traffic?.tracks.get(lockedHex);
  const { camera, origin, flight } = runtime;
  if (!track || !track.fix1 || !camera || !origin || !flight) return null;

  // Project where the GPU actually draws it: minus the AIRCRAFT bend drop
  // (full near the ground, capped at eye level for high targets). ryd =
  // drawn-frame render Y (round 8.5 H1) — the same Y TrafficLayer places
  // the instance at, so the bracket stays glued to the model.
  const drop = airDrop(
    Math.hypot(track.rx - flight.pos.x, track.rz - flight.pos.z),
    track.ryd
  );
  camera.getWorldDirection(_camFwd);
  if (!inFront(track.rx - origin.anchor.x, track.ryd - drop, track.rz - origin.anchor.z, camera))
    return null;
  _v.set(track.rx - origin.anchor.x, track.ryd - drop, track.rz - origin.anchor.z).project(camera);
  if (_v.z > 1) return null;
  const sx = (_v.x * 0.5 + 0.5) * w;
  const sy = (-_v.y * 0.5 + 0.5) * h;
  const color = LOCK_COLORS[lockState] ?? LOCK_COLORS.soft;
  const r = 22;
  const c = 8; // corner arm length

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.95;
  for (const [mx, my] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.beginPath();
    ctx.moveTo(sx + mx * r, sy + my * r - my * c);
    ctx.lineTo(sx + mx * r, sy + my * r);
    ctx.lineTo(sx + mx * r - mx * c, sy + my * r);
    ctx.stroke();
  }

  // Leading pip: where the target will be in a few seconds
  const fix = track.fix1;
  const leadT = Math.min(8, track.distM / 300);
  const k = 1; // pip is cosmetic; mercator refinement invisible at this scale
  _v.set(
    track.rx - origin.anchor.x + fix.vE * leadT * k,
    track.ryd + fix.vUp * leadT - drop,
    track.rz - origin.anchor.z - fix.vN * leadT * k
  );
  if (inFront(_v.x, _v.y, _v.z, camera) && (_v.project(camera), _v.z <= 1)) {
    const px = (_v.x * 0.5 + 0.5) * w;
    const py = (-_v.y * 0.5 + 0.5) * h;
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Range + closure readout (closure from timestamped range delta)
  const now = performance.now() / 1000;
  const rangeNm = track.distM / 1852;
  let closureMps = 0;
  if (prev && prev.hex === lockedHex && now > prev.t) {
    closureMps = (prev.dist - track.distM) / (now - prev.t);
  }
  const mode =
    lockState === 'soft' ? 'LOCK · F intercept · T inspect' : lockState === 'intercepting' ? 'INTERCEPT' : 'FORMATION';
  ctx.font = '600 11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  ctx.fillText(mode, sx + r + 10, sy - 6);
  ctx.fillText(
    `${rangeNm < 10 ? rangeNm.toFixed(1) : Math.round(rangeNm)}nm  ${closureMps >= 0 ? '+' : ''}${Math.round(closureMps)}m/s`,
    sx + r + 10,
    sy + 8
  );
  ctx.globalAlpha = 1;
  return { hex: lockedHex, dist: track.distM, t: now };
}

/**
 * ONE absolutely-positioned canvas redrawn per animation frame for every
 * traffic label — never per-label DOM nodes. Projects the maxLabels nearest
 * tracks through the live camera (rebased frame), culls behind-camera,
 * declutters on a screen grid, and dims labels whose sightline dips under
 * terrain (two samples along the ray, refreshed round-robin one track per
 * frame so raycasts never cluster into a spike).
 */
export function LabelCanvas({ runtime }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let losCursor = 0;
    let reticlePrev = null;

    // Pointer picking: this canvas is pointer-events-none (events land on
    // the GL canvas below), so track the cursor on window and hit-test it
    // against this frame's projected aircraft. Click opens the inspect modal.
    const cursor = { x: -1, y: -1 };
    const hits = []; // {hex, sx, sy} rebuilt per frame
    const onMove = (e) => {
      cursor.x = e.clientX;
      cursor.y = e.clientY;
    };
    // Nearest projected aircraft to a screen point, within the pick radius.
    // Mirrors the hover pick below; used for the direct touch-tap path.
    const pickAt = (x, y, radius) => {
      let best = null;
      let bestD = radius;
      for (const hit of hits) {
        let d = Math.hypot(hit.sx - x, hit.sy - y);
        const r = hit.rect;
        if (r && x >= r[0] - 6 && x <= r[0] + r[2] + 6 && y >= r[1] - 6 && y <= r[1] + r[3] + 6) {
          d = 0; // tap landed on the label itself
        }
        if (d < bestD) {
          bestD = d;
          best = hit.hex;
        }
      }
      return best;
    };
    const onDown = (e) => {
      const store = useFlyStore.getState();
      if (store.phase !== 'flying' || store.inspectHex || store.atlasOpen) return;
      // Touch has no persistent hover — hit-test the tap point directly against
      // this frame's projected planes (a fat-finger radius, since there's no
      // aim), and never let the steering stick eat the tap (input ignores
      // touch pointers on the canvas).
      if (e.pointerType === 'touch') {
        const hex = pickAt(e.clientX, e.clientY, Math.max(WARP.hoverRadiusPx, 64));
        if (hex) {
          runtime.hoverHex = hex; // brief hover ring on the next frame
          store.setInspectHex(hex);
        }
        return;
      }
      // Mouse/pen: the desktop hover ring already resolved the target.
      if (e.button !== 0 || !runtime.hoverHex) return;
      store.setInspectHex(runtime.hoverHex);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { traffic, camera, flight, origin, engine } = runtime;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!traffic || !camera || !flight || !origin) return;

      reticlePrev = drawReticle(ctx, w, h, runtime, reticlePrev);

      // Wider pool than the labels: every on-screen plane in it is hoverable
      // and clickable even when it doesn't earn one of the 15 labels —
      // "sometimes I can't inspect" was a plane outside the label set.
      const items = traffic.getNearest(TRAFFIC.pickPoolSize, flight.pos);
      if (items.length === 0) return;
      camera.getWorldDirection(_camFwd);

      // Round-robin terrain occlusion refresh: one track per frame.
      const probe = items[losCursor++ % items.length];
      if (probe && engine && probe.distM > LABELS.occlusionMinDistM) {
        let dim = false;
        for (const f of [0.45, 0.75]) {
          _sample.set(
            flight.pos.x + (probe.rx - flight.pos.x) * f,
            flight.pos.y + (probe.ry - flight.pos.y) * f,
            flight.pos.z + (probe.rz - flight.pos.z) * f
          );
          const geo = engine.worldToGeo(_sample);
          const elev = engine.getElevationAt(geo.x, geo.y);
          if (elev != null && _sample.y < elev - LABELS.occlusionMarginM) {
            dim = true;
            break;
          }
        }
        probe._losDim = dim;
      } else if (probe) {
        probe._losDim = false;
      }

      ctx.font = '500 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      const grid = new Set();
      hits.length = 0;
      const { k: bendK } = getBend(); // labels stick to the BENT positions
      let labeled = 0;

      for (const it of items) {
        if (it.distM < LABELS.minDistM) continue;
        // Round 11: a plane faded past the horizon (TrafficLayer stamps the
        // shared per-frame value) gets NO label and NO hit — you can't hover
        // or click a ghost the renderer skipped. Checked before the hits
        // push, not just the draw.
        const hFade = it.horizonFade ?? 1;
        if (hFade <= 0.05) continue;
        // ryd: labels/carets anchor to the drawn-frame Y the GPU renders at
        // (round 8.5 H1); the altFt TEXT below stays the true it.ry.
        const drop = airDrop(Math.hypot(it.rx - flight.pos.x, it.rz - flight.pos.z), it.ryd);
        const wx = it.rx - origin.anchor.x;
        const wy = it.ryd - drop;
        const wz = it.rz - origin.anchor.z;
        if (!inFront(wx, wy, wz, camera)) continue; // TRUE behind-camera cull
        _v.set(wx, wy, wz).project(camera);
        if (_v.z > 1 || _v.z < -1) continue; // out of depth
        const sx = (_v.x * 0.5 + 0.5) * w;
        const sy = (-_v.y * 0.5 + 0.5) * h;
        if (sx < -40 || sx > w + 40 || sy < -20 || sy > h + 20) continue;

        // Pickable regardless of label declutter — the plane is still there
        const hit = { hex: it.hex, sx, sy, name: it.meta?.flight || it.meta?.r || it.hex.toUpperCase(), rect: null };
        hits.push(hit);

        if (labeled >= TRAFFIC.maxLabels) continue; // pick-only beyond the label set
        const cell = `${Math.round(sx / LABELS.cellW)}:${Math.round(sy / LABELS.cellH)}`;
        if (grid.has(cell)) continue;
        grid.add(cell);
        labeled += 1;

        // horizon fade multiplies OUTSIDE the 0.25 stale-floor: the floor
        // defeats poll starvation, not the horizon (round 11)
        const alpha = (it._losDim ? 0.32 : 0.88) * Math.max(0.25, it.opacity) * hFade;
        const name = it.meta?.flight || it.meta?.r || it.hex.toUpperCase();
        const altFt = Math.round((it.ry * M_TO_FT) / 100) * 100;
        const distNm = it.distM / 1852;
        const text = `${name} · ${altFt >= 18000 ? `FL${Math.round(altFt / 100)}` : `${altFt.toLocaleString()}ft`} · ${
          distNm < 10 ? distNm.toFixed(1) : Math.round(distNm)
        }nm`;

        // caret at the aircraft, label below
        ctx.globalAlpha = alpha;
        ctx.fillStyle = it.meta?.color || '#9ca3af';
        ctx.beginPath();
        ctx.moveTo(sx, sy + 4);
        ctx.lineTo(sx - 4, sy + 10);
        ctx.lineTo(sx + 4, sy + 10);
        ctx.closePath();
        ctx.fill();

        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(9, 9, 11, 0.55)';
        ctx.fillRect(sx - tw / 2 - 5, sy + LABELS.offsetY - 3, tw + 10, 16);
        ctx.fillStyle = '#e4e4e7';
        ctx.fillText(text, sx, sy + LABELS.offsetY + 9);
        ctx.globalAlpha = 1;
        // The visible label is a click target too, not just the plane point
        hit.rect = [sx - tw / 2 - 5, sy + LABELS.offsetY - 3, tw + 10, 16];
      }

      // --- Hover pick: nearest projected aircraft within the pick radius ---
      const store = useFlyStore.getState();
      let hover = null;
      if (store.phase === 'flying' && !store.inspectHex && !store.atlasOpen) {
        let bestD = WARP.hoverRadiusPx;
        for (const hit of hits) {
          let d = Math.hypot(hit.sx - cursor.x, hit.sy - cursor.y);
          const r = hit.rect;
          if (
            r &&
            cursor.x >= r[0] - 6 &&
            cursor.x <= r[0] + r[2] + 6 &&
            cursor.y >= r[1] - 6 &&
            cursor.y <= r[1] + r[3] + 6
          ) {
            d = 0; // cursor on the label itself — direct hit
          }
          // Hysteresis: the current hover holds on until clearly beaten
          if (hit.hex === runtime.hoverHex) d *= WARP.hoverStickiness;
          if (d < bestD) {
            bestD = d;
            hover = hit;
          }
        }
      }
      runtime.hoverHex = hover?.hex ?? null;
      if (hover) {
        // Rotating-diamond hover ring + prompt — reads as "this is a button"
        const r = 16;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.75;
        ctx.globalAlpha = 0.95;
        ctx.save();
        ctx.translate(hover.sx, hover.sy);
        ctx.rotate((performance.now() / 900) % (Math.PI * 2));
        ctx.strokeRect(-r, -r, r * 2, r * 2);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(hover.sx, hover.sy, r * 0.55, 0, Math.PI * 2);
        ctx.stroke();

        const prompt = `${hover.name} — CLICK TO INSPECT`;
        ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
        const tw = ctx.measureText(prompt).width;
        ctx.fillStyle = 'rgba(9, 9, 11, 0.8)';
        ctx.fillRect(hover.sx - tw / 2 - 7, hover.sy - r - 26, tw + 14, 18);
        ctx.fillStyle = '#fde68a';
        ctx.fillText(prompt, hover.sx, hover.sy - r - 13);
        ctx.globalAlpha = 1;
      }

      // --- POI hover tooltip: aim near a 3D letter (aircraft hover wins) ---
      if (!hover && store.phase === 'flying' && !store.inspectHex && !store.atlasOpen && runtime.poiSlots?.length) {
        const isToy = store.mapStyle === 'toy';
        let best = null;
        let bestD = LABELS.poiHoverRadiusPx;
        for (const poi of runtime.poiSlots) {
          const distM = Math.hypot(poi.wx - flight.pos.x, poi.wz - flight.pos.z);
          if (distM < LABELS.minDistM) continue;
          // Anchor at the letters' mid-height, on the same drawn ground +
          // bend the letters stand on (PoiLetters mirrors this exactly)
          const groundY = isToy
            ? poi.elev * TOY_WORLD.terrainExaggeration + TOY_WORLD.groundLift
            : poi.elev;
          const wy = groundY + (LETTERS[poi.kind]?.sizeM ?? 100) * 0.5 - bendDrop(distM, bendK);
          const wx = poi.wx - origin.anchor.x;
          const wz = poi.wz - origin.anchor.z;
          if (!inFront(wx, wy, wz, camera)) continue;
          _v.set(wx, wy, wz).project(camera);
          if (_v.z > 1 || _v.z < -1) continue;
          const sx = (_v.x * 0.5 + 0.5) * w;
          const sy = (-_v.y * 0.5 + 0.5) * h;
          const d = Math.hypot(sx - cursor.x, sy - cursor.y);
          if (d < bestD) {
            bestD = d;
            best = { poi, sx, sy, distM };
          }
        }
        if (best) {
          const nm = best.distM / 1852;
          const title = best.poi.name.toUpperCase();
          // Kind badge: military/hotspot get their class color + the
          // blurb's first clause (the letters themselves stay clean white —
          // the tooltip is where the kind is allowed to speak)
          const badge = POI_BADGES[best.poi.kind];
          const sub = `${badge?.label ?? best.poi.kind.toUpperCase()} · ${
            nm < 10 ? nm.toFixed(1) : Math.round(nm)
          }nm`;
          let blurb = best.poi.blurb ? best.poi.blurb.split(/[—;.]/)[0].trim() : null;
          if (blurb && blurb.length > 46) blurb = `${blurb.slice(0, 44)}…`;
          ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
          const tw1 = ctx.measureText(title).width;
          ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
          const tw2 = ctx.measureText(sub).width;
          const tw3 = blurb ? ctx.measureText(blurb).width : 0;
          const bh = blurb ? 50 : 36;
          const bw = Math.max(tw1, tw2, tw3) + 18;
          const bx = best.sx - bw / 2;
          const by = best.sy - (bh + 22);
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = 'rgba(7, 10, 20, 0.85)';
          ctx.fillRect(bx, by, bw, bh);
          ctx.strokeStyle = 'rgba(207, 238, 248, 0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
          ctx.fillStyle = '#eef5ff';
          ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillText(title, best.sx, by + 15);
          ctx.fillStyle = badge?.color ?? '#8fa0bf';
          ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillText(sub, best.sx, by + 28);
          if (blurb) {
            ctx.fillStyle = '#8fa0bf';
            ctx.fillText(blurb, best.sx, by + 42);
          }
          // anchor diamond
          ctx.save();
          ctx.translate(best.sx, best.sy);
          ctx.rotate(Math.PI / 4);
          ctx.strokeRect(-4, -4, 8, 8);
          ctx.restore();
          ctx.globalAlpha = 1;
        }
      }
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      runtime.hoverHex = null;
    };
  }, [runtime]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}

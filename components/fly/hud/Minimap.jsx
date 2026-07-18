'use client';

import { useEffect, useRef } from 'react';
import { MINIMAP } from '@/lib/fly/fly-constants';
import { mercatorScale } from '@/lib/fly/coords';
import { buildPoiList } from '@/lib/fly/poi-data';
import { useFlyStore } from '@/stores/fly-store';

// Military bases as small hollow triangles on the dial (Atlas round §4.2):
// the in-world letters stay clean white, so the minimap carries the kind.
let militaryPois = null;
function getMilitaryPois() {
  if (!militaryPois) militaryPois = buildPoiList().filter((p) => p.kind === 'military');
  return militaryPois;
}

/**
 * Small north-up situational canvas, redrawn at 5Hz: player wedge at the
 * center, live traffic as tinted dots, faint range rings. Reads the shared
 * runtime only — no React state per tick.
 */
export function Minimap({ runtime }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const size = MINIMAP.sizePx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const draw = () => {
      const { traffic, flight } = runtime;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const c = size / 2;
      const r = c - 2;

      // dial — faint neon rim, matching the tracer/letter language
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(9, 9, 11, 0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(62, 230, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // range rings
      const pxPerM = r / MINIMAP.rangeM;
      ctx.strokeStyle = 'rgba(228, 228, 231, 0.10)';
      for (let d = MINIMAP.ringStepM; d < MINIMAP.rangeM; d += MINIMAP.ringStepM) {
        ctx.beginPath();
        ctx.arc(c, c, d * pxPerM, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(228, 228, 231, 0.6)';
      ctx.font = '600 9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N', c, 11);

      if (!traffic || !flight) return;
      const k = mercatorScale(flight.latDeg);
      const lockedHex = useFlyStore.getState().lockedHex;

      // traffic dots (clip to the dial); the locked target gets a ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.clip();

      // military bases in range — hollow red triangles under the traffic
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.85)';
      ctx.lineWidth = 1.1;
      for (const poi of getMilitaryPois()) {
        const eastM = (poi.wx - flight.pos.x) / k;
        const northM = -(poi.wz - flight.pos.z) / k;
        if (Math.abs(eastM) > MINIMAP.rangeM || Math.abs(northM) > MINIMAP.rangeM) continue;
        const x = c + eastM * pxPerM;
        const y = c - northM * pxPerM;
        if (x < 0 || x > size || y < 0 || y > size) continue;
        ctx.beginPath();
        ctx.moveTo(x, y - 3.4);
        ctx.lineTo(x - 3, y + 2.4);
        ctx.lineTo(x + 3, y + 2.4);
        ctx.closePath();
        ctx.stroke();
      }
      const pulse = runtime.spicyPulse;
      const pulseLive = pulse && performance.now() < pulse.until;
      for (const it of traffic.items) {
        const eastM = (it.rx - flight.pos.x) / k;
        const northM = -(it.rz - flight.pos.z) / k;
        const x = c + eastM * pxPerM;
        const y = c - northM * pxPerM;
        if (x < 0 || x > size || y < 0 || y > size) continue;
        ctx.globalAlpha = Math.max(0.25, it.opacity);
        ctx.fillStyle = it.meta?.color || '#9ca3af';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        if (it.hex === lockedHex) {
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.arc(x, y, 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        // SPICY attention ring: expanding red pulse on a fresh rare contact
        if (pulseLive && it.hex === pulse.hex) {
          const u = (performance.now() / 700) % 1;
          ctx.strokeStyle = 'rgba(248, 113, 113, 0.95)';
          ctx.globalAlpha = (1 - u) * 0.9;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 3.5 + u * 9, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // player wedge (heading 0 = north = up)
      const hdg = flight.heading;
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(hdg);
      ctx.fillStyle = '#fafafa';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(-4.5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    draw();
    const id = setInterval(draw, 1000 / MINIMAP.updateHz);
    return () => clearInterval(id);
  }, [runtime]);

  // Desktop: bottom-right dial. Touch/phone (max-sm): the bottom corners
  // belong to the joystick + throttle, so the dial moves to the top-right
  // (below the compact stats strip) and shrinks — the fixed-resolution canvas
  // just scales, staying crisp.
  return (
    <div
      className="pointer-events-none absolute bottom-10 right-4 z-10 origin-bottom-right max-sm:bottom-auto max-sm:right-2 max-sm:top-[calc(env(safe-area-inset-top)+3.25rem)] max-sm:origin-top-right max-sm:scale-[0.62]"
    >
      <canvas
        ref={canvasRef}
        style={{ width: MINIMAP.sizePx, height: MINIMAP.sizePx }}
        className="pointer-events-auto cursor-pointer rounded-full"
        onClick={() => useFlyStore.getState().setAtlasOpen(true)}
        title="Open the Atlas (M)"
        role="button"
        aria-label="Open the Atlas"
      />
    </div>
  );
}

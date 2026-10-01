import { Vector3, Vector4 } from 'three';
import { adventureById, distanceM } from './adventures.mjs';

export function adventureRecovery(active) {
  if (!active || !['retry', 'paused'].includes(active.status)) return null;
  const first = active.index === 0;
  return {
    label: active.status === 'paused' ? 'Resume adventure' : first ? 'Restart approach' : 'Retry checkpoint',
    heading: first ? 'Return to the first discovery' : 'Continue from your last discovery',
    description: active.status === 'paused'
      ? 'Resume from a safe approach to your next discovery.'
      : `Fast travel or a crash interrupted the route. ${first ? 'Restart the approach' : 'Return to your last discovery'} to continue.`,
  };
}

const clip = new Vector4();
/** Perspective projection with an explicit behind-camera test, including bank.
 * Point and camera are in the same rebased, visually bent scene coordinates. */
export function projectAdventureWaypoint(point, camera, width, height) {
  clip.set(point.x, point.y, point.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  if (![clip.x, clip.y, clip.z, clip.w, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const denominator = Math.max(Math.abs(clip.w), .001);
  const x = (clip.x / denominator * .5 + .5) * width;
  const y = (-clip.y / denominator * .5 + .5) * height;
  const behind = clip.w <= 0;
  // Use the undivided clip direction: dividing by negative w mirrors a target
  // behind the player onto the wrong side of the screen.
  const angle = Math.atan2(-clip.y, Math.abs(clip.x) < .001 && behind ? -1 : clip.x);
  return { x, y, behind, angle, onScreen: !behind && x >= 58 && x <= width - 58 && y >= 90 && y <= height - 100 };
}

/** One marker on the existing frame-synchronised HUD canvas, before any traffic
 * early return. No scene mesh, React frame updates, terrain requests or timer. */
export function createAdventureWaypointPainter() {
  const point = new Vector3();
  let hudBounds = null, measuredAt = -Infinity, fontFamily = 'system-ui, sans-serif';
  function capsule(ctx, x, y, width, height) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, width, height, height / 2);
    else ctx.rect(x, y, width, height);
    ctx.fillStyle = 'rgba(19, 37, 54, .88)';
    ctx.fill();
  }
  return (ctx, width, height, runtime, state, airDrop) => {
    runtime.adventureWaypoint = null;
    const active = runtime.adventures?.controller.progress.active;
    if (active?.status !== 'flying' || state.screen !== 'flight' || state.phase !== 'flying'
      || state.cameraMode === 'photo' || state.hangarOpen || state.atlasOpen || state.logbookOpen || state.inspectHex || state.adventureOpen) return;
    const target = adventureById(active.id)?.checkpoints[active.index];
    const { camera, engine, origin, flight } = runtime;
    if (!target || !camera || !engine || !origin || !flight) return;
    point.copy(engine.geoToWorld(target.lon, target.lat, target.altM));
    point.y -= airDrop(Math.hypot(point.x - flight.pos.x, point.z - flight.pos.z), point.y);
    point.x -= origin.anchor.x;
    point.z -= origin.anchor.z;
    const marker = projectAdventureWaypoint(point, camera, width, height);
    if (!marker) return;
    const now = performance.now();
    if (now - measuredAt > 250) {
      hudBounds = typeof document === 'undefined' ? null : document.querySelector('[data-testid="adventure-hud"]')?.getBoundingClientRect();
      if (typeof document !== 'undefined') fontFamily = getComputedStyle(document.body).getPropertyValue('--font-geist-sans').trim() || fontFamily;
      measuredAt = now;
    }
    const geo = runtime.geo || engine.worldToGeo(flight.pos);
    const distance = distanceM({ lat: geo.y, lon: geo.x }, target);
    const range = distance < 1000 ? `${Math.round(distance / 10) * 10} m` : `${(distance / 1000).toFixed(1)} km`;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'middle';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.font = `500 14px ${fontFamily}`;
    const labelWidth = Math.min(width - 32, ctx.measureText(target.name).width + 40);
    // Include the label and the expanded brief, not just the beacon centre.
    for (const bounds of [hudBounds]) {
      if (bounds && marker.x + labelWidth / 2 > bounds.left - 12 && marker.x - labelWidth / 2 < bounds.right + 12
        && marker.y + 26 > bounds.top - 12 && marker.y - 80 < bounds.bottom + 12) marker.onScreen = false;
    }
    if (marker.onScreen) {
      const { x, y } = marker;
      const radius = 19 + 7 * (1 - Math.min(distance / 2200, 1));
      // An open reticle leaves the actual discovery visible through its centre.
      for (const [lineWidth, color] of [[4, 'rgba(6, 18, 30, .48)'], [1.5, '#d5ecff']]) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(x, y, radius, i * Math.PI / 2 + .22, (i + 1) * Math.PI / 2 - .22);
          ctx.stroke();
        }
      }
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#eaf5ff'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y - radius - 7); ctx.lineTo(x, y - 35);
      ctx.strokeStyle = '#d5ecff80'; ctx.lineWidth = 1;
      ctx.stroke();
      const labelX = Math.max(16, Math.min(width - labelWidth - 16, x - labelWidth / 2));
      ctx.beginPath(); ctx.arc(labelX + 11, y - 66, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#e6f3ff'; ctx.fill();
      ctx.textAlign = 'center'; ctx.fillStyle = '#16324a'; ctx.font = `600 11px ${fontFamily}`;
      ctx.fillText(String(active.index + 1), labelX + 11, y - 66);
      ctx.textAlign = 'left'; ctx.font = `500 14px ${fontFamily}`;
      ctx.shadowColor = 'rgba(0, 10, 20, .95)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 1;
      ctx.strokeStyle = 'rgba(8, 22, 36, .6)'; ctx.lineWidth = 3;
      ctx.strokeText(target.name, labelX + 28, y - 66, labelWidth - 28);
      ctx.fillStyle = '#f6f9fc'; ctx.fillText(target.name, labelX + 28, y - 66, labelWidth - 28);
      ctx.textAlign = 'center'; ctx.font = `500 12px ${fontFamily}`;
      ctx.strokeText(range, x, y - 45);
      ctx.fillStyle = '#d2e9fa'; ctx.fillText(range, x, y - 45);
    } else {
      const x = width / 2;
      const y = width <= 760 ? Math.min(height - 160, Math.max(height * .46, (hudBounds?.bottom || 280) + 48)) : 150;
      const capsuleWidth = Math.min(width - 32, Math.max(218, labelWidth + 38));
      const left = x - capsuleWidth / 2;
      capsule(ctx, left, y - 30, capsuleWidth, 60);
      ctx.beginPath(); ctx.arc(left + 30, y, 18, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(139, 204, 255, .12)'; ctx.fill();
      ctx.textAlign = 'left'; ctx.fillStyle = '#f6f9fc';
      ctx.fillText(target.name, left + 59, y - 9, capsuleWidth - 74);
      ctx.font = `400 11px ${fontFamily}`; ctx.fillStyle = '#b8d2e6';
      ctx.fillText(`${range}  ·  ${marker.behind ? 'Behind you' : 'Follow the arrow'}`, left + 59, y + 10, capsuleWidth - 74);
      ctx.translate(left + 30, y);
      ctx.rotate(marker.angle);
      ctx.beginPath();
      ctx.moveTo(-6, 0); ctx.lineTo(7, 0); ctx.moveTo(1, -6); ctx.lineTo(7, 0); ctx.lineTo(1, 6);
      ctx.strokeStyle = '#a8daff'; ctx.lineWidth = 1.8; ctx.stroke();
      marker.x = x; marker.y = y;
    }
    ctx.restore();
    runtime.adventureWaypoint = { ...marker, checkpoint: active.index, distanceM: distance };
  };
}

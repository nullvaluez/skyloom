/**
 * Operations air step: the low-speed airborne model (pattern, approach,
 * flare). Called only from FlightOperations.step inside the fixed 120 Hz
 * integration.
 */
import { clamp } from './util.js';

export function airIntegrate(ops, f, cmd, dt) {
  const p = ops.profile;
  const target = ops.throttle * f.cfg.speeds.cruise;
  // Cutting power in the flare must not apply the wheel-brake deceleration
  // in mid-air. Preserve glide energy while the pilot settles onto the
  // runway; the stronger brake rating is used only by ground contact.
  f.speed = Math.max(0, f.speed + clamp(target - f.speed, -p.accel * 0.3, p.accel) * dt);
  const yawRate = p.length > 40 ? 0.14 : p.id === 'prop' ? 0.24 : 0.2;
  f.turnRate += (clamp(cmd.turn || 0, -1, 1) * yawRate - f.turnRate) * Math.min(1, dt * 3);
  f.heading += f.turnRate * dt;
  f.pitch = clamp(f.pitch + (cmd.pitch || 0) * 0.22 * dt, -0.45, 0.4);
  // Neutral stick holds the selected attitude. Levelling the nose every
  // frame erased a trimmed descent and forced constant pitch corrections
  // on final. This is attitude hold, not runway tracking or an autopilot.
  f.bank += (clamp(Math.atan((f.speed * f.turnRate) / 9.81), -0.65, 0.65) - f.bank) * Math.min(1, dt * 4);
  const lift = ops.freeRoam ? 1 : clamp(f.speed / p.stall, 0, 1);
  const desired = Math.sin(f.pitch) * f.speed - (1 - lift) * 12;
  ops.vy += (desired - ops.vy) * Math.min(1, dt * 2);
  f.pos.y += ops.vy * dt;
}

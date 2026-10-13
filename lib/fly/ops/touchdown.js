/**
 * Operations touchdown: judging the first contact of an airborne aircraft
 * with the ground. Only the fixed-step integration calls this; no renderer or
 * streaming callback may manufacture a touchdown.
 *
 * Returns true when the step must end here (a failure, or a bounce that
 * re-launches the aircraft), exactly where the pre-split inline code returned.
 */
import { airportEligible, airportFrame, airportLocal } from '../operations-airports.js';
import { angle } from './util.js';

/** The runway's rise rate under the aircraft (m/s), from the contact surface's endpoint elevations. */
export function surfaceRiseRate(f, contact) {
  const contactFrame = contact ? airportFrame(contact.airport) : null;
  if (!contact) return 0;
  const slope = (contact.airport.b.elevation - contact.airport.a.elevation) / contactFrame.length;
  return slope * f.speed * Math.cos(f.pitch) * Math.cos(f.heading - contactFrame.heading);
}

export function judgeContact(ops, f, contact, groundAfter) {
  const p = ops.profile;
  const surfaceRise = surfaceRiseRate(f, contact);
  const relativeSink = surfaceRise - ops.vy;
  if (!(!ops.grounded && f.pos.y <= groundAfter + p.clearance && relativeSink >= 0)) return false;
  if (!contact || contact.kind !== 'runway' || !airportEligible(contact.airport, p.id)) {
    ops.fail('Touchdown outside the runway. Line up again.');
    return true;
  }
  const landingLocal = airportLocal(contact.airport, f.pos.x, f.pos.z);
  const landingLength = airportFrame(contact.airport).length;
  const headingError = Math.abs(angle(f.heading - airportFrame(contact.airport).heading));
  const landingReverse = headingError > Math.PI / 2;
  if (landingReverse ? landingLocal.along > landingLength - (contact.airport.thresholdB || 0) : landingLocal.along < (contact.airport.thresholdA || 0)) {
    ops.fail('Touchdown before the displaced threshold. Aim beyond the runway threshold bars.');
    return true;
  }
  const hard = relativeSink > p.maxSink || Math.abs(f.bank) > p.maxBank || Math.abs(f.pitch) > p.maxPitch ||
    Math.min(headingError, Math.abs(Math.PI - headingError)) > 0.35 || f.speed > p.approach * 1.55;
  if (hard) {
    ops.fail('Hard landing — approach slower, wings level, and flare gently.');
    return true;
  }
  if (relativeSink > 3 && !ops.bounced && ops.bounceCooldown === 0) {
    ops.bounced = true;
    ops.bounceCooldown = 1.5;
    ops.vy = surfaceRise + Math.min(1.2, relativeSink * 0.2);
    f.pos.y = groundAfter + p.clearance + 0.03;
    ops.emit('bounce');
    return true;
  }
  const quality = ops.bounced ? 'Recovered bounce' : relativeSink < 1.5 ? 'Smooth' : relativeSink < 3 ? 'Good' : 'Firm';
  ops.lastTouchdown = { sink: relativeSink, quality, airport: contact.airport.id };
  ops.airport = contact.airport;
  ops.destination = contact.airport.id;
  ops.reverse = landingReverse;
  ops.contactCount++;
  ops.emit('touchdown', ops.lastTouchdown);
  ops.phase = 'landingRoll';
  ops.vy = 0;
  f.pos.y = groundAfter + p.clearance;
  ops.routeIndex = 0;
  ops.arrivalExit = null;
  return false;
}

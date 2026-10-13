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
import { TOUCHDOWN_AIM_M } from '../operations-paths.js';
import { mainsWorld, startRollout } from './telemetry.js';

/** The runway's rise rate under the aircraft (m/s), from the contact surface's endpoint elevations. */
export function surfaceRiseRate(f, contact) {
  const contactFrame = contact ? airportFrame(contact.airport) : null;
  if (!contact) return 0;
  const slope = (contact.airport.b.elevation - contact.airport.a.elevation) / contactFrame.length;
  return slope * f.speed * Math.cos(f.pitch) * Math.cos(f.heading - contactFrame.heading);
}

/**
 * The touchdown event's landing data (centreline, aim point, attitude, the
 * main-gear contact points) for the grade, the presentation and the replay.
 * alongM is measured from the landing threshold; aimM from the 250 m aim
 * point (positive = long); crossM is positive right of the landing direction.
 */
function touchdownDetail(ops, f, contact, local, length, reverse, headingError, groundAfter) {
  const a = contact.airport;
  // The mains at the contact height the step snaps to, not the sub-step penetration.
  const pose = { pos: { x: f.pos.x, y: groundAfter + ops.profile.clearance, z: f.pos.z }, heading: f.heading, pitch: f.pitch, bank: f.bank };
  const alongM = reverse ? length - (a.thresholdB || 0) - local.along : local.along - (a.thresholdA || 0);
  const k = 1 / Math.cos((f.latDeg * Math.PI) / 180);
  return {
    runway: reverse ? a.reciprocal : a.runway,
    speed: f.speed,
    vref: ops.profile.approach,
    crossM: reverse ? -local.cross : local.cross,
    alongM,
    aimM: alongM - TOUCHDOWN_AIM_M,
    bank: f.bank,
    pitch: f.pitch,
    headingErr: Math.min(headingError, Math.abs(Math.PI - headingError)),
    gearDown: ops.gear > 0.5,
    mains: mainsWorld(pose, ops.profile, k),
    bounced: !!ops.bounced,
  };
}

export function judgeContact(ops, f, contact, groundAfter) {
  const p = ops.profile;
  const surfaceRise = surfaceRiseRate(f, contact);
  const relativeSink = surfaceRise - ops.vy;
  if (!(!ops.grounded && f.pos.y <= groundAfter + p.clearance && relativeSink >= 0)) return false;
  if (!contact || contact.kind !== 'runway' || !airportEligible(contact.airport, p.id)) {
    ops.fail('Touchdown outside the runway. Line up again.', 'outside');
    return true;
  }
  const landingLocal = airportLocal(contact.airport, f.pos.x, f.pos.z);
  const landingLength = airportFrame(contact.airport).length;
  const headingError = Math.abs(angle(f.heading - airportFrame(contact.airport).heading));
  const landingReverse = headingError > Math.PI / 2;
  if (landingReverse ? landingLocal.along > landingLength - (contact.airport.thresholdB || 0) : landingLocal.along < (contact.airport.thresholdA || 0)) {
    ops.fail('Touchdown before the displaced threshold. Aim beyond the runway threshold bars.', 'threshold');
    return true;
  }
  const hard = relativeSink > p.maxSink || Math.abs(f.bank) > p.maxBank || Math.abs(f.pitch) > p.maxPitch ||
    Math.min(headingError, Math.abs(Math.PI - headingError)) > 0.35 || f.speed > p.approach * 1.55;
  if (hard) {
    ops.fail('Hard landing — approach slower, wings level, and flare gently.', 'hard');
    return true;
  }
  if (relativeSink > 3 && !ops.bounced && ops.bounceCooldown === 0) {
    ops.bounced = true;
    ops.bounceCooldown = 1.5;
    ops.vy = surfaceRise + Math.min(1.2, relativeSink * 0.2);
    f.pos.y = groundAfter + p.clearance + 0.03;
    ops.emit('bounce', { sink: relativeSink, airport: contact.airport.id });
    return true;
  }
  const quality = ops.bounced ? 'Recovered bounce' : relativeSink < 1.5 ? 'Smooth' : relativeSink < 3 ? 'Good' : 'Firm';
  ops.lastTouchdown = { sink: relativeSink, quality, airport: contact.airport.id };
  ops.airport = contact.airport;
  ops.destination = contact.airport.id;
  ops.reverse = landingReverse;
  ops.contactCount++;
  ops.emit('touchdown', { ...ops.lastTouchdown, ...touchdownDetail(ops, f, contact, landingLocal, landingLength, landingReverse, headingError, groundAfter) });
  startRollout(ops);
  ops.phase = 'landingRoll';
  ops.vy = 0;
  f.pos.y = groundAfter + p.clearance;
  ops.routeIndex = 0;
  ops.arrivalExit = null;
  return false;
}

/**
 * LOUNGE_WALK — the walking observer (Gate to Gate W4, stream N).
 *
 * connectAirportWatch (lib/fly/airport-watch-runtime.js) calls
 * attachLoungeWalk(watch, runtime) on each enter while LOUNGE_WALK is on and
 * calls the function it returns to detach. Attached, it installs watch.walk:
 *   update(dt, now)        move the eye (watch.eyeLocal) and run the postures
 *   lookLimits()           { centre, yawSpan, pitchMin, pitchMax, defaultPitch, face }
 *   enter(entry) / leave() a visit starts and ends (entry.seat: a vantage seat id)
 *   halt()                 stop walking (the binoculars went up)
 *   setMoveKeys(forward, right, run), sit(id, {instant}), stand()
 *   bob                    { x, y } camera-only head bob, metres
 * and sets watch.seats to the variant's vantage seats.
 *
 * W4-0 slot: walking is not built yet, so nothing attaches.
 */
export function attachLoungeWalk() {
  return null;
}

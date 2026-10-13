/**
 * GATE TO GATE — the player's exterior light state (flight.presentation.lights).
 *
 * playerLightState is the phase-derived default every flight gets, computed
 * with every flag off; PLAYER_GLOW_LIGHTS (W2 E) draws it in TrafficLayer's
 * shared AircraftLights, and OPS_FX adds engine-start/shutdown timing on top.
 * The rules follow common airline practice, simplified:
 *   nav      on whenever a flight exists (hangar excluded)
 *   beacon   on whenever a flight exists (engines are assumed running)
 *   strobe   on the runway and in the air
 *   landing  takeoff roll, low-speed flight below 3,000 m AGL, approach, rollout
 *   taxi     taxiing (pushback, taxi out, taxi in); off for the takeoff roll
 *   turnoff  taxi phases and the rollout
 *   logo     whenever a flight exists (the drawing side dims it by day)
 */
const LANDING_AGL_M = 3000;

export function createLightState() {
  return { nav: false, beacon: false, strobe: false, landing: false, taxi: false, logo: false, turnoff: false };
}

export function playerLightState(ops, flight, out = createLightState()) {
  const phase = ops?.phase ?? 'airborne';
  const live = phase !== 'hangar';
  const agl = flight ? flight.pos.y - (flight.groundElev ?? 0) : Infinity;
  const ground = !!ops?.grounded;
  const rolling = phase === 'takeoffRoll' || phase === 'landingRoll';
  const lowFlight = !ground && !!ops?.profile && (phase === 'approach' || agl < LANDING_AGL_M);
  out.nav = live;
  out.beacon = live;
  out.logo = live;
  out.strobe = live && (rolling || !ground);
  out.landing = live && (rolling || lowFlight);
  out.taxi = live && (phase === 'taxiOut' || phase === 'taxiIn' || phase === 'pushback');
  out.turnoff = live && (phase === 'taxiOut' || phase === 'taxiIn' || phase === 'landingRoll');
  return out;
}

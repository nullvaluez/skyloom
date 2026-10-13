/**
 * GATE TO GATE — the render view of the flight (OPS_FEEL.interpolate, W1 C).
 *
 * flight.pos / heading / pitch / bank stay the sim truth. When the operations
 * core owns rendering (flight.renderOwner === 'ops') it publishes an
 * interpolated pose (flight.renderPos, flight.renderAtt) between the last two
 * fixed steps, and the four pose consumers (PlayerPlane, the chase camera,
 * the contrail, the ground shadow, plus the director and approach HUD) read
 * renderView(flight) instead of flight. With the flag off renderView returns
 * the flight itself, so nothing changes.
 */
const views = new WeakMap();

function makeView(flight) {
  const att = () => flight.renderAtt;
  return {
    get pos() {
      return flight.renderPos;
    },
    get heading() {
      return att().heading;
    },
    get pitch() {
      return att().pitch;
    },
    get bank() {
      return att().bank;
    },
    get speed() {
      return flight.speed;
    },
    get cfg() {
      return flight.cfg;
    },
    get operations() {
      return flight.operations;
    },
    get agl() {
      return flight.agl;
    },
    get groundElev() {
      return flight.groundElev;
    },
    get latDeg() {
      return flight.latDeg;
    },
    get boosting() {
      return flight.boosting;
    },
    get aircraftVisual() {
      return flight.aircraftVisual;
    },
    get presentation() {
      return flight.presentation;
    },
    /** Unit forward vector from the render attitude (FlightModel.forward's formula). */
    forward(target) {
      const cp = Math.cos(att().pitch);
      return target.set(Math.sin(att().heading) * cp, Math.sin(att().pitch), -Math.cos(att().heading) * cp);
    },
  };
}

/** The pose to draw: the flight itself unless the operations core owns rendering. */
export function renderView(flight) {
  if (flight?.renderOwner !== 'ops' || !flight.renderPos || !flight.renderAtt) return flight;
  let view = views.get(flight);
  if (!view) {
    view = makeView(flight);
    views.set(flight, view);
  }
  return view;
}

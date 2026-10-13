/**
 * GATE TO GATE — the runtime services FlyScene connects once, next to the
 * flight operations (FLY_GATE_TO_GATE.md "Seams"):
 *
 *   runtime.airports      the airport service (airport-service/index.js)
 *   runtime.director      the camera director (camera-director.js)
 *   runtime.presentation  flight.presentation + the one event fan-out (ops-presentation.js)
 *
 * FlyScene calls runtime.airports.update at useFrame −40 and
 * runtime.presentation.update right after operations.advance in its −50
 * block; the camera chain asks camera-mode.js who owns the frame. Later
 * streams change these services' modules, never FlyScene.
 */
import { createAirportService } from './airport-service/index.js';
import { createCameraDirector } from './camera-director';
import { createOpsPresentation } from './ops-presentation.js';

export function connectGateToGate({ runtime, operations }) {
  const airports = createAirportService(runtime);
  const director = createCameraDirector();
  const presentation = createOpsPresentation({ runtime, getOps: () => runtime.operations ?? operations });
  runtime.airports = airports;
  runtime.director = director;
  runtime.presentation = presentation;
  return () => {
    presentation.dispose();
    director.dispose();
    airports.dispose();
    if (runtime.airports === airports) delete runtime.airports;
    if (runtime.director === director) delete runtime.director;
    if (runtime.presentation === presentation) delete runtime.presentation;
  };
}

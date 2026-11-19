import { createCockpitModel } from './cockpit-model.js';
import { buildLightCockpit } from './light-cockpits.js';
import { buildTransportCockpit } from './transport-cockpits.js';

export function buildFleetInterior(id, scene, compact) {
  const {kit, finish} = createCockpitModel(scene, compact);
  if (!buildLightCockpit(id, kit)) buildTransportCockpit(id, kit);
  return finish();
}

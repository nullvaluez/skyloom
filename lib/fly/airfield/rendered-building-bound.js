// Conservative observation occlusion, not an asserted OSM building height.
// Mirrors the upper envelope of buildSatBuildings' body inference and roof
// dispatch. It deliberately keeps footprints the renderer may cull: rejection
// is safer than advertising a view through a building. Source tags stay intact.
import { SAT_BUILDINGS, ROOFS, ROOFS_SAT, ROOF_TYPOLOGY } from '../fly-constants.js';
import { areaNormK } from '../true-areas.js';
import { REGIONAL_PALETTES } from '../living-regional-palettes.js';

export const RENDERED_OCCLUSION_REVISION = 1;
export function renderedBuildingBound(properties, mercatorAreaM2, k = 1, suburbanContext = false) {
  const sourceHeight = Number(properties.render_height ?? properties.height ?? 0);
  const syntheticFive = sourceHeight === 5 && properties.height == null;
  const mapped = !syntheticFive && Number.isFinite(sourceHeight) && sourceHeight > 0;
  // Cover TRUE_AREAS both on and off, as the scenery worker supports both.
  const area = Math.max(0, mercatorAreaM2) * Math.max(1, areaNormK(k, true));
  const legacy = Math.min(42, Math.max(SAT_BUILDINGS.minH, 9 + Math.sqrt(area) * .5)) * 1.15;
  const house = ROOFS_SAT.houseInfer.hM[1];
  const typology = Math.max(...ROOF_TYPOLOGY.bands.map(b => b.hM[1]));
  const bodyTop = mapped ? Math.max(sourceHeight, SAT_BUILDINGS.minH) : (suburbanContext ? Math.max(house, typology) : Math.max(legacy, house, typology));
  const regionalRise = Math.max(1, ...Object.values(REGIONAL_PALETTES).map(p => p.roofRise ?? 1));
  const smallRoof = ROOFS_SAT.small.riseM[1] * regionalRise + ROOFS_SAT.small.chimney.riseM[1];
  // pushWaterTankSat's conical cap reaches 1.35 * tankHM above the roof.
  const ordinaryRoof = Math.max(smallRoof, ROOFS.parapet.heightM, ROOFS.hvac.hM[1], ROOFS_SAT.mid.penthouse.hM[1], ROOFS_SAT.mid.tankHM[1] * 1.35);
  const roof = bodyTop < SAT_BUILDINGS.roofTones.tallMinH ? ordinaryRoof : Math.max(ordinaryRoof, ROOFS_SAT.tall.antenna.hM[1], ROOFS_SAT.super.crownStepM.reduce((a,b)=>a+b,0), bodyTop * ROOFS_SAT.super.spire.hFrac[1]);
  return { bodyBasis: mapped ? 'mapped' : suburbanContext ? 'bounded-suburban' : 'bounded-legacy', sourceHeight: Number.isFinite(sourceHeight) ? sourceHeight : null, inferred: !mapped, bodyTop, top: bodyTop + roof };
}

// Count the full tile, including bodies the worker might later exclude. If
// this superset passes both context locks, every rendered subset passes too.
// Coverage ratio is unchanged by TRUE_AREAS normalization.
export function provesSuburbanContext({ area, tallTagged }, tileArea) {
  const c = ROOF_TYPOLOGY.context;
  return ROOFS_SAT.enabled && ROOF_TYPOLOGY.enabled && tallTagged < c.maxTallTagged && area / tileArea < c.maxFootprintCover;
}

export const isRenderTallTag = properties => Number(properties.render_height ?? properties.height ?? 0) >= ROOF_TYPOLOGY.context.tallM;

/**
 * LIVING WORLD — AIRFRAME (FLY_LIVING_WORLD.md): the player aircraft's mount.
 *
 * PlayerPlane.jsx carries ONE marked block that imports this module and calls
 * mountLivingAirframe once per airframe mount (style, visuals, hangar pick)
 * and update() once per frame. Everything else lives here:
 *
 *  - AIRFRAME_DETAIL (airframe-detail.js): panel lines, glass and the pilot,
 *    propeller discs — the same finish the hangar's display models get — and
 *    the running lights moved after the cloud composite so they read by day;
 *  - VAPOR_FX (vapor-fx.js): the transonic cone, over-wing sheets and the
 *    wingtip vortices, which take the wingtip ribbons over from Contrail.jsx
 *    (aircraft-effects.js setWingVaporOwner) while they run.
 *
 * Enhanced satellite only (Neon and Classic keep today's frame), and with both
 * flags off this returns null: nothing is patched, added or registered.
 */
import { applyAirframeDetail, airframeDetailAllowed, AIRFRAME_DETAIL_ON, finishRunningLights } from './airframe-detail.js';
import { createVaporFx, VAPOR_FX_ON } from './vapor-fx.js';
import { surveyAirframe } from './airframe-survey.js';
import { registerSkyOverlay } from './sky-overlay-pass.js';
import { setWingVaporOwner } from './aircraft-effects.js';
import { cinematicEarthOn } from './cinematic-earth.js';
import { isPhoneClass } from './device-class.js';
import { readReducedMotion } from './immersive.js';
import { useFlyStore } from '../../stores/fly-store.js';

/** The rig PlayerPlane poses (matrixAutoUpdate off), found above the model. */
function findRig(flight, from) {
  if (flight.playerRig) return flight.playerRig;
  for (let o = from; o; o = o.parent) if (o.matrixAutoUpdate === false) return o;
  return null;
}

/**
 * root: the per-mount GLB clone; correction: computeModelCorrection (its
 * scale is metres per GLB unit); anchors: measureAircraftAnchors; entry: the
 * presentation entry (canopyMaterial).
 */
export function mountLivingAirframe({ flight, aircraft, entry, root, correction, anchors }) {
  if (!AIRFRAME_DETAIL_ON && !VAPOR_FX_ON) return null;
  if (!root || !cinematicEarthOn()) return null;
  const outer = root.parent?.parent ?? null; // PlayerModel's group: the corrected frame
  const mpu = correction?.scale ?? 1;
  const phone = isPhoneClass();
  const canopyMaterial = entry?.canopyMaterial ?? aircraft?.entry?.canopyMaterial ?? null;
  // The running-light fix runs on every tier: it is a fix, not a cost.
  const lights = AIRFRAME_DETAIL_ON && outer ? finishRunningLights(outer.children.filter((o) => o.isPoints), registerSkyOverlay, root) : null;
  const detail = AIRFRAME_DETAIL_ON && airframeDetailAllowed()
    ? applyAirframeDetail(root, aircraft.id, { metresPerUnit: mpu, mode: 'flight', canopyMaterial })
    : null;
  const discOffs = (detail?.discs ?? []).map((d) => registerSkyOverlay(d.mesh));
  const rig = findRig(flight, outer);
  const vapor = VAPOR_FX_ON && !phone && outer && rig
    ? createVaporFx({
        root,
        outer,
        survey: detail?.survey ?? surveyAirframe(root, { canopyMaterial }),
        mpu,
        anchors,
        rig,
        register: registerSkyOverlay,
        aircraftId: aircraft.id,
      })
    : null;
  let vaporLive = false;
  const releaseTips = vapor ? setWingVaporOwner(() => vaporLive) : null;
  const report = () => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
    const stats = (window.__flyStats ??= {});
    stats.livingAirframe = { ...(detail?.stats ?? { aircraft: aircraft.id }), lights: lights?.count ?? 0, lightsSeated: lights?.seated ?? 0, vapor: !!vapor };
  };
  report();

  const api = {
    detail,
    vapor,
    lights,
    update(state, dt) {
      const store = useFlyStore.getState();
      const held = store.phase === 'paused' || store.cameraMode === 'photo' || (typeof document !== 'undefined' && document.hidden);
      lights?.update();
      detail?.update(dt, held || readReducedMotion());
      if (vapor) {
        const allowed = store.qualityTier !== 'low' && cinematicEarthOn(store);
        vapor.update(flight, state.camera, dt, { allowed, held });
        vaporLive = allowed;
        if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') (window.__flyStats ??= {}).livingVapor = vapor.stats;
      }
    },
    dispose() {
      releaseTips?.();
      vapor?.dispose();
      for (const off of discOffs) off();
      detail?.dispose();
      lights?.dispose();
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        if (window.__flyStats) {
          delete window.__flyStats.livingAirframe;
          delete window.__flyStats.livingVapor;
        }
        if (window.__flyLivingAirframe === api) delete window.__flyLivingAirframe;
      }
    },
  };
  // Dev-only probe handle (the __flyPlayer idiom): the motion harness reads it.
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') window.__flyLivingAirframe = api;
  return api;
}

'use client';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AIRFIELD } from '@/lib/fly/observation-config';
import { AirfieldGroundSet } from '@/lib/fly/airfield/airfield-ground';

/**
 * AIRFIELD GROUND — the observed airport's surfaces and lights: real OSM
 * pavement (asphalt runways with their markings, concrete aprons, taxiways
 * with fillets, centrelines, edge lines and holding positions), infield grass,
 * and the airfield lighting system (edge, threshold/end, centreline, touchdown
 * zone, approach lights with sequenced flashers, PAPI, taxiway edge/centre,
 * stop bars, guard lights). Owner: AIRFIELD-GROUND (FLY_OBSERVATION_LOUNGE.md).
 *
 * Mounted inside worldRoot by ObservationWorld (keyed on the airport, so a new
 * airport is a fresh set). Everything lives in lib/fly/airfield/; this
 * component only owns the lifetime: create on mount, the sky-overlay
 * registration of the light sets, the per-frame update, dispose on unmount.
 * While the set is ready it publishes `runtime.airfieldGround` (heights, the
 * OSM facts and the airport model for the other lounge workstreams) and takes
 * over the observed airport's ground from the older layers
 * (lib/fly/airfield/airfield-suppression.js). It also registers the engine's
 * ground provider, so `engine.getGroundAt` answers the drawn surface wherever
 * this set draws (with the zoom of the terrain it was built from).
 */
export function AirfieldGround({ runtime }) {
  const parent = useRef(null);
  const set = useRef(null);
  // The engine our ground provider is registered with, and its unregister.
  const provider = useRef({ engine: null, off: null });
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const site = runtime.airportWatch?.site;
    if (!AIRFIELD.ground.enabled || !site || !parent.current) return undefined;
    const ground = new AirfieldGroundSet({ runtime, site, anisotropy: Math.min(16, gl.capabilities.getMaxAnisotropy?.() ?? 8) });
    parent.current.add(ground.group);
    set.current = ground;
    if (process.env.NODE_ENV === 'development') window.__airfieldGround = ground; // harness introspection
    const unregister = ground.overlays();
    runtime.airfieldGround = {
      ident: site.ident,
      get ready() {
        return ground.state === 'ready';
      },
      /** Bumps whenever the drawn surface moves (re-sample surfaceY then). */
      get version() {
        return ground.heights?.version ?? 0;
      },
      /** The merged OSM facts (scene coordinates), once loaded. */
      get features() {
        return ground.data ?? null;
      },
      /** Runways, taxiways, holds, fillets, polygons in local metres + frame. */
      get model() {
        return ground.model ?? null;
      },
      /** Drawn surface height at a SCENE point ('grass' | 'pavement' | 'runway' | 'paint'), or null. */
      surfaceY: (x, z, layer) => ground.surfaceY(x, z, layer),
      lift: AIRFIELD.ground.lift,
      stats: ground.stats,
    };
    return () => {
      unregister();
      provider.current.off?.();
      provider.current = { engine: null, off: null };
      ground.dispose();
      if (set.current === ground) set.current = null;
      if (process.env.NODE_ENV === 'development' && window.__airfieldGround === ground) delete window.__airfieldGround;
      if (runtime.airfieldGround?.stats === ground.stats) delete runtime.airfieldGround;
    };
  }, [runtime, gl]);

  useFrame((state) => {
    const ground = set.current;
    if (!ground) return;
    // Engine ground queries inside the airfield answer the drawn surface
    // (AirfieldGroundSet.groundAt); re-registered if the engine is replaced.
    const engine = runtime.engine;
    if (engine?.setGroundProvider && provider.current.engine !== engine) {
      provider.current.off?.();
      provider.current = { engine, off: engine.setGroundProvider((x, z) => ground.groundAt(x, z)) };
    }
    ground.update(state, state.clock.elapsedTime);
    if (typeof window !== 'undefined' && window.__flyStats) window.__flyStats.airfieldGround = ground.stats;
  }, -39);

  return <group ref={parent} name="airfield-ground-root" />;
}

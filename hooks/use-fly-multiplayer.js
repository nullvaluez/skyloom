'use client';

import { useEffect } from 'react';
import { mpAvailable } from '@/lib/fly/mp/mp-flag';

/**
 * MULTIPLAYER (MULTIPLAYER.md): mount the shared-sky session for the life of
 * the Fly session. With the flag off or no relay URL this is a no-op — the
 * session module is never even loaded (dynamic import behind mpAvailable()).
 */
export function useFlyMultiplayer(runtime) {
  useEffect(() => {
    if (!runtime || !mpAvailable()) return undefined;
    let release = null;
    let dead = false;
    import('@/lib/fly/mp/session')
      .then((m) => {
        if (!dead) release = m.connectMultiplayer(runtime);
      })
      .catch((err) => console.warn('[fly-mp] session failed to load:', err));
    return () => {
      dead = true;
      release?.();
    };
  }, [runtime]);
}

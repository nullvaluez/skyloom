/**
 * A returning page can still be controlled by the old shell while /sw.js is
 * updating. Do this BEFORE FlyMode mounts any dedicated workers: updating the
 * shell afterwards cannot repair a worker that already booted the wrong API.
 * Keep this module independent of the flag registry (page.js installs pins).
 */
export function askShellWorker(worker, type, timeoutMs = 2000) {
  if (!worker || typeof MessageChannel !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (value) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event) => finish(event.data);
    try {
      worker.postMessage({ type }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

/** Never reload, touch saves/provider caches, or register a shell on a fresh visit. */
export async function prepareSceneryWorkers() {
  try {
    const sw = globalThis.navigator?.serviceWorker;
    const controller = sw?.controller;
    if (!controller || new URL(controller.scriptURL).pathname !== '/sw.js') return 'uncontrolled';
    const policy = await askShellWorker(controller, 'worker-cache-policy');
    if (policy?.workerBootstrap === 'network-only') return 'safe';

    // v1 caches fragment-configured bootstraps. v2 fixes future requests but
    // has no readiness handshake. Both understand retire and acknowledge only
    // AFTER disabling their fetch handler and clearing their own shell cache.
    // Merely unregistering is insufficient: it still controls this document.
    const retired = await askShellWorker(controller, 'retire');
    if (retired !== 'retired') return 'unavailable';
    const registrations = await sw.getRegistrations();
    for (const registration of registrations) {
      // An update may have activated during the handshake; never unregister it.
      if (registration.active === controller) await registration.unregister();
    }
    return 'retired-legacy';
  } catch {
    // Restricted storage/service-worker access must not strand the title.
    return 'unavailable';
  }
}

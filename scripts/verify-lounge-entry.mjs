// Real watch lifecycle with controlled no-data airfield loads. No browser,
// network imagery, timers-as-readiness, or fabricated airport geometry needed.
// Run: node scripts/verify-lounge-entry.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = new URL('../' + specifier.slice(2), import.meta.url).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (fs.existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });

const { Vector3, PerspectiveCamera } = await import('three');
const { connectAirportWatch } = await import('../lib/fly/airport-watch-runtime.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { clearSessionSites, storedSeat } = await import('../lib/fly/lounge-site.js');
const registry = await import('../lib/fly/operations-airports.js');
const catalog = await import('../lib/fly/runway-catalog.js');
const root = new URL('../public/', import.meta.url);
const saved = new Map();
globalThis.localStorage = { setItem: (k, v) => saved.set(k, v), getItem: (k) => saved.get(k) };
globalThis.fetch = async (url) => {
  assert.ok(String(url).startsWith('/data/runways/v1/'), `unexpected network request: ${url}`);
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(new URL(String(url).slice(1), root), 'utf8')) };
};
globalThis.window = { location: { search: '?graphicsReview=1&airports=on' }, matchMedia: () => ({ matches: false }) };

// setImmediate drains the real promise continuations; it does not advance a
// timeout to claim readiness. The controlled loader is resolved explicitly.
const drain = () => new Promise((resolve) => setImmediate(resolve));
let checks = 0;
const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };

function harness() {
  assert.equal(catalog.protectedRunwayIdents().size, 0, 'previous watch released every registry role');
  clearSessionSites();
  useFlyStore.setState({ airportBrowserOpen: false, airportWatch: null, airportReturn: null });
  const loads = [];
  const flight = { pos: new Vector3(), cfg: { speeds: { slow: 60, boost: 300 } }, heading: 0, speed: 100, pitch: 0, bank: 0 };
  const runtime = {
    flight,
    engine: {
      worldToGeo: (p) => new Vector3(p.x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(-p.z / 6378137)) - Math.PI / 2) * 180 / Math.PI, p.y),
      getGroundAt: () => ({ tileZ: 18, elev: 250 }),
    },
    traffic: { tracks: new Map(), items: [] },
    targeting: { lockedHex: null },
    input: { neutralize() {}, keys: new Set() },
    adventures: { suspend() {} },
    warpToGeo(lat, lon, { altM, headingRad = 0 }) {
      const p = registry.projectAirportPoint(lon, lat);
      flight.pos.set(p.x, altM, p.z); flight.heading = headingRad; return true;
    },
  };
  const disconnect = connectAirportWatch(runtime, {
    loadAirfield(airport) {
      return new Promise((resolve) => loads.push({ ident: airport.ident || airport.id.split(':')[0], resolve }));
    },
  });
  const watch = runtime.airportWatch;
  let disposed = false;
  const dispose = () => { if (!disposed) { disconnect(); disposed = true; } };
  const load = (ident) => {
    const pending = loads.find((entry) => entry.ident === ident && !entry.resolved);
    assert.ok(pending, `${ident}: real entry requested the injected airfield loader`);
    return pending;
  };
  const resolve = async (pending) => { pending.resolved = true; pending.resolve(null); await drain(); };
  const begin = async (ident = 'NZQN', { picker = true } = {}) => {
    if (picker) useFlyStore.setState({ airportBrowserOpen: true });
    assert.equal(await watch.enter(ident), true);
    assert.equal(watch.site.ident, ident);
    assert.equal(storedSeat(watch.airport), null, 'exercise runtime/fallback placement rather than an existing table seat');
    assert.equal(watch.seatPending, true, 'entry awaits controlled airfield data');
    return load(ident);
  };
  const validate = () => {
    watch.updateCamera(0, new PerspectiveCamera(50, 16 / 9, 2.5, 600000));
    assert.equal(watch.validated, true, 'no-data fallback releases the ordinary terrain-validation path');
  };
  const cleanup = async () => {
    dispose();
    for (const pending of loads) if (!pending.resolved) { pending.resolved = true; pending.resolve(null); }
    await drain();
    assert.equal(catalog.protectedRunwayIdents().size, 0, 'cleanup released observation and pending-entry roles');
  };
  return { runtime, watch, begin, resolve, validate, dispose, cleanup };
}

await check('picker self-dismiss preserves the committed NZQN seat refinement and terrain validation', async () => {
  const h = harness();
  try {
    const pending = await h.begin();
    assert.equal(useFlyStore.getState().airportBrowserOpen, false, 'successful entry dismisses its picker');
    assert.equal(h.watch.validated, false);
    await h.resolve(pending);
    assert.equal(h.watch.seatPending, false, 'the picker must not cancel its own refinement');
    h.validate();
    assert.deepEqual([...catalog.protectedRunwayIdents()], ['NZQN']);
  } finally { await h.cleanup(); }
});

await check('reopening and manually closing the picker does not strand an active refinement', async () => {
  const h = harness();
  try {
    const pending = await h.begin();
    useFlyStore.setState({ airportBrowserOpen: true });
    useFlyStore.setState({ airportBrowserOpen: false }); // FlyMode Escape closes through the store alone.
    assert.equal(h.watch.seatPending, true);
    useFlyStore.setState({ airportBrowserOpen: true });
    h.watch.cancelPending(); // AirportBrowser.close cancels pending entries.
    useFlyStore.setState({ airportBrowserOpen: false });
    assert.equal(h.watch.seatPending, true);
    await h.resolve(pending);
    assert.equal(h.watch.seatPending, false);
    h.validate();
    assert.equal(h.watch.site.ident, 'NZQN');
  } finally { await h.cleanup(); }
});

await check('programmatic entry with an already-closed picker uses the same refinement lifecycle', async () => {
  const h = harness();
  try {
    const pending = await h.begin('NZQN', { picker: false });
    assert.equal(useFlyStore.getState().airportBrowserOpen, false);
    await h.resolve(pending);
    assert.equal(h.watch.seatPending, false);
    h.validate();
  } finally { await h.cleanup(); }
});

await check('a cancelled newer entry preserves the current airport and its in-flight refinement', async () => {
  const h = harness();
  try {
    const pending = await h.begin();
    const site = h.watch.site, position = h.runtime.flight.pos.clone();
    useFlyStore.setState({ airportBrowserOpen: true });
    const newer = h.watch.enter('NZCH');
    h.watch.cancelPending();
    useFlyStore.setState({ airportBrowserOpen: false });
    assert.equal(await newer, false);
    assert.equal(h.watch.site, site);
    assert.equal(h.runtime.flight.pos.distanceTo(position), 0);
    assert.equal(h.watch.seatPending, true);
    assert.deepEqual([...catalog.protectedRunwayIdents()], ['NZQN']);
    await h.resolve(pending);
    assert.equal(h.watch.seatPending, false);
    h.validate();
  } finally { await h.cleanup(); }
});

await check('an unavailable newer airport leaves the existing refinement able to finish', async () => {
  const h = harness();
  try {
    const pending = await h.begin();
    const site = h.watch.site;
    await assert.rejects(h.watch.enter('NOT-A-REAL-AIRPORT'), /not available/);
    assert.equal(h.watch.site, site);
    assert.equal(h.watch.seatPending, true);
    assert.deepEqual([...catalog.protectedRunwayIdents()], ['NZQN']);
    await h.resolve(pending);
    assert.equal(h.watch.seatPending, false);
    h.validate();
  } finally { await h.cleanup(); }
});

await check('a rejected stored-seat warp preserves the old lounge pending state until its load finishes', async () => {
  const h = harness();
  try {
    const pending = await h.begin();
    const site = h.watch.site, position = h.runtime.flight.pos.clone();
    const originalWarp = h.runtime.warpToGeo;
    h.runtime.warpToGeo = () => false;
    try { await assert.rejects(h.watch.enter('KCMH'), /not ready for an airport transfer/); }
    finally { h.runtime.warpToGeo = originalWarp; }
    assert.equal(h.watch.site, site);
    assert.equal(h.runtime.flight.pos.distanceTo(position), 0);
    assert.equal(h.watch.seatPending, true, 'failed placement must restore the old lounge pending state');
    assert.equal(h.watch.validated, false);
    assert.deepEqual([...catalog.protectedRunwayIdents()], ['NZQN']);
    await h.resolve(pending);
    assert.equal(h.watch.seatPending, false);
    assert.equal(h.watch.site.ident, 'NZQN');
    h.validate();
  } finally { await h.cleanup(); }
});

await check('a newer successful airport prevents old refinement from clearing or moving its pending seat', async () => {
  const h = harness();
  try {
    const older = await h.begin('NZQN');
    const newer = await h.begin('NZCH');
    const site = h.watch.site, epoch = h.watch.siteEpoch, position = h.runtime.flight.pos.clone();
    assert.deepEqual([...catalog.protectedRunwayIdents()], ['NZCH']);
    await h.resolve(older);
    assert.equal(h.watch.site, site);
    assert.equal(h.watch.siteEpoch, epoch);
    assert.equal(h.runtime.flight.pos.distanceTo(position), 0);
    assert.equal(h.watch.seatPending, true, 'old completion must not reveal the newer pending lounge');
    assert.notEqual(h.watch.seatChoice?.ident, 'NZQN', 'retired choices must not overwrite active diagnostics');
    await h.resolve(newer);
    assert.equal(h.watch.seatPending, false);
    assert.equal(h.watch.site.ident, 'NZCH');
    assert.equal(h.watch.seatChoice.ident, 'NZCH');
    h.validate();
  } finally { await h.cleanup(); }
});

await check('leave retires deferred refinement and releases every runway protection role', async () => {
  const h = harness();
  try {
    const pending = await h.begin();
    h.watch.leave();
    const site = h.watch.site, epoch = h.watch.siteEpoch;
    assert.equal(h.watch.active, false);
    assert.equal(h.watch.seatPending, false);
    assert.equal(catalog.protectedRunwayIdents().size, 0);
    await h.resolve(pending);
    assert.equal(h.watch.active, false);
    assert.equal(h.watch.seatPending, false);
    assert.equal(h.watch.site, site);
    assert.equal(h.watch.siteEpoch, epoch);
    assert.equal(useFlyStore.getState().airportWatch, null);
  } finally { await h.cleanup(); }
});

await check('disposal retires deferred refinement and does not resurrect runtime or store state', async () => {
  const h = harness();
  try {
    const pending = await h.begin();
    h.dispose();
    assert.equal(h.runtime.airportWatch, undefined);
    assert.equal(h.watch.active, false);
    assert.equal(catalog.protectedRunwayIdents().size, 0);
    await h.resolve(pending);
    assert.equal(h.watch.active, false);
    assert.equal(h.watch.seatPending, false);
    assert.equal(h.runtime.airportWatch, undefined);
    assert.equal(useFlyStore.getState().airportWatch, null);
  } finally { await h.cleanup(); }
});

delete globalThis.window;
console.log(`LOUNGE ENTRY: ${checks}/${checks}; real runtime, registry, store and no-data fallback`);

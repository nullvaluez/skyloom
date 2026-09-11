/** Real hook logic under deterministic browser-history and React-effect fixtures. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../hooks/use-overlay-back.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export function /g, 'function ');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
function fixture() {
  const effects = [], refs = [], queued = [], listeners = new Set(), subscribers = new Set();
  const entries = [{ app: 'preserved', __NA: true }];
  let index = 0, cursor = 0, refCursor = 0, surface = null;
  const store = { phase: 'flying', cameraMode: 'chase', inspectHex: null, atlasOpen: false,
    logbookOpen: false, hangarOpen: false, creditsOpen: false };
  const patch = (delta) => {
    Object.assign(store, delta);
    for (const sub of subscribers) {
      const next = sub.select(store);
      if (next !== sub.value) { sub.value = next; sub.callback(next); }
    }
  };
  for (const [setter, field] of [['setPhase','phase'], ['setCameraMode','cameraMode'], ['setInspectHex','inspectHex'],
    ['setAtlasOpen','atlasOpen'], ['setLogbookOpen','logbookOpen'], ['setHangarOpen','hangarOpen']]) store[setter] = (value) => patch({ [field]: value });
  store.closeCredits = () => patch({ creditsOpen: false });
  const history = {
    get state() { return entries[index]; },
    pushState(value) { entries.splice(index + 1); entries.push(value); index++; },
    back() { queued.push(() => { if (index > 0) index--; for (const listener of [...listeners]) listener(); }); },
  };
  const api = vm.runInNewContext(`${source}\n({useOverlayBack, anyOverlayOpen, escapeStep})`, {
    window: { history, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) },
    useRef: (initial) => { const i = refCursor++; return refs[i] ??= { current: initial }; },
    useEffect: (fn, deps) => {
      const i = cursor++, previous = effects[i];
      if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) {
        effects[i] = { deps, fn, cleanup: previous?.cleanup, dirty: true };
      }
    },
    useFlyStore: { getState: () => store, subscribe: (select, callback) => {
      const sub = { select, callback, value: select(store) }; subscribers.add(sub); return () => subscribers.delete(sub);
    } },
  });
  const close = () => { surface = null; render(); };
  const read = () => surface !== null;
  function render() {
    cursor = 0; refCursor = 0;
    api.useOverlayBack(true, !!surface, close, read);
    for (const effect of effects) if (effect.dirty) {
      effect.cleanup?.(); effect.dirty = false; effect.cleanup = effect.fn();
    }
  }
  render();
  return { api, store, patch, history, entries, get index() { return index; }, get surface() { return surface; },
    open: () => { surface = 'actions'; render(); }, close,
    flush: () => { let limit = 20; while (queued.length && limit--) queued.shift()(); assert.ok(limit > 0, 'history converges'); },
    unmount: () => effects.forEach((effect) => effect.cleanup?.()),
  };
}
check('Pause arms Back and resumes without navigation', () => {
  const f = fixture(); f.patch({ phase: 'paused' }); assert.equal(f.index, 1);
  f.history.back(); f.flush(); assert.equal(f.store.phase, 'flying'); assert.equal(f.index, 0);
});
check('Panel open pushes one sentinel and preserves router state', () => {
  const f = fixture(); f.open(); f.open(); assert.equal(f.index, 1); assert.equal(f.history.state.__NA, true);
  assert.equal(f.history.state.app, 'preserved'); f.history.back(); f.flush(); assert.equal(f.surface, null); assert.equal(f.index, 0);
});
check('Programmatic close cannot close a rapidly reopened panel', () => {
  const f = fixture(); f.open(); f.close(); f.open(); f.flush(); assert.equal(f.surface, 'actions'); assert.equal(f.index, 1);
  f.close(); f.flush(); assert.equal(f.index, 0);
});
check('Panel to Atlas transfer consumes no extra history entry', () => {
  const f = fixture(); f.open(); f.close(); f.patch({ atlasOpen: true }); f.flush(); assert.equal(f.index, 1);
  f.history.back(); f.flush(); assert.equal(f.store.atlasOpen, false); assert.equal(f.index, 0);
});
check('Nested credits close before paused game resumes', () => {
  const f = fixture(); f.patch({ phase: 'paused', creditsOpen: true });
  f.history.back(); f.flush(); assert.equal(f.store.creditsOpen, false); assert.equal(f.store.phase, 'paused'); assert.equal(f.index, 1);
  f.history.back(); f.flush(); assert.equal(f.store.phase, 'flying'); assert.equal(f.index, 0);
});
check('Inspect closes before photo, Atlas, Logbook, and Hangar', () => {
  const f = fixture(); f.patch({ inspectHex: 'abc123', cameraMode: 'photo', atlasOpen: true, logbookOpen: true, hangarOpen: true });
  for (const [key, value] of [['inspectHex', null], ['cameraMode', 'chase'], ['atlasOpen', false], ['logbookOpen', false], ['hangarOpen', false]]) {
    f.history.back(); f.flush(); assert.equal(f.store[key], value);
  }
  assert.equal(f.index, 0);
});
check('Unmount removes only its sentinel', () => {
  const f = fixture(); f.open(); f.unmount(); f.flush(); assert.equal(f.index, 0); assert.equal(f.history.state.app, 'preserved');
});
check('A newer router state is not consumed on close', () => {
  const f = fixture(); f.open(); f.history.pushState({ route: 'next' }); f.close(); f.flush(); assert.equal(f.history.state.route, 'next');
});
console.log(`${passed}/${passed} PASS`);

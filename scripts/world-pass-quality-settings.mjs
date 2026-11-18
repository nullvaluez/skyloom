/** Manual quality feedback and per-page geometry contract. Node/SSR only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import vm from 'node:vm';
register('./_node-resolve.mjs', import.meta.url);
const W = await import('../lib/fly/world-pass.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const settings = await import('../lib/fly/fly-settings.js');
const require = createRequire(import.meta.url), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');
const originalWindow = globalThis.window, originalState = { ...useFlyStore.getState() }, originalInitial = { ...useFlyStore.getInitialState() };
let passes = 0, glass = true;
const check = (name, test) => { test(); passes++; console.log(`PASS ${name}`); };
function page(preset, { mobile = false, off = false, forced } = {}) {
  const values = new Map([[settings.QUALITY_TIER_KEY, preset]]);
  globalThis.window = { matchMedia: () => ({ matches: false }), location: { search: '' },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    __flyWorldPassTierOverride: { mobile, ...(forced === undefined ? {} : { enabled: forced }) },
    ...(off ? Object.fromEntries(['Truth', 'Arrival', 'Reach', 'Look', 'Ground'].map(name => [`__flyWorld${name}Override`, { enabled: false }])) : {}),
  };
  W.__resetWorldPassLatchForTests();
  useFlyStore.getState().setQualityPreset(preset);
}

// Render the real SettingsRows JSX. Unrelated controls are inert substitutes;
// the quality store, persistence methods and World Pass reader are the app's.
const empty = () => null, no = () => false;
const modules = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@/stores/fly-store': { useFlyStore }, '@/lib/fly/world-pass': W, '@/lib/fly/fly-settings': settings,
  '@/lib/fly/pilot-seat': await import('../lib/fly/pilot-seat.js'),
  '@/hooks/use-is-touch': {useIsTouch: no},
  '@/lib/fly/player-surface': { reviewSurfaceOn: no }, '@/lib/fly/map-style': { MAP_STYLES: [] },
  '@/lib/fly/fly-constants': { CRASH: { enabled: false } },
  '@/lib/fly/challenge': { challengeLayerOn: no, challengeOn: no },
  '@/lib/fly/immersive': { immersiveOn: no, readReducedMotion: no },
  '@/lib/fly/visuals-profile': { visualsAvailable: no }, './GuestSaveControls': { GuestSaveControls: empty },
  './ConditionsPanel': { ConditionsPanel: empty }, '@/lib/fly/player-conditions': { conditionsOn: no },
  './FlightComfortSettings': { FlightComfortSettings: empty },
  './LivingGlass': { get GLASS_ON() { return glass; }, GlassToggle: empty,
    GlassField: ({ children, note }) => React.createElement('div', null, children, note && React.createElement('p', null, note)) },
  './calm-hud': { CALM: false, HUD_MODES: [] },
  '@/lib/fly/frame-api': { frameCadence: () => '60', subscribeFrameCadence: () => () => {} },
  '@/lib/fly/ship-pass': { shipPassOn: no }, '@/lib/fly/device-policy': { deviceFeature: () => ({ allowed: false }) },
};
const source = readFileSync(new URL('../components/fly/hud/SettingsRows.jsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { fileName: 'SettingsRows.jsx', compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const component = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(name => {
  if (!(name in modules)) throw Error(`Unexpected SettingsRows dependency: ${name}`);
  return modules[name];
}, component, component.exports);
function render() {
  Object.assign(useFlyStore.getInitialState(), useFlyStore.getState());
  return renderToStaticMarkup(React.createElement(component.exports.SettingsRows, { sheet: true, includeConditions: false }));
}
const reloadNote = 'World detail updates the next time you load Skyloom.';
try {
  page('high');
  check('settings cannot latch the world before the engines', () => {
    assert.equal(W.worldPassPresetNeedsReload('medium'), false); render(); assert.equal(W.worldPassState(), null);
  });
  const high = W.worldPassRequest();
  check('High to Medium needs a new load, and returning to High clears it', () => {
    useFlyStore.getState().setQualityPreset('medium'); assert.equal(W.worldPassPresetNeedsReload('medium'), true);
    useFlyStore.getState().setQualityPreset('high'); assert.equal(W.worldPassPresetNeedsReload('high'), false);
    assert.equal(W.worldPassRequest(), high);
  });
  check('High and Ultra have distinct world detail', () => assert.equal(W.worldPassPresetNeedsReload('ultra'), true));
  check('governor changes neither the selected preset nor world identity', () => {
    useFlyStore.getState().setQualityTier('low'); assert.equal(W.worldPassPresetNeedsReload('high'), false);
    assert.equal(W.worldPassRequest(), high); assert.equal(useFlyStore.getState().qualityPreset, 'high');
  });
  for (const style of [true, false]) {
    glass = style;
    check(`${style ? 'glass' : 'legacy'} settings show the selected preset and pending world detail`, () => {
      useFlyStore.getState().setQualityPreset('medium'); settings.saveQualityTier('medium'); useFlyStore.getState().setQualityTier('low');
      const html = render(); assert(html.includes(reloadNote));
      assert.match(html, /data-testid="settings-quality-medium"[^>]*aria-pressed="true"/);
      assert.match(html, /data-testid="settings-quality-low"[^>]*aria-pressed="false"/);
      useFlyStore.getState().setQualityPreset('high'); settings.saveQualityTier('high'); assert(!render().includes(reloadNote));
    });
    check(`${style ? 'glass' : 'legacy'} denied storage never promises a persisted world change`, () => {
      const storage = window.localStorage;
      window.localStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
      useFlyStore.getState().setQualityPreset('medium'); settings.saveQualityTier('medium');
      const html = render(); assert(!html.includes(reloadNote)); assert(html.includes('World detail stays unchanged.'));
      assert(html.includes('couldn’t save your quality choice.')); assert.equal(W.worldPassRequest(), high);
      window.localStorage = storage;
    });
  }
  page('low'); W.worldPassRequest();
  check('Low and Medium share world detail; High differs', () => {
    assert.equal(W.worldPassPresetNeedsReload('medium'), false); assert.equal(W.worldPassPresetNeedsReload('high'), true);
  });
  for (const options of [{ mobile: true }, { off: true }, { forced: false }]) {
    page('high', options); W.worldPassRequest();
    check(`no reload notice for unchanged all-off world ${JSON.stringify(options)}`, () => {
      for (const preset of ['low', 'medium', 'high', 'ultra']) assert.equal(W.worldPassPresetNeedsReload(preset), false);
    });
  }
  page('high', { forced: true }); const forced = W.worldPassRequest();
  check('explicit tier pin remains authoritative without mutating the latch', () => {
    assert.equal(W.worldPassPresetNeedsReload('medium'), false); assert.equal(W.worldPassPresetNeedsReload('ultra'), true);
    assert.equal(W.worldPassRequest(), forced);
  });
} finally {
  W.__resetWorldPassLatchForTests(); useFlyStore.setState(originalState); Object.assign(useFlyStore.getInitialState(), originalInitial);
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
}
console.log(`PASS ${passes} quality settings gates (no GPU)`);

// FAMILY UI BEAT (edit 38.0-42.0). Same scene as clouds-family's approach, as
// the player sees it: lock reticle and callsign label on NVA184 and the
// InfoCard (787-9, LAX -> JFK). Full-page screenshots in loop mode.
const { hideChrome } = require('./_ui.cjs');
const fam = require('./clouds-family.cjs');
module.exports = {
  ...fam,
  id: 'clouds-family-ui',
  frames: 135, runIn: 45,
  stepMode: 'loop',
  // the player's own view: the game's native chase camera, not the scripted one
  pageArgs: { nativeCamera: true },
  actions: [
    { at: -40, name: 'hide chrome', run: hideChrome },
    { at: -18, name: 'intercept (lock)', run: async (page, log) => { const r = await page.evaluate(() => { const ok = window.__fly.interceptHex('a4f2c1'); return { ok, tracks: window.__fly.traffic.tracks.size, lock: window.__flyStore.getState().lockState }; }); log && log('intercept ->', JSON.stringify(r)); } },
    { at: 60, name: 'lock state', run: async (page, log) => { log && log('lock', await page.evaluate(() => window.__flyStore.getState().lockState)); } },
  ],
};

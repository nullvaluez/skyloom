// WARP (edit 60.0-63.5). The Atlas world screen over New York at night: type
// "Paris", results appear, Enter -> the warp begins. Captured as full-page
// screenshots (GL + DOM) in loop mode.
const { hideChrome } = require('./_ui.cjs');
const night = require('./nyc-night.cjs');
const type = (ch) => async (page) => { await page.keyboard.type(ch); };
module.exports = {
  ...night,
  id: 'atlas-ui',
  frames: 120, runIn: 20,
  stepMode: 'loop',
  actions: [
    { at: -18, name: 'hide chrome', run: hideChrome },
    { at: 2, name: 'open atlas', run: async (page) => { await page.evaluate(() => window.__flyStore.getState().setAtlasOpen(true)); } },
    { at: 22, name: 'focus', run: async (page) => { await page.evaluate(() => { const i = document.querySelector('[data-testid="atlas-search"]'); i && i.focus(); }); } },
    { at: 26, run: type('P') }, { at: 31, run: type('a') }, { at: 36, run: type('r') }, { at: 40, run: type('i') }, { at: 45, run: type('s') },
    { at: 88, name: 'enter', run: async (page) => { await page.keyboard.press('Enter'); } },
  ],
};

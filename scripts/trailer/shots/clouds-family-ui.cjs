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
  actions: [
    { at: -40, name: 'hide chrome', run: hideChrome },
    { at: -30, name: 'intercept (lock)', run: async (page) => { await page.evaluate(() => window.__fly.interceptHex('a4f2c1')); } },
  ],
};

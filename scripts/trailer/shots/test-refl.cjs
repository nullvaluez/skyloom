const hero = require('./nyc-hero.cjs');
module.exports = { ...hero, id: 'test-refl', frames: 3, runIn: 10, settle: { maxSec: 400, minSec: 20, streamSec: 60 },
  page: function () {
    (HERO)();
    const cr = window.__fly.coastalReflection;
    window.__reflInfo = cr ? Object.keys(cr).join(',') : 'none';
    if (cr) { cr.update = function () { this.release && this.release(); }; cr.release && cr.release(); }
  }.toString().replace('(HERO)', '(' + hero.page.toString() + ')') };

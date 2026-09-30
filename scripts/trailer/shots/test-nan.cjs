const base = require('./test-debug2.cjs');
module.exports = { ...base, id: 'test-nan', frames: 13,
  afterPause: () => { window.__nanscan = null; },
  beforeRig: () => {
    const c = window.__flyComposer;
    for (const pass of c.passes) {
      const original = pass.render.bind(pass); let data;
      pass.render = function (renderer, input, output, ...rest) {
        original(renderer, input, output, ...rest);
        if (this.renderToScreen) return;
        const target = this.needsSwap ? output : input;
        if (!target || !target.texture || target.texture.type !== 1016) return;
        const n = target.width * target.height * 4;
        data = data && data.length === n ? data : new Uint16Array(n);
        renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data);
        let invalid = 0; for (let i = 0; i < n; i++) if ((data[i] & 0x7c00) === 0x7c00) invalid++;
        (window.__nanscanCur ||= []).push({ name: this.name + (this.effects ? '[' + this.effects.map((e) => e.name.replace('Effect', '')).join(',') + ']' : ''), invalid });
      };
    }
    const r = c.render.bind(c);
    c.render = function (dt) { window.__nanscanCur = []; r(dt); window.__nanscan = window.__nanscanCur; };
  },
};

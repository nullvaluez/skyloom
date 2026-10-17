/* Browser-init diagnostic only. No application code imports this file. */
function installLoungeWebGLProbe() {
  const trace = window.__loungeWebGL = { totals: {}, slow: [], programs: {}, frameGaps: [], marks: [], dropped: 0 };
  const programIds = new WeakMap(), shaderSources = new WeakMap();
  let serial = 0, last = performance.now(), sourceBytes = 0;
  const hash = (source) => {
    let value = 2166136261;
    for (let i = 0; i < source.length; i++) value = Math.imul(value ^ source.charCodeAt(i), 16777619);
    return (value >>> 0).toString(16).padStart(8, '0');
  };
  const program = (object) => {
    if (!object || typeof object !== 'object') return null;
    if (!programIds.has(object)) {
      const id = ++serial;
      programIds.set(object, id);
      trace.programs[id] = { id, shaders: [], linkedAt: null, deleted: false };
    }
    return trace.programs[programIds.get(object)];
  };
  const record = (method, start, detail) => {
    const ms = performance.now() - start;
    const total = trace.totals[method] ??= { count: 0, ms: 0, maxMs: 0 };
    total.count++;
    total.ms += ms;
    total.maxMs = Math.max(total.maxMs, ms);
    if (ms >= 20) {
      if (trace.slow.length < 2000) trace.slow.push({ method, at: start, ms, ...detail, phase: trace.phase ?? 'boot' });
      else trace.dropped++;
    }
  };
  // Source and attachment bookkeeping happens only at compilation, never at
  // draw time. Readiness checks are untouched: this must not change link timing.
  for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!ctor) continue;
    const proto = ctor.prototype;
    const source = proto.shaderSource;
    proto.shaderSource = function (shader, text) {
      trace.context ??= this;
      // Limit retained source to 16 MiB. Names, hashes and compile parameters
      // survive the cap, so a long soak cannot grow an unbounded shader log.
      const retained = text.slice(0, Math.min(160000, Math.max(0, (16 * 1024 * 1024 - sourceBytes) / 2)));
      sourceBytes += retained.length * 2;
      shaderSources.set(shader, { hash: hash(text), name: text.match(/^#define SHADER_NAME[ \t]+([^\r\n]*)/m)?.[1]?.trim() || null, source: retained, sourceTruncated: retained.length !== text.length });
      return source.call(this, shader, text);
    };
    const attach = proto.attachShader;
    proto.attachShader = function (object, shader) {
      const shaderInfo = shaderSources.get(shader);
      if (shaderInfo) program(object).shaders.push(shaderInfo);
      return attach.call(this, object, shader);
    };
    for (const method of ['compileShader', 'linkProgram', 'getProgramInfoLog', 'getShaderInfoLog', 'getProgramParameter', 'getShaderParameter', 'getActiveUniform', 'getActiveAttrib', 'getUniformLocation', 'getAttribLocation', 'checkFramebufferStatus']) {
      const original = proto[method];
      if (!original) continue;
      proto[method] = function (...args) {
        const isProgram = /Program|Active|Location/.test(method);
        const row = isProgram ? program(args[0]) : null;
        if (method === 'linkProgram') row.linkedAt = performance.now();
        const start = performance.now();
        try { return original.apply(this, args); }
        finally { record(method, start, { program: row?.id ?? null, parameter: typeof args[1] === 'number' ? args[1] : null }); }
      };
    }
    const remove = proto.deleteProgram;
    proto.deleteProgram = function (object) {
      if (object) program(object).deleted = true;
      return remove.call(this, object);
    };
  }
  trace.identify = (object) => programIds.get(object) ?? null;
  trace.annotate = () => {
    for (const p of window.__flyGl?.info?.programs ?? []) {
      const row = trace.programs[trace.identify(p.program)];
      if (row) Object.assign(row, { threeId: p.id, name: p.name, type: p.type, cacheKey: p.cacheKey });
    }
  };
  trace.mark = (phase) => { trace.phase = phase; trace.marks.push({ phase, at: performance.now() }); };
  const tick = () => {
    const now = performance.now(), ms = now - last;
    if (ms > 100 && trace.frameGaps.length < 5000) trace.frameGaps.push({ at: last, ms, phase: trace.phase ?? 'boot' });
    last = now;
    trace.raf = requestAnimationFrame(tick);
  };
  trace.raf = requestAnimationFrame(tick);
  trace.snapshot = () => {
    trace.annotate();
    const slowIds = new Set(trace.slow.map((s) => s.program));
    const programs = Object.values(trace.programs).map((p) => ({
      ...p, shaders: p.shaders.map((s) => ({ ...s, source: slowIds.has(p.id) ? s.source : undefined })),
    }));
    return { totals: trace.totals, slow: trace.slow, programs, marks: trace.marks, frameGaps: trace.frameGaps, dropped: trace.dropped };
  };
}

module.exports = { installLoungeWebGLProbe };

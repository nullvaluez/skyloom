/**
 * SHIP PASS FRAME (FR-1, SHADER_READY) — the program census.
 *
 * WHAT IT ANSWERS. "Which WebGL programs did the player wait for, when, and
 * for how long?" EXPLORER_BETA.md's live diagnostic found the first minute
 * dominated by first-use shader links (about 20 s inside getProgramInfoLog on
 * the RTX 5080); FR-3 prewarms them, and this is the instrument that proves
 * the prewarm worked: on the reference route the list of programs first used
 * AFTER the reveal should be empty (FLY_SHIP_PASS.md section 2, "First minute").
 *
 * HOW. three keeps every live WebGLProgram in `renderer.info.programs` (the
 * array WebGLPrograms.acquireProgram pushes to). The census replaces that one
 * array's own `push` (an instance property; Array.prototype is untouched) so
 * it sees each program the moment it is ACQUIRED, and wraps that program's
 * own `getUniforms` / `getAttributes` until the FIRST call — which is where
 * three's onFirstUse blocks on the driver (link status, info logs, uniform
 * introspection). After the first call the original methods are restored on
 * the instance, so a draw never pays for the census. Per-frame cost: zero.
 *
 * Published as `window.__flyStats.census.programs`:
 *   { total, live, preReveal, afterReveal: [{ key, ms, t, waitMs }],
 *     afterRevealCount, firstUseMs, worstMs, linkFailures }
 * `key` is `<shaderType>[:name]#<fnv1a(cacheKey)>` — stable across a session
 * and short enough to publish; `ms` is the blocking first-use time; `t` is ms
 * since the world was revealed; `waitMs` is acquire → first use (the time the
 * driver had to link in parallel).
 *
 * LINK FAILURES. With checkShaderErrors on, three's diagnostics say whether
 * the program is runnable. With it off (FR-2, production), the census reads
 * LINK_STATUS itself — after onFirstUse, when the link has already landed, so
 * the read does not wait. A failure counts in `linkFailures` and calls
 * `track('client_error', { kind: 'shader_link' })` (RELEASE's analytics).
 *
 * Installed by FlyCanvas only when censusWanted(): SHADER_READY on, `?diag=1`,
 * or an automated page (so a harness can read both flag arms). It changes no
 * GL call, no program key and no shader text.
 */
import { track } from './analytics';
import { shipPassOn } from './ship-pass';
import { diagRequested } from './diag';
import { automated } from './shader-ready';
import { sinceRevealMs } from './settle';

const LINK_STATUS = 0x8b82;
const AFTER_REVEAL_CAP = 200;
const EVENTS = 64;

/** FNV-1a 32-bit, hex — a short stable id for a long three cache key. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The census key of a WebGLProgram. */
export function programKey(p) {
  return `${p?.type ?? 'program'}${p?.name ? `:${p.name}` : ''}#${fnv1a(p?.cacheKey)}`;
}

/** Should FlyCanvas install the census on this page load? */
export function censusWanted() {
  return shipPassOn('SHADER_READY') || diagRequested() || automated();
}

/** A fresh census state (exported for the node gate). */
export function createCensusState() {
  return {
    total: 0,
    live: 0,
    preReveal: 0,
    afterReveal: [],
    afterRevealCount: 0,
    firstUseMs: 0,
    worstMs: 0,
    linkFailures: 0,
    // Ring of recent first uses ({ at, ms }) for the stall classifier (FR-7).
    events: [],
  };
}

const hooked = new WeakSet();

/**
 * Hook one programs array. `opts` (all optional) are the injection points the
 * node gate uses: now(), sinceReveal() (ms, < 0 while the overlay is up),
 * linkOk(program) → true | false | null, onLinkFail(entry).
 */
export function hookProgramList(list, state, opts = {}) {
  if (!Array.isArray(list) || hooked.has(list)) return false;
  hooked.add(list);
  const now = opts.now ?? (() => performance.now());
  const since = opts.sinceReveal ?? sinceRevealMs;
  const linkOk = opts.linkOk ?? (() => null);
  const onLinkFail = opts.onLinkFail ?? (() => track('client_error', { kind: 'shader_link' }));

  const record = (p, acquiredAt, startedAt, ms) => {
    const t = since();
    const entry = { key: programKey(p), ms: Math.round(ms * 100) / 100, t: t >= 0 ? Math.round(t) : null, waitMs: Math.round(startedAt - acquiredAt) };
    state.firstUseMs += ms;
    if (ms > state.worstMs) state.worstMs = Math.round(ms * 100) / 100;
    if (t >= 0) {
      state.afterRevealCount++;
      if (state.afterReveal.length < AFTER_REVEAL_CAP) state.afterReveal.push(entry);
    } else state.preReveal++;
    state.events.push({ at: startedAt, ms });
    if (state.events.length > EVENTS) state.events.shift();
    let ok = null;
    try {
      ok = p.diagnostics ? p.diagnostics.runnable !== false : linkOk(p);
    } catch {
      ok = null;
    }
    if (ok === false) {
      state.linkFailures++;
      try {
        onLinkFail(entry);
      } catch {
        /* analytics never breaks a draw */
      }
    }
  };

  const hook = (p) => {
    if (!p || typeof p.getUniforms !== 'function') return;
    const acquiredAt = now();
    state.total++;
    const own = { u: p.getUniforms, a: p.getAttributes };
    let done = false;
    const first = (orig) =>
      function censusFirstUse(...args) {
        if (done) return orig.apply(this, args);
        done = true;
        p.getUniforms = own.u;
        p.getAttributes = own.a;
        const t0 = now();
        const out = orig.apply(this, args);
        record(p, acquiredAt, t0, now() - t0);
        return out;
      };
    p.getUniforms = first(own.u);
    p.getAttributes = first(own.a);
  };

  const push = list.push;
  list.push = function censusPush(...items) {
    for (const p of items) hook(p);
    const n = push.apply(this, items);
    state.live = this.length;
    return n;
  };
  // splice is how three releases a program; keep `live` honest without a
  // per-frame read.
  const splice = list.splice;
  list.splice = function censusSplice(...args) {
    const out = splice.apply(this, args);
    state.live = this.length;
    return out;
  };
  state.live = list.length;
  return true;
}

let installed = null;

/**
 * Install on a WebGLRenderer. Idempotent per renderer; re-hooks the new
 * programs array three builds when a lost context is restored. Returns the
 * live state object (also published at __flyStats.census.programs).
 */
export function installProgramCensus(gl) {
  if (!gl?.info) return null;
  if (installed?.gl === gl) return installed.state;
  const state = createCensusState();
  const ctx = gl.getContext?.();
  const linkOk = (p) => {
    if (!ctx || !p?.program || ctx.isContextLost?.()) return null;
    const v = ctx.getProgramParameter(p.program, LINK_STATUS);
    return v === false ? false : v === true ? true : null;
  };
  const hookNow = () => hookProgramList(gl.info.programs, state, { linkOk });
  hookNow();
  // three's own restore handler runs first (registered at construction), so
  // by the time this fires `gl.info.programs` is the new array.
  gl.domElement?.addEventListener?.('webglcontextrestored', hookNow);
  installed = { gl, state };
  if (typeof window !== 'undefined') ((window.__flyStats ??= {}).census ??= {}).programs = state;
  return state;
}

/** The live census (null when not installed). */
export function programCensus() {
  return installed?.state ?? null;
}

/** Sum of first-use ms whose start falls in [from, to] (performance.now ms). */
export function programMsBetween(from, to) {
  const s = installed?.state;
  if (!s) return 0;
  let ms = 0;
  for (const e of s.events) if (e.at >= from && e.at <= to) ms += e.ms;
  return ms;
}

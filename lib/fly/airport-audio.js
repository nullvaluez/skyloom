import { LOUNGE_ROOM, SOUNDSCAPE, WALK } from './observation-config.js';
import { trackPhase } from './flight-phase.js';

/*
 * The observation lounge soundscape. Everything routes through the shared
 * FlyAudio effects bus, so the sound toggle, the master/effects preferences,
 * the pause and the hidden-tab mute all govern it for free; this class also
 * fades its own room bus to silence the moment the lounge is left, the tab
 * is hidden or sound is off, and tears its graph down shortly after.
 *
 * INSIDE (dry): the room — a low ventilation bed (brown noise), a faint
 * air-handler hum, a distant murmur of voices (band-limited noise with a
 * slow random swell) and an occasional PA chime with a short hall reverb.
 *
 * OUTSIDE (through the glass): up to SOUNDSCAPE.aircraft.voices aircraft,
 * the loudest the observer can hear right now. Each voice is the CC0 engine
 * loop (lazily fetched and decoded when the lounge first opens; filtered
 * noise until then, or for good if it cannot load) plus a brown-noise roar,
 * through an air-absorption lowpass that closes with distance, a level that
 * falls with distance, and a stereo position from the seat. All of it then
 * passes the glazing: one shared lowpass that muffles the whole outside.
 *
 * PROPAGATION. Sound travels at 343 m/s, so what you hear from an aircraft
 * 3 km away left it ~9 s ago. Each candidate keeps a short history of where
 * it was and how loud its phase is (takeoff roll and final approach matter
 * most); a voice plays the RETARDED state — the solution of
 * c·Δ = |p(now − Δ) − eye| — so a takeoff is seen first and heard later,
 * and the doppler shift comes from the closing speed at that moment.
 *
 * No AudioParam is ever stepped in flight: every move is setTargetAtTime.
 */

const GROUNDED = 1;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const hash01 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return (h % 10007) / 10007;
};
// Engine playback rate by phase: idle on the stand, spooled up on the roll.
const PHASE_RATE = { parked: 0.42, taxi: 0.5, runway: 1, 'climb-out': 0.95, departure: 0.9, final: 0.72, approach: 0.7, climb: 0.88, descent: 0.68, level: 0.8, cruise: 0.84 };

/** Brown (integrated) noise: the low roar of distant jets and ventilation. */
function brownNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  return buf;
}
/** Pink-ish noise (Voss-McCartney approximation): voices in a far corner. */
function pinkNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
  }
  return buf;
}
/** A short stereo hall impulse response for the PA chime. */
function hallImpulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}

/**
 * State at time `t` from a contact's history (linear between samples);
 * before the oldest sample, extrapolated backwards along its velocity.
 */
export function sampleAt(h, t, out) {
  const s = h.samples;
  const first = s[0], last = s[s.length - 1];
  if (t >= last.t) return Object.assign(out, last);
  if (t <= first.t) {
    const back = first.t - t;
    Object.assign(out, first);
    out.x = first.x - first.vx * back;
    out.y = first.y - first.vy * back;
    out.z = first.z - first.vz * back;
    return out;
  }
  let i = s.length - 1;
  while (i > 0 && s[i - 1].t > t) i--;
  const a = s[i - 1], b = s[i], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  out.x = a.x + (b.x - a.x) * u;
  out.y = a.y + (b.y - a.y) * u;
  out.z = a.z + (b.z - a.z) * u;
  // A phase change (the start of a takeoff roll) is a step, heard when it arrives.
  out.level = u < 0.5 ? a.level : b.level;
  out.rate = u < 0.5 ? a.rate : b.rate;
  out.vx = b.vx;
  out.vy = b.vy;
  out.vz = b.vz;
  return out;
}

/**
 * The retarded state of a contact heard from `eye` at time `now`: iterate
 * Δ = |p(now − Δ) − eye| / c (subsonic, so it converges in a few steps).
 * Returns the emission delay Δ in seconds; `out` holds the state then.
 */
export function retarded(h, eye, k, now, c, out) {
  let delay = 0;
  for (let i = 0; i < 5; i++) {
    sampleAt(h, now - delay, out);
    delay = Math.hypot((out.x - eye.x) / k, out.y - eye.y, (out.z - eye.z) / k) / c;
  }
  sampleAt(h, now - delay, out);
  return delay;
}

export class AirportAudio {
  constructor(base) {
    this.base = base; // FlyAudio: ctx (lazy, gesture-owned), effects + music buses, muted
    this.graph = null;
    this.voices = [];
    this.history = new Map(); // hex -> {samples: [...], seen}
    this.engineBuffer = null;
    this.engineStatus = 'idle'; // idle | loading | ready | fallback
    this.controller = null;
    this.disposed = false;
    this.nextUpdate = 0;
    this.nextSample = 0;
    this.nextChime = 0;
    this.inactiveSince = 0;
    this.ducked = false;
    this._s = {};
    this._eye = {};
  }

  /** Called at the hook's cadence; throttles itself to SOUNDSCAPE.updateHz. */
  update(runtime, state) {
    const ctx = this.base.ctx;
    if (this.disposed) return;
    const observing = !!runtime.airportWatch?.active;
    this.duck(observing);
    if (!ctx) return;
    const now = performance.now() / 1000;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const active = observing && state.soundOn && !hidden;
    if (!active) {
      if (this.graph) {
        this.graph.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
        for (const v of this.voices) v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
        this.inactiveSince ||= now;
        if (now - this.inactiveSince > 3) this.teardown();
      }
      return;
    }
    this.inactiveSince = 0;
    if (now < this.nextUpdate) return;
    this.nextUpdate = now + 1 / SOUNDSCAPE.updateHz;
    if (!this.graph) this.build(ctx);
    if (this.engineStatus === 'idle') this.loadEngine(ctx);
    const t = ctx.currentTime;
    this.graph.bus.gain.setTargetAtTime(1, t, 0.6);
    this.updateRoom(t, now);
    this.updateAircraft(runtime, t, now);
  }

  /** Duck the music director while observing (FlyAudio.setMusicDuck, an additive hook). */
  duck(on) {
    if (on === this.ducked) return;
    this.ducked = on;
    this.base.setMusicDuck?.(on ? SOUNDSCAPE.musicDuck : 1);
  }

  build(ctx) {
    const R = SOUNDSCAPE.room;
    const g = { nodes: [], sources: [] };
    const node = (n) => (g.nodes.push(n), n);
    const source = (n) => (g.sources.push(n), node(n));
    g.bus = node(ctx.createGain());
    g.bus.gain.value = 0;
    g.bus.connect(this.base.effects ?? this.base.master);

    // Room: ventilation bed, hum, murmur.
    g.roar = brownNoise(ctx, 4);
    const hvac = source(ctx.createBufferSource());
    hvac.buffer = g.roar;
    hvac.loop = true;
    const hvacLp = node(ctx.createBiquadFilter());
    hvacLp.type = 'lowpass';
    hvacLp.frequency.value = R.hvacHz;
    hvacLp.Q.value = 0.4;
    const hvacGain = node(ctx.createGain());
    hvacGain.gain.value = R.hvacGain;
    hvac.connect(hvacLp).connect(hvacGain).connect(g.bus);
    const hum = source(ctx.createOscillator());
    hum.type = 'sine';
    hum.frequency.value = R.humHz;
    const humGain = node(ctx.createGain());
    humGain.gain.value = R.humGain;
    hum.connect(humGain).connect(g.bus);
    const murmur = source(ctx.createBufferSource());
    murmur.buffer = pinkNoise(ctx, 6);
    murmur.loop = true;
    const murmurBp = node(ctx.createBiquadFilter());
    murmurBp.type = 'bandpass';
    murmurBp.frequency.value = R.murmurHz;
    murmurBp.Q.value = 0.8;
    g.murmurGain = node(ctx.createGain());
    g.murmurGain.gain.value = R.murmurGain * 0.7;
    murmur.connect(murmurBp).connect(g.murmurGain).connect(g.bus);

    // PA hall reverb (wet path only; the chime's dry tone goes straight to the bus).
    g.reverb = node(ctx.createConvolver());
    g.reverb.buffer = hallImpulse(ctx, SOUNDSCAPE.chime.reverbSec);
    g.reverbGain = node(ctx.createGain());
    g.reverbGain.gain.value = 0.5;
    g.reverb.connect(g.reverbGain).connect(g.bus);

    // Outside: every aircraft voice passes the glazing.
    g.outside = node(ctx.createGain());
    g.glass = node(ctx.createBiquadFilter());
    g.glass.type = 'lowpass';
    g.glass.frequency.value = SOUNDSCAPE.glass.cutoffHz;
    g.glass.Q.value = SOUNDSCAPE.glass.q;
    g.glassGain = node(ctx.createGain());
    g.glassGain.gain.value = SOUNDSCAPE.glass.level;
    g.outside.connect(g.glass).connect(g.glassGain).connect(g.bus);

    for (const s of g.sources) s.start();
    this.graph = g;
    this.voices = [];
    for (let i = 0; i < SOUNDSCAPE.aircraft.voices; i++) this.voices.push(this.makeVoice(ctx, g));
    this.nextChime = performance.now() / 1000 + SOUNDSCAPE.chime.firstSec;
  }

  makeVoice(ctx, g) {
    const v = { hex: null, next: null, switchAt: 0, engine: null, engineGain: null };
    v.noise = ctx.createBufferSource();
    v.noise.buffer = g.roar;
    v.noise.loop = true;
    v.noiseGain = ctx.createGain();
    v.noiseGain.gain.value = 0.55;
    v.air = ctx.createBiquadFilter();
    v.air.type = 'lowpass';
    v.air.frequency.value = 800;
    v.air.Q.value = 0.5;
    v.gain = ctx.createGain();
    v.gain.gain.value = 0;
    v.pan = ctx.createStereoPanner();
    v.noise.connect(v.noiseGain).connect(v.air).connect(v.gain).connect(v.pan).connect(g.outside);
    v.noise.start(0, Math.random() * 3);
    if (this.engineBuffer) this.attachEngine(ctx, v);
    return v;
  }

  attachEngine(ctx, v) {
    if (v.engine || !this.engineBuffer) return;
    v.engine = ctx.createBufferSource();
    v.engine.buffer = this.engineBuffer;
    v.engine.loop = true;
    v.engineGain = ctx.createGain();
    v.engineGain.gain.value = 0.85;
    v.engine.connect(v.engineGain).connect(v.air);
    v.engine.start(0, Math.random() * Math.max(0.1, this.engineBuffer.duration - 0.1));
  }

  /** Fetch + decode the CC0 engine loop once (ImmersiveAudio's buffer is private). */
  async loadEngine(ctx) {
    this.engineStatus = 'loading';
    this.controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    try {
      const response = await fetch('/audio/immersive/engine.mp3', { signal: this.controller?.signal });
      if (!response.ok) throw new Error(`Audio ${response.status}`);
      const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
      if (this.disposed) return;
      // Fold a short tail into the head for a seamless loop (the ImmersiveAudio idiom).
      const fade = Math.min(Math.floor(ctx.sampleRate * 0.2), Math.floor(decoded.length / 4));
      const length = decoded.length - fade;
      const buffer = ctx.createBuffer(decoded.numberOfChannels, length, ctx.sampleRate);
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const input = decoded.getChannelData(ch), output = buffer.getChannelData(ch);
        output.set(input.subarray(0, length));
        for (let i = 0; i < fade; i++) {
          const u = i / fade;
          output[i] = input[length + i] * (1 - u) + input[i] * u;
        }
      }
      this.engineBuffer = buffer;
      this.engineStatus = 'ready';
      if (this.graph && this.base.ctx === ctx) for (const v of this.voices) this.attachEngine(ctx, v);
    } catch {
      this.engineStatus = this.disposed ? 'idle' : 'fallback';
    }
  }

  updateRoom(t, now) {
    const g = this.graph, R = SOUNDSCAPE.room;
    // The murmur swells and settles like a room of travellers.
    if (now >= (g.murmurAt || 0)) {
      g.murmurAt = now + 2.5 + Math.random() * 4;
      g.murmurGain.gain.setTargetAtTime(R.murmurGain * (0.45 + Math.random() * 0.55), t, 1.6);
    }
    if (now >= this.nextChime) {
      const C = SOUNDSCAPE.chime;
      this.nextChime = now + C.minSec + Math.random() * (C.maxSec - C.minSec);
      this.chime(t + 0.05);
    }
  }

  /** The PA chime: three soft bell tones, dry plus hall. */
  chime(t0) {
    const ctx = this.base.ctx, g = this.graph;
    if (!ctx || !g) return;
    const notes = [[523.25, 0], [659.25, 0.42], [783.99, 0.84]];
    for (const [hz, at] of notes) {
      for (const [mul, level, type] of [[1, 1, 'sine'], [2.01, 0.18, 'sine'], [3, 0.06, 'triangle']]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz * mul;
        const e = ctx.createGain();
        const start = t0 + at, peak = SOUNDSCAPE.chime.gain * level;
        e.gain.setValueAtTime(0.0001, start);
        e.gain.exponentialRampToValueAtTime(peak, start + 0.015);
        e.gain.exponentialRampToValueAtTime(0.0001, start + 1.5);
        o.connect(e);
        e.connect(g.bus);
        e.connect(g.reverb);
        o.start(start);
        o.stop(start + 1.6);
        o.onended = () => {
          o.disconnect();
          e.disconnect();
        };
      }
    }
  }

  updateAircraft(runtime, t, now) {
    const A = SOUNDSCAPE.aircraft, w = runtime.airportWatch, k = w.frame?.k || 1;
    // The listener is the observer's eye wherever it is in the room (a seat or
    // walking); a watch without one (older test doubles) hears from the window seat.
    const eye = w.eyeWorld ? w.eyeWorld(this._eye) : { x: w.seat.x, y: w.seat.y + LOUNGE_ROOM.eye[1], z: w.seat.z };
    const fieldElev = w.airport?.a ? (w.airport.a.elevation + w.airport.b.elevation) / 2 : (w.floorY || 0) - (w.site?.floorM || 0);
    const items = runtime.traffic?.items || [];

    // History: where each nearby contact is, and how loud its phase is.
    if (now >= this.nextSample) {
      this.nextSample = now + 1 / A.sampleHz;
      const near = [];
      for (const tr of items) {
        if (!tr.fix1 || tr.stale === 2) continue;
        const d = Math.hypot((tr.rx - eye.x) / k, (tr.rz - eye.z) / k);
        if (d < A.rangeM * 1.2) near.push({ tr, d });
      }
      near.sort((a, b) => a.d - b.d);
      for (const { tr } of near.slice(0, 24)) {
        const fix = tr.fix1;
        const phase = trackPhase(tr, fieldElev);
        let h = this.history.get(tr.hex);
        if (!h) this.history.set(tr.hex, (h = { samples: [], seen: now }));
        h.seen = now;
        h.samples.push({
          t: now, x: tr.rx, y: tr.ry ?? 0, z: tr.rz,
          vx: fix.vE * k, vy: fix.vUp || 0, vz: -fix.vN * k,
          level: (A.phaseLevel[phase] ?? 0.25) * (tr.flags & GROUNDED && phase === 'parked' ? 0.5 : 1),
          rate: PHASE_RATE[phase] ?? 0.8,
        });
        while (h.samples.length > 2 && now - h.samples[0].t > A.historySec) h.samples.shift();
      }
      for (const [hex, h] of this.history) if (now - h.seen > 5) this.history.delete(hex);
    }

    // The retarded state of each candidate and its loudness at the seat.
    const c = A.speedOfSound;
    const heard = [];
    const s = this._s;
    for (const [hex, h] of this.history) {
      if (!h.samples.length) continue;
      const delay = retarded(h, eye, k, now, c, s);
      const dx = (s.x - eye.x) / k, dy = s.y - eye.y, dz = (s.z - eye.z) / k;
      const d = Math.max(1, Math.hypot(dx, dy, dz));
      if (d > A.rangeM) continue;
      const level = s.level * Math.min(1, A.refM / d) * Math.exp(-d / 30000);
      // Radial speed at emission (positive = receding) -> doppler.
      const vr = (dx * (s.vx / k) + dy * s.vy + dz * (s.vz / k)) / d;
      heard.push({ hex, level, d, dx, dz, delay, rate: s.rate, doppler: A.doppler ? clamp(c / (c + vr), 0.8, 1.25) : 1 });
    }
    heard.sort((a, b) => b.level - a.level);
    const wanted = heard.slice(0, this.voices.length);
    const byHex = new Map(wanted.map((x) => [x.hex, x]));

    // Stable voice assignment: a voice keeps its aircraft while it stays in
    // the loudest set; a reassignment fades out first, then switches.
    const free = this.voices.filter((v) => !v.hex || !byHex.has(v.hex));
    const taken = new Set(this.voices.filter((v) => v.hex && byHex.has(v.hex)).map((v) => v.hex));
    for (const x of wanted) {
      if (taken.has(x.hex)) continue;
      const v = free.shift();
      if (!v) break;
      if (v.hex) {
        if (v.next !== x.hex) {
          v.next = x.hex;
          v.switchAt = now + 0.35;
        }
      } else v.hex = x.hex;
      taken.add(x.hex);
    }
    const m = runtime.camera?.matrixWorld?.elements;
    let rx = m ? m[0] : 1, rz = m ? m[2] : 0;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    for (const v of this.voices) {
      if (v.next && now >= v.switchAt) {
        v.hex = v.next;
        v.next = null;
      }
      const x = !v.next && v.hex ? byHex.get(v.hex) : null;
      if (!x) {
        v.gain.gain.setTargetAtTime(0, t, v.next ? 0.1 : 0.4);
        if (!v.next && v.hex && !this.history.has(v.hex)) v.hex = null;
        continue;
      }
      v.gain.gain.setTargetAtTime(clamp(x.level, 0, 1) * A.maxGain, t, 0.3);
      // Air absorption: highs fade first with distance.
      v.air.frequency.setTargetAtTime(180 + 9000 / (1 + x.d / 400), t, 0.4);
      const hl = Math.hypot(x.dx, x.dz) || 1;
      v.pan.pan.setTargetAtTime(clamp(((x.dx * rx + x.dz * rz) / hl) * 0.85, -0.9, 0.9), t, 0.25);
      const variety = 0.94 + hash01(x.hex) * 0.12;
      if (v.engine) v.engine.playbackRate.setTargetAtTime(x.rate * x.doppler * variety, t, 0.5);
      v.noise.playbackRate.setTargetAtTime(0.85 + 0.15 * x.rate * x.doppler, t, 0.5);
    }
    runtime.airportAudioStats = {
      engine: this.engineStatus,
      voices: this.voices.filter((v) => v.hex).length,
      heard: wanted.map((x) => ({ hex: x.hex, d: Math.round(x.d), delayS: +x.delay.toFixed(2), level: +x.level.toFixed(4) })),
    };
  }

  /** Small interface cues for lounge actions (select, binoculars up/down, a footstep). */
  cue(name) {
    const ctx = this.base.ctx;
    if (!ctx || ctx.state !== 'running' || this.base.muted || this.disposed) return;
    const t = ctx.currentTime;
    const out = this.base.effects ?? this.base.master;
    if (name === 'select') {
      for (const [hz, at, dur] of [[880, 0, 0.09], [1318.5, 0.06, 0.14]]) {
        const o = ctx.createOscillator(), e = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = hz;
        e.gain.setValueAtTime(0.0001, t + at);
        e.gain.exponentialRampToValueAtTime(0.05, t + at + 0.01);
        e.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
        o.connect(e).connect(out);
        o.start(t + at);
        o.stop(t + at + dur + 0.02);
        o.onended = () => {
          o.disconnect();
          e.disconnect();
        };
      }
      return;
    }
    if (name === 'step') {
      // A footstep on the travertine (LOUNGE_WALK): a short, soft scuff into the
      // room bus, so it fades and mutes with the room. Each one varies a little.
      const g = this.graph;
      if (!g) return;
      if (!this.stepBuffer || this.stepBuffer.sampleRate !== ctx.sampleRate) {
        const len = Math.floor(ctx.sampleRate * 0.07);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          const u = i / len;
          d[i] = (Math.random() * 2 - 1) * Math.min(1, u * 40) * Math.exp(-u * 7);
        }
        this.stepBuffer = buf;
      }
      const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), e = ctx.createGain();
      src.buffer = this.stepBuffer;
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.8;
      e.gain.value = WALK.footstepGain * (0.8 + Math.random() * 0.4);
      src.connect(bp).connect(e).connect(g.bus);
      src.start(t);
      src.stop(t + 0.1);
      src.onended = () => {
        src.disconnect();
        bp.disconnect();
        e.disconnect();
      };
      return;
    }
    if (name === 'raise' || name === 'lower') {
      // A soft cloth-and-glass swish: a band-passed noise sweep.
      const len = Math.floor(ctx.sampleRate * 0.32);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
      const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), e = ctx.createGain();
      src.buffer = buf;
      bp.type = 'bandpass';
      bp.Q.value = 1.4;
      const [f0, f1] = name === 'raise' ? [700, 2400] : [2200, 600];
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.exponentialRampToValueAtTime(f1, t + 0.3);
      e.gain.value = 0.07;
      src.connect(bp).connect(e).connect(out);
      src.start(t);
      src.onended = () => {
        src.disconnect();
        bp.disconnect();
        e.disconnect();
      };
    }
  }

  /** Stop and release the whole lounge graph (kept: the decoded engine buffer). */
  teardown() {
    const g = this.graph;
    if (!g) return;
    for (const v of this.voices) {
      for (const src of [v.noise, v.engine]) {
        if (!src) continue;
        try {
          src.stop();
        } catch {
          // never started
        }
      }
      for (const n of [v.noise, v.noiseGain, v.engine, v.engineGain, v.air, v.gain, v.pan]) n?.disconnect();
    }
    for (const src of g.sources) {
      try {
        src.stop();
      } catch {
        // never started
      }
    }
    for (const n of g.nodes) n.disconnect();
    this.graph = null;
    this.voices = [];
    this.history.clear();
    this.inactiveSince = 0;
  }

  dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.duck(false);
    this.teardown();
    this.engineBuffer = null;
  }
}

import { MUSIC } from './fly-constants';

/**
 * ROUND 18 "Alive & Dangerous" — A4 SHOWTIME: procedural score.
 *
 * Four gain-crossfaded layers on the SAME AudioContext as the engine bed
 * (audio.bus() hands back {ctx, master} — everything routes through the
 * master gain, so the sound toggle's single ramp still governs the music):
 *
 *   A  air bed     two detuned triangle drones (root + fifth) through a slow
 *                  lowpass; gain + cutoff ride the altitude band, so climbing
 *                  opens the sky up and the deck feels close.
 *   B  pulse       one bandpassed square running a 4-note minor-pentatonic
 *                  arpeggio; the RATE is the speed preset (silent at slow,
 *                  sparse at cruise, driving at boost) — the layer that makes
 *                  going fast feel like going fast.
 *   C  tension     filtered-noise swell + a low fifth, armed by proximity
 *                  (nearest traffic inside tension.nearDistM) or by fast-low
 *                  flight. This is the layer that says "this is dangerous".
 *   D  night pad   warm detuned pad that fades in as runtime.sun.frac drops.
 *                  Toy/Neon publishes no sun — the caller passes null and the
 *                  layer simply never opens.
 *
 * Mode: D dorian. The root WALKS D → F → C → G on MUSIC.rootWalkSec, blended
 * with a long setTargetAtTime glide rather than a cut, so the harmony moves
 * under you without ever announcing a bar line (there are no bars — a flight
 * sim has no beat grid to sync to, and a hard chord change over a 40-minute
 * session reads as a loop point).
 *
 * HARD RULE: this is driven at MUSIC.updateHz (2 Hz) from JuiceSystems, never
 * per frame, and every parameter move is setTargetAtTime — no AudioParam is
 * ever assigned a stepped value in flight. Zippering on a drone is instantly
 * audible, and a per-frame WebAudio call is a main-thread cost for nothing.
 *
 * MUSIC.enabled:false ⇒ this module is never constructed and creates ZERO
 * nodes (JuiceSystems gates the `new MusicDirector()` itself).
 */

/** Semitone ratio, precomputed per step so the note loop does no pow(). */
function semis(n) {
  return Math.pow(2, n / 12);
}

export class MusicDirector {
  /**
   * @param bus {{ctx: AudioContext, master: GainNode}} from FlyAudio.bus()
   */
  constructor(bus) {
    const { ctx, master } = bus;
    this.ctx = ctx;
    this._nodes = 0;
    this._rootIdx = 0;
    this._nextRootAt = 0;
    this._nextNoteAt = 0;
    this._noteIdx = 0;
    this._disposed = false;
    this._steps = MUSIC.pulse.steps.map(semis);

    const N = () => this._nodes++;

    // --- Music master: one place for MUSIC.gain and the sound toggle ------
    this.out = ctx.createGain();
    N();
    this.out.gain.value = 0;
    this.out.connect(master);

    const root = MUSIC.roots[0];

    // --- A: air bed -------------------------------------------------------
    this.bedFilter = ctx.createBiquadFilter();
    N();
    this.bedFilter.type = 'lowpass';
    this.bedFilter.frequency.value = MUSIC.bed.cutoff[0];
    this.bedFilter.Q.value = 0.4;
    this.bedGain = ctx.createGain();
    N();
    this.bedGain.gain.value = 0;
    this.bedFilter.connect(this.bedGain).connect(this.out);

    this.bedRoot = ctx.createOscillator();
    N();
    this.bedRoot.type = 'triangle';
    this.bedRoot.frequency.value = root;
    this.bedRoot.detune.value = -5;
    this.bedFifth = ctx.createOscillator();
    N();
    this.bedFifth.type = 'triangle';
    this.bedFifth.frequency.value = root * 1.5;
    this.bedFifth.detune.value = 6; // slow beat against the root = "air"
    this.bedRoot.connect(this.bedFilter);
    this.bedFifth.connect(this.bedFilter);
    this.bedRoot.start();
    this.bedFifth.start();

    // --- B: speed pulse ---------------------------------------------------
    // ONE persistent oscillator whose frequency and note envelope are
    // scheduled ahead of time. A node-per-note would allocate a few hundred
    // nodes a minute for no audible gain.
    this.pulseGain = ctx.createGain();
    N();
    this.pulseGain.gain.value = 0;
    this.pulseGain.connect(this.out);
    this.pulseBp = ctx.createBiquadFilter();
    N();
    this.pulseBp.type = 'bandpass';
    this.pulseBp.frequency.value = root * MUSIC.pulse.octave * 2;
    this.pulseBp.Q.value = 2.4;
    this.pulseBp.connect(this.pulseGain);
    this.pulseEnv = ctx.createGain();
    N();
    this.pulseEnv.gain.value = 0;
    this.pulseEnv.connect(this.pulseBp);
    this.pulseOsc = ctx.createOscillator();
    N();
    this.pulseOsc.type = 'square';
    this.pulseOsc.frequency.value = root * MUSIC.pulse.octave;
    this.pulseOsc.connect(this.pulseEnv);
    this.pulseOsc.start();

    // --- C: proximity tension --------------------------------------------
    this.tensionGain = ctx.createGain();
    N();
    this.tensionGain.gain.value = 0;
    this.tensionGain.connect(this.out);

    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.tensionNoise = ctx.createBufferSource();
    N();
    this.tensionNoise.buffer = buf;
    this.tensionNoise.loop = true;
    this.tensionBp = ctx.createBiquadFilter();
    N();
    this.tensionBp.type = 'bandpass';
    this.tensionBp.frequency.value = 900;
    this.tensionBp.Q.value = 1.1;
    const noiseTrim = ctx.createGain();
    N();
    noiseTrim.gain.value = 0.45;
    this.tensionNoise.connect(this.tensionBp).connect(noiseTrim).connect(this.tensionGain);
    this.tensionNoise.start();

    this.tensionOsc = ctx.createOscillator();
    N();
    this.tensionOsc.type = 'sawtooth';
    this.tensionOsc.frequency.value = root * 1.5;
    const tOscTrim = ctx.createGain();
    N();
    tOscTrim.gain.value = 0.3;
    this.tensionOsc.connect(tOscTrim).connect(this.tensionGain);
    this.tensionOsc.start();

    // --- D: night pad -----------------------------------------------------
    this.padFilter = ctx.createBiquadFilter();
    N();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 0.5;
    this.padGain = ctx.createGain();
    N();
    this.padGain.gain.value = 0;
    this.padFilter.connect(this.padGain).connect(this.out);
    this.padOscs = [];
    for (const [mul, detune] of [
      [2, -7],
      [3, 4],
      [4, 9],
    ]) {
      const o = ctx.createOscillator();
      N();
      o.type = 'triangle';
      o.frequency.value = root * mul;
      o.detune.value = detune;
      o.connect(this.padFilter);
      o.start();
      this.padOscs.push({ osc: o, mul });
    }
  }

  /** Node count for the __flyStats.juice.musicNodes A/B gate. */
  get nodeCount() {
    return this._nodes;
  }

  /**
   * @param s {{aglM, speedMps, speedPreset, nearestDistM, sunFrac, soundOn}}
   * @param nowSec monotonic seconds (the caller's clock; only used for the
   *        root-walk schedule, which has no need for sample accuracy)
   */
  update(s, nowSec) {
    const ctx = this.ctx;
    if (this._disposed || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const fade = MUSIC.fadeSec;

    // --- Root walk: glide, never a cut ------------------------------------
    if (this._nextRootAt === 0) this._nextRootAt = nowSec + MUSIC.rootWalkSec;
    else if (nowSec >= this._nextRootAt) {
      this._rootIdx = (this._rootIdx + 1) % MUSIC.roots.length;
      this._nextRootAt = nowSec + MUSIC.rootWalkSec;
      const r = MUSIC.roots[this._rootIdx];
      const g = MUSIC.glideSec;
      this.bedRoot.frequency.setTargetAtTime(r, t, g);
      this.bedFifth.frequency.setTargetAtTime(r * 1.5, t, g);
      this.tensionOsc.frequency.setTargetAtTime(r * 1.5, t, g);
      for (const p of this.padOscs) p.osc.frequency.setTargetAtTime(r * p.mul, t, g);
      this.pulseBp.frequency.setTargetAtTime(r * MUSIC.pulse.octave * 2, t, g);
    }
    const root = MUSIC.roots[this._rootIdx];

    // Sound off ⇒ everything ramps to silence and the note scheduler idles.
    // (The master gain already mutes us — this stops us *scheduling* into a
    // muted bus, which is both cheaper and what the engine bed effectively
    // does.)
    this.out.gain.setTargetAtTime(s.soundOn === false ? 0 : MUSIC.gain, t, 0.3);
    if (s.soundOn === false) {
      this.bedGain.gain.setTargetAtTime(0, t, fade);
      this.pulseGain.gain.setTargetAtTime(0, t, fade);
      this.tensionGain.gain.setTargetAtTime(0, t, fade);
      this.padGain.gain.setTargetAtTime(0, t, fade);
      this._active = 0;
      return;
    }

    let active = 0;

    // --- A: air bed. Altitude opens the filter and lifts the level --------
    const B = MUSIC.bed;
    const alt = Math.max(0, Math.min(1, (s.aglM ?? 0) / B.aglRefM));
    this.bedGain.gain.setTargetAtTime(B.gain * (0.45 + 0.55 * alt), t, fade);
    this.bedFilter.frequency.setTargetAtTime(
      B.cutoff[0] + (B.cutoff[1] - B.cutoff[0]) * alt,
      t,
      fade
    );
    active++;

    // --- B: speed pulse ---------------------------------------------------
    const P = MUSIC.pulse;
    const rate = P.rateBySpeed[s.speedPreset] ?? 0;
    this.pulseGain.gain.setTargetAtTime(rate > 0 ? P.gain : 0, t, fade);
    if (rate > 0) {
      active++;
      // Schedule every note that starts inside the next update window (plus a
      // little slack), so a dropped/late tick never leaves a hole.
      const horizon = t + 1.5 / MUSIC.updateHz;
      if (this._nextNoteAt < t) this._nextNoteAt = t + 0.02;
      const period = 1 / rate;
      let guard = 32;
      while (this._nextNoteAt < horizon && guard-- > 0) {
        const at = this._nextNoteAt;
        const hz = root * P.octave * this._steps[this._noteIdx % this._steps.length];
        this.pulseOsc.frequency.setValueAtTime(hz, at);
        this.pulseEnv.gain.setValueAtTime(0.0001, at);
        this.pulseEnv.gain.exponentialRampToValueAtTime(1, at + 0.012);
        this.pulseEnv.gain.exponentialRampToValueAtTime(0.0001, at + P.noteSec);
        this._noteIdx++;
        this._nextNoteAt = at + period;
      }
    } else {
      this._nextNoteAt = 0;
      this._noteIdx = 0;
    }

    // --- C: tension -------------------------------------------------------
    const T = MUSIC.tension;
    const near = s.nearestDistM != null && s.nearestDistM < T.nearDistM;
    const fastLow = (s.aglM ?? Infinity) < T.lowAglM && (s.speedMps ?? 0) > T.fastMps;
    // Proximity is a RAMP, not a switch — a track sliding from 400 m to 80 m
    // should swell, and a binary gate would pump on the edge.
    const prox = near ? 1 - Math.max(0, s.nearestDistM) / T.nearDistM : 0;
    const amt = Math.max(prox, fastLow ? 0.8 : 0);
    this.tensionGain.gain.setTargetAtTime(T.gain * amt, t, amt > 0 ? 0.5 : fade);
    this.tensionBp.frequency.setTargetAtTime(600 + 1400 * amt, t, fade);
    if (amt > 0.01) active++;

    // --- D: night pad -----------------------------------------------------
    const D = MUSIC.night;
    const frac = s.sunFrac;
    const nightAmt = frac == null ? 0 : Math.max(0, Math.min(1, (D.sunFrac - frac) / D.sunFrac));
    this.padGain.gain.setTargetAtTime(D.gain * nightAmt, t, fade * 2);
    if (nightAmt > 0.01) active++;

    this._active = active;
  }

  /** Layers currently contributing — __flyStats.juice.musicLayers. */
  get activeLayers() {
    return this._active ?? 0;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    const stops = [
      this.bedRoot,
      this.bedFifth,
      this.pulseOsc,
      this.tensionNoise,
      this.tensionOsc,
      ...this.padOscs.map((p) => p.osc),
    ];
    for (const n of stops) {
      try {
        n.stop();
        n.disconnect();
      } catch {
        // already stopped — nothing to unwind
      }
    }
    try {
      this.out.disconnect();
    } catch {
      // context may already be closed
    }
  }
}

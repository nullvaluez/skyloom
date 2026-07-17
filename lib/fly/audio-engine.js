import { AUDIO, FLIGHT } from './fly-constants';

/**
 * Procedural Fly-mode audio — 100% synthesized WebAudio, zero asset files
 * (keeps the no-download/no-license constraint trivially satisfied).
 *
 * Continuous bed: filtered-noise wind + detuned-saw engine hum, both chased
 * toward the current flight speed at AUDIO.updateHz. One-shots: lock blip,
 * warp sweep, UI click. The AudioContext is created lazily and resumed on
 * the first user gesture (browser autoplay policy); everything routes
 * through one master gain so mute is a single ramp.
 */
export class FlyAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  _ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : AUDIO.masterGain;
    this.master.connect(ctx.destination);

    // --- Wind: looped white noise → bandpass → gain -----------------------
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = buf;
    this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.windSrc.start();

    // --- Engine: two detuned saws + a sine sub → lowpass → gain -----------
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 260;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter.connect(this.engGain).connect(this.master);

    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc1.frequency.value = 55;
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'sawtooth';
    this.engOsc2.frequency.value = 55;
    this.engOsc2.detune.value = 9; // slow beat between the saws = "machine"
    this.engSub = ctx.createOscillator();
    this.engSub.type = 'sine';
    this.engSub.frequency.value = 27;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.6;
    this.engOsc1.connect(this.engFilter);
    this.engOsc2.connect(this.engFilter);
    this.engSub.connect(subGain).connect(this.engFilter);
    this.engOsc1.start();
    this.engOsc2.start();
    this.engSub.start();

    return true;
  }

  /** Call from a user-gesture handler (autoplay policy). */
  resume() {
    if (!this._ensure()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(muted ? 0 : AUDIO.masterGain, this.ctx.currentTime, 0.08);
  }

  /** Chase the continuous bed toward the current speed. ~AUDIO.updateHz. */
  update(speedMps, boost) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const f = Math.max(0, Math.min(1, speedMps / FLIGHT.speeds.boost));

    // Wind dominates at speed; brightens as it strengthens
    this.windGain.gain.setTargetAtTime(AUDIO.windMaxGain * Math.pow(f, 1.6), t, 0.25);
    this.windFilter.frequency.setTargetAtTime(300 + 2400 * f, t, 0.3);

    // Engine pitch/volume ride cruise fraction; boost kicks the lowpass open
    const cruiseF = Math.min(1, speedMps / FLIGHT.speeds.cruise);
    this.engGain.gain.setTargetAtTime(AUDIO.engineMaxGain * (0.35 + 0.65 * cruiseF), t, 0.25);
    const hz = 45 + 85 * f + (boost ? 25 : 0);
    this.engOsc1.frequency.setTargetAtTime(hz, t, 0.35);
    this.engOsc2.frequency.setTargetAtTime(hz, t, 0.35);
    this.engSub.frequency.setTargetAtTime(hz * 0.5, t, 0.35);
    this.engFilter.frequency.setTargetAtTime(220 + 700 * f + (boost ? 500 : 0), t, 0.3);
  }

  /** Soft-lock acquired: rising two-tone blip. */
  lockBlip() {
    this._beep([[880, 0, 0.07], [1318, 0.08, 0.09]], 'square', 0.5);
  }

  /** Warp: fast riser + noise burst + settle. */
  warpSweep() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const g = ctx.createGain();
    osc.connect(g).connect(this.master);
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(1600, t + 0.35);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.85);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(AUDIO.uiGain * 0.8, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.start(t);
    osc.stop(t + 1);
    // wind slam that decays with the flash
    this.windGain.gain.cancelScheduledValues(t);
    this.windGain.gain.setValueAtTime(AUDIO.windMaxGain, t);
  }

  /** UI confirm tick. */
  click() {
    this._beep([[1200, 0, 0.045]], 'square', 0.3);
  }

  /** Inspect card open: three-note codex riser. */
  cardFanfare() {
    this._beep(
      [
        [660, 0, 0.06],
        [880, 0.07, 0.06],
        [1320, 0.14, 0.1],
      ],
      'square',
      0.4
    );
  }

  /** New spot logged: two-tone stamp — pitch rises with the rarity tier. */
  spotBlip(tierIndex = 0) {
    const base = 740 + tierIndex * 130;
    this._beep(
      [
        [base, 0, 0.07],
        [base * 1.5, 0.08, 0.12],
      ],
      'triangle',
      0.55
    );
  }

  _beep(notes, type, gainScale) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    for (const [hz, at, dur] of notes) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(AUDIO.uiGain * gainScale, t0 + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.05);
    }
  }

  dispose() {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

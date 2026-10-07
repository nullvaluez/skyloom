/**
 * MULTIPLAYER — clock sync and dead reckoning to the PRESENT (MULTIPLAYER.md
 * §Client; design §5). Pure: no DOM, no three, no timers. The session
 * (lib/fly/mp/session.js) feeds it relay samples and asks it for poses once a
 * frame; scripts/verify-mp-motion.mjs drives it with simulated trajectories.
 *
 * Time. Every `now` here is RELAY milliseconds — ClockSync.serverNow() of the
 * client clock — and every sample time is the u32 relay ms a batch record
 * carries, compared wrap-aware. Rendering every pilot at the relay's present
 * (not at a buffered past) is what lets two screens agree on a formation, up
 * to the dead-reckoning error.
 *
 * RemoteMotion keeps only the NEWEST sample (plus the previous heading/time
 * for a turn rate) and an error term: a new sample adds
 * predict(old, now) − predict(new, now) to it and the render is
 * predict(new, now) + error, with the error decaying over dr.errorDecaySec —
 * so a correction glides in instead of popping.
 */
import { MULTIPLAYER } from '../fly-constants.js';
import { DEG2RAD, mercatorScale } from '../coords.js';
import { mercatorWorldXZ } from '../traffic-engine.js';
import { F, wrapPi } from './protocol.mjs';

const TAU = Math.PI * 2;
const U32 = 4294967296;
// Attitude (bank/pitch) corrections glide over this — samples land at 10 Hz
// (1 Hz on the far tier) and a raw step reads as a twitch at 60 fps. Short on
// purpose: the attitude is the newest sample's, not extrapolated.
const ATTITUDE_DECAY_SEC = 0.1;
const MAX_LEAD_SEC = -0.5; // a sample from the future renders at most this far back

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Wrap-aware relay-ms difference `now − ts` (now a float, ts a u32 or float). */
export function msSince(now, ts) {
  const d = now - ts;
  return d - U32 * Math.round(d / U32);
}

/**
 * NTP-style offset between the client clock (performance.now) and the relay's.
 * Each pong gives rtt = recv − c and offset = s − (c + recv)/2; the
 * minimum-RTT sample of the last `keep` wins (its error is at most half its
 * path asymmetry). Kept apart from the ADS-B engine's _skewSec on purpose.
 */
export class ClockSync {
  constructor(keep = 8) {
    this.keep = keep;
    this._rtt = new Float64Array(keep);
    this._off = new Float64Array(keep);
    this.reset();
  }

  reset() {
    this._n = 0;
    this._i = 0;
    this.offset = 0;
    this.rtt = Infinity;
    this.ready = false;
  }

  /** A pong: c = client ms the ping left, s = relay ms, recv = client ms it arrived. */
  add(c, s, recv) {
    if (!Number.isFinite(c) || !Number.isFinite(s) || !Number.isFinite(recv)) return false;
    const rtt = recv - c;
    if (rtt < 0) return false;
    this._rtt[this._i] = rtt;
    this._off[this._i] = s - (c + recv) / 2;
    this._i = (this._i + 1) % this.keep;
    this._n = Math.min(this.keep, this._n + 1);
    let best = 0;
    for (let i = 1; i < this._n; i++) if (this._rtt[i] < this._rtt[best]) best = i;
    this.offset = this._off[best];
    this.rtt = this._rtt[best];
    this.ready = true;
    return true;
  }

  /** Relay ms for a client ms (a float; `>>> 0` makes it a wire u32). */
  serverNow(clientMs) {
    return clientMs + this.offset;
  }
}

// Scratch for the old/new predictions inside push() (single-threaded).
const _old = { x: 0, y: 0, z: 0, yaw: 0 };
const _new = { x: 0, y: 0, z: 0, yaw: 0 };

/**
 * One remote pilot's motion. push() a relay record, render() at a relay time.
 * render() writes {x, y, z, yaw, pitch, bank, vE, vN, vUp, latRad, t, opacity,
 * stale} — x/z ABSOLUTE world mercator (z = −north), y MSL metres, yaw =
 * heading (0 = north, clockwise), velocities TRUE m/s.
 */
export class RemoteMotion {
  constructor(dr = MULTIPLAYER.dr, signals = MULTIPLAYER.signals) {
    this.dr = dr;
    this.sig = signals;
    this.has = false;
    // the newest sample
    this.t = 0; // relay ms (u32)
    this.flags = 0;
    this.warpSeq = 0;
    this.lat = 0;
    this.lonU = 0; // unwrapped toward the viewer's longitude
    this.x0 = 0; // its world position
    this.z0 = 0;
    this.k = 1; // mercatorScale(lat)
    this.alt = 0;
    this.heading = 0;
    this.pitch = 0;
    this.bank = 0;
    this.speed = 0;
    this.vUp = 0;
    this.omega = 0; // rad/s from the previous heading
    this.interval = 1000; // observed sample spacing, ms (EMA)
    // error (position in world units, heading and attitude in rad)
    this.ex = 0;
    this.ey = 0;
    this.ez = 0;
    this.eh = 0;
    this.ep = 0;
    this.eb = 0;
    this.errAt = 0;
    this.snapEpoch = 0;
    this.dipUntil = 0;
    this.dipping = false;
    this.enterAt = 0;
    this.waveAt = 0;
    this.waving = false;
  }

  /**
   * Take a relay record ({sampleTs, flags, warpSeq, lat, lon, alt, heading,
   * pitch, bank, speed, vUp} — readBatch's shape) at relay time `now`.
   * `refLon` is the viewer's own (unbounded) longitude: the sample's
   * longitude is unwrapped to the image nearest it, so a pilot across the
   * antimeridian draws beside you, not 40,000 km away. Returns false when the
   * record is not newer than the one held.
   */
  push(r, now, refLon = 0) {
    const lonU = r.lon + 360 * Math.round((refLon - r.lon) / 360);
    if (!this.has) {
      this._take(r, lonU);
      this.omega = 0;
      this.has = true;
      this.enterAt = now;
      this.errAt = now;
      return true;
    }
    const dtMs = (r.sampleTs - this.t) | 0;
    if (dtMs <= 0) return false;
    this._decay(now);
    this._predict(now, _old);
    const oldPitch = this.pitch;
    const oldBank = this.bank;
    const warp = (r.warpSeq & 0xff) !== this.warpSeq;
    // An unwrap image change: the drawn longitude would leap by 360°. (A pilot
    // simply crossing ±180° keeps a continuous unwrapped longitude: no snap.)
    const image = Math.abs(lonU - this.lonU) > 180;
    let omega = 0;
    if (!warp && !image && dtMs >= 50 && dtMs <= 1500) {
      omega = clamp(wrapPi(r.heading - this.heading) / (dtMs / 1000), -this.dr.maxTurnRad, this.dr.maxTurnRad);
    }
    if (dtMs <= 5000) this.interval += (dtMs - this.interval) * 0.3;
    this._take(r, lonU);
    this.omega = omega;
    if (warp || image) {
      this._snap(now, warp);
      return true;
    }
    this._predict(now, _new);
    this.ex += _old.x - _new.x;
    this.ey += _old.y - _new.y;
    this.ez += _old.z - _new.z;
    this.eh = wrapPi(this.eh + wrapPi(_old.yaw - _new.yaw));
    this.ep += oldPitch - this.pitch;
    this.eb = wrapPi(this.eb + wrapPi(oldBank - this.bank));
    if (Math.hypot(this.ex / this.k, this.ey, this.ez / this.k) > this.dr.snapErrorM) this._snap(now, false);
    return true;
  }

  /** A received wave: rock the wings (additive bank) for signals.waveSec. */
  startWave(now) {
    this.waveAt = now;
    this.waving = true;
  }

  /** The wave's additive bank (rad) at `now`: ±waveRockDeg at waveHz under a flat-top envelope. */
  waveOffset(now) {
    if (!this.waving) return 0;
    const W = this.sig.waveSec;
    const tau = msSince(now, this.waveAt) / 1000;
    if (tau < 0) return 0;
    if (tau >= W) {
      this.waving = false;
      return 0;
    }
    const ramp = Math.min(0.3, W / 4);
    const env = smooth01(tau / ramp) * smooth01((W - tau) / ramp);
    return this.sig.waveRockDeg * DEG2RAD * env * Math.sin(TAU * this.sig.waveHz * tau);
  }

  /** The drawn pose at relay time `now` into `o` (see the class comment). */
  render(now, o) {
    this._decay(now);
    this._predict(now, o);
    o.x += this.ex;
    o.y += this.ey;
    o.z += this.ez;
    o.yaw = wrapPi(o.yaw + this.eh);
    o.pitch = clamp(this.pitch + this.ep, -Math.PI / 2, Math.PI / 2);
    o.bank = wrapPi(this.bank + this.eb + this.waveOffset(now));
    o.latRad = this.lat * DEG2RAD;
    o.t = this.t / 1000;
    const fade = this.dr.enterFadeSec > 0 ? msSince(now, this.enterAt) / 1000 / this.dr.enterFadeSec : 1;
    if (fade < 1) o.opacity *= Math.max(0, fade);
    if (this.dipping) {
      if (msSince(now, this.dipUntil) < 0) o.opacity = Math.min(o.opacity, 0.25);
      else this.dipping = false;
    }
    return o;
  }

  _take(r, lonU) {
    this.t = r.sampleTs >>> 0;
    this.flags = r.flags;
    this.warpSeq = r.warpSeq & 0xff;
    this.lat = r.lat;
    this.lonU = lonU;
    const w = mercatorWorldXZ(lonU, r.lat);
    this.x0 = w.x;
    this.z0 = w.z;
    this.k = mercatorScale(r.lat);
    this.alt = r.alt;
    this.heading = r.heading;
    this.pitch = r.pitch;
    this.bank = r.bank;
    this.speed = r.speed;
    this.vUp = r.vUp;
  }

  // The turn rate survives an error snap: it came from two good samples (a
  // warp or an image change already computed it as 0). Zeroing it here made a
  // fast 1 Hz turner overshoot past snapErrorM on every sample — a snap cascade.
  _snap(now, dip) {
    this.ex = this.ey = this.ez = this.eh = this.ep = this.eb = 0;
    this.errAt = now;
    this.snapEpoch++;
    if (dip) {
      this.dipping = true;
      this.dipUntil = now + this.dr.snapDipMs;
    }
  }

  _decay(now) {
    const dt = msSince(now, this.errAt) / 1000;
    this.errAt = now;
    if (!(dt > 0)) return;
    const f = Math.exp(-dt / this.dr.errorDecaySec);
    this.ex *= f;
    this.ey *= f;
    this.ez *= f;
    this.eh *= f;
    const fa = Math.exp(-dt / ATTITUDE_DECAY_SEC);
    this.ep *= fa;
    this.eb *= fa;
  }

  /**
   * The newest sample carried to `now` (no error, no wave) — position,
   * heading, velocities and the freshness ladder:
   *   age ≤ max(freshSec, 2.5 × interval)  full DR, stale 0, opacity 1
   *   up to + dimSec                        horizontal DR continues straight,
   *                                         climb stops; stale 1, opacity 0.6
   *   beyond                                pose held; stale 2, opacity 0.3
   *   HELD                                  pose held, velocities 0; stale 2, opacity 0.5
   *   CRASHED                               the newest pose, no extrapolation
   */
  _predict(now, o) {
    const dr = this.dr;
    const age = Math.max(MAX_LEAD_SEC, msSince(now, this.t) / 1000);
    const fresh = Math.max(dr.freshSec, (2.5 * this.interval) / 1000);
    let ageH = age;
    let ageV = age;
    let moving = true;
    let climbing = true;
    o.stale = 0;
    o.opacity = 1;
    if (this.flags & F.HELD) {
      ageH = ageV = 0;
      moving = false;
      o.stale = 2;
      o.opacity = 0.5;
    } else {
      if (age > fresh + dr.dimSec) {
        ageH = fresh + dr.dimSec;
        ageV = fresh;
        moving = false;
        o.stale = 2;
        o.opacity = 0.3;
      } else if (age > fresh) {
        ageV = fresh;
        climbing = false;
        o.stale = 1;
        o.opacity = 0.6;
      }
      if (this.flags & F.CRASHED) {
        ageH = ageV = 0;
        moving = false;
      }
    }
    const vxz = this.speed * Math.cos(this.pitch);
    const w = this.omega;
    const tArc = Math.min(ageH, dr.maxArcSec);
    const h0 = this.heading;
    const h1 = h0 + w * tArc;
    let east;
    let north;
    if (Math.abs(w) > 1e-4) {
      const r = vxz / w;
      east = r * (Math.cos(h0) - Math.cos(h1));
      north = r * (Math.sin(h1) - Math.sin(h0));
    } else {
      east = vxz * Math.sin(h0) * tArc;
      north = vxz * Math.cos(h0) * tArc;
    }
    if (ageH > tArc) {
      const s = (ageH - tArc) * vxz;
      east += s * Math.sin(h1);
      north += s * Math.cos(h1);
    }
    o.x = this.x0 + east * this.k;
    o.z = this.z0 - north * this.k;
    o.y = this.alt + this.vUp * ageV;
    o.yaw = h1;
    if (moving) {
      o.vE = vxz * Math.sin(h1);
      o.vN = vxz * Math.cos(h1);
      o.vUp = climbing ? this.vUp : 0;
    } else {
      o.vE = 0;
      o.vN = 0;
      o.vUp = 0;
    }
    return o;
  }
}

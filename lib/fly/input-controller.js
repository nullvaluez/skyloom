import { FLIGHT } from './fly-constants';

/**
 * Keyboard + mouse → one normalized command struct per frame.
 *
 * Default scheme is mouse-steer: the cursor's offset from screen center is
 * the direction command (deadzone + expo), so you point where to fly.
 * WASD/QE and arrows are an equivalent fallback and add on top.
 * Hold RMB for free-look (drag deltas orbit the chase camera, snap back on
 * release). 1/2/3 select speed presets; holding Shift boosts.
 *
 * Pure module: attach(container) binds listeners, read() returns commands.
 */
export class InputController {
  constructor() {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0 }; // -1..1 from viewport center
    this.mouseActive = false; // becomes true on first move (avoid startup lurch)
    this.freeLook = { active: false, dx: 0, dy: 0 };
    this.speedPreset = 'cruise';
    this._el = null;
    this._handlers = [];
    this._pressed = new Set(); // edge-triggered keys, eaten by consumePress()
  }

  /** One-shot key press (edge, not hold). Consuming clears it. */
  consumePress(key) {
    if (this._pressed.has(key)) {
      this._pressed.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Zero the steering (used while paused): mouse-steer re-arms on the next
   * pointer move, so resuming never inherits a stale cursor offset.
   */
  neutralize() {
    this.mouse.x = 0;
    this.mouse.y = 0;
    this.mouseActive = false;
    this._pressed.clear();
  }

  attach(el) {
    this._el = el;
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._handlers.push([target, type, fn]);
    };

    on(window, 'keydown', (e) => {
      if (e.repeat) return;
      // Typing in an overlay field (Atlas search) must not steer the plane
      // or flip speed presets.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      this._pressed.add(k);
      if (k === '1') this.speedPreset = 'slow';
      if (k === '2') this.speedPreset = 'cruise';
      if (k === '3') this.speedPreset = 'boost';
    });
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on(window, 'blur', () => this.keys.clear());

    on(el, 'pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (this.freeLook.active) {
        // Browsers coalesce fast pointermoves and the delivered event's
        // movementX can drop the intermediate deltas — sum the coalesced
        // list (round 7; also captures full precision from high-Hz mice).
        const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || null;
        if (list && list.length > 1) {
          for (const ev of list) {
            this.freeLook.dx += ev.movementX / r.width;
            this.freeLook.dy += ev.movementY / r.height;
          }
        } else {
          this.freeLook.dx += e.movementX / r.width;
          this.freeLook.dy += e.movementY / r.height;
        }
      } else {
        this.mouse.x = nx;
        this.mouse.y = ny;
        this.mouseActive = true;
      }
    });
    on(el, 'pointerdown', (e) => {
      if (e.button === 2) {
        this.freeLook.active = true;
        this.freeLook.dx = 0;
        this.freeLook.dy = 0;
        // Capture so the drag keeps orbiting when the cursor leaves the
        // canvas (round 7: full 360° sweeps routinely exit the window).
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* capture unsupported (synthetic pointer) — drag still works on-canvas */
        }
      }
    });
    on(window, 'pointerup', (e) => {
      if (e.button === 2) this.freeLook.active = false;
    });
    on(el, 'pointercancel', () => {
      this.freeLook.active = false;
    });
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(el, 'pointerleave', () => {
      // Cursor left the canvas: relax to neutral so the plane flies straight
      this.mouse.x = 0;
      this.mouse.y = 0;
    });
  }

  detach() {
    for (const [t, type, fn] of this._handlers) t.removeEventListener(type, fn);
    this._handlers = [];
    this.keys.clear();
  }

  /** Deadzone + expo shaping for one mouse axis. */
  _shape(v) {
    const dz = FLIGHT.mouseDeadzone;
    const a = Math.abs(v);
    if (a < dz) return 0;
    const t = Math.min(1, (a - dz) / (1 - dz));
    return Math.sign(v) * Math.pow(t, FLIGHT.mouseExpo);
  }

  /** Normalized commands for this frame. */
  read() {
    const k = this.keys;
    let turn = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let pitch = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);

    if (this.mouseActive && !this.freeLook.active) {
      turn += this._shape(this.mouse.x);
      pitch += this._shape(-this.mouse.y); // cursor up = pull up
    }

    return {
      turn: Math.max(-1, Math.min(1, turn)),
      pitch: Math.max(-1, Math.min(1, pitch)),
      speedPreset: this.speedPreset,
      boost: k.has('shift'),
      freeLook: this.freeLook,
    };
  }
}

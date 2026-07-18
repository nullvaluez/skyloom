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
 * Touch (mobile) scheme: the on-screen TouchControls overlay drives this
 * imperatively — setTouchSteer() feeds a virtual stick, setSpeedPreset()/
 * setBoost() the throttle, setLookActive()/addLook() the free-look orbit.
 * Canvas pointer events from touch are ignored for steering (so a tap on the
 * world only inspects a plane, never lurches the stick); mouse users on the
 * same page keep the desktop scheme (the gate is per-event on pointerType).
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
    // Touch (virtual-stick) state — written by TouchControls, read in read()
    this.touch = { x: 0, y: 0, active: false }; // -1..1 stick deflection
    this.touchBoost = false; // hold-boost from the throttle
    this._el = null;
    this._handlers = [];
    this._pressed = new Set(); // edge-triggered keys, eaten by consumePress()
  }

  /** Virtual steering stick (TouchControls). x,y ∈ -1..1; y+ = pull up. */
  setTouchSteer(x, y) {
    this.touch.x = x;
    this.touch.y = y;
    this.touch.active = true;
  }

  /** Release the virtual stick — the plane relaxes to level, like the mouse
   *  returning to center. */
  clearTouchSteer() {
    this.touch.x = 0;
    this.touch.y = 0;
    this.touch.active = false;
  }

  /** Throttle detent from the on-screen rail (mirrors the 1/2/3 keys). */
  setSpeedPreset(preset) {
    this.speedPreset = preset;
  }

  /** Hold-boost from a touch button (mirrors holding Shift). */
  setBoost(on) {
    this.touchBoost = on;
  }

  /** Enter/leave touch free-look. Leaving zeroes any pending orbit delta so
   *  the camera snaps home instead of inheriting a stale drag. */
  setLookActive(active) {
    this.freeLook.active = active;
    if (!active) {
      this.freeLook.dx = 0;
      this.freeLook.dy = 0;
    }
  }

  /** Feed an orbit delta (screen fractions) — same units RMB drag produces. */
  addLook(dxFrac, dyFrac) {
    this.freeLook.dx += dxFrac;
    this.freeLook.dy += dyFrac;
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
    // Touch: drop the virtual stick + any held boost/look so an overlay that
    // opened mid-gesture (inspect/atlas/pause) can't leave the plane steering
    // or the camera orbiting on stale deflection. TouchControls re-arms on the
    // next touch.
    this.touch.x = 0;
    this.touch.y = 0;
    this.touch.active = false;
    this.touchBoost = false;
    this.freeLook.active = false;
    this.freeLook.dx = 0;
    this.freeLook.dy = 0;
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
      // Touch steers via the on-screen stick (setTouchSteer), never the
      // canvas — so tapping/dragging the world only inspects, never lurches
      // the plane. Mouse/pen fall through to the desktop mouse-steer path.
      if (e.pointerType === 'touch') return;
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

    // Virtual stick (touch): same expo shaping as the mouse, and suppressed
    // in free-look just like the mouse so orbiting never also banks.
    if (this.touch.active && !this.freeLook.active) {
      turn += this._shape(this.touch.x);
      pitch += this._shape(-this.touch.y); // stick up = pull up
    }

    return {
      turn: Math.max(-1, Math.min(1, turn)),
      pitch: Math.max(-1, Math.min(1, pitch)),
      speedPreset: this.speedPreset,
      boost: k.has('shift') || this.touchBoost,
      freeLook: this.freeLook,
    };
  }
}

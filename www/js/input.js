// Sky Highway — unified touch + keyboard input.
//
// Touch model: horizontal drag anywhere on the play surface steers (relative,
// continuous — not lane-snapped). A quick tap (<200ms, <12px travel) jumps.
// Dedicated HUD buttons (jump / fire / slow-mo) are wired by main.js and call
// the same triggers. Keyboard: arrows/AD steer, Space jumps, F fires, P pauses.

const TAP_MS = 200;
const TAP_PX = 12;
const PX_PER_LANE = 55; // drag sensitivity: CSS px per full lane of steering

export class Input {
  constructor(surface) {
    this.axis = 0;            // -1..1 smoothed steering
    this._jumpQueued = false;
    this.jumpHeld = false;    // true while the jump button / Space is held (sustains the jump)
    this._fireQueued = false;
    this._keys = new Set();
    this._pauseCbs = [];
    this._steerPointer = null; // { id, lastX, downX, downY, downT }
    this._dragVel = 0;         // lanes of drag since last frame (consumed by game)
    this._dragAccum = 0;

    // --- pointer events ---
    surface.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return; // HUD buttons handle themselves
      if (this._steerPointer === null) {
        this._steerPointer = { id: e.pointerId, lastX: e.clientX, downX: e.clientX, downY: e.clientY, downT: performance.now() };
        try { surface.setPointerCapture?.(e.pointerId); } catch { /* synthetic events have no active pointer */ }
      }
    });
    surface.addEventListener('pointermove', (e) => {
      const p = this._steerPointer;
      if (p && e.pointerId === p.id) {
        this._dragAccum += (e.clientX - p.lastX) / PX_PER_LANE;
        p.lastX = e.clientX;
      }
    });
    const end = (e) => {
      const p = this._steerPointer;
      if (p && e.pointerId === p.id) {
        const dt = performance.now() - p.downT;
        const dist = Math.hypot(e.clientX - p.downX, e.clientY - p.downY);
        if (dt < TAP_MS && dist < TAP_PX) this._jumpQueued = true;
        this._steerPointer = null;
      } else if (e.type === 'pointerup' && !e.target.closest('button')) {
        // secondary finger quick tap also jumps (two-thumb play);
        // HUD button pointerups bubble here too and must not count
        this._jumpQueued = true;
      }
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', (e) => {
      if (this._steerPointer && e.pointerId === this._steerPointer.id) this._steerPointer = null;
    });

    // --- keyboard ---
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'arrowup' || k === 'w') { this.pressJump(); e.preventDefault(); }
      else if (k === 'f' || k === 'control') this._fireQueued = true;
      else if (k === 'p' || k === 'escape') this._pauseCbs.forEach((cb) => cb());
      else this._keys.add(k);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'arrowup' || k === 'w') this.releaseJump();
      else this._keys.delete(k);
    });
    window.addEventListener('blur', () => { this._keys.clear(); this.jumpHeld = false; });
  }

  // Drop all transient state (drag accumulation, leaked steer pointer, queued
  // taps). Called whenever play (re)starts: drag builds up unconsumed while
  // the game is not in the running state (menus, crash, rewind animation) and
  // would otherwise be dumped into steering on the first running frame.
  reset() {
    this._dragAccum = 0;
    this._dragVel = 0;
    this._steerPointer = null;
    this._jumpQueued = false;
    this._fireQueued = false;
  }

  // called once per rendered frame by the game loop
  update() {
    let target = 0;
    if (this._keys.has('arrowleft') || this._keys.has('a')) target -= 1;
    if (this._keys.has('arrowright') || this._keys.has('d')) target += 1;
    // keyboard: ease toward target; touch drag overrides via dragDelta
    this.axis += (target - this.axis) * 0.35;
    if (Math.abs(this.axis) < 0.01 && target === 0) this.axis = 0;
  }

  // lanes of steering wheel-style drag since last call (touch)
  consumeDrag() {
    const d = this._dragAccum;
    this._dragAccum = 0;
    return d;
  }

  get touching() { return this._steerPointer !== null; }

  consumeJump() {
    const j = this._jumpQueued;
    this._jumpQueued = false;
    return j;
  }
  // legacy tap jump (tap-anywhere, tests): queues without holding -> short hop
  queueJump() { this._jumpQueued = true; }
  // press/release pair for the HUD button and keyboard: hold to jump higher
  pressJump() { this._jumpQueued = true; this.jumpHeld = true; }
  releaseJump() { this.jumpHeld = false; }

  consumeFire() {
    const f = this._fireQueued;
    this._fireQueued = false;
    return f;
  }
  queueFire() { this._fireQueued = true; }

  onPause(cb) { this._pauseCbs.push(cb); }
}

// Keyboard/mouse state with per-frame edge detection and pointer-lock management.

export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC', 'ControlLeft'], prone: ['KeyZ'], jump: ['Space'],
  interact: ['KeyE'], use: ['KeyF'], reload: ['KeyR'], firemode: ['KeyB'], light: ['KeyT'], holster: ['KeyX'],
  inventory: ['Tab', 'KeyI'], map: ['KeyM'], build: ['KeyG'], craft: ['KeyH'], pause: ['Escape', 'KeyP'], inspect: ['KeyY'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'],
  quick1: ['Digit5'], quick2: ['Digit6'], quick3: ['Digit7'], quick4: ['Digit8'],
  rotate: ['KeyQ'], vehLights: ['KeyL'], journal: ['KeyJ'], marker: ['KeyN'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: new Set(), pressedButtons: new Set(), releasedButtons: new Set() };
    this.locked = false;
    this.enabled = true;
    this.uiCapture = false; // when a menu is open, game keys are not processed
    this.onLockChange = null;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab' || (this.locked && (e.code === 'Space' || e.code.startsWith('Arrow')))) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouse.buttons.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // guard against browser spikes when pointer lock engages
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouse.buttons.add(e.button);
      this.mouse.pressedButtons.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.buttons.delete(e.button);
      this.mouse.releasedButtons.add(e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (this.locked) this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.mouse.buttons.clear();
      }
      this.onLockChange?.(this.locked, false, was);
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this.onLockChange?.(false, true, false);
    });
  }

  lock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* ignore */ }
      });
    } catch {
      try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* ignore */ }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  is(action) {
    return BINDINGS[action].some((c) => this.down.has(c));
  }

  hit(action) {
    return BINDINGS[action].some((c) => this.pressed.has(c));
  }

  up(action) {
    return BINDINGS[action].some((c) => this.released.has(c));
  }

  button(b) {
    return this.mouse.buttons.has(b);
  }

  buttonHit(b) {
    return this.mouse.pressedButtons.has(b);
  }

  consumeMouse() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel };
    this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.pressedButtons.clear();
    this.mouse.releasedButtons.clear();
  }

  /** Synthetic input for automated tests. */
  simulate(code, isDown) {
    if (isDown) { if (!this.down.has(code)) this.pressed.add(code); this.down.add(code); }
    else { this.down.delete(code); this.released.add(code); }
  }
}

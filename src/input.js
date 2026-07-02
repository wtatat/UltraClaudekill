export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouse0 = false; // left held
    this.mouse2 = false; // right held
    this.pressed = new Set();   // keys pressed this frame
    this.clicked0 = false;      // left pressed this frame
    this.locked = false;
    this.sensitivity = 0.0023;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ShiftLeft', 'ControlLeft', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.mouse0 = false; this.mouse2 = false; }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse0 = true; this.clicked0 = true; }
      if (e.button === 2) this.mouse2 = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse0 = false;
      if (e.button === 2) this.mouse2 = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock() {
    this.canvas.requestPointerLock();
  }

  consumeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return [dx, dy];
  }

  endFrame() {
    this.pressed.clear();
    this.clicked0 = false;
  }

  down(code) { return this.keys.has(code); }
  justPressed(code) { return this.pressed.has(code); }
}

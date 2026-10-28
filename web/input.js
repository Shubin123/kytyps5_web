const PS5_CROSS    = 1 << 0;
const PS5_CIRCLE   = 1 << 1;
const PS5_SQUARE   = 1 << 2;
const PS5_TRIANGLE = 1 << 3;
const PS5_L1       = 1 << 4;
const PS5_R1       = 1 << 5;
const PS5_L2       = 1 << 6;
const PS5_R2       = 1 << 7;
const PS5_CREATE   = 1 << 8;
const PS5_OPTIONS  = 1 << 9;
const PS5_L3       = 1 << 10;
const PS5_R3       = 1 << 11;
const PS5_UP       = 1 << 12;
const PS5_DOWN     = 1 << 13;
const PS5_LEFT     = 1 << 14;
const PS5_RIGHT    = 1 << 15;
const PS5_PS       = 1 << 16;
const PS5_TOUCHPAD = 1 << 17;

const DEADZONE = 0.12;

function applyDeadzone(v) {
  if (Math.abs(v) < DEADZONE) return 0;
  return (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
}

export class InputManager {
  constructor(canvas) {
    this._canvas = canvas;
    this._keys = new Set();
    this._gamepadIndex = null;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      if (document.activeElement === canvas) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
    });
    window.addEventListener('gamepadconnected', (e) => {
      this._gamepadIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this._gamepadIndex === e.gamepad.index) this._gamepadIndex = null;
    });
  }

  poll() {
    const result = { buttons: 0, lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0 };
    this._pollKeyboard(result);
    this._pollGamepad(result);
    return result;
  }

  _pollKeyboard(r) {
    const k = this._keys;
    if (k.has('KeyZ') || k.has('Enter'))   r.buttons |= PS5_CROSS;
    if (k.has('KeyX'))                      r.buttons |= PS5_CIRCLE;
    if (k.has('KeyA'))                      r.buttons |= PS5_SQUARE;
    if (k.has('KeyS'))                      r.buttons |= PS5_TRIANGLE;
    if (k.has('KeyQ'))                      r.buttons |= PS5_L1;
    if (k.has('KeyE'))                      r.buttons |= PS5_R1;
    if (k.has('Digit1'))                    r.buttons |= PS5_L2;
    if (k.has('Digit3'))                    r.buttons |= PS5_R2;
    if (k.has('Tab'))                       r.buttons |= PS5_CREATE;
    if (k.has('Escape'))                    r.buttons |= PS5_OPTIONS;
    if (k.has('ArrowUp') || k.has('KeyW'))  r.buttons |= PS5_UP;
    if (k.has('ArrowDown'))                 r.buttons |= PS5_DOWN;
    if (k.has('ArrowLeft'))                 r.buttons |= PS5_LEFT;
    if (k.has('ArrowRight'))                r.buttons |= PS5_RIGHT;

    if (k.has('ArrowUp') || k.has('KeyW'))  r.ly = Math.min(r.ly, -1);
    if (k.has('ArrowDown') || k.has('KeyS') && !k.has('KeyA') ? false : k.has('KeyS') ? false : false) {} // handled by d-pad
    if (k.has('ArrowLeft') || k.has('KeyA') && !r.buttons) {} // handled by d-pad
    // Keyboard left-stick emulation via WASD (d-pad takes priority above)
    let kx = 0, ky = 0;
    if (k.has('KeyW')) ky -= 1;
    if (k.has('ArrowDown')) ky += 1;
    if (k.has('ArrowLeft')) kx -= 1;
    if (k.has('ArrowRight')) kx += 1;
    if (kx || ky) {
      const mag = Math.sqrt(kx * kx + ky * ky);
      r.lx = kx / mag;
      r.ly = ky / mag;
    }

    if (k.has('Digit1')) r.l2 = 1;
    if (k.has('Digit3')) r.r2 = 1;
  }

  _pollGamepad(r) {
    if (this._gamepadIndex === null) return;
    const gp = navigator.getGamepads()[this._gamepadIndex];
    if (!gp) return;

    // Standard mapping (DualSense over standard mapping):
    // 0=Cross, 1=Circle, 2=Square, 3=Triangle
    // 4=L1, 5=R1, 6=L2, 7=R2
    // 8=Create, 9=Options, 10=L3, 11=R3
    // 12=Up, 13=Down, 14=Left, 15=Right, 16=PS, 17=Touchpad
    const map = [
      PS5_CROSS, PS5_CIRCLE, PS5_SQUARE, PS5_TRIANGLE,
      PS5_L1, PS5_R1, PS5_L2, PS5_R2,
      PS5_CREATE, PS5_OPTIONS, PS5_L3, PS5_R3,
      PS5_UP, PS5_DOWN, PS5_LEFT, PS5_RIGHT,
      PS5_PS, PS5_TOUCHPAD,
    ];
    for (let i = 0; i < gp.buttons.length && i < map.length; i++) {
      if (gp.buttons[i].pressed) r.buttons |= map[i];
    }

    const lx = applyDeadzone(gp.axes[0] || 0);
    const ly = applyDeadzone(gp.axes[1] || 0);
    const rx = applyDeadzone(gp.axes[2] || 0);
    const ry = applyDeadzone(gp.axes[3] || 0);
    if (lx) r.lx = lx;
    if (ly) r.ly = ly;
    if (rx) r.rx = rx;
    if (ry) r.ry = ry;

    // Analog triggers (axes 4/5 on some mappings, or button.value)
    if (gp.buttons[6]) r.l2 = Math.max(r.l2, gp.buttons[6].value);
    if (gp.buttons[7]) r.r2 = Math.max(r.r2, gp.buttons[7].value);
  }
}

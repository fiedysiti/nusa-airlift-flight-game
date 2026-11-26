// Keyboard input for Nusa Airlift. Arrows or WASD fly; Shift/Ctrl throttle;
// F flaps, C camera, M mute, R reset, Enter starts, P pauses.
export function createInput() {
  const keys = new Set();
  const pressed = new Set();

  function onDown(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
  }
  function onUp(e) { keys.delete(e.code); }
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);

  return {
    // -1..1 pitch (positive = nose up), -1..1 roll (positive = bank right).
    read() {
      const up = keys.has('ArrowUp') || keys.has('KeyW');
      const down = keys.has('ArrowDown') || keys.has('KeyS');
      const left = keys.has('ArrowLeft') || keys.has('KeyA');
      const right = keys.has('ArrowRight') || keys.has('KeyD');
      return {
        pitch: (up ? 1 : 0) - (down ? 1 : 0),
        roll: (right ? 1 : 0) - (left ? 1 : 0),
        throttleUp: keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('Equal'),
        throttleDown: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('Minus'),
      };
    },
    // True once per physical press; consumed after reading.
    wasPressed(code) {
      if (pressed.has(code)) { pressed.delete(code); return true; }
      return false;
    },
    endFrame() { pressed.clear(); },
  };
}

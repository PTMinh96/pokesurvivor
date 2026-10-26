/* ============ input.js — keyboard and mouse (touch is in touch.js, controller in gamepad.js) ============ */
G.Input = (() => {
  const down = new Set();
  const pressed = new Set();   // cleared each frame
  let mx = 0, my = 0, mdown = false;

  const MOVE_KEYS = {
    up: ['keyw', 'arrowup'], down: ['keys', 'arrowdown'],
    left: ['keya', 'arrowleft'], right: ['keyd', 'arrowright']
  };

  function code(e) { return (e.code || e.key).toLowerCase(); }

  addEventListener('keydown', e => {
    const c = code(e);
    if (!down.has(c)) pressed.add(c);
    down.add(c);
    // Prevent the browser from scrolling with arrows/space during gameplay.
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'space', 'tab'].includes(c)) e.preventDefault();
  });
  addEventListener('keyup', e => down.delete(code(e)));
  addEventListener('blur', () => { down.clear(); });
  let movedAt = 0;               // last mouse movement (manual aiming)
  addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; movedAt = performance.now(); });
  addEventListener('mousedown', () => mdown = true);
  addEventListener('mouseup', () => mdown = false);

  return {
    /** Player movement vector (keyboard, touch joystick, or controller). */
    axis() {
      const t = G.Touch && G.Touch.vector();
      if (t && (t[0] || t[1])) return t;
      const g = G.Pad && G.Pad.vector();
      if (g && (g[0] || g[1])) return g;
      let x = 0, y = 0;
      if (MOVE_KEYS.left.some(k => down.has(k))) x -= 1;
      if (MOVE_KEYS.right.some(k => down.has(k))) x += 1;
      if (MOVE_KEYS.up.some(k => down.has(k))) y -= 1;
      if (MOVE_KEYS.down.some(k => down.has(k))) y += 1;
      return G.U.norm(x, y);
    },
    held(c) { return down.has(c); },
    /** True only on the frame when pressed. */
    tap(c) { return pressed.has(c); },
    /** A non-keyboard press (controller): counts as a keypress for this frame. */
    virtual(c) { pressed.add(c); },
    mouse() { return { x: mx, y: my, down: mdown }; },
    /** Time of the last mouse movement (performance.now). */
    get mouseMovedAt() { return movedAt; },
    /** Mouse position in world coordinates (the canvas fills the window). */
    mouseWorld() { return { x: G.Camera.left() + mx / G.Camera.scale, y: G.Camera.top() + my / G.Camera.scale }; },
    endFrame() { pressed.clear(); }
  };
})();

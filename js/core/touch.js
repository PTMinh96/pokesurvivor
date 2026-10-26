/* ============ touch.js — touch controls ============
 * Floating joystick: touch anywhere on the game screen and it appears there;
 * drag to move and release to hide it. If the finger moves beyond the radius,
 * the base follows it (so it never gets "stuck").
 *
 * HUD buttons (attack icons, pause): the HUD registers them each frame with
 * addButton(); touching (or clicking) one activates it instead of opening the
 * joystick. Multiple fingers work at once.
 *
 * Fixed joystick (Settings > Controls > Arrange Buttons): stays in one place
 * and activates only when touched nearby.
 */
G.Touch = (() => {
  let cv = null, stick = null;
  let active = G.Settings.touch;      // Is touch input active?
  let buttons = [];

  const R = () => 56 * (G.Settings.get('stick') || 1);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** Player-set position for an element ('bar', 'pause', 'stick'): [x, y] in 0..1, or null. */
  function spot(k) { const p = G.Settings.get('pad'); return p && Array.isArray(p[k]) ? p[k] : null; }
  const STICK_DEF = [0.14, 0.72];
  const fixed = () => G.Settings.get('stickMode') === 'fixed';
  /** Fixed joystick center in screen pixels. */
  function stickBase(w = cv.clientWidth, h = cv.clientHeight) {
    const p = spot('stick') || STICK_DEF, r = R();
    return { x: clamp(p[0] * w, r + 4, w - r - 4), y: clamp(p[1] * h, r + 4, h - r - 4) };
  }

  function init(canvas) {
    cv = canvas;
    if (active) document.body.classList.add('touch');
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    // iPhone: a long press on the game opened the magnifier and the
    // "Copy / Select All" menu. Stop the touch here to prevent this (pointer
    // events used by the joystick still arrive).
    // Buttons (moves, pause) are also activated here: on iPhone (Safari and
    // Chrome use WebKit), pointerdown from a second finger sometimes failed
    // while another finger was on the joystick, preventing move changes.
    cv.addEventListener('touchstart', e => {
      if (e.cancelable) e.preventDefault();
      if (!active) { active = true; document.body.classList.add('touch'); }
      for (const t of e.changedTouches) { const b = hit(t.clientX, t.clientY); if (b) press(b); }
    }, { passive: false });
    document.addEventListener('selectstart', e => {
      if (!e.target.closest || !e.target.closest('input, textarea, [contenteditable]')) e.preventDefault();
    });
    addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
  }

  function hit(x, y) {
    for (let i = buttons.length - 1; i >= 0; i--) {
      const b = buttons[i];
      if (x >= b.x - b.pad && x <= b.x + b.w + b.pad && y >= b.y - b.pad && y <= b.y + b.h + b.pad) return b;
    }
    return null;
  }

  // The same touch arrives as touchstart and pointerdown; activate only once.
  let lastKey = '', lastAt = 0;
  function press(b) {
    const k = Math.round(b.x) + ',' + Math.round(b.y), now = performance.now();
    if (k === lastKey && now - lastAt < 350) return;
    lastKey = k; lastAt = now;
    b.fn();
  }

  function down(e) {
    const touchy = e.pointerType !== 'mouse';
    if (touchy && !active) { active = true; document.body.classList.add('touch'); }
    const b = hit(e.clientX, e.clientY);
    if (b) { e.preventDefault(); press(b); return; }
    if (!touchy || stick || !G.Game || G.Game.state !== 'playing') return;
    if (fixed()) {
      // Fixed joystick: only respond when the finger lands nearby.
      const b0 = stickBase();
      if (Math.hypot(e.clientX - b0.x, e.clientY - b0.y) > R() * 2.2) return;
      e.preventDefault();
      stick = { id: e.pointerId, fixed: true, ox: b0.x, oy: b0.y, x: e.clientX, y: e.clientY };
    } else {
      e.preventDefault();
      stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    }
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignored */ }
  }

  function move(e) {
    if (!stick || e.pointerId !== stick.id) return;
    stick.x = e.clientX; stick.y = e.clientY;
    if (stick.fixed) return;
    const dx = stick.x - stick.ox, dy = stick.y - stick.oy, d = Math.hypot(dx, dy), r = R();
    if (d > r) { stick.ox = stick.x - dx / d * r; stick.oy = stick.y - dy / d * r; }
  }

  function up(e) { if (stick && e.pointerId === stick.id) stick = null; }
  function reset() { stick = null; }

  /** Joystick direction (with strength 0..1), or null if unused. */
  function vector() {
    if (!stick) return null;
    const dx = stick.x - stick.ox, dy = stick.y - stick.oy, d = Math.hypot(dx, dy);
    if (d < 7) return [0, 0];
    // Reach full speed at half the joystick radius.
    const k = Math.min(1, (d - 7) / (R() * 0.5 - 7));
    return [dx / d * k, dy / d * k];
  }

  /** iPhone safe-area insets (home bar at the bottom, notches on the sides), in pixels. */
  let safe = null;
  function safeArea() {
    if (safe) return safe;
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(d);
    const cs = getComputedStyle(d);
    safe = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
             bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    d.remove();
    return safe;
  }
  addEventListener('resize', () => { safe = null; });
  addEventListener('orientationchange', () => { safe = null; });
  function resetSafe() { safe = null; }

  /** The HUD clears and re-registers its buttons every frame. */
  function clearButtons() { buttons = []; }
  function addButton(x, y, w, h, fn, pad = 6) { buttons.push({ x, y, w, h, fn, pad }); }

  /** Draw the joystick (screen coordinates, CSS pixels). */
  function draw(ctx) {
    // Always show the fixed joystick (dimmed when idle) so its location is clear.
    const base = !stick && fixed() && active ? stickBase() : null;
    if (!stick && !base) return;
    const s = stick || { ox: base.x, oy: base.y, x: base.x, y: base.y };
    drawStick(ctx, s, R(), base ? 0.55 : 1);
  }
  /** Draw a joystick (also used by the button editor); k: opacity. */
  function drawStick(ctx, stick, r, k = 1) {
    const dx = stick.x - stick.ox, dy = stick.y - stick.oy, d = Math.hypot(dx, dy);
    const kx = stick.ox + (d > r ? dx / d * r : dx), ky = stick.oy + (d > r ? dy / d * r : dy);
    ctx.save();
    ctx.globalAlpha = 0.5 * k;
    ctx.fillStyle = 'rgba(10,20,48,.55)';
    ctx.beginPath(); ctx.arc(stick.ox, stick.oy, r, 0, 6.2832); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#f4f8ff';
    ctx.stroke();
    ctx.globalAlpha = 0.85 * k;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(kx, ky, r * 0.42, 0, 6.2832); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#a55f00'; ctx.stroke();
    ctx.restore();
  }

  return { init, vector, draw, drawStick, clearButtons, addButton, reset, safeArea, resetSafe, spot, stickBase, R, STICK_DEF,
           get active() { return active; }, get stick() { return stick; } };
})();

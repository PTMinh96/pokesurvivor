/* ============ settings.js — device settings ============
 * Saved in the browser (not the account): each PC or phone has its own.
 * Volume is saved separately by audio.js.
 *
 *   quality     'auto' | 'high' | 'mid' | 'low'   effects and particles
 *   dmgNumbers  true/false                        damage numbers
 *   calm        true/false                        reduced screen shake and flashes
 *   fps         true/false                        FPS counter
 *   stick       0.8 | 1 | 1.25                    touch joystick size
 *   stickMode   'float' | 'fixed'                 joystick follows the finger or stays in place
 *   pad         { bar, pause, stick } | null      mobile button positions (center, relative to
 *                                                 the screen); set by layout-ui.js
 *   gamepad     true/false                        use a controller (gamepad.js)
 *   padRumble   true/false                        controller vibrates when taking damage
 *   aimManual   true/false                        aim manually (mouse or right stick) instead of auto-aim
 *
 *   G.Settings.get('quality')  ·  G.Settings.set('fps', true)  ·  G.Settings.on(fn)
 *   G.Settings.fx   effective level 0 (low) .. 2 (high), with 'auto' already resolved
 */
G.Settings = (() => {
  const KEY = 'ps.settings';
  const DEF = { quality: 'auto', dmgNumbers: true, calm: false, fps: false, stick: 1, stickMode: 'float', pad: null, gamepad: true, padRumble: true, aimManual: false };
  let s = Object.assign({}, DEF);
  try { Object.assign(s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* ignored */ }
  const fns = new Set();

  // Automatic quality: start high (medium on mobile) and lower it if performance stutters.
  const touchy = matchMedia('(pointer: coarse)').matches;
  let autoLevel = touchy ? 1 : 2;
  let acc = 0, frames = 0, slowT = 0, fastT = 0;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignored */ } }
  function get(k) { return s[k]; }
  function set(k, v) { s[k] = v; save(); fns.forEach(fn => { try { fn(k, v); } catch (e) { /* ignored */ } }); }

  /** Called by the game loop each frame (only during a run). */
  function sample(dt) {
    if (s.quality !== 'auto' || dt <= 0) return;
    acc += dt; frames++;
    if (acc < 1) return;
    const fps = frames / acc;
    acc = 0; frames = 0;
    // 3 continuous seconds below 45 FPS: lower one level; 8 seconds above 57: raise it.
    if (fps < 45) { slowT++; fastT = 0; } else if (fps > 57) { fastT++; slowT = 0; } else { slowT = fastT = 0; }
    if (slowT >= 3 && autoLevel > 0) { autoLevel--; slowT = 0; }
    if (fastT >= 8 && autoLevel < (touchy ? 1 : 2)) { autoLevel++; fastT = 0; }
  }

  return {
    get, set, sample, DEF,
    on(fn) { fns.add(fn); },
    get all() { return Object.assign({}, s); },
    get fx() { return s.quality === 'auto' ? autoLevel : s.quality === 'high' ? 2 : s.quality === 'mid' ? 1 : 0; },
    get autoLevel() { return autoLevel; },
    get touch() { return touchy; }
  };
})();

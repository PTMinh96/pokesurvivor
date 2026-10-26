/* ============ orbs.js — Mystery Dungeon orbs (single-use during a run) ============
 * Found during a run (chests, bosses, sometimes by defeating a Pokémon) and
 * lost when it ends: they are not saved or synced to the cloud.
 *
 *   4 slots, up to 3 of each orb. If there is no room, it stays on the ground.
 *   Use 5-8, tap its HUD slot, or press X (use) / Y (switch) on a controller.
 *   1 s cooldown between uses.
 *
 * Two classes:
 *   foe   affects enemies (sleep, slow, knockback). In co-op the host applies
 *         them, since the host controls enemies; guests send a request ('ou').
 *   buff  affects you and teammates within half a screen. Each player applies
 *         the buff to themselves upon receiving a nearby-player notice ('ob').
 * Bosses and legendaries are less affected.
 */
G.Orbs = (() => {
  const SLOTS = 4, STACK = 3, CD = 1;
  const NEAR = 384;                 // "Half a screen" (G.Camera.VIEW_W / 2)
  const PUSH = 1700, PUSH_R = 240;  // Blowback Orb pushes them about 1/3 of a screen

  const LIST = [
    { id: 'slumber', name: 'Soporesfera', kind: 'foe', col: '#b39bff',
      desc: 'Duerme a los enemigos de la pantalla 4 s (a los jefes, 1 s).' },
    { id: 'slow', name: 'Ralentosfera', kind: 'foe', col: '#5fd0ff',
      desc: 'Los enemigos de la pantalla van un 50 % más lentos durante 8 s (los jefes, un 20 %).' },
    { id: 'blowback', name: 'Rafagaesfera', kind: 'foe', col: '#9ff0c0',
      desc: 'Lanza lejos a los enemigos que tienes cerca (a los jefes, la mitad).' },
    { id: 'focus', name: 'Focosfera', kind: 'buff', dur: 15, col: '#ff6f7d',
      desc: '+25 % de crítico durante 15 s, para ti y los compañeros cercanos.' },
    { id: 'luminous', name: 'Luminosfera', kind: 'buff', dur: 15, col: '#ffe680',
      desc: 'Ves más campo (la cámara se aleja) durante 15 s, tú y los compañeros cercanos.' },
    { id: 'quick', name: 'Rapidosfera', kind: 'buff', dur: 10, col: '#ffb24d',
      desc: '+40 % de velocidad durante 10 s, para ti y los compañeros cercanos.' }
  ];
  const BY = {};
  for (const o of LIST) BY[o.id] = o;

  let cd = 0, sel = 0;
  const seen = new Set();           // Orbs already explained to you this run

  function roll() { return G.U.pick(LIST).id; }

  // ---------------- each player's bag (pl.orbs = 4 slots: { id, n } or null) ----------------
  // Each orb stays in its slot (and on its key) even when adjacent ones are used.

  const bag = p => p.orbs || (p.orbs = new Array(SLOTS).fill(null));

  function canTake(p, id) {
    const inv = bag(p), s = inv.find(o => o && o.id === id);
    return s ? s.n < STACK : inv.includes(null);
  }

  function add(p, id) {
    if (!BY[id] || !canTake(p, id)) return false;
    const inv = bag(p), s = inv.find(o => o && o.id === id);
    if (s) s.n++; else inv[inv.indexOf(null)] = { id, n: 1 };
    return true;
  }

  /** Remove one from its slot. → true if the player had it. */
  function take(p, id) {
    const inv = bag(p), i = inv.findIndex(o => o && o.id === id);
    if (i < 0) return false;
    if (--inv[i].n <= 0) inv[i] = null;
    return true;
  }

  /** You picked it up: show it and explain what it does the first time this run. */
  function got(pl, id) {
    if (!add(pl, id)) return;
    const o = BY[id];
    // Its slot glows and shows its name for a few seconds (hud.js).
    pl.orbNew = { i: bag(pl).findIndex(s => s && s.id === id), at: performance.now() };
    G.FX.dmgText(pl.x, pl.y - pl.bodyH - 8, G.T(o.name), o.col, true);
    G.FX.ring(pl.x, pl.y, 6, 50, o.col, 0.4, 3);
    if (!seen.has(id)) {
      // First time this run: explain what it does and how to use it.
      seen.add(id);
      const i = bag(pl).findIndex(s => s && s.id === id);
      const how = G.Pad.name ? G.T('X para usarla') : G.Touch.active ? G.T('tócala encima de tus ataques') : G.I18n.f('tecla {x}', i + 5);
      G.Spawner.say(G.T(o.name) + ' (' + how + '): ' + G.T(o.desc), 5);
    }
  }

  // ---------------- use ----------------

  /** Use the orb in slot i (0-3). */
  function use(pl, i) {
    const s = pl.orbs && pl.orbs[i];
    if (!s || cd > 0 || pl.dead || G.Game.state !== 'playing') {
      if (s && cd > 0) G.Audio.sfx('error');
      return;
    }
    cd = CD;
    const id = s.id, o = BY[id];
    take(pl, id);
    G.Audio.sfx('confirm');
    const z = G.Camera.zoom;
    if (o.kind === 'foe') {
      if (!G.Coop.active || G.Coop.isHost) foe(id, pl.x, pl.y, z);
      else ring(id, pl.x, pl.y);
    } else {
      buff(pl, id);
      ring(id, pl.x, pl.y, NEAR);
    }
    if (G.Coop.active) G.Coop.orbUsed(id, pl.x, pl.y, z);
  }

  /** Controller: Y selects the next orb you have; X uses the selected orb. */
  function next(pl) {
    const inv = bag(pl);
    for (let k = 1; k <= SLOTS; k++) if (inv[(sel + k) % SLOTS]) { sel = (sel + k) % SLOTS; G.Audio.sfx('click'); return; }
  }
  function useSelected(pl) {
    const inv = bag(pl);
    if (!inv[sel]) next(pl);
    if (inv[sel]) use(pl, sel);
  }

  function ring(id, x, y, r = 260) { G.FX.ring(x, y, 10, r, BY[id].col, 0.6, 5); }

  /** Affect enemies visible to the user (x, y with their zoom z). Host only (or solo play). */
  function foe(id, x, y, z = 1) {
    ring(id, x, y);
    const hw = G.Camera.VIEW_W / 2 * z + 60, hh = G.Camera.MIN_VIEW_H * 0.75 * z + 60;
    for (const e of G.EnemyMgr.all()) {
      if (e.dead || e.remote) continue;
      const dx = e.x - x, dy = e.y - y, big = e.boss || e.legend || e.judge;
      if (id === 'blowback') {
        if (dx * dx + dy * dy > PUSH_R * PUSH_R) continue;
        const [nx, ny] = G.U.norm(dx || 1, dy);
        e.kx += nx * PUSH * (big ? 0.5 : 1); e.ky += ny * PUSH * (big ? 0.5 : 1);
        continue;
      }
      if (Math.abs(dx) > hw || Math.abs(dy) > hh) continue;
      if (id === 'slumber') e.applySleep(big ? 1 : 4);
      else if (id === 'slow') e.applySlow(big ? 0.2 : 0.5, 8);
    }
  }

  // ---------------- timed buffs (pl.orbBuff = { id: seconds }) ----------------

  function buff(pl, id) {
    const o = BY[id];
    pl.orbBuff = pl.orbBuff || {};
    if (!(pl.orbBuff[id] > 0)) on(pl, id);
    pl.orbBuff[id] = o.dur;
    G.FX.dmgText(pl.x, pl.y - pl.bodyH - 8, G.T(o.name), o.col, true);
  }
  function on(pl, id) {
    if (id === 'focus') pl.critChance += 0.25;
    else if (id === 'quick') pl.spdMul *= 1.4;
    else if (id === 'luminous') G.Camera.zoomTo = 1.35;
  }
  function off(pl, id) {
    if (id === 'focus') pl.critChance -= 0.25;
    else if (id === 'quick') pl.spdMul /= 1.4;
    else if (id === 'luminous') G.Camera.zoomTo = 1;
  }

  /** Every frame, for your player. */
  function update(dt, pl) {
    if (cd > 0) cd -= dt;
    const b = pl.orbBuff;
    if (b) for (const id in b) if (b[id] > 0 && (b[id] -= dt) <= 0) off(pl, id);
  }

  /** At run start or end: reset the zoomed-out camera and explanations. */
  function reset() {
    cd = 0; sel = 0; seen.clear();
    G.Camera.zoomTo = 1;
  }

  // ---------------- red ----------------

  /** Host: a guest used an orb. Only accept it if they actually owned it. */
  function onMateUse(mpl, id, x, y, z) {
    if (!BY[id] || !take(mpl, id)) return false;
    if (BY[id].kind === 'foe') foe(id, x, y, z);
    else nearBuff(id, x, y);
    return true;
  }

  /** Teammate upgrade: also applies to you if they are within half a screen. */
  function nearBuff(id, x, y, pl = G.Game.player) {
    if (!BY[id] || BY[id].kind !== 'buff') { if (BY[id]) ring(id, x, y); return; }
    ring(id, x, y, NEAR);
    if (pl && !pl.dead && G.U.dist2(pl.x, pl.y, x, y) < NEAR * NEAR) buff(pl, id);
  }

  return { LIST, BY, SLOTS, STACK, roll, canTake, add, take, got, use, next, useSelected, update, reset,
           onMateUse, nearBuff, foe, get cd() { return cd; }, get sel() { return sel; } };
})();

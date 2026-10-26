/* ============ rift.js — rifts and the Legendary arena ============
 *
 * Occasionally (a few times per run), a RIFT opens near a player. It lasts
 * GRIETA_TTL seconds; entering takes the entire group to a closed arena in the
 * Distortion World to fight a LEGENDARY Pokémon.
 *
 *   win      the Legendary drops tickets (a ×10 ticket half the time) and coins,
 *            and everyone gets a BOND (fuses moves; see Player.fuse); after a
 *            few seconds, return to the map and choose the fused move
 *   lose     (everyone falls or time runs out) return without a reward, with
 *            some health; the run continues
 *
 * While in the arena, map enemies are stashed (EnemyMgr.stash) and no new ones
 * spawn; when you return, everything is as it was.
 *
 * Co-op: the host decides. Messages (see coop.js):
 *   'rift' x y ttl · 'riftx' · 'arena' cfg · 'aw' (won) · 'al' (lost)
 *   guest to host: 're' (entered the rift).
 */
G.Rift = (() => {
  // (0.14 through 2026-10-11: more rifts so links are easier to see.)
  // Less randomness (2026-10-12): each missed spawn makes the next one more
  // likely (20%, 40%, 60%, 80%, 100%): at most 2.5 minutes without a rift.
  // Stop opening rifts 2 minutes before Arceus's Judgment (minute 30).
  const CHECK = 30, CHANCE = 0.2, TTL = 45;
  const ARENA_R = 11, ARENA_TIME = 120, FROM = 75;
  let rift = null;          // { x, y, ttl, t }
  let arena = null;         // { tx, ty, r, dex, shiny, x, y, back, biome, t, phase, endT, bossId }
  let zone = null;          // where the last arena was { x, y, r } (see leftBehind)
  let checkT = CHECK, asked = false, downT = 0, misses = 0;
  const authority = () => !G.Coop.active || G.Coop.isHost;
  const TS = () => G.Tiles.T * G.Sprites.PX;

  function reset() { rift = null; arena = null; zone = null; checkT = CHECK; asked = false; downT = 0; misses = 0; }

  /**
   * Is this player still in the arena even though the map has already been
   * restored here? In co-op, the host returns a fraction of a second before
   * guests (the notification takes time to arrive) and still sees them there.
   * The waiting boss then spawned beside the host, thousands of meters away, and
   * could no longer be found (and no more rifts appeared).
   */
  function leftBehind(p) {
    return !arena && !!zone && G.U.dist2(p.x, p.y, zone.x, zone.y) < zone.r * zone.r;
  }

  // ---------------- map rift ----------------

  function update(dt, pl, time) {
    if (rift) {
      rift.t += dt;
      rift.ttl -= dt;
      if (rift.ttl <= 0) { rift = null; return; }
      if (!arena && !pl.dead && G.U.dist2(pl.x, pl.y, rift.x, rift.y - 10) < 30 * 30) enter();
    } else if (!arena && authority() && time > FROM && time < G.Judgment.AT - 120) {
      checkT -= dt;
      if (checkT <= 0) {
        checkT = CHECK;
        if (G.EnemyMgr.bossAlive()) return;           // A living boss does not count as an attempt
        if (Math.random() < CHANCE * (1 + misses)) { misses = 0; open(); }
        else misses++;
      }
    }
    if (arena) arenaTick(dt, pl);
  }

  function open() {
    const alive = G.Game.everyone().filter(p => !p.dead);
    const near = G.U.pick(alive.length ? alive : [G.Game.player]);
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * 6.2832, d = G.U.rand(380, 560);
      const x = near.x + Math.cos(a) * d, y = near.y + Math.sin(a) * d * 0.85;
      if (!G.World.isFree(x, y, 22)) continue;
      show(x, y, TTL);
      if (G.Coop.isHost) G.Coop.broadcast(['rift', Math.round(x), Math.round(y), TTL]);
      return;
    }
  }

  /** Show the rift (including one sent by the host). */
  function show(x, y, ttl) {
    rift = { x, y, ttl, t: 0 };
    asked = false;
    // hud.js draws the large notice while rift.t < 4.5 s.
    G.Audio.sfx('rift');
    G.FX.ring(x, y, 6, 80, '#b48aff', 0.7, 5);
  }

  function enter() {
    if (asked) return;
    asked = true;
    if (authority()) start();
    else G.Coop.toHost(['re']);
  }

  // ---------------- arena ----------------

  /** Host: chooses the Legendary and location, then notifies everyone. */
  let nextType = null;          // Tests/videos: type of the next arena.

  function start(forceType) {
    if (arena) return;
    forceType = forceType || nextType; nextType = null;
    let pool = G.DEX.filter(p => p.leg && G.SPRITE_META[p.dex]);
    if (forceType && pool.some(p => p.types.includes(forceType))) pool = pool.filter(p => p.types.includes(forceType));
    // Legendaries not yet defeated spawn 4 times more often (fewer duplicates).
    const beaten = (G.DB.save && G.DB.save.legends) || {};
    const ws = pool.map(p => (beaten[p.dex] ? 1 : 4));
    let r = Math.random() * ws.reduce((a, b) => a + b, 0), mi = 0;
    while (mi < pool.length - 1 && (r -= ws[mi]) > 0) mi++;
    const mon = pool[mi];
    const cfg = {
      tx: 5000 + Math.floor(Math.random() * 3000), ty: 5000 + Math.floor(Math.random() * 3000), r: ARENA_R,
      dex: mon.dex, shiny: G.Sprites.hasShiny(mon.dex) && Math.random() < 1 / 512,
      // Choose an arena matching one of its types at random.
      type: forceType || G.U.pick(mon.types)
    };
    if (G.Coop.isHost) G.Coop.broadcast(['arena', cfg]);
    begin(cfg);
    spawnLegend();
  }

  /** On each computer: travel to the arena. */
  function begin(cfg) {
    const pl = G.Game.player;
    const ts = TS();
    arena = Object.assign({}, cfg, {
      x: cfg.tx * ts + ts / 2, y: cfg.ty * ts + ts / 2,
      back: { x: pl.x, y: pl.y }, biome: G.World.biome, t: 0, phase: 'fight', endT: 0, bossId: 0
    });
    zone = { x: arena.x, y: arena.y, r: (cfg.r + 10) * ts };
    rift = null; asked = false; downT = 0;
    if (authority()) G.EnemyMgr.stash(); else G.EnemyMgr.clearRemote();
    G.Projectiles.clear();
    G.Combat.clearFields();
    G.Hazards.clear();
    G.World.setArena({ tx: cfg.tx, ty: cfg.ty, r: cfg.r, type: cfg.type });
    G.World.setBiome(G.Tiles.arenaBiome(cfg.type), true);
    // Each arena has its own weather (sun in the volcano, snow on the glacier, etc.).
    const th = G.Tiles.ARENA_THEMES[cfg.type];
    if (th && th.weather) G.Weather.force(th.weather, ARENA_TIME + 15);
    // Everyone starts in a row at the south of the arena; the legendary appears to the north.
    const ps = G.Game.everyone();
    ps.forEach((p, i) => { p.x = arena.x + (i - (ps.length - 1) / 2) * 34; p.y = arena.y + ts * 3; });
    G.Camera.x = pl.x; G.Camera.y = pl.y;
    G.Game.flash('#c9a6ff', 0.9);
    G.Audio.sfx('rift');
    G.Spawner.say('Has entrado en la grieta…', 2.4, true);
  }

  function spawnLegend() {
    const mon = G.DEX_BY[arena.dex];
    const t = G.Game.st.time;
    const n = G.Game.everyone().length;
    const ts = TS();
    const def = {
      dex: mon.dex, name: mon.name,
      hp: Math.round((3200 + t * 9) * G.Coop.scaleHp(n) * (n > 1 ? 1.4 : 1)),
      spd: Math.round(G.U.clamp(48 + (mon.spd - 78) * 0.6, 48, 105)),
      dmg: Math.round(36 + t / 20), xp: Math.round(500 + t * 1.2),
      behavior: mon.types.some(x => ['psychic', 'electric', 'ghost', 'fairy', 'fire', 'water', 'ice', 'dragon'].includes(x)) ? 'ranged' : 'charger',
      shotDmg: Math.round(18 + t / 40), shotCd: 0.9, range: 300
    };
    const e = new G.Enemy(def, arena.x, arena.y - ts * 3.5, { hp: 1, spd: 1, dmg: 1 }, true);
    e.legend = true;
    // Collides with walls and pillars like the player: if it flew over rocks,
    // shots could not reach it (Celebi bug).
    e.flying = false;
    if (arena.shiny) e.makeShiny();
    G.EnemyMgr.add(e);
    arena.bossId = e.id;
    G.Spawner.say('¡' + e.name + (e.shiny ? ' shiny' : '') + ' te esperaba en la grieta!', 3.2);
    G.Camera.kick(1.1);
    G.Audio.sfx('boss');
  }

  /** Keep everyone inside the arena circle (in case something pushes too hard). */
  function keepInside() {
    const ts = TS(), max = (arena.r - 1.4) * ts;
    for (const e of G.EnemyMgr.all()) {
      if (e.remote) continue;
      const dx = e.x - arena.x, dy = e.y - arena.y, d = Math.hypot(dx, dy);
      if (d > max) { e.x = arena.x + dx / d * max; e.y = arena.y + dy / d * max; }
    }
  }

  function arenaTick(dt, pl) {
    arena.t += dt;
    if (arena.phase === 'fight') {
      if (!authority()) return;
      keepInside();
      const boss = G.EnemyMgr.get(arena.bossId);
      if (!boss || boss.dead) { G.Coop.isHost && G.Coop.broadcast(['aw']); won(); return; }
      const allDown = G.Game.everyone().every(p => p.dead);
      downT = allDown ? downT + dt : 0;
      if (downT > 1.4 || arena.t > ARENA_TIME) { G.Coop.isHost && G.Coop.broadcast(['al']); lost(); }
      return;
    }
    arena.endT -= dt;
    if (arena.endT <= 0) finish();
  }

  function won() {
    if (!arena || arena.phase !== 'fight') return;
    arena.phase = 'won'; arena.endT = 5;
    G.Progress.event('rift', { type: arena.type });
    G.Pickups.pullAll();
    G.Spawner.say('¡Has vencido a ' + G.DEX_BY[arena.dex].name + '! Recoge el premio…', 3.4, true);
    G.Audio.sfx('legend');
    const pl = G.Game.player;
    if (pl) {
      pl.bonds++;
      G.FX.dmgText(pl.x, pl.y - pl.bodyH - 10, '¡Vínculo!', '#ff8ad8', true);
      G.FX.ring(pl.x, pl.y, 8, 90, '#ff8ad8', 0.7, 5);
    }
  }

  function lost() {
    if (!arena || arena.phase !== 'fight') return;
    arena.phase = 'lost'; arena.endT = 1.2;
    G.Spawner.say('La grieta os ha expulsado…', 2.6, true);
    G.Audio.sfx('back');
  }

  /** On each computer: return to the map. */
  function finish() {
    const pl = G.Game.player;
    const a = arena;
    arena = null;
    G.World.setBiome(a.biome, true);
    G.Weather.clear();
    // Guest: do not clear anything. The host reports which arena enemies leave
    // and which map enemies return; if the guest's countdown finished slightly
    // later (which usually happens), it removed the newly returned enemies.
    // They were invisible until defeated (only their attacks appeared).
    if (authority()) G.EnemyMgr.restore();
    G.Projectiles.clear();
    G.Combat.clearFields();
    G.Hazards.clear();
    for (const p of G.Game.everyone()) { p.x = a.back.x; p.y = a.back.y; }
    pl.x = a.back.x; pl.y = a.back.y;
    if (pl.dead) pl.revive(0.3);
    G.Camera.x = pl.x; G.Camera.y = pl.y;
    G.Game.flash('#c9a6ff', 0.8);
    if (pl.bonds > 0) G.Game.offerBond();
  }

  // ---------------- rendering ----------------

  /** The rift, for sorting by Y with the rest of the scene. */
  function drawable() {
    if (!rift) return null;
    return {
      y: rift.y,
      draw(ctx) {
        const P = G.Sprites.PX;
        const img = G.Tiles.propSprite(0, 'rift', Math.floor(rift.t * 8) % 4);
        const w = img.width * P, h = img.height * P;
        const fadeIn = Math.min(1, rift.t * 2), fadeOut = Math.min(1, rift.ttl / 1.5);
        ctx.save();
        ctx.globalAlpha = 0.25 * fadeIn * fadeOut;
        ctx.fillStyle = '#7b3cff';
        ctx.beginPath(); ctx.ellipse(rift.x, rift.y, 34, 12, 0, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = fadeIn * fadeOut;
        ctx.drawImage(img, Math.round(rift.x - w / 2), Math.round(rift.y - h + 4), w, h);
        ctx.restore();
        if (Math.random() < 0.3) G.FX.px(rift.x + G.U.rand(-14, 14), rift.y - G.U.rand(10, 80), '#d9c2ff', { vy: -40, life: 0.6 });
      }
    };
  }

  // ---------------- networking ----------------

  function onEvent(ev) {
    switch (ev[0]) {
      case 'rift': show(ev[1], ev[2], ev[3]); break;
      case 'riftx': rift = null; break;
      case 'arena': begin(ev[1]); break;
      case 'aw': won(); break;
      case 'al': lost(); break;
    }
  }

  return {
    reset, update, drawable, onEvent, leftBehind, enterRequest() { if (!arena) start(); },
    get rift() { return rift; }, get arena() { return arena; },
    get inArena() { return !!arena; },
    get timeLeft() { return arena ? Math.max(0, ARENA_TIME - arena.t) : 0; },
    debugOpen() { open(); },
    /** For testing: start an arena of a specific type immediately. */
    debugArena(type) { start(type); },
    /** For videos: the next rift you enter will have this type. */
    debugNextType(type) { nextType = type; }
  };
})();

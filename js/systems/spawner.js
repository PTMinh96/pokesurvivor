/* ============ spawner.js — waves, bosses, and shinies ============
 * Enemies spawn in a ring just outside the visible area, so they never
 * materialize on screen. About every 45 s, a "surge" arrives: a concentrated
 * rush from one direction to break up the rhythm.
 *
 * Each enemy has a 1/4096 chance to be shiny (as in the classic games).
 * A run defeats 1,500–4,000 enemies, so one shiny appears every 1–3 runs.
 *
 * Co-op (host only): enemies spawn around a random living player, outside
 * EVERYONE's view, and scale in number and strength with party size
 * (see G.Coop.scaleRate / scaleHp).
 */
G.Spawner = (() => {
  // Simultaneous enemy cap (previously 420; too many slowed the game). Once
  // reached, new spawns are "elite" (more health, damage, and experience),
  // so difficulty does not drop.
  const CAP = 64, ELITE_FROM = 0.85;
  // Fewer, stronger Pokémon (to avoid crowding the screen): about 24% of the
  // previous count, each with more health, damage, and experience.
  const DENSITY = 0.24, DMG_K = 2.4, XP_K = 5.6;
  // Extra durability scales with run time: ×3.3 initially, increasing to ×5
  // around minute 6, when the player has strong enough attacks to defeat them.
  const hpK = t => 3.3 + Math.min(1.7, t / 210);
  const SHINY_RATE = 1 / 4096;
  let acc = 0, bossIdx = 0, surgeT = 32, announce = null, announceT = 0, preloadT = 0;
  let forceShiny = 0;           // For tests: make the next N spawns shiny.

  function reset() {
    acc = 0; bossIdx = 0; surgeT = 32; announce = null; announceT = 0; preloadT = 0;
    G.Enemies.rollRun();
    G.Sprites.preload(G.Enemies.upcomingDex(0, 80));
  }

  /** Enemies per second by run minute. */
  function rate(t) {
    return (1.6 + t * 0.028 + Math.pow(t / 60, 1.6) * 0.5) * DENSITY;
  }

  /** Off-screen radius: the camera radius, or larger if someone has zoomed out (Luminosphere). */
  function outR() {
    let z = G.Camera.zoom;
    for (const o of players) if (o.net && o.net.zm > z) z = o.net.zm;
    return G.Camera.outerRadius() * z / G.Camera.zoom;
  }

  function ringPoint(pl, angle) {
    const d = outR() + G.U.rand(10, 70);
    return [pl.x + Math.cos(angle) * d, pl.y + Math.sin(angle) * d * 0.9];
  }

  let players = [];

  /** Would any player see it? (avoid spawning in front of anyone) */
  function seenByAnyone(x, y) {
    const r = outR() - 30;
    return players.some(o => G.U.dist2(o.x, o.y, x, y) < r * r);
  }

  /** Find a ring position with enough room: not inside walls or water. */
  function freePoint(pl, angle, flying) {
    for (let i = 0; i < 8; i++) {
      const a = angle + (i === 0 ? 0 : G.U.rand(-0.9, 0.9));
      const [x, y] = ringPoint(pl, a);
      if (players.length > 1 && seenByAnyone(x, y)) continue;
      if (flying || G.World.isFree(x, y, 14)) return [x, y];
    }
    return null;
  }

  /** Player around whom the next enemy spawns (never one returning from a rift). */
  function anchor() {
    const alive = players.filter(o => !o.dead && !G.Rift.leftBehind(o));
    return alive.length ? G.U.pick(alive) : players[0];
  }

  function scaled(sc, k) { return k === 1 ? sc : Object.assign({}, sc, { hp: sc.hp * k }); }

  function isFlyer(def) { return G.Sprites.hovers(def.dex); }

  function rollShiny(dex) {
    if (!G.Sprites.hasShiny(dex)) return false;
    if (forceShiny > 0) { forceShiny--; return true; }
    return Math.random() < SHINY_RATE;
  }

  // At most 3 healers, shielders, and summoners alive at once
  // (2026-10-18: together they made the horde and bosses nearly immortal).
  // If there are already 3 of one kind, choose another from the roster.
  const SUPPORT_MAX = 3, SUPPORT = new Set(['healer', 'shielder', 'summoner']);
  /** Support behaviors that already have 3 living enemies. */
  function supportFull() {
    const n = {}, full = new Set();
    for (const e of G.EnemyMgr.all()) {
      if (!e.dead && SUPPORT.has(e.behavior) && (n[e.behavior] = (n[e.behavior] || 0) + 1) >= SUPPORT_MAX) full.add(e.behavior);
    }
    return full;
  }

  function spawnOne(pl, t, angle) {
    const bag = G.Enemies.bagAt(t);
    let def = G.U.pick(bag);
    if (SUPPORT.has(def.behavior)) {
      const full = supportFull();
      if (full.has(def.behavior)) {
        const rest = bag.filter(d => !full.has(d.behavior));
        if (!rest.length) return null;
        def = G.U.pick(rest);
      }
    }
    const pt = freePoint(pl, angle == null ? Math.random() * 6.2832 : angle, isFlyer(def));
    if (!pt) return null;
    const shiny = rollShiny(def.dex);
    const e = new G.Enemy(def, pt[0], pt[1], scaled(G.Enemies.scale(t), G.Coop.scaleHp(players.length) * hpK(t)));
    e.dmg *= DMG_K; e.xp = Math.round(e.xp * XP_K);
    if (G.EnemyMgr.count >= CAP * ELITE_FROM) { e.maxHp = e.hp = Math.round(e.maxHp * 1.6); e.dmg *= 1.25; e.xp = Math.round(e.xp * 1.6); }
    if (shiny) e.makeShiny();
    if (G.Events.golden) e.makeGolden();
    G.EnemyMgr.add(e);
    if (shiny) {
      say('¡Un ' + e.name + ' shiny anda cerca!', 3.4);
      G.Audio.sfx('shiny');
    }
    return e;
  }

  function spawnBoss(pl, t, b) {
    const [x, y] = ringPoint(pl, Math.random() * 6.2832);
    const e = new G.Enemy(b, x, y, scaled(G.Enemies.bossScale(t), G.Coop.scaleHp(players.length) * (players.length > 1 ? 1.4 : 1)), true);
    if (rollShiny(b.dex)) e.makeShiny();
    G.EnemyMgr.add(e);
    say('¡' + e.name + (e.shiny ? ' shiny' : '') + ' salvaje apareció!', 3.2);
    G.Camera.kick(1.1);
    G.Audio.sfx('boss');
    return e;
  }

  /** @param who  the player or the list of players (co-op) */
  function update(dt, who, t) {
    players = Array.isArray(who) ? who : [who];
    if (announceT > 0) announceT -= dt;
    // Nothing else spawns in the rift arena (and the boss timer waits).
    // During Arceus's Judgment, spawn only its legendaries (systems/judgment.js).
    if (G.Rift.inArena || G.Judgment.active) return;

    // Preload sprites for enemies expected during the next minute.
    preloadT -= dt;
    if (preloadT <= 0) { preloadT = 10; G.Sprites.preload(G.Enemies.upcomingDex(t, 60)); }

    // --- bosses ---
    const b = G.Enemies.BOSSES[bossIdx];
    if (b && t >= b.at) { spawnBoss(anchor(), t, b); bossIdx++; }

    // During a boss fight, waves drop to 25% and there are no surges, giving
    // the boss its own moment and making it easier to target in the crowd.
    const bossFight = G.EnemyMgr.bossAlive();

    // --- regular trickle ---
    if (G.EnemyMgr.count < CAP) {
      acc += rate(t) * G.Coop.scaleRate(players.length) * (bossFight ? 0.25 : 1) * dt;
      let n = Math.floor(acc);
      acc -= n;
      while (n-- > 0 && G.EnemyMgr.count < CAP) spawnOne(anchor(), t);
    }

    // --- surge ---
    if (!bossFight) surgeT -= dt;
    if (surgeT <= 0) {
      surgeT = G.U.rand(38, 56);
      const base = Math.random() * 6.2832;
      const target = anchor();
      const n = Math.min(CAP - G.EnemyMgr.count, Math.round((14 + Math.floor(t / 22)) * G.Coop.scaleRate(players.length) * 0.4));
      for (let i = 0; i < n; i++) spawnOne(target, t, base + G.U.rand(-0.55, 0.55));
      say('¡Marea de Pokémon!', 2.2);
      G.Audio.sfx('surge');
    }
  }

  /** Several at once from one side (when a horde starts). */
  function burst(n) {
    const base = Math.random() * 6.2832, target = anchor() || G.Game.player, t = G.Game.st.time;
    for (let i = 0; i < n && G.EnemyMgr.count < CAP + 10; i++) spawnOne(target, t, base + G.U.rand(-0.6, 0.6));
  }

  /**
   * A straggler respawns ahead of the player (in the direction they are running),
   * outside the view. Returns false if there is no room (then it is removed).
   */
  function ahead(e, pl) {
    if (!players.length) players = [pl];
    const sp = Math.hypot(pl._vx || 0, pl._vy || 0);
    const a0 = sp > 20 ? Math.atan2(pl._vy, pl._vx) : Math.random() * 6.2832;
    const pt = freePoint(pl, a0 + G.U.rand(-0.9, 0.9), e.flying);
    if (!pt) return false;
    e.x = pt[0]; e.y = pt[1]; e.kx = e.ky = 0;
    e.phase = 'walk'; e.pt = 0; e.jump = null; e.jumpLift = 0;
    return true;
  }

  /** Large on-screen warning (also used for biomes and shinies). */
  /** @param local  only on this computer (not sent to teammates) */
  function say(text, secs = 2.6, local = false) {
    announce = text; announceT = secs;
    if (G.Coop.isHost && !local) G.Coop.say(text, secs);
  }

  function banner() { return announceT > 0 ? { text: announce, t: announceT } : null; }

  /** Co-op guest: only update the warning timer. */
  function tickBanner(dt) { if (announceT > 0) announceT -= dt; }

  return { reset, update, ahead, burst, tickBanner, banner, say, rate, SHINY_RATE, CAP,
           debugForceShiny(n = 1) { forceShiny = n; } };
})();

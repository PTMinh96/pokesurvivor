/* ============ game.js — game flow and main loop ============
 *
 *   login ──> personality test ──> menu ──> run ──> summary ──> menu
 *                 (first time only)        │
 *                                          ├─ Pokémon (collection)
 *                                          ├─ Upgrades
 *                                          └─ Gacha
 *
 * Loop states: 'ui' (menus, with the world in the background), 'playing',
 * 'levelup', 'paused', 'over'.
 *
 * Co-op (G.Coop.active): the host controls enemies, objects, and
 * experience; each player controls their Pokémon. Pausing does not stop the
 * game, level-up cards wait for everyone, and a downed teammate is revived if
 * another player stays beside them. See net/coop.js.
 */
G.Game = (() => {
  let cv, ctx, dpr = 1, w = 0, h = 0;
  let state = 'ui';
  let time = 0, last = 0, pendingLevels = 0;
  let pl = null;
  let caught = [];          // shinies caught during this run
  let biome = -1;

  const st = { get time() { return time; } };

  // ---------------- startup ----------------

  function init() {
    cv = document.getElementById('game');
    ctx = cv.getContext('2d');
    resize();
    addEventListener('resize', resizeSoon);
    // iPhone: when rotated or opened from the home screen, the orientation
    // change is reported BEFORE the page is repositioned. Using the old
    // measurements stretched the game. Remeasure on actual canvas changes
    // (ResizeObserver) and, just in case, shortly after each notification.
    addEventListener('orientationchange', resizeSoon);
    if (window.visualViewport) visualViewport.addEventListener('resize', resizeSoon);
    if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(cv);
    G.Touch.init(cv);
    // On mobile, pause the run when switching apps or rotating to portrait.
    document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
    G.RunUI.wirePause(() => { state = 'playing'; G.UI.hideAll(); }, quitRun);
    Backdrop.init();
    last = performance.now();
    requestAnimationFrame(loop);
  }

  function resize() {
    // Internal resolution is capped at ×1.5: drawing twice as many pixels on
    // ×2 screens was one of the most expensive operations, with no visible
    // difference in pixel art.
    const d = Math.min(1.5, window.devicePixelRatio || 1);
    const cw = cv.clientWidth, ch = cv.clientHeight;
    if (!cw || !ch) return;
    G.Touch.resetSafe();
    if (cw === w && ch === h && d === dpr && cv.width === Math.round(cw * d) && cv.height === Math.round(ch * d)) { checkOrientation(); return; }
    dpr = d; w = cw; h = ch;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    G.Camera.resize(w, h, dpr);
    checkOrientation();
  }
  let resizeTs = [];
  function resizeSoon() {
    resize();
    resizeTs.forEach(clearTimeout);
    resizeTs = [100, 350, 800].map(ms => setTimeout(resize, ms));
  }

  /** Portrait mode on mobile: show a rotate notice (and pause). */
  function checkOrientation() {
    const portrait = G.Touch.active && innerHeight > innerWidth;
    const el = document.getElementById('rotate');
    if (!el) return;
    if (portrait && !document.getElementById('rotate-ico').innerHTML) document.getElementById('rotate-ico').innerHTML = G.Icons.html('phone', 48);
    el.classList.toggle('hidden', !portrait);
    if (portrait) autoPause();
  }

  /** Automatic pause (solo only: other players keep going in co-op). */
  function autoPause() {
    G.Touch.reset();
    if (state === 'playing' && !G.Coop.active) { state = 'paused'; G.RunUI.showPause(); }
  }

  /** Pause/resume (Esc or P, or the mobile pause button). */
  let holdBy = [];                   // co-op: players choosing a link (everything paused)

  function togglePause() {
    // Pausing does not stop the game in co-op (the others keep playing).
    if (G.Coop.active) {
      if (state !== 'playing') return;
      if (G.UI.isOpen('scr-pause')) G.UI.hide('scr-pause');
      else { G.RunUI.showPause(true); G.Audio.sfx('pause'); }
      return;
    }
    if (state === 'playing') { state = 'paused'; G.RunUI.showPause(); G.Audio.sfx('pause'); }
    else if (state === 'paused') { state = 'playing'; G.UI.hideAll(); }
  }

  // ---------------- run ----------------

  /** @param coop  { seed, host, members } for a group run */
  function startRun(coop = null) {
    holdBy = []; awayBy = null;
    const save = G.DB.save;
    // Nature applied to a copy (see systems/mons.js).
    const mon = G.Mons.monFor(save.partner);
    const perks = G.Upgrades.perks(G.DB.upgradesOf(mon.dex));

    G.UI.hideAll();
    G.UI.chrome(false);
    G.FX.clear();
    G.Projectiles.clear();
    G.Combat.clearFields();
    G.EnemyMgr.clear();
    G.Pickups.clear();
    G.Spawner.reset();
    G.Rift.reset();
    G.Judgment.reset();
    G.Events.reset();
    G.Weather.reset();
    G.Path.clear();
    G.Hazards.clear();
    G.World.reset(coop ? coop.seed : Math.floor(Math.random() * 1e6));
    G.World.setBiome(0, true);
    biome = 0;
    time = 0; pendingLevels = 0;
    runReal = performance.now(); tampered = false;

    pl = new G.Player(mon, perks, !!save.partnerShiny && G.DB.ownsShiny(mon.dex));
    G.Orbs.reset();
    pl.setAbility(G.Mons.abilityOf(mon.dex).id);
    banked = { t1: 0, t10: 0 };
    caught = [];
    // Shortcuts: moves have fixed slots (save.pbind[dex] = [id of move 1, id of move 2, ...])
    // even before they are learned; addMove places them there.
    (save.pbind && save.pbind[mon.dex] || []).forEach((id, i) => { if (id) pl.bind[id] = i; });
    pl.addMove(G.startMoveOf(mon.dex));
    // "Veto" upgrade: moves you do not want to be offered.
    pl.banned = new Set((save.pban && save.pban[mon.dex] || []).slice(0, perks.bans));
    // "Move Set" upgrade: a second attack move, chosen with
    // "Starting second move" or randomly if none is selected.
    if (perks.startMoves >= 2) {
      const pick2 = G.startMove2Of(mon.dex);
      const pool = G.Moves.poolFor(mon).filter(id => !pl.hasMove(id) && !pl.banned.has(id) && G.Moves.BY_ID[id].kind !== 'buff');
      if (pick2 && !pl.hasMove(pick2)) pl.addMove(pick2);
      else if (pool.length) pl.addMove(G.U.pick(pool));
      pl.setActive(0);
    }

    if (coop) {
      G.Coop.begin(coop, pl, coopApi);
      G.Social.setPlaying(true);
    }
    G.Camera.x = pl.x; G.Camera.y = pl.y; G.Camera.shake = 0;
    // Load local sprite sheets for the companion and first enemies.
    G.Sprites.preload([mon.dex], 8000, pl.shiny);
    G.Audio.music(G.BIOME_MUSIC[0]);
    // For the leaderboard: the server records when the run starts (anti-cheat).
    if (!coop || G.Coop.isHost) G.Ranking.runStarted(coop ? 'g' : 's');
    deathT = 0;

    state = 'playing';
  }

  function quitRun() {
    if (G.Coop.active) G.Coop.leave();
    endRun(false);
  }

  /** All players in the run (you first). */
  function everyone() { return G.Coop.active ? G.Coop.players() : [pl]; }

  /** Experience needed for the next level (locked chests). */
  function levelXp() {
    if (!pl) return 20;
    const k = (G.Coop.active ? G.Coop.xpFactor() : 1) * (pl.xpMul || 1);
    return Math.ceil((pl.xpNext - pl.xp + 1) / k);
  }

  // Full-screen flash (travel to the rift).
  let flashT = 0, flashDur = 1, flashCol = '#fff';
  function flash(col, dur) { flashCol = col; flashDur = dur; flashT = dur; }

  function teamState() {
    return { time, level: pl.level, xp: pl.xp, xpNext: pl.xpNext, kills: pl.kills, bosses: pl.bosses, coins: pl.coins, t1: pl.t1, t10: pl.t10 };
  }
  function summary() { return { t: time, ki: pl.kills, bo: pl.bosses, co: pl.coins, lv: pl.level, t1: pl.t1, t10: pl.t10 }; }

  /** Data needed by co-op from the game. */
  /**
   * Collected tickets are saved as soon as you pick them up (like shinies):
   * previously they were saved only at the end, so closing the tab abruptly lost them.
   * `banked` = this run's Pokémon already present in the save.
   */
  let banked = { t1: 0, t10: 0 };
  function bankTickets(save_ = true) {
    const sv = G.DB.save;
    if (!sv || !pl) return;
    sv.tickets = sv.tickets || { t1: 0, t10: 0 };
    const d1 = Math.max(0, pl.t1 - banked.t1), d10 = Math.max(0, pl.t10 - banked.t10);
    if (!d1 && !d10) return;
    sv.tickets.t1 += d1; sv.tickets.t10 += d10;
    banked = { t1: pl.t1, t10: pl.t10 };
    if (save_) G.DB.commit('run');
  }

  const coopApi = {
    team: teamState,
    summary,
    // Guest: the host controls the timer and team state.
    syncTeam(t) {
      if (Math.abs(t.time - time) > 0.4) time = t.time;
      if (t.level > pl.level) G.Audio.sfx('xp');
      pl.level = t.level; pl.xp = t.xp; pl.xpNext = t.xpNext;
      pl.kills = t.kills; pl.bosses = t.bosses; pl.coins = t.coins;
      if (t.t1 > pl.t1 || t.t10 > pl.t10) G.Audio.sfx('shiny');
      pl.t1 = t.t1 || 0; pl.t10 = t.t10 || 0;
      bankTickets();
    },
    levelStart(level) {
      // If an item choice was open, restore it afterward (afterLevelUp).
      if (state === 'choice' && openItem && G.Coop.active) G.Coop.holdEnd();
      state = 'levelup';
      G.UI.hide('scr-pause');
      G.Audio.sfx('levelup');
      G.RunUI.showLevelUp(level, G.LevelUp.offer(pl), card => {
        G.Audio.sfx('confirm');
        card.apply(pl);
        G.Coop.localPicked();
      }, true);
    },
    waiting(names) { G.RunUI.setWaiting(names); },
    resume() {
      G.RunUI.closeLevelUp();
      if (state === 'levelup') { state = holdBy.length ? 'held' : 'playing'; afterLevelUp(); }
    },
    /** Are you choosing something that pauses the run (item or link)? */
    choosing() { return state === 'choice'; },
    /** Who to spectate while downed (uid, or '' for yourself). */
    watching() { const w = watched(); return w ? w.uid : ''; },
    inLevelUp() { return state === 'levelup'; },
    shiny(dex) { G.onShinyCaught({ dex, name: (G.DEX_BY[dex] || {}).name || '' }); },
    over(d) {
      if (d) Object.assign(pl, { kills: d.ki, bosses: d.bo, coins: d.co, level: Math.max(pl.level, d.lv || 1), t1: d.t1 || pl.t1, t10: d.t10 || pl.t10 });
      if (d && d.t) time = d.t;
      if (d && d.why === 'host') G.UI.toast('El anfitrión ha terminado la partida', 3200);
      endRun(!(d && d.why === 'host'));
    },
    lost(msg) { G.UI.toast(msg, 3600); endRun(false); },
    item(id) { offerItem(id); },
    /** The host grants you an orb you picked up. */
    orb(id) { if (pl && state !== 'over') G.Orbs.got(pl, id); },
    mateLeft() {},
    /** Co-op: players choosing a fusion. Pause everyone while anyone is choosing. */
    hold(names) {
      holdBy = names || [];
      const mine = G.UI.isOpen('scr-bond');
      if (holdBy.length) {
        if (state === 'playing') state = 'held';
        if (pl && pl.bonds > 0) offerBond(true);      // If you also have a link, choose at the same time.
        const others = holdBy.filter(n => n !== (G.Social.me && G.Social.me.name) && n !== 'Tú');
        if (!mine && others.length) G.Spawner.say('Pausa: ' + others.join(', ') + ' ' + (others.length > 1 ? 'están eligiendo…' : 'está eligiendo…'), 999, true);
        else if (!others.length) G.Spawner.say(awayBy ? awayText() : '', awayBy ? 999 : 0, true);   // Just you: no stale warning.
      } else {
        if (state === 'held' && !awayBy) state = 'playing';
        G.Spawner.say(awayBy ? awayText() : '', awayBy ? 999 : 0, true);
      }
    },
    /** Co-op guest: the host left the tab or is not responding; everything is paused. */
    away(name) {
      awayBy = name || null;
      if (awayBy) {
        if (state === 'playing') state = 'held';
        G.Spawner.say(awayText(), 999, true);
      } else if (!holdBy.length) {
        if (state === 'held') state = 'playing';
        G.Spawner.say('', 0, true);
      }
    }
  };
  let awayBy = null;
  const awayText = () => 'Pausa: esperando a ' + awayBy + ' (anfitrión)…';

  /** You brought a lost Pokémon home and it joins you (events.js). */
  G.onRescue = (dex, name) => {
    if (!G.DB.save || !pl) return;
    const isNew = !G.DB.owns(dex);
    if (isNew) { G.DB.grant(dex, 'rescue'); G.DB.commit(true); }
    else pl.coins += 150;
    G.Spawner.say(isNew ? '¡' + name + ' se une a tu equipo!' : '¡' + name + ' te da las gracias! (+150 monedas, ya lo tenías)', 4);
    G.Audio.sfx('shinyGet');
    if (isNew) irisSay(dex);
  };

  /** If `dex` (just obtained) was the last missing Pokémon in its generation: its Shiny Charm. */
  function irisSay(dex) {
    const gen = G.DEX_BY[dex].gen;
    if (!G.Gacha.hasIris(G.DB.save, gen)) return;
    setTimeout(() => G.Spawner.say(G.I18n.f('¡Amuleto Iris de {x}! Shiny al 2 % en su banner', G.T(G.Gacha.BANNERS[gen - 1].name)), 5), 4000);
  }

  /** A wild shiny is defeated: you keep it (and its normal version if you did not have it). */
  G.onShinyCaught = e => {
    if (!G.DB.save || !pl) return;
    if (G.Coop.isHost) G.Coop.shinyCaught(e);
    const wasOwned = G.DB.owns(e.dex);
    const isNew = G.DB.grantShiny(e.dex, 'wild');
    G.DB.save.stats.shinies++;
    G.DB.commit(true);
    caught.push({ dex: e.dex, isNew });
    G.Spawner.say(isNew ? '¡Has conseguido a ' + e.name + ' shiny!' : '¡Otro ' + e.name + ' shiny! (+300 monedas)', 4);
    if (!isNew) pl.coins += 300;
    G.Audio.sfx('shinyGet');
    if (!wasOwned) irisSay(e.dex);
  };

  function endRun(dead = true) {
    if (state === 'over' || !pl) return;
    const coop = !!pl.uid;                    // only co-op runs have a uid
    const wasHost = !!pl.coopHost;
    const team = coop ? G.Coop.members.slice() : [];
    if (G.Coop.active) G.Coop.end();
    if (coop) G.Social.setPlaying(false);
    state = 'over';
    G.Orbs.reset();
    G.Audio.music(null);
    G.Audio.sfx(dead ? 'gameover' : 'back');
    const save = G.DB.save;
    const mul = pl.coinMul;
    const parts = {
      tiempo: Math.floor(time / 5),
      derrotados: Math.floor(pl.kills * 0.25),
      jefes: pl.bosses * 80,
      recogidas: pl.coins
    };
    const coins = Math.round((parts.tiempo + parts.derrotados + parts.jefes + parts.recogidas) * mul);
    const record = time > save.stats.bestTime;

    save.coins += coins;
    bankTickets(false);
    save.stats.runs++;
    save.pused = save.pused || {};
    save.pused[pl.dex] = (+save.pused[pl.dex] || 0) + 1;     // For "most used" in the collection.
    save.stats.totalKills += pl.kills;
    save.stats.bestTime = Math.max(save.stats.bestTime, Math.floor(time));
    if (coop) save.stats.bestGroupTime = Math.max(save.stats.bestGroupTime || 0, Math.floor(time));
    save.stats.bestLevel = Math.max(save.stats.bestLevel, pl.level);
    save.stats.coinsEarned += coins;
    const judge = G.Judgment.summary();
    if (judge) G.Progress.event('judgeEnd', judge);
    G.Judgment.reset();
    G.Progress.event('runEnd', { time, level: pl.level, coins: pl.coins, types: pl.mon.types, group: coop });
    G.Progress.checkAch();
    // Upload to the cloud when the run ends (at most hourly); upload immediately
    // if the score enters a top list (today, week, or month; see below).
    G.DB.commit('run');
    if (G.Social.me) G.Social.publishProfile();

    // Leaderboard: solo runs are submitted by each player; the host submits group runs.
    const mark = { t: Math.floor(time), lv: pl.level, kills: pl.kills, dmg: judge ? judge.dmg : 0 };   // dmg: a Arceus
    // If the run was tampered with (see clean()), do not submit it (silently); submit all others.
    const ok = clean();
    const sent = ok && !coop ? G.Ranking.submitSolo(Object.assign(mark, { dex: pl.dex, shiny: pl.shiny }))
               : ok && wasHost ? G.Ranking.submitGroup(Object.assign(mark, { members: team })) : null;
    if (sent) sent.then(b => { if (b && b.some(p => p !== 'a')) G.DB.commit(true); }).catch(() => {});

    G.RunUI.showOver({
      dead, time, level: pl.level, kills: pl.kills, bosses: pl.bosses, coins, record, t1: pl.t1, t10: pl.t10, judge,
      moves: pl.moves, caught,
      breakdown: Object.entries(parts).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ') +
                 (mul > 1 ? ` · ×${mul.toFixed(2)} Fortuna` : '')
    }, () => { pl = null; G.Flow.afterRun(); });
  }

  /*
   * Is this a clean run? Only check things no legitimate player can do, with
   * wide margins (the 10-10 system produced false positives):
   *   - the run clock advances faster than real time (speed hacks)
   *   - functions on the Pokémon have been replaced (to make it invincible)
   *   - health, damage, speed, or cooldown far beyond possible values
   *   - test functions have been used (skip the clock, etc.)
   * If any check fails, do not submit the run to the leaderboard (silently); otherwise, do nothing.
   */
  let runReal = 0, tampered = false;
  function clean() {
    if (tampered) return false;
    if (time > (performance.now() - runReal) / 1000 + 10) return false;
    for (const k of ['hurt', 'update', 'heal', 'gainXp']) if (Object.prototype.hasOwnProperty.call(pl, k)) return false;
    if (!isFinite(pl.hp) || !isFinite(pl.maxHp) || pl.hp > pl.maxHp + 1 || pl.maxHp > 50000) return false;
    if (pl.atkMul > 2000 || pl.spdMul > 25 || pl.cdMul < 0.03 || pl.level > 20 + time / 3) return false;
    return true;
  }

  // ---------------- level-up ----------------

  function maybeLevelUp() {
    if (pendingLevels <= 0 || state !== 'playing') return;
    if (G.Coop.active) {
      // In co-op, everyone gets cards at once and the game waits for all choices.
      if (G.Coop.players().every(p => p.dead)) return;
      pendingLevels--;
      G.Coop.levelStart(pl.level);
      return;
    }
    // Never open cards while the Pokémon is down (death and XP pickup can happen in the same frame).
    if (pl.dead) return;
    pendingLevels--;
    state = 'levelup';
    G.Audio.sfx('levelup');
    G.RunUI.showLevelUp(pl.level, G.LevelUp.offer(pl), card => {
      G.Audio.sfx('confirm');
      card.apply(pl);
      state = 'playing';
    });
  }

  // ---------------- links ----------------

  /**
   * Legendary link: choose which moves to fuse.
   * If it is not possible now (fewer than two unlinked moves), defer until
   * another move is learned. Check every frame: if another screen covers it
   * (co-op level cards, pause), show it again when that screen closes.
   * @param quiet  do not notify if it is still unavailable
   */
  function offerBond(quiet = false) {
    if (!pl || pl.bonds <= 0 || pl.dead || (state !== 'playing' && state !== 'held') || G.Rift.inArena) return;
    if (['scr-bond', 'scr-pause', 'scr-item', 'scr-levelup'].some(G.UI.isOpen)) return;
    const opt = pl.bondOptions();
    if (!opt) {
      if (!quiet) G.Spawner.say('Guardas el vínculo: aprende otro movimiento para usarlo', 3, true);
      return;
    }
    // Stop the game; in co-op, stop everyone until all players choose (G.Coop.holdStart).
    state = 'choice';
    if (G.Coop.active) G.Coop.holdStart();
    G.Audio.sfx('levelup');
    G.RunUI.showBond(opt, picked => {
      const group = pl.fuse(picked, opt.group);
      G.Audio.sfx('legend');
      G.FX.ring(pl.x, pl.y, 8, 130, '#ff8ad8', 0.8, 6);
      G.FX.burst(pl.x, pl.y - pl.bodyH * 0.5, '#ffb3e6', 40, 240);
      G.Spawner.say('¡Vínculo! ' + group.length + ' movimientos a la vez', 2.6, true);
      if (state === 'choice') state = holdBy.length ? 'held' : 'playing';
      if (G.Coop.active) G.Coop.holdEnd();
    });
  }

  // ---------------- pickups ----------------

  const PICK_SFX = { xp: 'xp', xpBig: 'xp', coin: 'coin', heal: 'heal', bomb: 'break', magnet: 'confirm', ticket: 'shiny', ticket10: 'legend', item: 'legend', sphere: 'confirm' };

  /*
   * Co-op: the item choice and level-up cards must not cover each other.
   * If an item arrives while cards are open, wait for the card choice; if cards
   * arrive while an item choice is open, show them after the item is chosen.
   * Previously, one closed the other, preventing everyone from choosing and
   * leaving the run paused for the whole group.
   */
  let openItem = null;           // { cur, next, take } unfinished item choice
  const laterItems = [];         // items collected while level-up cards are open
  function afterLevelUp() {
    if (state !== 'playing' && state !== 'held') return;
    if (openItem && !G.UI.isOpen('scr-item')) {
      const o = openItem;
      if (o.mine) { state = 'choice'; if (G.Coop.active) G.Coop.holdStart(); }
      G.RunUI.showItemChoice(o.cur, o.next, o.take);
      return;
    }
    if (laterItems.length) offerItem(laterItems.shift());
  }

  /** You picked up an item: equip it if you have none, otherwise choose. */
  function offerItem(id) {
    if (!pl || !G.Items.BY[id]) return;
    if (state === 'levelup' || G.UI.isOpen('scr-levelup')) { laterItems.push(id); return; }
    let mine = false;            // this choice is what paused the game
    const take = got => {
      openItem = null;
      if (got !== pl.item) {
        pl.equip(got);
        G.Spawner.say('¡Llevas ' + G.Items.BY[got].name + '!', 2.6, true);
        G.Progress.event('item', { id: got });
      }
      if (!mine) { afterLevelUp(); return; }
      if (state === 'choice') state = holdBy.length ? 'held' : 'playing';
      if (G.Coop.active) G.Coop.holdEnd();
      afterLevelUp();
    };
    if (!pl.item) { take(id); return; }
    if (pl.item === id) { G.Spawner.say('Ya llevas ' + G.Items.BY[id].name, 2, true); return; }
    // Stop the game while choosing; in co-op, stop it for everyone (as with
    // fusions). Previously, co-op continued and enemies could hit you during a choice.
    if (state === 'playing' || state === 'held') {
      mine = true;
      state = 'choice';
      if (G.Coop.active) G.Coop.holdStart();
    }
    openItem = { cur: pl.item, next: id, take, get mine() { return mine; } };
    G.RunUI.showItemChoice(pl.item, id, take);
  }

  /** @param who  who picked it up (could be a teammate in co-op) */
  function onCollect(p, who = pl) {
    const mine = who === pl;
    if (G.Coop.active && !G.Coop.isHost) {
      // Copy of a host item: the host determines its effect.
      if (mine) G.Audio.sfx(PICK_SFX[p.kind]);
      return;
    }
    if (G.Coop.active) G.Coop.collected(p, who);
    if (mine || p.kind === 'bomb') G.Audio.sfx(PICK_SFX[p.kind]);
    if (p.kind === 'xp' || p.kind === 'xpBig') {
      pendingLevels += pl.gainXp(p.value * (G.Coop.active ? G.Coop.xpFactor() : 1));
      return;
    }
    if (p.kind === 'coin') {
      pl.coins += p.value;
      G.FX.dmgText(who.x, who.y - who.bodyH - 6, '+' + p.value, '#ffd23f');
      return;
    }
    if (p.kind === 'item') {
      if (mine) offerItem(p.value);
      return;
    }
    if (p.kind === 'sphere') {
      // Guest item: the host tracks the guest's items to know whether another will fit.
      if (mine) G.Orbs.got(pl, p.value); else G.Orbs.add(who, p.value);
      return;
    }
    if (p.kind === 'ticket' || p.kind === 'ticket10') {
      if (p.kind === 'ticket') pl.t1++; else pl.t10++;
      bankTickets();
      G.FX.dmgText(who.x, who.y - who.bodyH - 8, p.kind === 'ticket' ? '+1 ticket' : '¡Ticket ×10!', p.kind === 'ticket' ? '#ffd23f' : '#d9a6ff', true);
      G.FX.ring(who.x, who.y, 6, 50, p.kind === 'ticket' ? '#ffd23f' : '#c47bff', 0.4, 3);
      return;
    }
    if (p.kind === 'heal') {
      if (mine) pl.heal(pl.maxHp * 0.3);
      G.FX.ring(who.x, who.y, 6, 60, '#5fe08a', 0.4, 3);
      return;
    }
    if (p.kind === 'magnet') {
      G.Pickups.pullAll();
      G.FX.ring(who.x, who.y, 10, 420, '#ff9ed8', 0.6, 4);
      return;
    }
    if (p.kind === 'bomb') {
      if (G.U.dist2(who.x, who.y, pl.x, pl.y) < 500 * 500) G.Camera.kick(0.8);
      const R = G.Camera.outerRadius();
      G.FX.ring(who.x, who.y, 20, R, '#ff7b3d', 0.5, 6);
      for (const e of G.EnemyMgr.all()) {
        if (mine ? !G.Camera.sees(e.x, e.y, 0) : G.U.dist2(e.x, e.y, who.x, who.y) > R * R) continue;
        e.hurt(60 + pl.level * 14, '#ff7b3d', e.x - who.x, e.y - who.y, 160);
      }
    }
  }

  // ---------------- keyboard ----------------

  function handleKeys() {
    if (G.SettingsUI.isOpen) { if (G.Input.tap('escape')) G.SettingsUI.close(); return; }
    // Arceus's Judgment: Space, Enter, or Esc skips the animation when possible.
    if (G.Judgment.cinematic && state === 'playing') {
      if (['space', 'enter', 'escape'].some(k => G.Input.tap(k))) G.Judgment.skip();
      return;
    }
    if (state === 'levelup') {
      for (let i = 0; i < 3; i++) {
        if (G.Input.tap('digit' + (i + 1)) || G.Input.tap('numpad' + (i + 1))) G.RunUI.pick(i);
      }
      if (G.Input.tap('keyr')) G.RunUI.reroll();
      return;
    }
    if (G.UI.isOpen('scr-bond')) {
      for (let i = 0; i < 4; i++) {
        if (G.Input.tap('digit' + (i + 1)) || G.Input.tap('numpad' + (i + 1))) G.RunUI.pickBond(i);
      }
      return;
    }
    if (G.UI.isOpen('scr-item')) {
      for (let i = 0; i < 2; i++) {
        if (G.Input.tap('digit' + (i + 1)) || G.Input.tap('numpad' + (i + 1))) document.querySelectorAll('#item-cards .card')[i].click();
      }
      return;
    }
    if (state === 'ui') {
      // Esc in a menu sub-screen returns to the menu.
      if (G.Input.tap('escape') && !G.UI.isOpen('scr-profile') && ['scr-dex', 'scr-upgrades', 'scr-shop', 'scr-bag', 'scr-gacha', 'scr-friends', 'scr-rank', 'scr-goals'].some(G.UI.isOpen)
          && document.getElementById('pull-fx').classList.contains('hidden')) G.MenuUI.open();
      return;
    }
    if (G.Input.tap('escape') || G.Input.tap('keyp')) { togglePause(); return; }
    if (state !== 'playing' || !pl) return;
    for (let i = 0; i < 4; i++) {
      if (G.Input.tap('digit' + (i + 1)) || G.Input.tap('numpad' + (i + 1))) pl.setActive(i);
    }
    // Downed in co-op: Q / E switch the player being viewed.
    if (pl.dead) { if (G.Input.tap('keyq')) cycleWatch(-1); if (G.Input.tap('keye') || G.Input.tap('tab')) cycleWatch(1); return; }
    if (G.Input.tap('keyq')) pl.cycle(-1);
    if (G.Input.tap('keye') || G.Input.tap('tab')) pl.cycle(1);
    // Orbs: 5–8 (or numpad); on a controller, X uses one and Y switches orbs.
    for (let i = 0; i < 4; i++) {
      if (G.Input.tap('digit' + (i + 5)) || G.Input.tap('numpad' + (i + 5))) G.Orbs.use(pl, i);
    }
    if (G.Input.tap('padx')) G.Orbs.useSelected(pl);
    if (G.Input.tap('pady')) G.Orbs.next(pl);
  }

  // ---------------- loop ----------------

  let deathT = 0;

  // Downed in co-op: you can watch a living teammate. This only changes which
  // player the camera follows (the host also sends you the enemies in that area).
  let watch = null;
  /** The teammate being watched, or null to watch your own body. */
  function watched() {
    if (!pl || !pl.dead || !G.Coop.active) return (watch = null);
    if (watch && (watch.dead || !G.Coop.puppets().includes(watch))) watch = G.Coop.puppets().find(p => !p.dead) || null;
    return watch;
  }
  /** Change who you watch: you → each living teammate → you. */
  function cycleWatch(dir) {
    const list = [null, ...G.Coop.puppets().filter(p => !p.dead)];
    if (list.length < 2) return;
    watch = list[(list.indexOf(watched()) + dir + list.length) % list.length];
    G.Audio.sfx('click');
  }

  let frameDt = 0, speedK = 1;
  let fpsShown = 60, fpsAcc = 0, fpsN = 0;
  // Request the next frame FIRST: if something fails midway, the game continues
  // (previously it froze forever and required a reload; a long run was lost
  // when a rift opened).
  // If frames keep failing (the game no longer advances or renders), end the
  // run after ~3 s and save time, defeats, records, and leaderboard data. This
  // is better than a black screen and losing everything.
  let loopErrs = 0, errRun = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    try { frame(ts); errRun = 0; }
    catch (e) {
      if (loopErrs++ < 5) console.error('[Game] fallo en un fotograma:', e);
      G.Input.endFrame();
      if (++errRun === 180 && pl && state !== 'ui' && state !== 'over') {
        try {
          G.UI.hideAll();
          quitRun();
          G.UI.toast('El juego ha fallado: tu partida se ha guardado hasta aquí', 5000);
        } catch (e2) { console.error('[Game] no se pudo cerrar la partida:', e2); }
      }
    }
  }

  function frame(ts) {
    const real = (ts - last) / 1000 || 0;
    const dt = Math.min(1 / 30, real) * speedK;
    last = ts;
    if (state === 'playing') G.Settings.sample(real);
    fpsAcc += real; fpsN++;
    if (fpsAcc >= 0.5) { fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    frameDt = state === 'playing' ? dt : 0;

    G.Pad.poll(real);
    handleKeys();

    if (state === 'playing') update(dt);
    else if (pl && state !== 'ui') { G.FX.update(dt * 0.25); pl.anim.update(dt * 0.25); }
    // Always process networking, even while level-up cards are open.
    if (G.Coop.active && pl && state !== 'ui' && state !== 'over') G.Coop.tick(dt);

    if (pl && state !== 'ui') render(); else Backdrop.render(ctx, w, h, dpr, dt);
    G.UI.tick(dt);

    G.Input.endFrame();
  }

  function update(dt) {
    const coop = G.Coop.active;
    if (flashT > 0) flashT -= dt;
    // Arceus's Judgment: pause everything else while the animation plays.
    if (G.Judgment.cinematic) {
      G.Judgment.cineTick(dt);
      pl.anim.update(dt);
      if (coop) for (const p of G.Coop.puppets()) p.netUpdate(dt);
      G.World.update(dt, G.Camera);
      G.FX.update(dt);
      G.Audio.music(G.Judgment.music);
      return;
    }
    // After being downed, show the Faint animation before the summary.
    // Not in a rift arena: falling there only sends you back.
    if (pl.dead && !coop && !G.Rift.inArena) {
      deathT += dt;
      pl.update(dt);
      G.EnemyMgr.update(dt * 0.3, pl);
      G.FX.update(dt);
      G.Camera.follow(pl.x, pl.y, dt);
      if (deathT > 1.3) { deathT = 0; endRun(true); }
      return;
    }
    time += dt;

    const b = Math.floor(time / 240);
    if (b !== biome && !G.Rift.inArena && !G.Judgment.active) {
      biome = b;
      G.World.setBiome(b);
      G.Audio.sfx('biome');
      G.Spawner.say('— ' + G.World.biomeName() + ' —', 3);
      G.FX.ring(pl.x, pl.y, 10, G.Camera.outerRadius(), '#ffffff', 0.7, 6);
    }

    pl.frozen = coop && (G.UI.isOpen('scr-pause') || G.UI.isOpen('scr-item'));
    pl.update(dt);
    G.Orbs.update(dt, pl);
    if (coop) {
      for (const p of G.Coop.puppets()) { p.netUpdate(dt); G.Combat.ghostOrbit(p, dt, time); }
      if (pl.dead) reviveTick(dt);
    }
    const view = watched() || pl;
    G.Camera.follow(view.x, view.y, dt);
    G.World.update(dt, G.Camera);

    const all = everyone();
    if (!coop || G.Coop.isHost) { G.Path.update(dt, all); G.Spawner.update(dt, all, time); }
    else G.Spawner.tickBanner(dt);
    G.EnemyMgr.update(dt, all);
    G.EnemyMgr.rebuildGrid();
    G.Combat.tick(dt, pl, time);
    G.Projectiles.update(dt, pl, G.EnemyMgr.all());
    G.Combat.resolve(dt, pl, time);
    G.Combat.updateFields(dt);
    G.Pickups.update(dt, all, onCollect);
    G.Hazards.update(dt);
    G.Interact.update(dt, pl);
    G.Rift.update(dt, pl, time);
    G.Judgment.update(dt, pl, time);
    G.Events.update(dt, all, time);
    G.Weather.update(dt, time, pl);
    G.FX.update(dt);

    G.Audio.music(G.Judgment.active ? G.Judgment.music : G.Rift.inArena ? 'rift' : G.EnemyMgr.bossAlive() ? 'boss' : G.BIOME_MUSIC[biome % G.BIOME_MUSIC.length]);
    if (!coop || G.Coop.isHost) maybeLevelUp();
    if (pl.bonds > 0) offerBond(true);
    if (G.Coop.isHost) checkAllDown(dt);
  }

  /** Downed in a group: a teammate beside you gradually revives you. */
  function reviveTick(dt) {
    const helper = G.Coop.puppets().some(p => !p.dead && G.U.dist2(p.x, p.y, pl.x, pl.y) < 56 * 56);
    pl.reviveT = helper ? (pl.reviveT || 0) + dt : Math.max(0, (pl.reviveT || 0) - dt * 0.5);
    if (pl.reviveT >= G.Player.REVIVE_TIME) pl.revive(0.5);
  }

  /** Host: if everyone falls, the run ends (after the last one falls). */
  function checkAllDown(dt) {
    if (G.Rift.inArena || !G.Coop.players().every(p => p.dead)) { deathT = 0; return; }
    deathT += dt;
    if (deathT > 1.6) {
      deathT = 0;
      G.Coop.over(summary());
      endRun(true);
    }
  }

  // ---------------- rendering ----------------

  function drawScene(cam, extra) {
    const t = performance.now() / 1000;
    G.World.drawGround(ctx, cam);
    G.World.drawLiquid(ctx, cam, t);
    G.Hazards.draw(ctx);
    G.Combat.drawGroundFields(ctx);
    G.Pickups.draw(ctx);

    // Sort everything with "feet" by Y: objects, enemies, player.
    const items = [];
    // Flat objects (springs, traps) always render beneath everything else.
    for (const p of G.World.visibleProps(cam)) items.push({ y: p.flat ? p.y - 4000 : p.y, prop: p });
    for (const e of G.EnemyMgr.drawables(cam)) items.push({ y: e.y, ent: e });
    for (const e of extra) items.push({ y: e.y, ent: e });
    const rift = G.Rift.drawable();
    if (rift) items.push({ y: rift.y, ent: rift });
    const arceus = pl && state !== 'ui' ? G.Judgment.drawable() : null;
    if (arceus) items.push({ y: arceus.y, ent: arceus });
    if (pl && state !== 'ui') for (const d of G.Events.drawables()) items.push({ y: d.y, ent: d });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (it.prop) G.World.drawProp(ctx, it.prop, t);
      else it.ent.draw(ctx);
    }
  }

  /*
   * Manual aiming: a reticle follows the mouse (with a crosshair cursor), or
   * stays ahead of the Pokémon when aiming with the right stick.
   */
  function drawAimMark() {
    const on = state === 'playing' && pl && pl.manualAim && !G.Judgment.cinematic;
    const cur = on && !G.Pad.aim() ? 'crosshair' : '';
    if (cv.style.cursor !== cur) cv.style.cursor = cur;
    if (!on) return;
    let x, y;
    if (G.Pad.aim()) {
      const k = G.Camera.scale;
      x = (pl.x - G.Camera.left() + Math.cos(pl.aim) * 90) * k;
      y = (pl.y - G.LIFT * 0.5 - G.Camera.top() + Math.sin(pl.aim) * 90) * k;
    } else ({ x, y } = G.Input.mouse());
    ctx.save();
    ctx.lineCap = 'round';
    for (const [col, lw] of [['rgba(0,0,0,.65)', 4], ['#ffe9a8', 1.6]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.2832); ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * 5, y + dy * 5); ctx.lineTo(x + dx * 14, y + dy * 14); }
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    ctx.save();
    ctx.scale(G.Camera.scale, G.Camera.scale);
    G.Camera.apply(ctx);
    drawScene(G.Camera, G.Coop.active ? [pl, ...G.Coop.puppets()] : [pl]);
    G.Projectiles.draw(ctx);
    G.Combat.drawAirFields(ctx);
    G.FX.draw(ctx);
    G.Judgment.drawAir(ctx);
    ctx.restore();

    G.Weather.draw(ctx, w, h, frameDt);
    G.World.drawVignette(ctx, w, h);
    // Fog: narrow the vignette slightly without obscuring the center.
    const fog = G.Weather.vignette;
    if (fog > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.62);
      g.addColorStop(0, 'rgba(200,205,220,0)');
      g.addColorStop(1, `rgba(200,205,220,${0.45 * fog})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (!G.Judgment.cinematic) G.HUD.draw(ctx, w, h, pl, st);
    G.Judgment.drawOverlay(ctx, w, h);
    G.Touch.draw(ctx);
    drawAimMark();
    if (G.Settings.get('fps')) {
      ctx.save();
      ctx.font = '700 11px Pixelify, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = fpsShown >= 50 ? '#5fe08a' : fpsShown >= 30 ? '#ffd23f' : '#ff5f6d';
      ctx.fillText(fpsShown + ' FPS', w - 10, h - 8);
      ctx.restore();
    }
    if (flashT > 0) {
      ctx.save();
      // "Reduced flashes": limit the full-screen flash to one third.
      ctx.globalAlpha = Math.min(1, flashT / flashDur * 1.4) * (G.Settings.get('calm') ? 0.3 : 1);
      ctx.fillStyle = flashCol;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // ---------------- menu background ----------------

  /**
   * The actual world, with wild Pokémon wandering and the camera drifting.
   * This lets the menu show the game immediately.
   */
  const Backdrop = (() => {
    let wanderers = [], t = 0, ready = false, biomeT = 0, bi = 0;
    const CAST = [1, 4, 7, 25, 133, 52, 39, 35, 16, 43, 60, 69, 74, 92, 129, 147, 113, 143, 54, 79];

    function init() {
      G.World.reset(4242);
      G.World.setBiome(0, true);
      G.Camera.x = 0; G.Camera.y = 0;
      wanderers = CAST.map(dex => spawn(dex, true));
      ready = true;
    }

    function spawn(dex, anywhere) {
      const a = new G.Sprites.Animator(dex, 1);
      const r = G.Sprites.bodyRadius(dex);
      let x = 0, y = 0;
      for (let i = 0; i < 20; i++) {
        x = G.Camera.x + G.U.rand(-1, 1) * (anywhere ? G.Camera.w * 0.6 : G.Camera.w * 0.7);
        y = G.Camera.y + G.U.rand(-1, 1) * (anywhere ? G.Camera.h * 0.6 : G.Camera.h * 0.7);
        if (G.World.isFree(x, y, r)) break;
      }
      return { dex, anim: a, x, y, r, vx: 0, vy: 0, t: 0, draw(ctx) {
        G.Sprites.drawShadow(ctx, this.dex, this.x, this.y);
        this.anim.draw(ctx, this.x, this.y);
      } };
    }

    function step(dt) {
      t += dt;
      G.World.update(dt, G.Camera);
      // Slow camera drift.
      G.Camera.x += Math.cos(t * 0.05) * 14 * dt;
      G.Camera.y += Math.sin(t * 0.037) * 10 * dt;
      G.Camera.follow(G.Camera.x, G.Camera.y, dt);

      biomeT += dt;
      if (biomeT > 30) { biomeT = 0; bi = (bi + 1) % 3; G.World.setBiome(bi); }

      for (const wd of wanderers) {
        wd.t -= dt;
        if (wd.t <= 0) {
          // Wander, stop, or occasionally "attack" the air.
          wd.t = G.U.rand(1, 3.5);
          const r = Math.random();
          if (r < 0.55) {
            const a = Math.random() * 6.2832, s = G.U.rand(25, 55);
            wd.vx = Math.cos(a) * s; wd.vy = Math.sin(a) * s;
          } else {
            wd.vx = wd.vy = 0;
            if (r > 0.85) wd.anim.play(G.U.pick(['Attack', 'Shoot', 'Charge']));
          }
        }
        wd.x += wd.vx * dt; wd.y += wd.vy * dt;
        G.World.collide(wd);
        const moving = Math.abs(wd.vx) + Math.abs(wd.vy) > 1;
        if (moving) wd.anim.dir = G.Sprites.dirFromAngle(Math.atan2(wd.vy, wd.vx));
        wd.anim.loop(moving ? 'Walk' : 'Idle');
        wd.anim.update(dt);
        // If it leaves the camera view, make it reappear inside.
        if (!G.Camera.sees(wd.x, wd.y, 120)) Object.assign(wd, spawn(wd.dex, false));
      }
    }

    function render(ctx, w, h, dpr, dt) {
      if (!ready) return;
      step(dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.scale(G.Camera.scale, G.Camera.scale);
      G.Camera.apply(ctx);
      drawScene(G.Camera, wanderers);
      ctx.restore();
      G.World.drawVignette(ctx, w, h);
    }

    /** Restore the menu world after returning from a run. */
    function restore() {
      G.World.reset(4242);
      G.World.setBiome(bi, true);
      G.FX.clear(); G.Projectiles.clear(); G.Combat.clearFields(); G.EnemyMgr.clear(); G.Pickups.clear();
      wanderers = CAST.map(dex => spawn(dex, true));
    }

    return { init, render, restore };
  })();

  return {
    init, startRun, everyone, levelXp, flash, offerBond,
    /** For tests: skip the run timer. */
    debugTime(t) { tampered = true; time = t; },
    /** For video recording: slow motion (0.5 = half speed). */
    debugSpeed(k) { if (k > 1) tampered = true; speedK = k; },
    togglePause, cycleWatch,
    /** The teammate being watched while downed (or null). */
    get watching() { return watched(); },
    /** Leave the current run (e.g. when signing out from Settings). */
    quit() { if (state !== 'ui' && state !== 'over') quitRun(); },
    /** For video recording: open the level-up cards. */
    debugLevelUp() { tampered = true; pl.level++; pendingLevels++; },
    toUI() { state = 'ui'; if (cv) cv.style.cursor = ''; Backdrop.restore(); },
    get state() { return state; }, get player() { return pl; }, st
  };
})();

/* ============ Flow — transiciones entre pantallas ============ */
G.Flow = {
  boot() {
    G.UI.initChrome();
    G.LoginUI.init(); G.TestUI.init(); G.MenuUI.init(); G.GachaUI.init();
    G.SocialUI.init(); G.RankingUI.init(); G.ModUI.init(); G.GoalsUI.init(); G.ProfileUI.init(); G.SettingsUI.init(); G.SupportUI.init(); G.NewsUI.init(); G.LiveUI.init(); G.Updater.init();
    // Your name at the top right opens your profile.
    document.getElementById('user-pill').onclick = () => G.GoalsUI.open('profile');
    G.Audio.music('village');     // Plays after the first click (required by the browser).
    G.Game.init();
    // The database (cloud or local) restores the previous session.
    G.DB.ready().then(restored => {
      document.getElementById('boot').classList.add('hidden');
      // Run this in another task: creating the test sound takes ~60 ms and must not block loading.
      setTimeout(() => this.tapToStart(() => { if (restored) this.afterLogin(); else this.toLogin(); }), 0);
    });
  },
  /**
   * "Tap to start": browsers do not let a site play audio until the user
   * interacts. This screen starts the music as soon as you enter.
   * (It is not shown if the browser already allows audio.)
   */
  tapToStart(then) {
    G.Audio.unlock();
    if (G.Audio.canPlay()) { then(); return; }
    const el = document.getElementById('tap-start');
    el.classList.remove('hidden');
    const go = e => {
      if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      G.Audio.unlock();
      el.classList.add('hidden');
      el.removeEventListener('click', go); removeEventListener('keydown', go, true);
      then();
    };
    el.addEventListener('click', go);
    addEventListener('keydown', go, true);
  },
  toLogin() { G.Audio.music('village'); G.LoginUI.open(); },
  afterLogin() {
    G.Audio.music('village');
    if (!G.DB.save.partner) G.TestUI.start();
    else this.goMenu();
  },
  goMenu() {
    if (G.Game.state !== 'ui') G.Game.toUI();
    G.Audio.music('village');
    G.MenuUI.open();
    if (!G.LoginUI.updateNotices()) G.LoginUI.offerRecovery();
  },
  /** On closing the summary: return to the lobby if still in one; otherwise, to the menu. */
  afterRun() {
    if (G.Social.room) {
      if (G.Game.state !== 'ui') G.Game.toUI();
      G.Audio.music('village');
      if (G.Social.room.isHost) G.Social.setOpen(true);
      G.LobbyUI.open();
    } else this.goMenu();
  },
  play() { G.Game.startRun(); },
  /** Start a group run (the host sends it to everyone). */
  startCoop(cfg) {
    if (G.Game.state !== 'ui' || !G.Social.room) return;
    G.LobbyUI.close();
    G.Game.startRun(cfg);
  }
};

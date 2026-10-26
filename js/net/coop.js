/* ============ coop.js — co-op session (up to 4 players) ============
 *
 * Who controls what:
 *   HOST        enemies (spawning, AI, health, death), ground items,
 *               team experience and level, clock, end of the session.
 *   EACH PLAYER their own Pokémon: position, health, attacks, and incoming hits.
 *               Their hits on enemies are sent to the host, who applies them.
 *
 * Guests see COPIES of the host's enemies (enemy.remote) and teammates'
 * attacks as harmless "ghosts" (see combat.js).
 *
 * Who is choosing (an item or fusion) and who has chosen a level-up card are
 * also included in EVERY packet (not just a separate notification): if a
 * notification is lost because the connection drops, the next packet fixes it
 * so nobody is left waiting forever (this happened in 2026-10).
 *
 * Messages (via net.js, about 15 times per second; 5 via the relay):
 *   guest -> host  { k:'f', p:[state], ev:[events] }
 *   host -> guest  { k:'f', t, lv, xp, xn, ki, bo, co, p:{uid:[state]},
 *                    e:[[id,x,y,hp,anim,dir,statuses]], ev:[events],
 *                    ja:[x,y,anim,dir,damage] (Arceus, only in Judgment) }
 *   host -> all    { k:'start', seed, host, members:[{uid,name,dex,shiny}] }
 */
G.Coop = (() => {
  const ANIMS = ['Idle', 'Walk', 'Attack', 'Shoot', 'Charge', 'Hurt', 'Faint'];
  const COLORS = ['#ffcb3d', '#5fc8ff', '#7ee07a', '#ff8ad8'];
  // Packets per second: 15 over a direct connection and 3 through the
  // Realtime Database relay (disabled: $1 per GB).
  const RATE_FAST = 1 / 15, RATE_SLOW = 1 / 3;
  const rateFor = u => (G.Net.slow(u) ? RATE_SLOW : RATE_FAST);
  const NEAR = 950;                     // Enemy radius sent to each player

  let active = false, host = false, me = null, hostUid = null;
  let local = null;                     // The local player
  const mates = new Map();              // uid -> { uid, name, color, pl, connected, q:[], flushT, xpMul }
  let outEv = [];                       // Guest: events for the host
  let flushT = 0;
  let hitFrom = null;                   // Guest whose hit is being applied (avoid duplicating the number)
  let api = {};                         // Game callbacks (game.js)
  let waiting = new Set();              // Level-up: players who have yet to choose
  let holds = new Set();                // Players choosing a fusion (the session pauses for everyone)
  // The host moves the enemies: if they switch tabs (or the browser freezes),
  // the game pauses for everyone. Previously enemies stopped while everyone
  // else kept playing with a huge advantage.
  let hostAway = false, stalled = false, lastHostAt = 0;
  // Level-up cards: round number (host), latest received, latest chosen (guest),
  // and the latest applied "who is choosing" state.
  let levelSeq = 0, levelNow = 1, seenSeq = 0, doneSeq = 0, lastHo = '';
  const STALL_MS = 2500;
  let members = [];

  // ---------------- difficulty scaling ----------------

  const scaleRate = n => 1 + 0.75 * Math.max(0, n - 1);
  const scaleHp = n => 1 + 0.3 * Math.max(0, n - 1);

  // ---------------- start / end ----------------

  /**
   * @param cfg   { seed, host, members }
   * @param pl    Your Player (already created)
   * @param cb    { levelStart(lv), resume(), waiting(names), over(data), lost(msg), team(t), shiny(dex) }
   */
  function begin(cfg, pl, cb) {
    active = true;
    me = G.Net.uid; hostUid = cfg.host;
    host = me === hostUid;
    local = pl;
    api = cb;
    members = cfg.members;
    mates.clear();
    outEv = []; flushT = 0; waiting = new Set(); holds = new Set();
    hostAway = false; stalled = false; lastHostAt = performance.now();
    levelSeq = 0; levelNow = 1; seenSeq = 0; doneSeq = 0; lastHo = '';
    cfg.members.forEach((m, i) => {
      const x = (i - (cfg.members.length - 1) / 2) * 34, y = 0;
      if (m.uid === me) { pl.x = x; pl.y = y; pl.uid = me; pl.coopHost = host; pl.tagColor = COLORS[i]; return; }
      const mon = G.DEX_BY[m.dex] || G.DEX_BY[25];
      const p = new G.Player(mon, {}, !!m.shiny);
      p.remote = true; p.uid = m.uid; p.tag = m.name; p.tagColor = COLORS[i]; p.revLabel = 'Quédate a su lado';
      p.x = x; p.y = y;
      p.net = { x, y, ang: Math.PI / 2, walk: 0, hp: p.maxHp, maxHp: p.maxHp, dead: 0, mv: G.baseStartOf(mon.dex), ml: 1, mag: 78, aim: Math.PI / 2, rev: 0 };
      G.Sprites.preload([mon.dex], 8000, p.shiny);
      mates.set(m.uid, { uid: m.uid, name: m.name, color: COLORS[i], pl: p, connected: true, q: [], flushT: 0, xpMul: 1 });
    });
  }

  function end() {
    for (const u of [...graceT.keys()]) stopGrace(u);
    active = false; host = false; local = null;
    mates.clear(); outEv = []; waiting = new Set(); holds = new Set();
  }

  /** Leave the session (the others continue). */
  function leave() {
    if (!active) return;
    if (host) {
      // If the host leaves, the session ends for everyone.
      emit(['ov', Object.assign(api.summary ? api.summary() : {}, { why: 'host' })]);
      flushAll();
    } else {
      outEv.push(['bye']);
      flushClient(true);
    }
    end();
  }

  // ---------------- player list ----------------

  function players() {
    const out = [local];
    for (const m of mates.values()) if (m.connected) out.push(m.pl);
    return out;
  }
  function puppets() { const out = []; for (const m of mates.values()) if (m.connected) out.push(m.pl); return out; }

  /**
   * Team experience multiplier: the average of each player's bonuses, divided
   * among the group (otherwise, groups would level up three times faster than
   * solo players).
   */
  function xpFactor() {
    let s = local.xpMul, n = 1;
    for (const m of mates.values()) if (m.connected) { s += m.xpMul || 1; n++; }
    return (s / n) / local.xpMul / (1 + 0.6 * (n - 1));
  }

  // ---------------- player state ----------------

  const r1 = v => Math.round(v), r2 = v => Math.round(v * 100) / 100;

  function myState() {
    // With a bond, send its orbit if present (it's the only part others don't see via 'c').
    const g = local.activeGroup();
    const m = g.find(x => x.kind === 'orbit') || g[0];
    return [r1(local.x), r1(local.y), r2(local.moveAngle), local.walking ? 1 : 0, r1(local.hp), r1(local.maxHp),
            local.dead ? 1 : 0, m ? m.id : '', m ? m.lvl : 1, r1(local.magnet), r2(local.aim), r2(local.xpMul),
            r2(local.reviveT || 0), api.choosing && api.choosing() ? 1 : 0, doneSeq, api.watching ? api.watching() : '',
            r2((G.Camera && G.Camera.zoomTo) || 1)];
  }

  /** Incoming network value: use `def` if not a number, and clamp it to the limit if it is. */
  const num = (v, def, lo, hi) => typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;

  // Never trust another player's packet blindly: an xpMul of 1e309 used to freeze the host during level-up.
  function readState(a) {
    if (!Array.isArray(a)) a = [];
    return { x: num(a[0], 0, -1e6, 1e6), y: num(a[1], 0, -1e6, 1e6), ang: num(a[2], 0, -10, 10), walk: a[3] ? 1 : 0,
             hp: num(a[4], 0, 0, 1e6), maxHp: num(a[5], 1, 1, 1e6), dead: a[6] ? 1 : 0,
             mv: typeof a[7] === 'string' ? a[7].slice(0, 40) : '', ml: num(a[8], 1, 1, 99),
             mag: num(a[9], 0, 0, 5000), aim: num(a[10], 0, -10, 10), xpMul: num(a[11], 1, 0.1, 20),
             rev: num(a[12], 0, 0, 60), ch: a[13] === undefined ? undefined : a[13] ? 1 : 0, ld: num(a[14], 0, 0, 1e9),
             wa: typeof a[15] === 'string' ? a[15].slice(0, 64) : '', zm: num(a[16], 1, 1, 1.5) };
  }

  /** Host: where a guest is looking (themselves, or a living teammate while downed). */
  function viewOf(m) {
    const w = m.pl.dead && m.pl.net && m.pl.net.wa;
    if (!w) return m.pl;
    if (w === me) return local.dead ? m.pl : local;
    const o = mates.get(w);
    return o && o.connected && !o.pl.dead ? o.pl : m.pl;
  }

  // ---------------- sending packets ----------------

  /** Host: event for all guests (except `except`). */
  function emit(ev, except) {
    if (!host) return;
    for (const m of mates.values()) if (m.connected && m.uid !== except) m.q.push(ev);
  }

  /** Host: event only for nearby players (damage numbers). */
  function emitNear(ev, x, y, except) {
    for (const m of mates.values()) {
      if (!m.connected || m.uid === except) continue;
      const v = viewOf(m);
      if (G.U.dist2(v.x, v.y, x, y) > 700 * 700) continue;
      if (m.q.length > 400) continue;
      m.q.push(ev);
    }
  }

  function enemyList(near) {
    const out = [];
    const r2n = NEAR * NEAR;
    for (const e of G.EnemyMgr.all()) {
      if (e.dead || G.U.dist2(e.x, e.y, near.x, near.y) > r2n) continue;
      const a = ANIMS.indexOf(e.anim.cur);
      out.push([e.id, r1(e.x), r1(e.y), Math.ceil(e.hp), a < 0 ? 0 : a, e.anim.dir,
                (e.burn > 0 ? 1 : 0) | (e.poison > 0 ? 2 : 0) | (e.shield > 0 ? 4 : 0) | (e.slow > 0 ? 8 : 0) | (e.sleepT > 0 ? 16 : 0)]);
    }
    return out;
  }

  function hostFrame(m) {
    const st = api.team();
    const p = { [me]: myState() };
    for (const o of mates.values()) {
      if (o.connected && o.uid !== m.uid && o.state) p[o.uid] = o.state;
    }
    const ev = m.q; m.q = [];
    const f = { k: 'f', t: r2(st.time), lv: st.level, xp: r2(st.xp), xn: st.xpNext, ki: st.kills, bo: st.bosses, co: st.coins, tk: [st.t1, st.t10],
                p, e: enemyList(viewOf(m)), ev };
    const ja = G.Judgment.netState();       // Arceus in Judgment
    if (ja) f.ja = ja;
    // Always include who is choosing and, if level-up cards are open, which ones (see above).
    f.ho = holdNames();
    if (waiting.size) f.lu = [levelSeq, levelNow];
    return f;
  }

  function flushAll() { for (const m of mates.values()) if (m.connected) G.Net.send(m.uid, hostFrame(m)); }

  function flushClient(force) {
    if (!force && !outEv.length && flushT > 0) return;
    G.Net.toHost({ k: 'f', p: myState(), ev: outEv });
    outEv = [];
  }

  /** Every frame (including the level-up screen). */
  function tick(dt) {
    if (!active) return;
    if (host) {
      for (const m of mates.values()) {
        if (!m.connected) continue;
        m.flushT -= dt;
        if (m.flushT > 0) continue;
        m.flushT = rateFor(m.uid);
        G.Net.send(m.uid, hostFrame(m));
      }
    } else {
      if (!stalled && performance.now() - lastHostAt > STALL_MS) { stalled = true; updateAway(); }
      flushT -= dt;
      if (flushT <= 0) {
        flushT = rateFor(hostUid);
        G.Net.toHost({ k: 'f', p: myState(), ev: outEv });
        outEv = [];
      }
    }
  }

  // ---------------- receiving packets ----------------

  G.Net.on((from, msg) => {
    if (!msg) return;
    if (msg.k === 'start') { if (G.Flow.startCoop) G.Flow.startCoop(msg); return; }
    if (!active || msg.k !== 'f') return;
    if (host) onClientFrame(from, msg); else if (from === hostUid) onHostFrame(msg);
  });

  /*
   * Direct connection drops during a session (2026-10-22). Previously, the
   * guest's session ended on the first channel failure (a Wi-Fi or mobile-data
   * hiccup), even while the host was already retrying. Now we wait GRACE_MS for
   * the guest to return: the guest pauses ("waiting for host") while the host
   * continues playing.
   */
  const GRACE_MS = 45000;
  const graceT = new Map();             // uid -> reconnection grace-period timer

  function stopGrace(u) { clearTimeout(graceT.get(u)); graceT.delete(u); }

  G.Net.onPeer((u, mode) => {
    if (!active) return;
    if (mode === 'direct') {
      if (!graceT.has(u)) return;
      stopGrace(u);
      const m = mates.get(u);
      if (host && m && m.connected) G.Spawner.say(m.name + ' ha vuelto', 2);
      return;
    }
    if (mode !== 'closed' && mode !== 'failed') return;
    const ours = host ? !!(mates.get(u) && mates.get(u).connected) : u === hostUid;
    if (mode === 'failed' && ours) {
      if (graceT.has(u)) return;                  // Already waiting for this player
      if (host) G.Spawner.say(nameOf(u) + ': reconectando…', 3);
      graceT.set(u, setTimeout(() => {
        graceT.delete(u);
        if (!active || G.Net.mode(u) === 'direct' || (host && !keeps(u))) return;   // Returned, or left ('bye')
        if (host) G.Social.dropMember(u);         // Did not return: remove from the room
        gone(u);
      }, GRACE_MS));
      return;
    }
    gone(u);
  });

  function gone(u) {
    stopGrace(u);
    if (host) mateGone(u);
    else if (u === hostUid) { const cb = api.lost; end(); if (cb) cb('Se ha perdido la conexión con el anfitrión.'); }
  }

  /** Host: is `u` still in this session (even if reconnecting)? */
  function keeps(u) { const m = active && host && mates.get(u); return !!(m && m.connected); }

  function mateGone(u) {
    const m = mates.get(u);
    if (!m || !m.connected) return;
    m.connected = false;
    G.Projectiles.clearOrbs(m.pl);
    G.Spawner.say(m.name + ' ha dejado la partida', 2.6);
    if (waiting.has(u)) picked(u);
    if (holds.has(u)) holdOff(u);
    if (api.mateLeft) api.mateLeft(m);
  }

  // --- on the host ---

  function onClientFrame(from, msg) {
    const m = mates.get(from);
    if (!m || !m.connected) return;
    if (msg.p) { m.state = msg.p; m.pl.net = readState(msg.p); m.xpMul = m.pl.net.xpMul || 1; reconcile(from, m.pl.net); }
    for (const ev of msg.ev || []) {
      switch (ev[0]) {
        case 'h': {
          const e = G.EnemyMgr.get(ev[1]);
          if (!e || e.dead || e.remote) break;
          hitFrom = from;
          e.hurt(ev[2], ev[3], ev[4], ev[5], ev[6]);
          hitFrom = null;
          break;
        }
        case 's': {
          const e = G.EnemyMgr.get(ev[1]);
          if (!e || e.dead) break;
          if (ev[2] === 'b') e.applyBurn(ev[3]);
          else if (ev[2] === 'p') e.applyPoison(ev[3]);
          else if (ev[2] === 's') e.applySlow(ev[3]);
          else if (ev[2] === 't') e.applyStun(ev[3]);
          break;
        }
        case 'c':
          G.Combat.ghostCast(m.pl, ev[1], ev[2], ev[3], ev[4]);
          emit(['c', from, ev[1], ev[2], ev[3], ev[4]], from);
          break;
        case 'pb':
          G.World.breakAt(ev[1], ev[2]);
          emit(['pb', ev[1], ev[2]], from);
          break;
        case 'ou': {
          // Guest's orb: apply it here (the host owns the enemies) and notify the others.
          const x = num(ev[2], 0, -1e6, 1e6), y = num(ev[3], 0, -1e6, 1e6), z = num(ev[4], 1, 1, 1.5);
          if (typeof ev[1] === 'string' && G.Orbs.onMateUse(m.pl, ev[1], x, y, z)) emit(['ob', ev[1], x, y, z], from);
          break;
        }
        case 'lp': picked(from); break;
        case 'hs': holdOn(from); break;
        case 'he': holdOff(from); break;
        case 're': G.Rift.enterRequest(); break;
        case 'bye': mateGone(from); break;
      }
    }
  }

  /** Host: each guest packet takes precedence over notifications that may have been lost. */
  function reconcile(from, n) {
    if (n.ch === undefined) return;                        // Older game version
    if (n.ch && !holds.has(from)) holdOn(from);
    else if (!n.ch && holds.has(from)) holdOff(from);
    if (waiting.has(from) && n.ld >= levelSeq) picked(from);
  }

  // --- on the guest ---

  /** Guest: pause or resume depending on whether the host is present. */
  function updateAway() { if (api.away) api.away(hostAway || stalled ? nameOf(hostUid) : null); }

  // Host: immediately notify everyone when leaving the tab (the host cannot
  // send anything afterwards), and again when returning.
  document.addEventListener('visibilitychange', () => {
    if (!active || !host) return;
    emit(['ha', document.hidden ? 1 : 0]);
    flushAll();
  });

  function onHostFrame(msg) {
    lastHostAt = performance.now();
    if (stalled) { stalled = false; updateAway(); }
    for (const ev of msg.ev || []) applyHostEvent(ev);
    if (msg.ja) G.Judgment.netApply(msg.ja);
    // Who is choosing and the level-up cards, even if a notification was lost.
    if (msg.ho) {
      const k = msg.ho.join('|');
      if (k !== lastHo) { lastHo = k; api.hold && api.hold(msg.ho); }
      // Reopen cards that are still pending but no longer visible (they were
      // new, or a quick selection closed them). Previously, only new cards
      // were checked, so you could miss a round while everyone waited.
      const showing = api.inLevelUp && api.inLevelUp();
      if (msg.lu && msg.lu[0] > doneSeq && (msg.lu[0] > seenSeq || !showing)) { seenSeq = msg.lu[0]; api.levelStart(msg.lu[1]); }
      else if (!msg.lu && showing) api.resume();
    }
    api.syncTeam({ time: msg.t, level: msg.lv, xp: msg.xp, xpNext: msg.xn, kills: msg.ki, bosses: msg.bo, coins: msg.co,
                   t1: (msg.tk || [])[0], t10: (msg.tk || [])[1] });
    for (const u in msg.p || {}) {
      const m = mates.get(u);
      if (m) m.pl.net = readState(msg.p[u]);
    }
    const now = performance.now();
    for (const a of msg.e || []) {
      const e = G.EnemyMgr.get(a[0]);
      if (!e || !e.remote || e.dead) continue;
      const n = e.net;
      const dts = (now - (n.last || now)) / 1000;
      if (dts > 0.02 && dts < 1) {
        n.vx = G.U.clamp((a[1] - n.x) / dts, -600, 600);
        n.vy = G.U.clamp((a[2] - n.y) / dts, -600, 600);
      } else { n.vx = 0; n.vy = 0; }
      n.x = a[1]; n.y = a[2]; n.age = 0; n.last = now;
      e.hp = Math.min(e.maxHp, a[3]);
      n.anim = a[4]; n.dir = a[5]; n.st = a[6];
    }
  }

  function applyHostEvent(ev) {
    switch (ev[0]) {
      case 'ne':
        G.EnemyMgr.addRemote({ id: ev[1], dex: ev[2], x: ev[3], y: ev[4], boss: !!ev[5], shiny: !!ev[6], hp: ev[7], dmg: ev[8], beh: ev[9] });
        break;
      case 'ed': G.EnemyMgr.removeRemote(ev[1], true); break;
      case 'eg': G.EnemyMgr.removeRemote(ev[1], false); break;
      case 'hn': { const e = G.EnemyMgr.get(ev[1]); if (e && !e.dead) e.showHurt(ev[2], ev[3]); break; }
      case 'es':
        G.Projectiles.spawn({ x: ev[1], y: ev[2], vx: ev[3], vy: ev[4], dmg: ev[5], r: ev[6], life: ev[7],
                              friendly: false, color: '#ff7a9e', vis: G.VFX.forType(ev[8]), mtype: ev[8], cat: ev[9] });
        break;
      case 'c': { const m = mates.get(ev[1]); if (m) G.Combat.ghostCast(m.pl, ev[2], ev[3], ev[4], ev[5]); break; }
      case 'item': api.item(ev[1]); break;
      case 'orb': if (typeof ev[1] === 'string') api.orb(ev[1]); break;
      case 'ob': if (typeof ev[1] === 'string') G.Orbs.nearBuff(ev[1], num(ev[2], 0, -1e6, 1e6), num(ev[3], 0, -1e6, 1e6)); break;
      case 'pk': G.Pickups.addRemote(ev[1], ev[2], ev[3], ev[4], ev[5]); break;
      case 'pc': G.Pickups.removeId(ev[1]); break;
      case 'mag': G.Pickups.pullAll(); G.FX.ring(local.x, local.y, 10, 420, '#ff9ed8', 0.6, 4); break;
      case 'bomb':
        G.FX.ring(ev[1], ev[2], 20, G.Camera.outerRadius(), '#ff7b3d', 0.5, 6);
        if (G.U.dist2(ev[1], ev[2], local.x, local.y) < 500 * 500) G.Camera.kick(0.8);
        G.Audio.sfx('break');
        break;
      case 'pb': G.World.breakAt(ev[1], ev[2]); break;
      case 'say': G.Spawner.say(ev[1], ev[2]); break;
      case 'heal': if (!local.dead) { local.heal(local.maxHp * ev[1]); G.FX.ring(local.x, local.y, 6, 60, '#5fe08a', 0.4, 3); } break;
      case 'lu': if (!ev[2] || ev[2] > seenSeq) { seenSeq = ev[2] || seenSeq; api.levelStart(ev[1]); } break;
      case 'lw': api.waiting(ev[1]); break;
      case 'lr': api.resume(); break;
      case 'hp': lastHo = (ev[1] || []).join('|'); api.hold && api.hold(ev[1]); break;
      case 'ha': hostAway = !!ev[1]; updateAway(); break;
      case 'sh': api.shiny(ev[1]); break;
      case 'ov': { const cb = api.over; const d = ev[1]; end(); cb(d); break; }
      case 'rift': case 'riftx': case 'arena': case 'aw': case 'al': G.Rift.onEvent(ev); break;
      case 'jd': case 'jk': case 'jb': G.Judgment.onEvent(ev); break;
      case 'wx': G.Weather.onEvent(ev); break;
      case 'ev': G.Events.onNet(ev); break;
      case 'hz': G.Hazards.add(ev[1], true); break;
      case 'fxr':
        if (typeof ev[4] === 'string') G.FX.ring(num(ev[1], 0, -1e6, 1e6), num(ev[2], 0, -1e6, 1e6), 8, num(ev[3], 8, 0, 2000), ev[4], 0.5, 3);
        break;
    }
  }

  // ---------------- hooks called by game modules ----------------

  /** Your attack: the others replay it as a ghost. */
  function cast(pl, m) {
    if (!active || pl !== local) return;
    if (host) emit(['c', me, m.id, m.lvl, r2(pl.aim), m.evolved ? 1 : 0]);
    else outEv.push(['c', m.id, m.lvl, r2(pl.aim), m.evolved ? 1 : 0]);
  }

  // Guest
  function hit(e, d, color, dx, dy, knock) { outEv.push(['h', e.id, d, color, r1(dx), r1(dy), knock || 0]); }
  function status(e, kind, val) { outEv.push(['s', e.id, kind, val]); }

  // Host
  function hurtShown(e, d, color) { emitNear(['hn', e.id, d, color], e.x, e.y, hitFrom); }
  function enemyAdded(e) {
    emit(['ne', e.id, e.dex, r1(e.x), r1(e.y), e.boss ? 1 : 0, e.shiny ? 1 : 0, Math.ceil(e.maxHp), r2(e.dmg), e.behavior]);
  }
  function enemyGone(e, died) { emit([died ? 'ed' : 'eg', e.id]); }
  function enemyShot(p, type) { emit(['es', r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), r2(p.dmg), p.r, p.life, type, p.cat]); }
  function pickupAdded(o) { emit(['pk', o.id, o.kind, r1(o.x), r1(o.y), o.value]); }
  function pickupGone(id) { emit(['pc', id]); }
  function say(text, secs) { emit(['say', text, secs]); }

  function propBroken(p) {
    if (host) emit(['pb', p.tx, p.ty]);
    else outEv.push(['pb', p.tx, p.ty]);
  }

  /** Host: someone picked up an item. Returns true if it is for you. */
  function collected(p, who) {
    emit(['pc', p.id]);
    if (p.kind === 'magnet') emit(['mag']);
    if (p.kind === 'bomb') emit(['bomb', r1(who.x), r1(who.y)]);
    if ((p.kind === 'heal' || p.kind === 'item' || p.kind === 'sphere') && who !== local) {
      const m = mates.get(who.uid);
      if (m) m.q.push(p.kind === 'heal' ? ['heal', 0.3] : [p.kind === 'item' ? 'item' : 'orb', p.value]);
    }
  }

  function shinyCaught(e) { emit(['sh', e.dex]); }

  /** You used an orb: the host notifies everyone; a guest requests it from the host. */
  function orbUsed(id, x, y, z) {
    if (!active) return;
    if (host) emit(['ob', id, r1(x), r1(y), r2(z)]);
    else outEv.push(['ou', id, r1(x), r1(y), r2(z)]);
  }

  // ---------------- shared level-up ----------------

  function levelStart(level) {
    waiting = new Set([me]);
    for (const m of mates.values()) if (m.connected) waiting.add(m.uid);
    levelSeq++; levelNow = level;
    emit(['lu', level, levelSeq]);
    flushAll();
    api.levelStart(level);
    sendWaiting();
  }

  function nameOf(u) { return u === me ? (G.Social.me ? G.Social.me.name : 'Tú') : (mates.get(u) || {}).name || '?'; }

  function sendWaiting() {
    const names = [...waiting].map(nameOf);
    emit(['lw', names]);
    api.waiting(names);
  }

  /** A player chose a card (host). */
  function picked(u) {
    if (!waiting.delete(u)) return;
    if (waiting.size) { sendWaiting(); return; }
    emit(['lr']);
    flushAll();
    api.resume();
  }

  // ---------------- fusions: pause for everyone ----------------
  // While a player chooses which moves to fuse (a legendary's bond), the
  // session pauses for everyone, just like during level-up.

  function holdNames() { return [...holds].map(nameOf); }

  /** Host: `u` starts choosing. */
  function holdOn(u) {
    holds.add(u);
    emit(['hp', holdNames()]); flushAll();
    api.hold && api.hold(holdNames());
  }

  /** Host: `u` has finished (or left). */
  function holdOff(u) {
    if (!holds.delete(u)) return;
    emit(['hp', holdNames()]); flushAll();
    api.hold && api.hold(holdNames());
  }

  /** You start/finish choosing a fusion. */
  function holdStart() { if (host) holdOn(me); else { outEv.push(['hs']); flushClient(true); } }
  function holdEnd() { if (host) holdOff(me); else { outEv.push(['he']); flushClient(true); } }

  /** You chose your card. */
  function localPicked() {
    if (host) picked(me);
    else { doneSeq = seenSeq; outEv.push(['lp']); flushClient(true); }
  }

  /** Host: the session has ended for everyone. */
  function over(data) {
    emit(['ov', data]);
    flushAll();
    end();
  }

  return {
    ANIMS, COLORS, begin, end, leave, keeps, tick, players, puppets, xpFactor, scaleRate, scaleHp,
    cast, hit, status, hurtShown, enemyAdded, enemyGone, enemyShot, pickupAdded, pickupGone, say,
    propBroken, collected, shinyCaught, orbUsed, levelStart, localPicked, over, holdStart, holdEnd,
    /** Host: event for everyone. Guest: event for the host. */
    broadcast(ev) { emit(ev); },
    toHost(ev) { if (active && !host) { outEv.push(ev); flushClient(true); } },
    mate(u) { return mates.get(u); },
    get mates() { return [...mates.values()]; },
    get members() { return members; },
    get active() { return active; },
    get isHost() { return active && host; },
    get local() { return local; }
  };
})();

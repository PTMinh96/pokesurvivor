/* ============ player.js — the Pokémon you control ============
 * (x, y) are the FEET. Only ONE move is active at a time: it fires
 * automatically and is selected with 1-4 / Q / E. Each shot plays its
 * corresponding Mystery Dungeon attack animation (Attack, Shoot, or Charge).
 */
G.Player = class Player {
  /**
   * @param mon   entry from G.DEX
   * @param perks resolved permanent upgrades (see data/upgrades.js)
   */
  constructor(mon, perks = {}, shiny = false) {
    this.mon = mon;
    this.dex = mon.dex;
    this.shiny = shiny && G.Sprites.hasShiny(mon.dex);
    // Large Pokémon are slightly smaller and use the collision size of a regular Pokémon (see sprites.js).
    this.scale = G.Sprites.playerScale(mon.dex);
    this.anim = new G.Sprites.Animator(mon.dex, this.scale, this.shiny);
    this.x = 0; this.y = 0;
    this.r = G.Sprites.playerRadius(mon.dex);
    this.bodyH = G.Sprites.bodyHeight(mon.dex, this.scale);

    this.atkMul = perks.atkMul || 1;
    this.spdMul = perks.spdMul || 1;
    this.cdMul = perks.cdMul || 1;
    this.dmgReduce = perks.dmgReduce || 0;
    this.regenFlat = perks.regen || 0;
    this.magnet = 78 * (perks.magnetMul || 1);
    this.xpMul = perks.xpMul || 1;
    this.coinMul = perks.coinMul || 1;

    this.maxHp = mon.hp + (perks.hp || 0);
    this.hp = this.maxHp;
    this.baseSpd = mon.spd;
    this.baseAtk = mon.atk;

    this.moves = [];           // All learned moves
    this.slots = [];           // Slots: each holds a list of moves fired together
    this.active = 0;           // Active slot
    this.maxMoves = 4;         // Slots
    this.bonds = 0;            // Unused bonds (reward from legendaries)

    // patk / satk: Swords Dance and Dragon Dance (physical), and Nasty Plot (special).
    this.buffs = {
      atk: { n: 0, t: 0, amount: 0 },
      patk: { n: 0, t: 0, amount: 0 },
      satk: { n: 0, t: 0, amount: 0 },
      spd: { n: 0, t: 0, amount: 0 },
      def: { n: 0, t: 0, amount: 0 },
      regen: { n: 0, t: 0, amount: 0 }
    };

    this.level = 1;
    this.xp = 0;
    this.xpNext = Player.xpFor(1);
    this.kills = 0;
    this.bosses = 0;
    this.rerolls = 0;          // Number of times level-up cards were rerolled this run
    this.rerollBonus = perks.rerolls || 0;   // Rerolls purchased in Upgrades (plus the free one)
    this.critChance = perks.crit || 0;       // Critical-hit chance (Upgrades)
    this.banned = new Set();                 // Banned moves (Upgrades → Ban): not offered on cards
    this.bind = {};                          // Move -> fixed slot (0-3), selected in Upgrades
    this.coins = 0;            // Coins collected this run
    this.t1 = 0; this.t10 = 0; // Gacha tickets collected this run
    this.dmgDealt = 0;

    this.invuln = 0;
    this.flash = 0;
    this.aim = Math.PI / 2;
    this.moveAngle = Math.PI / 2;
    this.walking = false;
    this.inLiquid = false;
    this.lavaTick = 0;
    this.attackFace = 0;       // Time spent facing the target after attacking
    this.dead = false;
    this.power = null;         // Active altar power: { def, t, dur }
    this.slowT = 0;            // Recently hit by a trap
    this.item = null;          // Equipped item (data/items.js), one per run
    this.sashT = -999;         // Last time Focus Sash saved the player
    this.bellHeal = 0;         // Pending healing from Shell Bell
    this.statsTaken = {};      // Stat upgrades collected (evolution condition)
    this.abil = null;          // Ability effect (data/ability-fx.js), set by game.js
    this.sturdyAt = -999;      // Last time Sturdy saved the player
  }

  /** Set the ability (G.AbilityFX.of) and apply its startup effect. */
  setAbility(id) {
    this.abilId = id || '';
    this.abil = G.AbilityFX.of(id, this.mon);
    if (this.abil.cdMul) this.cdMul *= this.abil.cdMul;
    if (this.abil.start) this.abil.start(this);
  }

  /** Seconds required beside a downed teammate to revive them. */
  static get REVIVE_TIME() { return 3; }

  // (Increased to ×2, then ×4 on 2026-10-10: leveling was too fast.)
  static xpFor(level) {
    return Math.floor((8 + level * 6 + Math.pow(level, 1.75) * 1.6) * 4);
  }

  cy() { return this.y; }

  // ---------------- effective stats ----------------
  get atk() { return this.baseAtk * this.atkMul * (1 + this.buffs.atk.n * this.buffs.atk.amount); }
  /**
   * Attack stat for a move: the Pokémon's physical or special stat (see
   * G.Stats), including boosts for that category, but not other boosts.
   */
  atkFor(m) {
    const cat = m && m.cat, b = cat === 'physical' ? this.buffs.patk : cat === 'special' ? this.buffs.satk : null;
    return this.atk * G.Stats.fit(this.mon, cat) * (b ? 1 + b.n * b.amount : 1) * (m && this.monoType(m.type) ? Player.MONO_K : 1);
  }
  /** Mono-type (2026-10-19): Pokémon with one type deal 20% more damage with moves of that type (they have less variety). */
  static get MONO_K() { return 1.2; }
  monoType(type) { return this.mon.types.length === 1 && type === this.mon.types[0]; }
  get spd() {
    // (Abilities: "steady" is not slowed; speed() applies the multiplier, see data/ability-fx.js.)
    const ab = this.abil || {}, stuck = this.slowT > 0 && !ab.steady;
    const s = this.baseSpd * this.spdMul * (1 + this.buffs.spd.n * this.buffs.spd.amount) * (stuck ? 0.5 : 1) * (ab.speed ? ab.speed(this) : 1);
    const w = G.Weather.speedFor(this.mon.types);
    const slow = this.inLiquid && !ab.steady ? G.World.liquidEffect(this.mon.types).slow || 1 : 1;
    return G.Judgment && G.Judgment.active ? G.Judgment.capSpd(s * slow * w) : s * slow * w;
  }
  get reduction() { return Math.min(0.8, this.dmgReduce + this.buffs.def.n * this.buffs.def.amount); }
  get regen() { return this.regenFlat + this.buffs.regen.n * this.buffs.regen.amount; }

  // ---------------- moves ----------------
  addMove(id) {
    if (this.slots.length >= this.maxMoves || this.hasMove(id)) return false;
    const m = G.Moves.instance(id, 1);
    m.since = G.Game.st.time;          // When it was obtained (damage per second in the summary)
    this.moves.push(m);
    const group = [m];
    this.slots.push(group);
    this.arrange();
    // Keep the move you had equipped (2026-10-18: previously, switching only
    // to the new move could remove the attack in use). Use the new move only
    // if no move was already equipped.
    if (!this.slots[this.active]) this.active = this.slots.indexOf(group);
    return true;
  }

  /**
   * Fixed slots (Upgrades → Shortcuts): each move with a selected slot goes
   * there for muscle memory (Confusion always goes in slot 1...).
   * Until you have that many moves, it goes in the nearest available slot;
   * other moves fill empty slots in the order they were learned.
   */
  arrange() {
    const n = this.slots.length;
    if (n < 2 || !this.bind) return;
    const want = g => { let k = Infinity; for (const m of g) if (this.bind[m.id] != null) k = Math.min(k, this.bind[m.id]); return k; };
    const cur = this.slots[this.active];
    const out = new Array(n).fill(null);
    const bound = this.slots.filter(g => want(g) < Infinity).sort((a, b) => want(a) - want(b));
    for (const g of bound) {
      let p = Math.min(want(g), n - 1);
      while (p >= 0 && out[p]) p--;                          // Occupied: keep the previous slot
      if (p < 0) { p = 0; while (out[p]) p++; }              // Otherwise, use the first free slot
      out[p] = g;
    }
    for (const g of this.slots) if (!out.includes(g)) out[out.indexOf(null)] = g;
    this.slots = out;
    if (cur) this.active = out.indexOf(cur);
  }

  hasMove(id) { return this.moves.some(m => m.id === id); }

  setActive(i) {
    if (i < 0 || i >= this.slots.length || i === this.active) return;
    // Choice Scarf: the move cannot be changed.
    if (this.hasItem('choiceband') && this.slots[this.active]) {
      G.FX.dmgText(this.x, this.y - this.bodyH - 8, 'Cinta Elección', '#ff8ad8');
      return;
    }
    this.active = i;
    G.Projectiles.clearOrbs(this);
    G.Audio.sfx('select');
    for (const m of this.slots[i]) m.t = Math.min(m.t, m.cd * 0.35);
    const m = this.slots[i][0];
    G.FX.ring(this.x, this.y - G.LIFT * 0.5, 6, this.r * 3.4, G.U.TYPE_COLOR[m.type], 0.3, 3);
  }

  cycle(dir) {
    if (!this.slots.length) return;
    this.setActive((this.active + dir + this.slots.length) % this.slots.length);
  }

  // ---------------- bonds (fusions) ----------------
  // Each defeated legendary grants a bond. Bonds combine moves in a single
  // slot so they fire together. Only one group can grow (up to BOND_MAX); if
  // no group is partial, the bond joins two standalone moves.
  static get BOND_MAX() { return 4; }

  /** What can be done with a bond now: add to a group or join two standalone moves. */
  bondOptions() {
    const loose = this.slots.filter(s => s.length === 1).map(s => s[0]);
    const grow = this.slots.find(s => s.length > 1 && s.length < Player.BOND_MAX);
    if (grow) return loose.length ? { mode: 'add', group: grow, loose } : null;
    return loose.length >= 2 ? { mode: 'pair', group: null, loose } : null;
  }

  /** Join standalone `moves` to `group` (or a new group) and spend a bond. */
  fuse(moves, group = null) {
    const target = group || this.slots.find(s => s[0] === moves[0]);
    const cur = this.slots[this.active];
    for (const m of moves) {
      if (target.includes(m)) continue;
      const i = this.slots.findIndex(s => s.length === 1 && s[0] === m);
      if (i < 0) continue;
      this.slots.splice(i, 1);
      target.push(m);
    }
    this.arrange();
    // Switch to the group unless Choice Scarf is equipped (keep the current slot if possible).
    const a = this.slots.indexOf(cur);
    this.active = this.hasItem('choiceband') && a >= 0 ? a : this.slots.indexOf(target);
    this.bonds = Math.max(0, this.bonds - 1);
    G.Projectiles.clearOrbs(this);
    return target;
  }

  /** Moves fired now (the group in the active slot). */
  activeGroup() { return this.slots[this.active] || []; }

  activeMove() { return this.activeGroup()[0]; }

  /**
   * Called by combat.js when firing a move. Select the PMD animation and speed
   * it up if the cooldown is shorter than the animation, so moves chain smoothly.
   */
  cast(m) {
    // Life Orb: each attack costs a little health (never enough to knock you out).
    if (this.hasItem('lifeorb') && m.kind !== 'orbit' && m.kind !== 'trail' && !this.remote) {
      this.hp = Math.max(1, this.hp - Math.max(1, this.maxHp * 0.01));
    }
    const anim = { melee: 'Attack', beam: 'Shoot', projectile: 'Shoot', nova: 'Attack',
                   aura: 'Charge', buff: 'Charge', orbit: 'Charge', boomerang: 'Shoot', chain: 'Shoot',
                   mine: 'Charge', meteor: 'Charge', turret: 'Charge', dash: 'Attack', trail: 'Walk', cone: 'Shoot' }[m.kind] || 'Attack';
    // New move families use the sound of a similar existing family.
    const SND = { boomerang: 'projectile', chain: 'beam', mine: 'nova', meteor: 'nova', turret: 'buff', dash: 'melee', trail: 'aura', cone: 'projectile' };
    // The trail does not play a sound for every puddle (that would be a constant hum).
    if (m.kind !== 'trail') G.Audio.sfx('shot', { kind: SND[m.kind] || m.kind, type: m.type });
    if (m.kind === 'trail') return;
    // Do not restart an animation halfway through; it would look choppy.
    if (this.anim.busy() && this.anim.progress() < 0.65) return;
    const meta = G.Sprites.animMeta(this.dex, anim);
    const len = meta ? meta.d.reduce((a, b) => a + b, 0) / 60 : 0.4;
    const cd = Math.max(0.12, m.cd * this.cdMul);
    this.anim.play(anim, { speed: Math.max(1, len / (cd * 0.9)) });
    this.attackFace = 0.35;
  }

  // ---------------- damage and healing ----------------
  /**
   * @param type  attack type (type chart and weather); if absent, damage is applied as-is
   * @param pure  damage unaffected by defense or melee reduction (Arceus)
   */
  /** @param cat  'physical' | 'special': which of your defenses applies (based on the attacking enemy). */
  hurt(amount, type = null, pure = false, cat = null) {
    if (this.invuln > 0 || this.dead) return;
    // Ability (data/ability-fx.js): absorb a type, dodge, or take reduced damage.
    const ab = this.abil, cls = cat === 'physical' ? 'p' : cat === 'special' ? 's' : '';
    if (ab && !pure) {
      if (type && ab.absorb === type) {
        this.invuln = 0.3;
        this.heal(this.maxHp * 0.03);
        return;
      }
      if (ab.dodge && Math.random() < ab.dodge(this, type, cls)) {
        this.invuln = 0.3;
        G.FX.dmgText(this.x, this.y - this.bodyH - 4, '¡Esquiva!', '#bfe8ff');
        return;
      }
      if (ab.inMul) amount *= ab.inMul(this, type, cls);
    }
    if (!pure) amount *= G.Stats.taken(this.mon, cat);
    let eff = null;
    if (type) {
      const k = G.Types.mult(type, this.mon.types);
      eff = G.Types.label(k);
      amount *= k * G.Weather.mult(type);
    }
    // Take 25% less damage while a melee move is active: players need to get
    // close to enemies to attack (melee was underperforming).
    const close = this.activeGroup().some(m => m.kind === 'melee') ? 0.75 : 1;
    const d = pure ? Math.max(1, amount) : Math.max(1, amount * (1 - this.reduction) * close);
    this.hp -= d;
    this.invuln = 0.45;
    this.flash = 0.14;
    G.Audio.sfx('hurt');
    G.Camera.kick(0.28);
    if (!this.remote) G.Pad.rumble(0.25 + Math.min(0.75, d / this.maxHp * 3), 140);
    G.FX.dmgText(this.x, this.y - this.bodyH - 4, '-' + Math.round(d), eff === 'super' ? '#ff3048' : eff === 'weak' ? '#c9a0a8' : '#ff6b7a', eff === 'super');
    G.FX.burst(this.x, this.y - this.bodyH * 0.5, '#ff5f6d', 6, 90);
    // Focus Sash: survive a hit with 1 HP (once every 60 s).
    if (this.hp <= 0 && this.hasItem('focussash') && performance.now() - this.sashT > 60000) {
      this.sashT = performance.now();
      this.hp = 1; this.invuln = 1.2;
      G.FX.dmgText(this.x, this.y - this.bodyH - 16, '¡Banda Focus!', '#ff9a3d', true);
      G.FX.ring(this.x, this.y, 6, 70, '#ff9a3d', 0.5, 4);
    }
    // Sturdy (ability): same effect, once every 90 s.
    if (this.hp <= 0 && ab && ab.sturdy && performance.now() - this.sturdyAt > 90000) {
      this.sturdyAt = performance.now();
      this.hp = 1; this.invuln = 1.2;
      G.FX.dmgText(this.x, this.y - this.bodyH - 16, '¡Robustez!', '#c9b48a', true);
      G.FX.ring(this.x, this.y, 6, 70, '#c9b48a', 0.5, 4);
    }
    if (ab && ab.hurt && this.hp > 0) ab.hurt(this, type, cls);
    if (this.hp <= 0) {
      this.hp = 0; this.dead = true;
      this.anim.play('Faint', { hold: true });
      G.Projectiles.clearOrbs(this);
      this.reviveT = 0;
    }
  }

  heal(amount) {
    if (this.abil && this.abil.healMul) amount *= this.abil.healMul;     // Gluttony, Pickup
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const got = Math.round(this.hp - before);
    if (got >= 1) G.FX.dmgText(this.x, this.y - this.bodyH - 6, '+' + got, '#5fe08a');
  }

  addMaxHp(amount) { this.maxHp += amount; this.hp += amount; }

  /** Return the number of levels gained (possibly several at once). */
  gainXp(amount) {
    const add = amount * this.xpMul;
    if (!Number.isFinite(add) || add <= 0) return 0;     // Infinite experience used to keep triggering level-ups indefinitely
    this.xp += add;
    let leveled = 0;
    while (this.xp >= this.xpNext && leveled < 50) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Player.xpFor(this.level);
      leveled++;
    }
    return leveled;
  }

  // ---------------- equipped item ----------------
  hasItem(id) { return this.item === id; }

  /** Equip an item, replacing the previous one. */
  equip(id) {
    if (this.item) G.Items.BY[this.item].off(this);
    this.item = id;
    if (id) G.Items.BY[id].on(this);
  }

  /** Shell Bell: heal slightly based on damage dealt (capped at 4/s). */
  onDealt(dmg) {
    if (this.item === 'shellbell') this.bellHeal = Math.min(4, this.bellHeal + dmg * 0.04);
  }

  /** Altar power (see systems/interact.js): apply and remove it automatically. */
  addPower(def, dur) {
    if (this.power) this.power.def.off(this);
    def.on(this);
    this.power = { def, t: dur, dur };
  }

  addBuff(stat, amount, dur, maxStacks) {
    const b = this.buffs[stat];
    if (!b) return;
    b.amount = amount;
    b.n = Math.min(maxStacks, b.n + 1);
    b.t = dur;
  }

  // ---------------- ciclo ----------------
  update(dt) {
    this.anim.update(dt);
    if (this.dead) return;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.attackFace > 0) this.attackFace -= dt;

    for (const k in this.buffs) {
      const b = this.buffs[k];
      if (b.n > 0) { b.t -= dt; if (b.t <= 0) b.n = 0; }
    }
    if (this.slowT > 0) this.slowT -= dt;
    if (this.bellHeal > 0) { const h = Math.min(this.bellHeal, 4 * dt); this.hp = Math.min(this.maxHp, this.hp + h); this.bellHeal -= h; }
    if (this.power && (this.power.t -= dt) <= 0) { this.power.def.off(this); this.power = null; }
    if (this.regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);
    if (this.abil && this.abil.tick) this.abil.tick(this, dt);
    // Drought, Drizzle...: apply its weather at startup and every 3 min if no
    // other weather is active (in co-op, the host controls the weather for all).
    if (this.abil && this.abil.summon && (!G.Coop.active || G.Coop.isHost) && (this.sumT = (this.sumT || 0) - dt) <= 0) {
      this.sumT = 180;
      if (!G.Weather.current) G.Weather.debugStart(this.abil.summon, 60);
    }

    // --- movement with collisions ---
    // (In co-op, pausing does not stop the game; it only freezes your player.)
    const [ax, ay] = this.frozen ? [0, 0] : G.Input.axis();
    this.walking = ax !== 0 || ay !== 0;
    const s = this.spd;
    // Ice: slide (speed changes gradually).
    const slide = this.inLiquid && G.World.liquidEffect(this.mon.types).slide;
    this.svx = slide ? G.U.damp(this.svx || 0, ax * s * 1.15, 1.6, dt) : ax * s;
    this.svy = slide ? G.U.damp(this.svy || 0, ay * s * 1.15, 1.6, dt) : ay * s;
    this.x += this.svx * dt;
    this.y += this.svy * dt;
    G.World.collide(this);
    if (this.walking) this.moveAngle = Math.atan2(ay, ax);

    // --- liquid terrain ---
    // (Levitate: hover over water and lava.)
    this.inLiquid = !(this.abil && this.abil.levitate) && G.World.isLiquid(this.x, this.y);
    if (this.inLiquid) {
      const le = G.World.liquidEffect(this.mon.types);
      if (le.dmg && !(this.abil && this.abil.lavaProof)) {
        this.lavaTick -= dt;
        if (this.lavaTick <= 0) {
          this.lavaTick = le.every; this.invuln = 0;
          this.hurt(Math.max(le.flat, this.maxHp * le.dmg * 0.5));
          G.FX.burst(this.x, this.y - 4, le.color, 5, 70);
        }
      } else if (this.walking && Math.random() < dt * 8) {
        G.FX.burst(this.x, this.y, le.slide ? '#ffffff' : '#b3defa', 2, 40);
      }
    }

    // --- targeting: nearest enemy, or movement direction if none ---
    // Target priority depends on the active move:
    //   ranged (projectile, beam): boss if in range > target facing > nearest
    //   melee and others:          target facing > boss > nearest
    // With a horde nearby, something is almost always facing you; if that always
    // won, ranged attacks would never hit the boss.
    // With no enemies, target the nearest rock or chest.
    const all = G.EnemyMgr.all();
    const m = this.activeMove();
    const ranged = !!m && (m.kind === 'projectile' || m.kind === 'beam');
    const threat = G.Projectiles.nearest(all, this.x, this.y, this.r + 24);
    const boss = all.find(e => e.boss && !e.dead && G.U.dist(this.x, this.y, e.x, e.y) < 330);
    const tg = (ranged ? boss || threat : threat || boss)
            || G.Projectiles.nearest(all, this.x, this.y, 520)
            || G.World.nearestBreakable(this.x, this.y, 200);
    // Manual aim (Settings > Accessibility): use the mouse or right stick.
    // For chaining, target the enemy in that direction; if there is none, use
    // the normal target.
    const hand = this.handAim();
    this.manualAim = hand != null;
    if (hand != null) {
      this.aim = hand;
      this.target = this.enemyAlong(all, hand) || tg;
    } else {
      this.target = tg;
      if (tg) this.aim = Math.atan2(tg.y - this.y, tg.x - this.x);
      else if (this.walking) this.aim = this.moveAngle;
    }

    // --- animation: face the target when attacking, otherwise face movement ---
    const face = this.attackFace > 0 || !this.walking ? this.aim : this.moveAngle;
    this.anim.dir = G.Sprites.dirFromAngle(face);
    this.anim.loop(this.walking ? 'Walk' : 'Idle', this.walking ? s / 110 : 1);
  }

  /**
   * "Manual aim" angle, or null for auto-aim. Use the last input: the right
   * stick while it is being pushed; otherwise the mouse if it moved afterwards
   * (on PC). Releasing the stick without touching the mouse returns to auto-aim.
   */
  handAim() {
    // On mobile (touch), manual aim is unavailable; auto-aim is always used.
    if (this.remote || G.Settings.touch || !G.Settings.get('aimManual')) return null;
    const st = G.Pad.aim();
    if (st) return Math.atan2(st[1], st[0]);
    if (G.Touch.active || !G.Input.mouseMovedAt || G.Input.mouseMovedAt < G.Pad.aimAt) return null;
    const w = G.Input.mouseWorld();
    const dx = w.x - this.x, dy = w.y - (this.y - G.LIFT * 0.5);
    return Math.hypot(dx, dy) < 4 ? null : Math.atan2(dy, dx);
  }

  /** Nearest enemy within ±25° of direction a (within 520 units). */
  enemyAlong(all, a) {
    let best = null, bd = 520 * 520;
    const ca = Math.cos(a), sa = Math.sin(a), cosMax = Math.cos(0.44);
    for (const e of all) {
      if (e.dead) continue;
      const dx = e.x - this.x, dy = e.y - this.y, d2 = dx * dx + dy * dy;
      if (d2 >= bd || d2 < 1) continue;
      if ((dx * ca + dy * sa) / Math.sqrt(d2) < cosMax) continue;
      bd = d2; best = e;
    }
    return best;
  }

  /** Get back up (revived by a teammate in co-op). */
  revive(frac = 0.5) {
    this.dead = false;
    this.hp = Math.max(1, this.maxHp * frac);
    this.invuln = 2;
    this.reviveT = 0;
    this.anim._start('Idle', false);
    G.FX.ring(this.x, this.y, 6, 70, '#5fe08a', 0.5, 4);
    G.FX.burst(this.x, this.y - this.bodyH * 0.5, '#9dffb8', 18, 150);
    G.Audio.sfx('heal');
  }

  // ---------------- teammate (co-op) ----------------

  /**
   * A teammate on another computer: their owner sends their state (position,
   * health, active move...), which is interpolated smoothly here.
   * n = { x, y, ang, walk, hp, maxHp, dead, mv, ml, mag, aim, rev }
   */
  netUpdate(dt) {
    this.anim.update(dt);
    const n = this.net;
    if (!n) return;
    if (this.flash > 0) this.flash -= dt;
    if (this.attackFace > 0) this.attackFace -= dt;
    if (G.U.dist2(this.x, this.y, n.x, n.y) > 300 * 300) { this.x = n.x; this.y = n.y; }
    else { this.x = G.U.damp(this.x, n.x, 14, dt); this.y = G.U.damp(this.y, n.y, 14, dt); }
    if (n.hp < this.hp - 0.5 && !n.dead) this.flash = 0.14;
    this.hp = n.hp; this.maxHp = n.maxHp;
    this.magnet = n.mag || this.magnet;
    this.reviveT = n.rev || 0;
    if (n.dead && !this.dead) { this.dead = true; this.anim.play('Faint', { hold: true }); G.Projectiles.clearOrbs(this); }
    else if (!n.dead && this.dead) this.revive(n.hp / (n.maxHp || 1));
    // Active move (for the aura, HUD, and orbs).
    if (n.mv && (!this.moves[0] || this.moves[0].id !== n.mv || this.moves[0].lvl !== n.ml) && G.Moves.BY_ID[n.mv]) {
      this.moves = [G.Moves.instance(n.mv, n.ml || 1)];
      this.slots = [this.moves.slice()];
      this.active = 0;
      G.Projectiles.clearOrbs(this);
    }
    if (this.dead) return;
    this.walking = !!n.walk;
    this.moveAngle = n.ang;
    this.aim = n.aim;
    const face = this.attackFace > 0 || !this.walking ? this.aim : this.moveAngle;
    this.anim.dir = G.Sprites.dirFromAngle(face);
    this.anim.loop(this.walking ? 'Walk' : 'Idle', this.walking ? this.baseSpd / 110 : 1);
  }

  draw(ctx) {
    // Active move's type aura on the ground.
    const m = this.activeMove();
    if (m && !this.dead) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = G.U.TYPE_COLOR[m.type];
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(this.x, this.y, this.r * 1.5, this.r * 0.6, 0, 0, 6.2832); ctx.stroke();
      ctx.restore();
    }
    G.Sprites.drawShadow(ctx, this.dex, this.x, this.y, this.scale);
    // Altar power: pulsing ring in its color beneath the player.
    if (this.power && !this.dead) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(performance.now() / 120) * 0.15;
      ctx.strokeStyle = this.power.def.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(this.x, this.y, this.r * 2.1, this.r * 0.85, 0, 0, 6.2832); ctx.stroke();
      ctx.restore();
    }

    const alpha = this.invuln > 0 && !this.dead ? (Math.floor(this.invuln * 18) % 2 ? 0.45 : 1) : 1;
    this.anim.draw(ctx, this.x, this.y, { flash: this.flash > 0, softFlash: true, alpha, color: '#ffcb3d' });

    // Buff arcs around the feet.
    const COL = { atk: '#ff6b4d', patk: '#ff6b4d', satk: '#c47bff', spd: '#7fe0ff', def: '#b0b8c8', regen: '#5fe08a' };
    let i = 0;
    for (const k in this.buffs) {
      const b = this.buffs[k];
      if (b.n <= 0) continue;
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = COL[k];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, this.r * 1.8 + i * 5, (this.r * 1.8 + i * 5) * 0.42, 0, 0, 6.2832 * (b.n / 5));
      ctx.stroke();
      ctx.restore();
      i++;
    }

    // Co-op: "reviving" ring and name above the player.
    if (this.dead && this.reviveT > 0) {
      ctx.save();
      ctx.strokeStyle = '#5fe08a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, this.r * 2.4, this.r * 1.0, 0, -Math.PI / 2, -Math.PI / 2 + 6.2832 * Math.min(1, this.reviveT / G.Player.REVIVE_TIME));
      ctx.stroke();
      ctx.restore();
    }
    if (this.tag) {
      ctx.save();
      ctx.font = '700 7px Pixelify,"Segoe UI",sans-serif';
      ctx.textAlign = 'center';
      const y = this.y - this.bodyH - 8;
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      G.I18n.rawCanvas(ctx, 'strokeText', this.tag, this.x, y);
      ctx.fillStyle = this.dead ? '#ff8a96' : this.tagColor || '#fff';
      G.I18n.rawCanvas(ctx, 'fillText', this.tag, this.x, y);
      if (this.dead) {
        ctx.font = '700 6px Pixelify,"Segoe UI",sans-serif';
        ctx.strokeText(this.revLabel || '', this.x, y - 8);
        ctx.fillText(this.revLabel || '', this.x, y - 8);
      }
      ctx.restore();
    }
  }
};

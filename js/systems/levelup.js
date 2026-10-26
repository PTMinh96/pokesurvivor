/* ============ levelup.js — the three level-up cards ============
 * Card types:
 *   new   learn a new move (only if one of the 4 slots is free; a bond frees slots)
 *   up    upgrade a move you already have
 *   stat  permanent run upgrade
 */
G.LevelUp = (() => {

  const STATS = [
    { id: 'hp',   icon: 'heart', title: 'Vigor',        desc: '+20 de vida máxima (y la recupera).',
      apply: pl => pl.addMaxHp(20) },
    { id: 'atk',  icon: 'fist', title: 'Potencia',     desc: '+10% de daño con todos los movimientos.',
      apply: pl => pl.atkMul *= 1.10, max: 40 },
    { id: 'spd',  icon: 'boot', title: 'Carrera',      desc: '+7% de velocidad de movimiento.',
      apply: pl => pl.spdMul *= 1.07, max: 8 },
    { id: 'cd',   icon: 'clock', title: 'Reflejos',     desc: '-8% de recarga en todos los movimientos.',
      apply: pl => pl.cdMul *= 0.92, max: 10 },
    { id: 'def',  icon: 'shield', title: 'Coraza',       desc: '+6% de reducción de daño recibido.',
      apply: pl => pl.dmgReduce = Math.min(0.7, pl.dmgReduce + 0.06), max: 12 },
    { id: 'rgn',  icon: 'sprout', title: 'Síntesis',     desc: '+0.9 de vida regenerada por segundo.',
      apply: pl => pl.regenFlat += 0.9 },
    { id: 'mag',  icon: 'magnet', title: 'Imán',         desc: '+30% de radio de recogida de experiencia.',
      apply: pl => pl.magnet *= 1.30, max: 6 },
    { id: 'xp',   icon: 'book', title: 'Aprendizaje',  desc: '+12% de experiencia ganada.',
      apply: pl => pl.xpMul *= 1.12, max: 8 },
    { id: 'heal', icon: 'berry', title: 'Baya Zidra',   desc: 'Recupera el 45% de tu vida ahora mismo.',
      apply: pl => pl.heal(pl.maxHp * 0.45) }
  ];

  /** Pick n distinct elements from list, with each probability based on weight(x). */
  function pickWeighted(list, n, weight) {
    const rest = list.map(x => [x, weight(x)]), out = [];
    while (out.length < n && rest.length) {
      let r = Math.random() * rest.reduce((a, [, w]) => a + w, 0), i = 0;
      while (i < rest.length - 1 && (r -= rest[i][1]) > 0) i++;
      out.push(rest.splice(i, 1)[0][0]);
    }
    return out;
  }

  /** Build the candidate card set with weights. */
  function candidates(pl) {
    const out = [];

    // --- new moves ---
    if (pl.slots.length < pl.maxMoves) {
      // Do not offer more than 2 buffs: they do not deal damage, and filling
      // all 4 slots with them leaves the run at a dead end.
      const buffs = pl.moves.filter(m => m.kind === 'buff').length;
      // If it is on the Pokémon's weaker side, show its effectiveness (e.g. Machamp with Shadow Ball).
      const fitNote = (mon, cat) => {
        const f = G.Stats.fit(mon, cat);
        return f < 0.95 ? ` <span class="fit-low">Con ${mon.name} rinde un ${Math.round(f * 100)} %: pega mejor con ataques ${G.Stats.sideOf(mon) === 'special' ? 'especiales' : 'físicos'}.</span>` : '';
      };
      const pool = G.Moves.poolFor(pl.mon).filter(id =>
        !pl.hasMove(id) && !(pl.banned && pl.banned.has(id)) && !(buffs >= 2 && G.Moves.BY_ID[id].kind === 'buff'));
      // Moves on its stronger side (and ties and buffs) are twice as likely.
      const weight = id => { const d = G.Moves.BY_ID[id]; return G.Stats.fit(pl.mon, d.cat) >= 0.999 ? 2 : 1; };
      for (const id of pickWeighted(pool, 6, weight)) {
        const d = G.Moves.BY_ID[id];
        out.push({
          w: 10, type: 'new', key: 'new:' + id,
          icon: 'move:' + id, color: G.U.TYPE_COLOR[d.type],
          // (Physical or special appears in its own outlined label; see run-ui.js.
          // Buffs have no category, but Swords Dance and Dragon Dance raise physical
          // attack and Nasty Plot raises special attack, so they use the matching label.)
          tag: G.U.TYPE_NAME[d.type],
          cat: G.Stats.NAME[d.cat || (d.stat === 'patk' ? 'physical' : d.stat === 'satk' ? 'special' : '')] || '',
          title: G.T(d.name, 'move'), desc: d.desc + fitNote(pl.mon, d.cat),
          apply: p => p.addMove(id)
        });
      }
    }

    // --- evolutions: move at max level + its condition met ---
    const waiting = {};                   // stat -> move waiting for that evolution condition
    for (const m of pl.moves) {
      const ev = G.Moves.evoInfo(m, pl.statsTaken);
      if (!ev) continue;
      if (!ev.ready) { waiting[ev.needs] = m; continue; }
      out.push({
        w: 40, type: 'evo', key: 'evo:' + m.id,
        icon: 'move:' + m.id, color: '#ffd23f', tag: 'EVOLUCIÓN',
        title: G.T(m.name, 'move') + ' → ' + G.T(ev.name, 'move'), desc: ev.text,
        apply: p => {
          G.Moves.evolve(m);
          G.FX.ring(p.x, p.y, 8, 120, '#ffd23f', 0.8, 6);
          G.FX.burst(p.x, p.y - p.bodyH * 0.5, '#ffe14d', 40, 240);
          G.Audio.sfx('legend');
          G.Progress.event('evolve', { move: m.id });
        }
      });
    }

    // --- upgrades for moves you already have ---
    for (const m of pl.moves) {
      const txt = G.Moves.nextUpText(m);
      if (!txt) continue;
      out.push({
        w: 8, type: 'up', key: 'up:' + m.id,
        icon: 'move:' + m.id, color: G.U.TYPE_COLOR[m.type],
        tag: 'Nv.' + m.lvl + ' > ' + (m.lvl + 1),
        title: G.T(m.name, 'move'), desc: txt,
        apply: () => G.Moves.levelUp(m)
      });
    }

    // --- stats ---
    // Upgrades that unlock an evolution are always offered, with a notice.
    // Each upgrade has a maximum number of stacks (`max`): during very long
    // runs, unlimited stacking (extreme speed, cooldown, and experience) could
    // eventually freeze the game. Evolution prerequisites are always offered.
    const room = s => !s.max || (pl.statsTaken[s.id] || 0) < s.max;
    const pickStats = G.U.pickN(STATS.filter(s => !waiting[s.id] && room(s)), 5).concat(STATS.filter(s => waiting[s.id]));
    for (const s of pickStats) {
      const evoFor = waiting[s.id];
      out.push({
        w: evoFor ? 14 : pl.slots.length < pl.maxMoves ? 4 : 7,
        type: 'stat', key: 'stat:' + s.id,
        icon: s.icon, color: evoFor ? '#ffd23f' : '#8fa3c4', tag: evoFor ? 'Evoluciona ' + G.T(evoFor.name, 'move') : 'Mejora',
        title: s.title, desc: s.desc,
        apply: p => { s.apply(p); p.statsTaken[s.id] = (p.statsTaken[s.id] || 0) + 1; }
      });
    }

    return out;
  }

  /** Return 3 distinct cards, selected by weight. */
  function offer(pl, n = 3) {
    const pool = candidates(pl);
    const picked = [];
    const used = new Set();
    // If an evolution is ready, its gold card is always offered.
    const evo = pool.findIndex(c => c.type === 'evo');
    if (evo >= 0) { const c = pool.splice(evo, 1)[0]; used.add(c.key); picked.push(c); }

    while (picked.length < n && pool.length) {
      const total = pool.reduce((a, c) => a + c.w, 0);
      let r = Math.random() * total, idx = 0;
      for (let i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) { idx = i; break; } }
      const c = pool.splice(idx, 1)[0];
      if (used.has(c.key)) continue;
      used.add(c.key);
      picked.push(c);
    }
    return picked;
  }

  return { offer, STATS };
})();

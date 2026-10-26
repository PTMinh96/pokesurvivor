/* ============ gacha.js — one banner per generation ============
 * Pure logic: does not touch the interface. The screen is in ui/gacha-ui.js.
 *
 * 9 banners (Kanto ... Paldea), each with its own pity counter.
 * Pull odds: 1★ 45% · 2★ 30% · 3★ 17% · 4★ 6.5% · 5★ 1.5%
 * Guarantees:
 *   - Each ×10 pull includes at least one 4★ or higher.
 *   - After 70 pulls without a 5★ on that banner, the next pull is guaranteed 5★.
 * Shiny: 1 in 100 pulls is shiny (2 in 100 with that generation's Rainbow Charm).
 * Rainbow Charm: one per generation, owned by completing its Pokédex, including
 *   all Legendary Pokémon. It is derived from owned Pokémon, not stored separately.
 * Duplicates convert to Pokécoins (shiny duplicates pay triple).
 *
 * Pulls use TICKETS earned by playing:
 *   ×1   1 ticket (button removed 2026-10-22; pulls are now ×10 or ×100)
 *   ×10  10 regular tickets or 1 ×10 ticket (choose how to pay)
 *   ×100 100 regular tickets or 10 ×10 tickets: ten consecutive ×10 pulls
 *        (each guarantees an Epic)
 */
G.Gacha = (() => {
  /** What does an n-pull cost? → { t1, t10 }, or null if you cannot afford it. */
  /** @param use  't1' (regular tickets) or 't10' (one ×10 ticket, only for ×10 pulls) */
  function costOf(save, n, use = 't1') {
    const t = save.tickets || { t1: 0, t10: 0 };
    if (n === 100 && use === 't10') return t.t10 >= 10 ? { t1: 0, t10: 10 } : null;
    if (n === 10 && use === 't10') return t.t10 >= 1 ? { t1: 0, t10: 1 } : null;
    return t.t1 >= n ? { t1: n, t10: 0 } : null;
  }
  const RATES = [[1, 45], [2, 30], [3, 17], [4, 6.5], [5, 1.5]];
  const PITY_5 = 70;
  const SHINY_RATE = 1 / 100;
  const SHINY_RATE_IRIS = 2 / 100;
  const REFUND = { 1: 15, 2: 30, 3: 60, 4: 120, 5: 300 };
  let forceShiny = 0;           // For tests and videos: the next N pulls are shiny.

  const RARITY_NAME = { 1: 'Común', 2: 'Poco común', 3: 'Rara', 4: 'Épica', 5: 'Legendaria' };
  const RARITY_COLOR = { 1: '#9fb1c9', 2: '#5fe08a', 3: '#4fb4ff', 4: '#c47bff', 5: '#ffcb3d' };

  const BANNERS = [
    { gen: 1, name: 'Kanto',   color: ['#3a1d6e', '#1b2f78', '#0f4d6e'] },
    { gen: 2, name: 'Johto',   color: ['#5a2a1a', '#7a3d1f', '#2d4a6e'] },
    { gen: 3, name: 'Hoenn',   color: ['#0f4d6e', '#1b6a5a', '#2a3d78'] },
    { gen: 4, name: 'Sinnoh',  color: ['#2a2a5e', '#3d3d8a', '#5a2a6e'] },
    { gen: 5, name: 'Teselia', color: ['#1a1a2a', '#3a3a4e', '#2a4a6e'] },
    { gen: 6, name: 'Kalos',   color: ['#4a1a3a', '#2a3a7a', '#1a5a7a'] },
    { gen: 7, name: 'Alola',   color: ['#7a3a1a', '#1a6a6a', '#2a4a8a'] },
    { gen: 8, name: 'Galar',   color: ['#4a1a5a', '#1a3a6a', '#6a1a3a'] },
    { gen: 9, name: 'Paldea',  color: ['#6a2a1a', '#4a1a5a', '#1a4a6a'] }
  ];

  function inBanner(p, gen) { return p.gen === gen && !!G.SPRITE_META[p.dex]; }

  /** Pokémon of a given rarity in a banner. */
  function pool(rarity, gen) { return G.DEX.filter(p => inBanner(p, gen) && p.rarity === rarity); }

  /** Nearest non-empty pool (some generations have rarities with few Pokémon). */
  function poolNear(rarity, gen) {
    for (const d of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
      const r = rarity + d;
      if (r < 1 || r > 5) continue;
      const p = pool(r, gen);
      if (p.length) return { rarity: r, list: p };
    }
    return { rarity, list: G.DEX.filter(p => inBanner(p, gen)) };
  }

  /** How many you own in a generation → { have, total }. */
  function dexOf(save, gen) {
    const list = G.DEX.filter(p => p.gen === gen);
    return { have: list.filter(p => save.owned[p.dex]).length, total: list.length };
  }

  /** Does the player have that generation's Rainbow Charm (complete Pokédex)? */
  function hasIris(save, gen) { const d = dexOf(save, gen); return d.have >= d.total; }

  function shinyRate(save, gen) { return hasIris(save, gen) ? SHINY_RATE_IRIS : SHINY_RATE; }

  function rollRarity(min = 1) {
    const rates = RATES.filter(([r]) => r >= min);
    const total = rates.reduce((a, [, w]) => a + w, 0);
    let x = Math.random() * total;
    for (const [r, w] of rates) { x -= w; if (x <= 0) return r; }
    return rates[rates.length - 1][0];
  }

  /** The generation's 3 strongest Pokémon, for the banner display. */
  function featured(gen) {
    return G.DEX.filter(p => inBanner(p, gen) && p.rarity === 5)
      .sort((a, b) => b.bst - a.bst).slice(0, 3).map(p => p.dex);
  }

  /**
   * Makes `n` pulls from banner `gen` using save data `save` (modifies it).
   * Returns null if there are not enough tickets, or the list of results:
   *   { dex, rarity, shiny, isNew, refund }
   * (and in .iris, the generation if these pulls earned its Rainbow Charm).
   */
  function pull(save, n, gen = 1, use = 't1') {
    if (n === 100) {
      if (!costOf(save, 100, use)) return null;
      const hadIris = hasIris(save, gen);
      const out = [];
      for (let k = 0; k < 10; k++) out.push(...pull(save, 10, gen, use));
      out.iris = !hadIris && hasIris(save, gen) ? gen : 0;
      return out;
    }
    const cost = costOf(save, n, use);
    if (!cost) return null;
    save.tickets.t1 -= cost.t1;
    save.tickets.t10 -= cost.t10;
    save.pity = save.pity || {};
    save.shiny = save.shiny || {};
    save.pity[gen] = save.pity[gen] || 0;
    const hadIris = hasIris(save, gen), rate = shinyRate(save, gen);

    const out = [];
    for (let i = 0; i < n; i++) {
      save.pity[gen]++;
      let want;
      if (save.pity[gen] >= PITY_5) want = 5;
      else if (n === 10 && i === n - 1 && !out.some(r => r.rarity >= 4)) want = rollRarity(4);
      else want = rollRarity();

      const { rarity, list } = poolNear(want, gen);
      if (rarity === 5) save.pity[gen] = 0;
      let mon = G.U.pick(list);
      let shiny = G.Sprites.hasShiny(mon.dex) && (forceShiny > 0 ? (forceShiny--, true) : Math.random() < rate);
      // Shiny Pokémon are not duplicated: if you already own one, choose another
      // of the same rarity whose shiny form you lack; if you own them all, use a normal form.
      if (shiny && save.shiny[mon.dex]) {
        const missing = list.filter(p => G.Sprites.hasShiny(p.dex) && !save.shiny[p.dex]);
        if (missing.length) mon = G.U.pick(missing);
        else shiny = false;
      }

      let isNew = false, refund = 0;
      if (shiny) {
        isNew = !save.shiny[mon.dex];
        if (isNew) save.shiny[mon.dex] = { at: Date.now(), from: 'gacha' };
        else refund = REFUND[rarity] * 3;
        if (!save.owned[mon.dex]) save.owned[mon.dex] = { at: Date.now(), from: 'gacha' };
      } else {
        isNew = !save.owned[mon.dex];
        if (isNew) save.owned[mon.dex] = { at: Date.now(), from: 'gacha' };
        else refund = REFUND[rarity];
      }
      save.coins += refund;
      out.push({ dex: mon.dex, rarity, shiny, isNew, refund });
    }
    save.stats.pulls = (save.stats.pulls || 0) + n;
    out.iris = !hadIris && hasIris(save, gen) ? gen : 0;
    return out;
  }

  return { debugForceShiny(n = 1) { forceShiny = n; },
           costOf, RATES, PITY_5, SHINY_RATE, SHINY_RATE_IRIS, REFUND, RARITY_NAME, RARITY_COLOR, BANNERS,
           pool, featured, pull, dexOf, hasIris, shinyRate };
})();

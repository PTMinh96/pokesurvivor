/* ============ mons.js — Pokémon natures, abilities, and TMs ============
 * (Adapted from TheAdro7's PR #236 for the Kecleon Shop, 2026-10-20.)
 *
 * Each Pokémon in your collection has:
 *   - NATURE (data/natures.js): +10% to one stat and −10% to another, as in the
 *     games (5 are neutral). Change it with a Mint.
 *   - ABILITY (data/abilities.js, effect in data/ability-fx.js): one of its
 *     abilities; the hidden ability has a 1-in-20 chance. Change it with an
 *     Ability Capsule (or a Hidden Ability Capsule for the hidden ability).
 *   - Learned TMs: moves outside its types that it can learn in the games
 *     (Mewtwo can learn Shadow Ball; Psyduck cannot learn Flamethrower). They
 *     appear in level-up cards and can be selected as starting moves (G.Moves.poolFor).
 *
 * Assigned nature and ability are not stored: they are "random" but fixed per
 * account and Pokémon (seed: save creation date + Pokédex number), so every
 * device on the same account sees the same values, including for Pokémon owned
 * before this feature. Changes made with a Mint or Capsule are stored
 * (save.pnat / save.pabil, with timestamps for merging).
 */
G.Mons = (() => {
  const HIDDEN_RATE = 1 / 20;
  const save = () => G.DB && G.DB.save;

  /** Name in the game's language: [es, en, fr, it, zh-Hans, zh-Hant] (pt-BR uses English). */
  const LANG_I = { es: 0, en: 1, fr: 2, it: 3, 'pt-BR': 1, 'zh-Hans': 4, 'zh-Hant': 5 };
  function name(n) {
    if (!Array.isArray(n)) return String(n || '');
    return n[LANG_I[G.I18n ? G.I18n.lang : 'es'] || 0] || n[1] || n[0];
  }

  // Fixed pseudo-random number for (account, Pokémon, salt), between 0 and 1.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  const roll = (dex, salt) => hash(((save() && save().created) || 0) + ':' + dex + ':' + salt);

  // ---------------- naturaleza ----------------

  /** The assigned nature (without a Mint). */
  function rolledNature(dex) { return G.NATURES[Math.floor(roll(dex, 'nat') * G.NATURES.length)]; }
  /** Current nature: from a Mint or the assigned one. */
  function natureOf(dex) {
    const s = save(), p = s && s.pnat && s.pnat[dex];
    return (p && G.NATURE_BY[p[0]]) || rolledNature(dex);
  }
  function setNature(dex, id) {
    const s = save();
    if (!s || !G.NATURE_BY[id]) return;
    s.pnat = s.pnat || {};
    s.pnat[dex] = [id, Date.now()];
  }

  /**
   * Pokémon with its nature applied (a copy; G.DEX_BY is not modified).
   * pa/sa: physical/special move damage · df/sd: defenses · spd: speed.
   */
  function monFor(dex) {
    const base = G.DEX_BY[dex];
    if (!base) return base;
    const n = natureOf(dex), m = Object.assign({}, base);
    if (n.up) m[n.up] = base[n.up] * 1.1;
    if (n.down) m[n.down] = base[n.down] * 0.9;
    m.atk = Math.max(m.pa, m.sa);
    m.nature = n.id;
    return m;
  }

  // ---------------- habilidad ----------------

  /** [ability 1, ability 2 or 0, hidden ability or 0] */
  const slots = dex => (G.DEX_ABIL && G.DEX_ABIL[dex]) || [0, 0, 0];
  /** Assigned slot: 2 (hidden) with a 1-in-20 chance if available; otherwise 0 or 1. */
  function rolledSlot(dex) {
    const l = slots(dex);
    if (l[2] && roll(dex, 'hid') < HIDDEN_RATE) return 2;
    return l[1] && roll(dex, 'abil') < 0.5 ? 1 : 0;
  }
  /** { id, slot }: from a Capsule or randomly assigned. */
  function abilityOf(dex) {
    const s = save(), p = s && s.pabil && s.pabil[dex], l = slots(dex);
    let slot = p && l[p[0]] ? p[0] : rolledSlot(dex);
    if (!l[slot]) slot = 0;
    return { id: l[slot] || '', slot };
  }
  /** Slots you can switch to (hidden ability only with a Hidden Ability Capsule). */
  function abilityChoices(dex, hidden) {
    const l = slots(dex), cur = abilityOf(dex).slot;
    return [0, 1, 2].filter(i => l[i] && i !== cur && (i < 2 || hidden) && !(i === 1 && l[1] === l[0]));
  }
  function setAbility(dex, slot) {
    const s = save();
    if (!s || !slots(dex)[slot]) return;
    s.pabil = s.pabil || {};
    s.pabil[dex] = [slot, Date.now()];
  }
  const abilityName = id => (id && G.ABIL[id] ? name(G.ABIL[id]) : '');

  // ---------------- MT ----------------

  /** Moves learned with TMs. */
  function taught(dex) {
    const s = save(), l = s && s.ptm && s.ptm[dex];
    return Array.isArray(l) ? l.filter(id => G.Moves.BY_ID[id]) : [];
  }
  /** Does it already know the move without a TM (is it one of its types)? */
  const natural = (dex, id) => G.Moves.poolFor(G.DEX_BY[dex], true).includes(id);
  /** TMs it can learn (excluding those it already knows). */
  function learnable(dex) { return G.TM_OF(dex).filter(id => G.Moves.BY_ID[id] && !natural(dex, id) && !taught(dex).includes(id)); }
  const canLearn = (dex, id) => learnable(dex).includes(id);
  /** Teaches a TM from the Backpack (consumes it). → true if learned. */
  function teach(dex, id) {
    const s = save();
    if (!s || !canLearn(dex, id) || !G.Shop.takeTm(id)) return false;
    s.ptm = s.ptm || {};
    s.ptm[dex] = taught(dex).concat([id]);
    return true;
  }

  return { name, natureOf, setNature, rolledNature, monFor, abilityOf, abilityChoices, setAbility, abilityName,
           slots, taught, learnable, canLearn, teach, natural };
})();

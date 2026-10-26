/* ============ stats.js — physical / special attack and defenses ============
 * As in the games, each move is physical or special (G.Moves, m.cat). Physical
 * moves use your Pokémon's Attack (mon.pa), and special moves use its Special
 * Attack (mon.sa). 'atk' remains the higher of the two, so attacks on its
 * stronger side deal the same damage as before 2026-10-18.
 *
 * Defenses (mon.df / mon.sd, the base stats from the games) are softened so
 * neither becomes impossible: 75 (the average) has no effect; high defense
 * reduces damage by up to 22%, while low defense increases it by up to 25%.
 *   - Enemies defend against your physical moves with Defense and special
 *     moves with Special Defense.
 *   - Each enemy attacks with its stronger side (physical if its Attack is
 *     higher than its Special Attack); you defend with the matching stat.
 * Arceus damage (pure) and traps ignore these calculations.
 */
G.Stats = (() => {
  const REF = 75, EXP = 0.35, LO = 0.78, HI = 1.25;
  const NAME = { physical: 'Físico', special: 'Especial' };

  /** Damage multiplier for a target with this base defense. */
  function guard(def) { return G.U.clamp(Math.pow(REF / Math.max(5, def || REF), EXP), LO, HI); }

  return {
    NAME,
    /**
     * Damage taken by a Pokémon (mon with df/sd) from a hit of category cat.
     * No category or no data: ×1.
     */
    taken(mon, cat) {
      if (!mon || !cat) return 1;
      return guard(cat === 'special' ? mon.sd : mon.df);
    },
    /** A Pokémon's stronger side: 'physical' | 'special' (ties go to physical). */
    sideOf(mon) {
      if (!mon || mon.pa == null || mon.sa == null) return 'physical';
      return mon.sa > mon.pa ? 'special' : 'physical';
    },
    /** How a move performs with this Pokémon relative to its stronger side (1 = equal). */
    fit(mon, cat) {
      if (!mon || !cat || mon.pa == null) return 1;
      return (cat === 'special' ? mon.sa : mon.pa) / mon.atk;
    }
  };
})();

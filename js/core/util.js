/* ============ util.js — shared helpers ============ */
window.G = window.G || {};

/** Height above the ground plane for projectiles and effects. */
G.LIFT = 18;

G.U = {
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  /*
   * Data received from OTHER players (leaderboards, profiles, reports) is
   * sanitized when read, before it is used anywhere. (2026-10-18: someone
   * inserted code into the "level" field of a leaderboard entry, and it ran in
   * the browser of anyone who opened it.) Numbers remain numbers and strings
   * remain strings (and are escaped when rendered).
   */
  int(v, max = 1e12) { return Number.isFinite(+v) && +v > 0 ? Math.min(max, Math.floor(+v)) : 0; },
  str(v, max = 64) { return typeof v === 'string' ? v.slice(0, max) : ''; },
  list(v, max = 50) { return Array.isArray(v) ? v.slice(0, max) : []; },
  lerp(a, b, t) { return a + (b - a) * t; },
  rand(a, b) { return a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },

  /** Pick n distinct random elements. */
  pickN(arr, n) {
    const c = arr.slice();
    const out = [];
    while (out.length < n && c.length) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]);
    return out;
  },

  dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); },
  dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },

  /** Normalize a vector; return [0,0] if it is zero. */
  norm(x, y) { const m = Math.hypot(x, y); return m > 1e-6 ? [x / m, y / m] : [0, 0]; },

  /** Frame-rate-independent interpolation. */
  damp(a, b, rate, dt) { return b + (a - b) * Math.exp(-rate * dt); },

  /** Deterministic 2D hash -> [0,1). Keeps map generation consistent. */
  hash(x, y, seed = 0) {
    // Use 32-bit integers with Math.imul: this is the most frequently called
    // function while baking the map, keeping V8 on its fast path.
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  },

  /** Format seconds as "3:07". */
  mmss(s) {
    const m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  },

  /** Pokémon type colors (for projectiles, tags, and effects). */
  TYPE_COLOR: {
    normal: '#b0a99f', fire: '#ff7b3d', water: '#4b9bff', grass: '#5fcb6a',
    electric: '#ffd33d', ice: '#7fe0e0', fighting: '#e0533d', poison: '#b45ec4',
    ground: '#d6b25c', flying: '#9bb8ff', psychic: '#ff5f9e', bug: '#a3c43d',
    rock: '#bfa96b', ghost: '#7a6bc4', dragon: '#6b58ff', dark: '#6b5c52',
    steel: '#a8b8c4', fairy: '#ff9ed8'
  },

  TYPE_NAME: {
    normal: 'Normal', fire: 'Fuego', water: 'Agua', grass: 'Planta',
    electric: 'Eléctrico', ice: 'Hielo', fighting: 'Lucha', poison: 'Veneno',
    ground: 'Tierra', flying: 'Volador', psychic: 'Psíquico', bug: 'Bicho',
    rock: 'Roca', ghost: 'Fantasma', dragon: 'Dragón', dark: 'Siniestro',
    steel: 'Acero', fairy: 'Hada'
  }
};

/* ============ pathing.js — enemies path around rocks and lakes ============
 * A "distance field" is built for each player every few tenths of a second:
 * run a breadth-first search (BFS) through nearby tiles, recording how many
 * steps each tile is from the player. Enemies only need to move toward the
 * neighboring tile with fewer steps to find a path around walls, rocks, trees,
 * and dangerous puddles.
 *
 *   - 8 neighbors, without cutting corners (cannot squeeze diagonally between rocks).
 *   - Blocked by walls, solid props, and lava/poison/electric discharge.
 *     Water is passable (it only slows you).
 *   - Floating Pokémon (G.Sprites.hovers) do not need this; they move in a straight line.
 *
 * Cost: radius R=28 → 57×57 = 3,249 tiles per player every 0.35 s. Enemies
 * outside the field (far away) move in a straight line.
 */
G.Path = (() => {
  const R = 28, N = R * 2 + 1, EVERY = 0.35;
  const UNSEEN = 0x7fff;
  const fields = new Map();          // player -> { ox, oy, dist: Int16Array, t }
  const queue = new Int32Array(N * N);
  const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let timer = 0;

  function build(pl) {
    const TS = G.World.TS;
    const px = Math.floor(pl.x / TS), py = Math.floor(pl.y / TS);
    const ox = px - R, oy = py - R;
    let f = fields.get(pl);
    if (!f) { f = { dist: new Int16Array(N * N) }; fields.set(pl, f); }
    f.ox = ox; f.oy = oy;
    const dist = f.dist;
    dist.fill(UNSEEN);
    // Walkable cells in the area (queried once).
    const open = f.open || (f.open = new Uint8Array(N * N));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) open[j * N + i] = G.World.walkable(ox + i, oy + j) ? 1 : 0;

    const start = R * N + R;
    open[start] = 1;                 // always include the player's tile
    dist[start] = 0;
    let head = 0, tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % N, cy = (c / N) | 0, d = dist[c] + 1;
      for (let k = 0; k < 8; k++) {
        const nx = cx + D8[k][0], ny = cy + D8[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const n = ny * N + nx;
        if (!open[n] || dist[n] !== UNSEEN) continue;
        // Diagonal movement: both adjacent cells must be clear.
        if (k >= 4 && (!open[cy * N + nx] || !open[ny * N + cx])) continue;
        dist[n] = d;
        queue[tail++] = n;
      }
    }
  }

  /** Recalculate fields for living players (called by the host / solo player). */
  function update(dt, players) {
    timer -= dt;
    if (timer > 0) return;
    timer = EVERY;
    for (const p of [...fields.keys()]) if (!players.includes(p)) fields.delete(p);
    for (const p of players) if (!p.dead) build(p);
  }

  /**
   * Normalized direction for `e` to reach `pl` around obstacles, or null if
   * unnecessary (nearby, outside the field, or no path available).
   */
  function dirFor(e, pl) {
    const f = fields.get(pl);
    if (!f) return null;
    const TS = G.World.TS;
    const tx = Math.floor(e.x / TS) - f.ox, ty = Math.floor(e.y / TS) - f.oy;
    if (tx < 0 || ty < 0 || tx >= N || ty >= N) return null;
    const here = f.dist[ty * N + tx];
    if (here <= 1 || here === UNSEEN) return null;   // adjacent or unreachable: move directly
    // If there is a clear line of sight to the player, move directly (more natural).
    // Checked every 0.2 s per enemy (the most expensive operation).
    const now = performance.now();
    if (!e.losAt || now - e.losAt > 200) { e.losAt = now; e.los = clearLine(f, e.x, e.y, pl.x, pl.y, e.r); }
    if (e.los) return null;
    // Next path cell (neighbor with the fewest steps, without cutting corners).
    let bx = tx, by = ty, best = here;
    for (let k = 0; k < 8; k++) {
      const x = tx + D8[k][0], y = ty + D8[k][1];
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const v = f.dist[y * N + x];
      if (v >= best) continue;
      if (k >= 4 && (!f.open[ty * N + x] || !f.open[y * N + tx])) continue;
      best = v; bx = x; by = y;
    }
    if (bx === tx && by === ty) return null;
    let gx = (f.ox + bx + 0.5) * TS, gy = (f.oy + by + 0.5) * TS;
    // If off-center and the shortcut to that cell clips an obstacle, move to
    // the center of the current cell first (to avoid getting caught on corners).
    if (!clearLine(f, e.x, e.y, gx, gy, e.r)) { gx = (f.ox + tx + 0.5) * TS; gy = (f.oy + ty + 0.5) * TS; }
    return G.U.norm(gx - e.x, gy - e.y);
  }

  /** Can a body with radius r fit along a straight line from (ax,ay) to (bx,by)? */
  function clearLine(f, ax, ay, bx, by, r) {
    const TS = G.World.TS;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) return true;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    const w = Math.min(r * 0.9, TS * 0.45);
    for (let d = 0; d <= len; d += TS * 0.4) {
      const cx = ax + ux * d, cy = ay + uy * d;
      for (const s of [-w, 0, w]) {
        const x = Math.floor((cx - uy * s) / TS) - f.ox, y = Math.floor((cy + ux * s) / TS) - f.oy;
        if (x < 0 || y < 0 || x >= N || y >= N) return false;
        if (!f.open[y * N + x]) return false;
      }
    }
    return true;
  }

  function clear() { fields.clear(); timer = 0; }

  return { update, dirFor, clear };
})();

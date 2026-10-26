/* ============ camera.js — world-to-screen view and transform ============
 * The visible world width (VIEW_W) remains constant at any window size, so
 * the game feels the same on every screen.
 */
G.Camera = {
  x: 0, y: 0,
  scale: 1,
  VIEW_W: 768,              // 20% more visible area than the original 640
  shake: 0,
  _sx: 0, _sy: 0,

  /** Recalculate the scale for the current canvas size. */
  dpr: 1,

  // On screens wider than 16:9 (mobile landscape), also ensure a minimum
  // world height so the player does not see only a narrow strip.
  MIN_VIEW_H: 420,

  // Luminous Orb: zoom out (zoom > 1 shows more of the world); gradually approach zoomTo.
  zoom: 1, zoomTo: 1, _cw: 0, _ch: 0,

  resize(cssW, cssH, dpr = 1) {
    this.dpr = dpr;
    this._cw = cssW; this._ch = cssH;
    this.fit();
  },

  fit() {
    this.scale = Math.min(this._cw / this.VIEW_W, this._ch / this.MIN_VIEW_H) / this.zoom;
    this.w = this._cw / this.scale;
    this.h = this._ch / this.scale;
  },

  follow(tx, ty, dt) {
    if (this.zoom !== this.zoomTo) {
      this.zoom = Math.abs(this.zoom - this.zoomTo) < 0.003 ? this.zoomTo : G.U.damp(this.zoom, this.zoomTo, 3, dt);
      this.fit();
    }
    this.x = G.U.damp(this.x, tx, 9, dt);
    this.y = G.U.damp(this.y, ty, 9, dt);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.4);
      const a = this.shake * 7;
      this._sx = G.U.rand(-a, a);
      this._sy = G.U.rand(-a, a);
    } else { this._sx = this._sy = 0; }
  },

  kick(amount) {
    if (G.Settings.get('calm')) amount *= 0.25;      // "less shaking"
    this.shake = Math.min(1.2, this.shake + amount);
  },

  /** Apply the camera transform to the context. */
  apply(ctx) {
    // Snap to physical screen pixels; otherwise 1 px seams appear between
    // chunks and sprites "shimmer" while moving.
    const k = this.scale * this.dpr;
    ctx.translate(Math.round((-this.left() + this._sx) * k) / k,
                  Math.round((-this.top() + this._sy) * k) / k);
  },

  left() { return this.x - this.w / 2; },
  top() { return this.y - this.h / 2; },

  /*  * Is the point within the viewport (with a margin)? */
  sees(x, y, pad = 60) {
    return x > this.left() - pad && x < this.left() + this.w + pad &&
           y > this.top() - pad && y < this.top() + this.h + pad;
  },

  /** Radius of the circle around the viewport; used for off-screen spawns. */
  outerRadius() { return Math.hypot(this.w, this.h) / 2 + 40; }
};

/* ============ live-ui.js — YouTube button ============
 * A button in the top bar that opens the channel. If the channel is live,
 * it turns red with "LIVE" and opens the stream.
 *
 * Checking whether the channel is live costs nothing: .github/workflows/live.yml
 * checks the channel every 5 minutes and puts live.json on the repository's
 * "live" branch ({ live, id, at }); this reads it from GitHub, without Firebase.
 * Notices older than 90 minutes (when checks have stopped) are ignored.
 */
G.LiveUI = (() => {
  const $ = G.UI.$;
  const CHANNEL = 'https://www.youtube.com/@jpter78';
  const SRC = 'https://raw.githubusercontent.com/JPTER78/pokesurvivor/live/live.json';
  const EVERY = 5 * 60 * 1000, STALE = 90 * 60 * 1000;
  let live = null, lastT = 0;

  function init() {
    const b = $('btn-yt');
    b.onclick = () => window.open(live ? 'https://www.youtube.com/watch?v=' + live : CHANNEL, '_blank', 'noopener');
    draw();
    check();
    setInterval(check, EVERY);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }

  function draw() {
    const b = $('btn-yt');
    b.classList.toggle('live', !!live);
    b.title = live ? '¡Estoy en directo! Pulsa para verlo' : 'Mi canal de YouTube';
    b.innerHTML = live ? '<i class="rec"></i><span>EN DIRECTO</span>' : G.Icons.html('yt', 18) + ' <span>YouTube</span>';
  }

  async function check() {
    // Only while the tab is visible, and at most once every 5 minutes.
    if (document.hidden || Date.now() - lastT < EVERY - 5000) return;
    lastT = Date.now();
    try {
      const r = await fetch(SRC, { cache: 'no-cache' });
      if (!r.ok) return;
      const d = await r.json();
      const id = d.live && /^[\w-]{11}$/.test(d.id || '') && Date.now() - Date.parse(d.at) < STALE ? d.id : null;
      if (id !== live) { live = id; draw(); }
    } catch (e) { /* no network or file: leave it as is */ }
  }

  return { init };
})();

/* ============ updater.js — automatic updates ============
 * When a new version is published (node tools/build.js writes version.json with
 * the js/app.min.js hash), all players receive it without losing progress:
 *
 *   - Check version.json every 5 minutes and when returning to the tab
 *     (served by GitHub Pages at no cost).
 *   - If NOT in a run: show an "updating in 5 s…" notice and reload.
 *     If the player is in the gacha, upgrade shop, settings, or typing in a
 *     field, wait until they finish. Co-op rooms reload too (decision of
 *     2026-10-12).
 *   - If IN A RUN: do nothing. When it ends, save as usual (records, coins,
 *     tickets, leaderboard), then reload on returning to the menu.
 *   - Before reloading, wait for the saved game to upload to the cloud (for
 *     at most a few seconds; otherwise it remains in this browser and uploads
 *     on the next sign-in).
 *   - REQUIRED update (node tools/build.js --forzar writes force:true to
 *     version.json): players in a run see a 10-second notice, then the run
 *     ends as if they had quit (coins, tickets, records, and leaderboard are
 *     saved), uploads to the cloud, and reloads. This is supported only by
 *     players who already have this updater.js (since 2026-10-15).
 * Only works on the published site (with app.min.js); does nothing in
 * dev.html or when opened with a double-click (file://).
 */
G.Updater = (() => {
  const EVERY = 5 * 60 * 1000, COUNTDOWN = 5, FORCED = 10;
  const tag = document.querySelector('script[src*="app.min.js?v="]');
  const mine = tag ? (tag.getAttribute('src').match(/v=([0-9a-f]+)/) || [])[1] : null;
  let pending = false, forced = false, lastCheck = 0, timer = 0, counting = false;

  async function check() {
    if (!mine || pending) return;
    lastCheck = Date.now();
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (j && j.v && j.v !== mine) { pending = true; forced = !!j.force; console.log('[Actualizar] versión nueva', j.v, '(esta es', mine + ')', forced ? 'OBLIGATORIA' : ''); }
    } catch (e) { /* offline: check again next time */ }
  }

  /** Can we reload now without interrupting anything? */
  function safe() {
    if (!G.Game || G.Game.state !== 'ui') return false;                   // in a run or results screen
    if (['scr-gacha', 'scr-upgrades', 'scr-settings'].some(id => document.getElementById(id) && G.UI.isOpen(id))) return false;
    const fx = document.getElementById('pull-fx');
    if (fx && !fx.classList.contains('hidden')) return false;             // gacha pull in progress
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;   // typing (password, nickname, etc.)
    return true;
  }

  async function reload() {
    // Upload pending saves to the cloud before reloading (wait no more than 6 s).
    const dirty = G.DB.syncState && G.DB.syncState !== 'ok' && G.DB.syncState !== 'local';
    if (dirty) { try { await Promise.race([G.DB.flush(), new Promise(r => setTimeout(r, 6000))]); } catch (e) { /* remains in this browser */ } }
    location.reload();
  }

  function countdown() {
    counting = true;
    let n = COUNTDOWN;
    const tick = () => {
      if (!safe()) { counting = false; G.UI.toast('', 1); return; }     // a run has started; wait
      if (n <= 0) { reload(); return; }
      G.UI.toast('Hay una versión nueva del juego: actualizando en ' + n + ' s…', 1500);
      n--;
      setTimeout(tick, 1000);
    };
    tick();
  }

  /** Is a session in progress (one that a required update must close)? */
  function inRun() { return G.Game && G.Game.state !== 'ui' && G.Game.state !== 'over'; }

  /** Required update during a run: notify, end the run (saving everything), and reload. */
  function forceEnd() {
    counting = true;
    let n = FORCED;
    const tick = () => {
      if (!inRun()) { reload(); return; }                                 // the player finished it
      if (n <= 0) {
        G.Game.quit();                                                    // same as quitting: save progress
        setTimeout(reload, 4000);                                         // allow the record and leaderboard to appear
        return;
      }
      G.UI.toast('Actualización obligatoria: tu partida se guarda y el juego se recarga en ' + n + ' s…', 1500);
      n--;
      setTimeout(tick, 1000);
    };
    tick();
  }

  function loop() {
    if (pending && forced && !counting && inRun()) { forceEnd(); return; }
    if (pending && forced && !counting && G.Game && G.Game.state === 'over') { reload(); return; }   // results screen: already saved
    if (pending && !counting && safe()) countdown();
    if (!pending && Date.now() - lastCheck > EVERY) check();
  }

  function init() {
    if (!mine || !location.protocol.startsWith('http')) return;
    clearInterval(timer);
    timer = setInterval(loop, 2000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60000) check(); });
    setTimeout(check, 30000);
  }

  return { init, check, get pending() { return pending; }, get version() { return mine; } };
})();

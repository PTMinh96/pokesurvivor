/* ============ boot.js — the first script to run (previously in the HTML) ============
 * Kept outside the HTML so the Content Security Policy (CSP, in dev.html) can
 * forbid all inline code: even if text containing code were ever inserted into
 * rendered content, the browser would not execute it.
 *   - PS_PAGES: guide and Pokédex are available (unless --sin-seo; see tools/build.js).
 *   - The loading screen language, before the game loads.
 */
window.PS_PAGES = !!document.querySelector('meta[name="ps-pages"]');
(function () {
  // locales.js selects the language in the <head>.
  var copy = {
    es: ['Juego de supervivencia con Pokémon, gratis en el navegador y en el móvil.', 'Cargando…'],
    en: ['A Pokémon survival game, free in your browser and on mobile.', 'Loading…'],
    fr: ['Un jeu de survie Pokémon gratuit sur navigateur et mobile.', 'Chargement…'],
    it: ['Un gioco di sopravvivenza Pokémon gratuito su browser e cellulare.', 'Caricamento…'],
    'pt-BR': ['Um jogo de sobrevivência Pokémon grátis no navegador e no celular.', 'Carregando…'],
    'zh-Hans': ['免费的宝可梦生存游戏，可在浏览器和手机上游玩。', '加载中…'],
    'zh-Hant': ['免費的寶可夢生存遊戲，可在瀏覽器與手機上遊玩。', '載入中…']
  }[window.PS_LOCALES && window.PS_LOCALES.lang];
  if (!copy) return;
  var p = document.querySelectorAll('#boot p');
  p[0].textContent = copy[0]; p[1].textContent = copy[1];
})();

/* ============ funding.js — donations ============
 * Donations are voluntary, provide no in-game advantages, and are used only
 * to keep the game online: servers and domain.
 * This file is the source for what is shown in-game (the "Support" button)
 * and on the /apoyar/ page. Updated manually:
 *
 *   kofi      Ko-fi username (empty = button is hidden)
 *   sponsors  GitHub Sponsors username (for repository visitors)
 *   costs     expenses [description, euros per month]; use text for variable costs
 */
G.Funding = {
  kofi: 'jpter78',
  sponsors: 'JPTER78',
  costs: [
    ['Servidores (partidas, cuentas, ranking y multijugador)', 'Según cuánta gente juegue'],
    ['Dominio pokesurvivor.com', '≈12 € al año']
  ],
  get url() { return this.kofi ? 'https://ko-fi.com/' + this.kofi : ''; }
};

# PokéSurvivor — development and releases

The project owner's standing requirements. ALWAYS apply them.

## Releasing a version
1. Edit `dev.html` (never `index.html`, which is generated).
2. Run `node tools/build.js && node tools/export_data.js && python tools/make_seo_pages.py`.
   - `build.js` generates `index.html`, `js/app.min.js`, and **`version.json`** (the fingerprint for this version).
3. Commit (without "Co-Authored-By" or any AI signature) and `git push origin main` only when the owner asks.

## Mandatory automatic player updates
When publishing, every player must move to the new version without losing anything
(`js/core/updater.js` checks `version.json` every 5 minutes):
- **Outside a run** (including the menu and co-op lobby): show a 5-second notice and reload the page.
  If the player is using the gacha, upgrade shop, settings, or typing in a field, wait until they finish.
- **During a run**: do nothing. At the end, save the run as usual, then reload on returning to the menu.
- Upload pending data to the cloud before reloading.
Do not remove `updater.js` or the `version.json` generation in `tools/build.js`.

## Changelog
Every gameplay change or bug fix must also be recorded in `js/data/changelog.js`
(Spanish and English, under `new` / `chg` / `fix` for today's date). Server,
database, or cost changes do NOT belong there.

## Servers
- Firebase: project **pokesurvivor-free** (standard authentication: unlimited free accounts).
  **Never** enable "Identity Platform" or anything that enables it (blocking functions, MFA,
  "Upgrade to enable"): it charges per user. The old pokesurvivor-jpter project was deleted on 2026-10-13 (including its billing).
- Cloudflare: ONLY the pokesurvivor.com domain (purchased there, free DNS). The Worker and TURN
  (Cloudflare Realtime) were removed on 2026-10-15: co-op now uses direct connections only
  (Google's free STUN). Do not add any paid services again.
- Maintenance mode: `MAINTENANCE` in `js/main.js` (use `?dev` to enter for testing).

/* ============ db.js — database: Firebase (cloud) or local ============
 * ALL access to persistent data goes through here. The rest of the game only
 * uses G.DB.*.
 *
 * Two modes (selected in ready()):
 *
 *   CLOUD  (Firebase Authentication + Cloud Firestore)
 *     Requires configuration in js/core/firebase-config.js and opening the
 *     game from a website (http/https, including localhost). The save is stored
 *     in saves/{uid} and can be continued on any computer.
 *       - Username + password: Firebase requires an email, so the username is
 *         converted to an internal address (nothing is ever sent to it).
 *       - Google account.
 *     A local copy is also saved for offline play; when syncing, it is MERGED
 *     (see merge): collections are combined and no Pokémon or shiny is lost.
 *
 *   LOCAL (localStorage)
 *     Used when there is no configuration or the game is opened by double-click
 *     (file://). As before, accounts and saves exist only in this browser.
 *       ps.accounts      { key: { name, salt, hash, created } }
 *       ps.save.<key>    that account's save
 *       ps.session       last account signed in
 *
 * Guest mode uses an in-memory save that is not persisted.
 */
G.DB = (() => {
  const K_ACC = 'ps.accounts', K_SES = 'ps.session', K_SAVE = 'ps.save.';
  const K_CLOUD = 'ps.cloud.', K_MIGRATED = 'ps.migrated.';
  const VERSION = 3;
  const START_COINS = 500;
  const SDK = 'https://www.gstatic.com/firebasejs/13.0.0/';
  const NAME_DOMAIN = 'jugadores.pokesurvivor.net';   // Used only for the internal email address

  let mode = 'local';       // 'cloud' | 'local'
  let localReason = '';     // Why cloud mode is unavailable: 'file' | 'config' | 'host' | 'error'
  let user = null;          // Visible name
  let key = null;           // Lowercase local key or Firebase uid
  let guest = false;
  let save = null;
  let storageOk = true;

  // ---------------- safe local storage ----------------

  function read(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
    catch (e) { storageOk = false; return null; }
  }
  function write(k, v) {
    const s = JSON.stringify(v);
    try { localStorage.setItem(k, s); return true; }
    catch (e) {
      // Storage full (often due to leaderboard data): remove disposable data
      // and retry. Previously the run save silently stopped updating and a
      // reload restored the older cloud copy.
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && /^ps\.rk\.c\./.test(key)) localStorage.removeItem(key);
        }
        localStorage.setItem(k, s); return true;
      } catch (e2) { storageOk = false; return false; }
    }
  }
  function remove(k) { try { localStorage.removeItem(k); } catch (e) { /* Nothing to do. */ } }

  // ---------------- save data ----------------

  function newSave(name) {
    return {
      v: VERSION,
      name,
      created: Date.now(),
      updated: Date.now(),    // Last modification (for merging)
      coins: START_COINS,
      owned: {},              // dex -> { at, from: 'starter'|'gacha'|'wild' }
      shiny: {},              // dex -> { at, from } — shiny variants obtained
      partner: null,          // dex of the Pokémon you play as
      partnerShiny: false,    // Play as its shiny version (if owned)
      starter: null,          // dex selected by the quiz
      personality: null,      // { trait, scores }
      upgrades: {},           // Legacy account upgrades; now stored per Pokémon
      pupg: {},               // dex -> { id -> level }: each Pokémon's upgrades
      dfav: {},               // dex -> timestamp: collection favorite (negative = removed then)
      pused: {},              // dex -> runs played with it (most-used sort order)
      pstart: {},             // dex -> selected starting move (Upgrades → Starting move)
      pstart2: {},            // dex -> second starting move (Upgrades → Second starting move)
      // Kecleon shop (2026-10-20; see data/shop.js and systems/mons.js):
      bag: {},                // Backpack: id -> quantity (mint, cap, caph); also tracked in the ledger like coins
      tms: {},                // Unused TMs: move -> quantity; also tracked in the ledger
      ptm: {},                // dex -> [moves learned via TM] (permanent)
      pnat: {},               // dex -> [nature, timestamp]: changed with Mint (otherwise, the assigned nature)
      pabil: {},              // dex -> [0|1|2, timestamp]: changed with Capsule (2 = hidden)
      tickets: { t1: 0, t10: 0 },   // Gacha tickets (x1 and x10)
      pity: {},               // Banner generation -> pulls without a ★5
      legends: {},            // dex -> timestamp: legendaries defeated in rifts
      arenas: {},             // type -> timestamp: rift arenas won
      itemsFound: {},         // id -> timestamp: equipable items found
      evoMoves: {},           // id -> timestamp: moves ever evolved
      ach: {},                // id -> timestamp: achievements earned
      missions: {},           // Daily / weekly missions (systems/progress.js)
      profile: { favs: [], title: '' },   // Public profile: 3 favorites and a title
      stats: { runs: 0, bestTime: 0, bestLevel: 0, totalKills: 0, pulls: 0, coinsEarned: 0, shinies: 0,
               bossesTotal: 0, riftWins: 0, evolutions: 0, missionsDone: 0, groupRuns: 0, bestGroupTime: 0 }
    };
  }

  /** Fill in fields missing from saves created by earlier versions. */
  function migrate(s, name) {
    const base = newSave(name || s.name);
    for (const k in base) if (s[k] == null) s[k] = base[k];
    for (const k in base.stats) if (s.stats[k] == null) s.stats[k] = base.stats[k];
    // v1 -> v2: there was a single banner (Kanto), with pity stored as a number.
    if (typeof s.pity === 'number') s.pity = { 1: s.pity };
    // v2 -> v3: upgrades used to belong to the account; assign them to the companion at the time.
    if (!s.pupgDone) {
      if (s.partner && Object.values(s.upgrades || {}).some(v => v > 0)) {
        s.pupg[s.partner] = Object.assign({}, s.upgrades);
      }
      s.pupgDone = true;
    }
    s.tickets = Object.assign({ t1: 0, t10: 0 }, s.tickets);
    sanitize(s);
    s.v = VERSION;
    return s;
  }

  /**
   * Remove impossible values from a manually edited save (the browser copy
   * can be modified): negative or unusual numbers, upgrades above the maximum,
   * and nonexistent Pokémon. The server (firestore.rules, saves) blocks values
   * that are otherwise possible.
   */
  function sanitize(s) {
    const n = v => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);
    s.coins = n(s.coins);
    s.tickets.t1 = n(s.tickets.t1);
    s.tickets.t10 = n(s.tickets.t10);
    if (isObj(s.led)) {
      for (const dev of Object.keys(s.led)) {
        const e = s.led[dev];
        if (!isObj(e)) { delete s.led[dev]; continue; }
        for (const k of Object.keys(e)) {
          if (!isCurKey(k) || !Array.isArray(e[k])) { delete e[k]; continue; }
          e[k] = [n(e[k][0]), n(e[k][1])];
        }
      }
    } else delete s.led;
    if (G.DEX_BY) for (const coll of ['owned', 'shiny', 'dfav', 'pused']) {
      for (const d of Object.keys(s[coll] || {})) if (!G.DEX_BY[d]) delete s[coll][d];
    }
    for (const coll of ['dfav', 'pused']) {
      if (!isObj(s[coll])) { s[coll] = {}; continue; }
      for (const d of Object.keys(s[coll])) if (!Number.isFinite(+s[coll][d])) delete s[coll][d];
    }
    for (const k of ['pstart', 'pstart2']) {
      if (!isObj(s[k])) s[k] = {};
      for (const d of Object.keys(s[k])) {
        if (typeof s[k][d] !== 'string' || (G.DEX_BY && !G.DEX_BY[d]) || (G.Moves && !G.Moves.BY_ID[s[k][d]])) delete s[k][d];
      }
    }
    // Backpack and TMs: counts for each existing item (maximum 999).
    for (const [k, ok] of [['bag', id => !G.Shop || G.Shop.ITEMS[id]], ['tms', id => !G.Moves || G.Moves.BY_ID[id]]]) {
      if (!isObj(s[k])) s[k] = {};
      for (const id of Object.keys(s[k])) {
        s[k][id] = Math.min(999, n(s[k][id]));
        if (!s[k][id] || !ok(id)) delete s[k][id];
      }
    }
    // Learned TMs: existing moves, with no duplicates.
    if (!isObj(s.ptm)) s.ptm = {};
    for (const d of Object.keys(s.ptm)) {
      const l = Array.isArray(s.ptm[d]) ? s.ptm[d] : [];
      s.ptm[d] = [...new Set(l.filter(id => typeof id === 'string' && (!G.Moves || G.Moves.BY_ID[id])))];
      if (!s.ptm[d].length || (G.DEX_BY && !G.DEX_BY[d])) delete s.ptm[d];
    }
    // Selected nature and ability: [value, timestamp].
    for (const [k, ok] of [['pnat', v => typeof v === 'string' && (!G.NATURE_BY || G.NATURE_BY[v])], ['pabil', v => v === 0 || v === 1 || v === 2]]) {
      if (!isObj(s[k])) s[k] = {};
      for (const d of Object.keys(s[k])) {
        const e = s[k][d];
        if (!Array.isArray(e) || !ok(e[0]) || (G.DEX_BY && !G.DEX_BY[d])) delete s[k][d];
        else s[k][d] = [e[0], n(e[1])];
      }
    }
    // Shortcuts: 4 slots with existing moves (or null), without duplicates.
    if (s.pbind && typeof s.pbind === 'object') {
      for (const d of Object.keys(s.pbind)) {
        const l = Array.isArray(s.pbind[d]) ? s.pbind[d].slice(0, 4) : [];
        const seen = new Set();
        s.pbind[d] = [0, 1, 2, 3].map(i => {
          const id = l[i];
          if (typeof id !== 'string' || (G.Moves && !G.Moves.BY_ID[id]) || seen.has(id)) return null;
          seen.add(id); return id;
        });
      }
    } else s.pbind = {};
    // Veto: lists of existing moves, without duplicates, up to 3.
    if (s.pban && typeof s.pban === 'object') {
      for (const d of Object.keys(s.pban)) {
        const l = Array.isArray(s.pban[d]) ? s.pban[d] : [];
        s.pban[d] = [...new Set(l.filter(id => typeof id === 'string' && (!G.Moves || G.Moves.BY_ID[id])))].slice(0, 3);
      }
    } else s.pban = {};
    if (G.Upgrades) for (const d of Object.keys(s.pupg || {})) {
      const u = s.pupg[d];
      if (!u || typeof u !== 'object') { delete s.pupg[d]; continue; }
      for (const id of Object.keys(u)) {
        if (!G.Upgrades.BY[id]) delete u[id];
        else u[id] = Math.min(G.Upgrades.BY[id].max, n(u[id]));
      }
    }
  }

  /**
   * Merge two versions of the same save (e.g. one played offline and the cloud
   * copy). Nothing earned is lost:
   *   - collections (owned, shiny): union
   *   - upgrades and stats: the maximum of each
   *   - coins, partner, pity, etc.: values from the most recent version
   * This is idempotent: merging twice gives the same result.
   */
  /*
   * COIN AND TICKET LEDGER (2026-10-14). Previously, coins and tickets came
   * from "the most recent version": if a device with stale data (a phone with
   * yesterday's tab still open) saved, its balance won and progress on the
   * other device was lost (one player went from 36 tickets to 3).
   * Now each device records what it earned and spent for each currency in
   * save.led[device] ([earned, spent], values only increase); the balance is
   * their sum. Merging takes the largest value for each entry, so nothing is
   * lost.
   *   led.base: balance from before the ledger (or at initial setup).
   *   led.old:  changes from an older game version (stale tabs).
   */
  const CUR = {
    c: [s => s.coins, (s, v) => { s.coins = v; }],
    t1: [s => s.tickets.t1, (s, v) => { s.tickets.t1 = v; }],
    t10: [s => s.tickets.t10, (s, v) => { s.tickets.t10 = v; }]
  };
  /*
   * Since 2026-10-20, the Backpack and TMs (Kecleon Shop) also use the same
   * ledger: 'b:<item>' (save.bag) and 'm:<move>' (save.tms). A Mint spent on
   * one device will not reappear after merging with another.
   */
  const isCurKey = k => !!CUR[k] || /^b:[a-z0-9]{1,12}$/.test(k) || /^m:[a-z0-9-]{1,40}$/.test(k);
  const SUB = { b: 'bag', m: 'tms' };
  function curGet(s, k) {
    if (CUR[k]) return CUR[k][0](s);
    const o = s[SUB[k[0]]];
    return o ? o[k.slice(2)] : 0;
  }
  function curSet(s, k, v) {
    if (CUR[k]) { CUR[k][1](s, v); return; }
    const o = s[SUB[k[0]]] = s[SUB[k[0]]] || {};
    if (v > 0) o[k.slice(2)] = Math.min(999, v); else delete o[k.slice(2)];
  }
  /** All balances in a save and its ledger. */
  function curKeys(s, led) {
    const ks = new Set(Object.keys(CUR));
    for (const id of Object.keys(s.bag || {})) ks.add('b:' + id);
    for (const id of Object.keys(s.tms || {})) ks.add('m:' + id);
    for (const dev in led || {}) for (const k in led[dev]) if (isCurKey(k)) ks.add(k);
    return [...ks];
  }
  // This device (browser): a random ID that is persisted.
  const DEV = (() => {
    let d = read('ps.dev');
    if (typeof d !== 'string' || !/^[a-z0-9]{6,12}$/.test(d)) { d = 'd' + Math.random().toString(36).slice(2, 10); write('ps.dev', d); }
    return d;
  })();
  const num = v => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);
  const balOf = (s, led) => { const o = {}; for (const k of curKeys(s, led)) o[k] = num(curGet(s, k)); return o; };
  function ledSum(led, k) {
    let t = 0;
    for (const dev in led) { const e = led[dev] && led[dev][k]; if (e) t += num(e[0]) - num(e[1]); }
    return t;
  }
  function addTo(led, dev, k, d) {
    if (!d) return;
    const e = led[dev] = led[dev] || {};
    const p = e[k] = e[k] || [0, 0];
    if (d > 0) p[0] = num(p[0]) + d; else p[1] = num(p[1]) - d;
  }
  /** Return a save's ledger without modifying it; reconcile any difference under `dev`. */
  function ledOf(s, dev) {
    if (!isObj(s.led)) {
      const b = balOf(s), base = {};
      for (const k in b) base[k] = [b[k], 0];
      return { base };
    }
    const led = JSON.parse(JSON.stringify(s.led)), b = balOf(s, led);
    // A negative balance (the same currency spent on two offline devices) is treated as 0.
    for (const k in b) addTo(led, dev, k, b[k] - Math.max(0, ledSum(led, k)));
    return led;
  }
  /** Record changes since the previous save in THIS device's ledger. */
  function fold(s) {
    if (!s) return s;
    s.led = ledOf(s, DEV);
    return s;
  }

  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;
    const newer = (a.updated || 0) >= (b.updated || 0) ? a : b;
    const older = newer === a ? b : a;
    const r = JSON.parse(JSON.stringify(newer));
    // Coins and tickets: keep the largest device entry for each record; balance is the sum.
    const la = ledOf(a, 'old'), lb = ledOf(b, 'old'), led = {};
    for (const src of [la, lb]) for (const dev in src) for (const k in src[dev]) {
      const p = ((led[dev] = led[dev] || {})[k] = led[dev][k] || [0, 0]), q = src[dev][k];
      p[0] = Math.max(p[0], num(q[0])); p[1] = Math.max(p[1], num(q[1]));
    }
    r.led = led;
    r.tickets = r.tickets || { t1: 0, t10: 0 };
    r.bag = {}; r.tms = {};
    for (const k of curKeys({ bag: {}, tms: {} }, led)) curSet(r, k, Math.max(0, ledSum(led, k)));
    // Learned TMs are never forgotten (union). Use the most recently selected nature and ability.
    r.ptm = r.ptm || {};
    for (const d in older.ptm || {}) r.ptm[d] = [...new Set((r.ptm[d] || []).concat(older.ptm[d] || []))];
    for (const k of ['pnat', 'pabil']) {
      r[k] = r[k] || {};
      for (const d in older[k] || {}) if (!r[k][d] || (+older[k][d][1] || 0) > (+r[k][d][1] || 0)) r[k][d] = older[k][d];
    }
    for (const coll of ['owned', 'shiny']) {
      r[coll] = r[coll] || {};
      for (const k in older[coll] || {}) {
        if (!r[coll][k] || (older[coll][k].at || 0) < (r[coll][k].at || 0)) r[coll][k] = older[coll][k];
      }
    }
    for (const k in older.upgrades || {}) r.upgrades[k] = Math.max(r.upgrades[k] || 0, older.upgrades[k]);
    r.pupg = r.pupg || {};
    for (const d in older.pupg || {}) {
      const mine = r.pupg[d] = r.pupg[d] || {};
      for (const k in older.pupg[d]) mine[k] = Math.max(mine[k] || 0, older.pupg[d][k]);
    }
    r.pupgDone = r.pupgDone || older.pupgDone;
    // Favorites: keep the most recent add/remove action for each entry across
    // devices. Runs with each Pokémon: keep the larger value.
    r.dfav = r.dfav || {};
    for (const d in older.dfav || {}) if (Math.abs(+older.dfav[d] || 0) > Math.abs(+r.dfav[d] || 0)) r.dfav[d] = older.dfav[d];
    r.pused = r.pused || {};
    for (const d in older.pused || {}) r.pused[d] = Math.max(+r.pused[d] || 0, +older.pused[d] || 0);
    // Starting move: use the most recent version; if it has no selection, use the other.
    for (const k of ['pstart', 'pstart2']) {
      r[k] = r[k] || {};
      for (const d in older[k] || {}) if (!(d in r[k])) r[k][d] = older[k][d];
    }
    // Never lose earned progress: union of legendaries, arenas, items, achievements, etc.
    for (const coll of ['legends', 'arenas', 'itemsFound', 'evoMoves', 'ach']) {
      r[coll] = r[coll] || {};
      for (const k in older[coll] || {}) if (!r[coll][k]) r[coll][k] = older[coll][k];
    }
    // Missions for the same day/week: keep the greatest progress and claimed rewards.
    const mo = older.missions || {}, mr = r.missions = r.missions || {};
    for (const [per, list] of [['day', 'daily'], ['week', 'weekly']]) {
      if (mr[per] !== mo[per] || !mr[list] || !mo[list]) continue;
      mr[list].forEach((m, i) => {
        const o = mo[list][i];
        if (!o || o.id !== m.id) return;
        m.prog = Math.max(m.prog || 0, o.prog || 0);
        m.claimed = m.claimed || o.claimed;
        m.told = m.told || o.told;
      });
    }
    for (const k in older.stats || {}) r.stats[k] = Math.max(r.stats[k] || 0, older.stats[k] || 0);
    if (r.starter == null) r.starter = older.starter;
    if (r.personality == null) r.personality = older.personality;
    if (r.partner == null || !r.owned[r.partner]) { r.partner = older.partner; r.partnerShiny = older.partnerShiny; }
    r.created = Math.min(a.created || Date.now(), b.created || Date.now());
    r.updated = Math.max(a.updated || 0, b.updated || 0);
    return r;
  }

  /** Replace the contents of `save` without replacing the object (other modules hold references to it). */
  // Copy `s` into the save WITHOUT replacing nested objects (upgrades, Pokémon,
  // etc.): open screens hold references to them. Previously, a purchase made
  // just after uploading the save updated the old copy, charging coins while
  // losing the upgrade.
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function assignDeep(dst, src) {
    for (const k of Object.keys(dst)) if (!(k in src)) delete dst[k];
    for (const k in src) {
      if (isObj(src[k]) && isObj(dst[k])) assignDeep(dst[k], src[k]);
      else dst[k] = src[k];
    }
  }
  function applyInPlace(s) { assignDeep(save, s); }

  const VALID = /^[A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]{3,16}$/;

  // =====================================================================
  //                               LOCAL MODE
  // =====================================================================

  async function hash(pass, salt) {
    const text = salt + ':' + pass;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    return 'f' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }

  function randomSalt() {
    const a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.random() * 256;
    return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function loadLocal(k, name) {
    const s = read(K_SAVE + k);
    return s ? migrate(s, name) : newSave(name);
  }

  function beginLocal(k, name) {
    key = k; user = name; guest = false;
    save = fold(loadLocal(k, name));
    write(K_SES, k);
  }

  async function registerLocal(name, pass) {
    const accs = read(K_ACC) || {};
    const k = name.toLowerCase();
    if (accs[k]) return { ok: false, error: 'Ese nombre ya existe.' };
    const salt = randomSalt();
    accs[k] = { name, salt, hash: await hash(pass, salt), created: Date.now() };
    if (!write(K_ACC, accs)) return { ok: false, error: 'El navegador no deja guardar datos (¿modo incógnito?).' };
    beginLocal(k, name);
    write(K_SAVE + k, save);
    return { ok: true, isNew: true };
  }

  async function loginLocal(name, pass) {
    const accs = read(K_ACC) || {};
    const acc = accs[name.toLowerCase()];
    if (!acc || acc.hash !== await hash(pass || '', acc.salt)) {
      return { ok: false, error: 'Usuario o contraseña incorrectos.' };
    }
    beginLocal(name.toLowerCase(), acc.name);
    return { ok: true, isNew: !save.partner };
  }

  function restoreLocal() {
    const k = read(K_SES);
    if (!k) return false;
    const accs = read(K_ACC) || {};
    if (!accs[k]) { remove(K_SES); return false; }
    beginLocal(k, accs[k].name);
    return true;
  }

  /** Save for a legacy local account, if the username and password match. */
  async function legacySave(name, pass) {
    const k = (name || '').toLowerCase();
    const acc = (read(K_ACC) || {})[k];
    if (!acc || read(K_MIGRATED + k)) return null;
    if (acc.hash !== await hash(pass || '', acc.salt)) return null;
    const s = read(K_SAVE + k);
    return s ? { key: k, save: migrate(s, acc.name) } : null;
  }

  // =====================================================================
  //                               CLOUD MODE
  // =====================================================================

  let auth = null, fs = null, rtdb = null, uid = null, unlisten = null;
  let pushT = 0, retryT = 0, pending = false, pushing = null, lastPush = 0;
  /*
   * Cloud save revision (saves/{uid}.rev, 2026-10-21). Each upload sends rev + 1,
   * and firestore.rules accepts it only if the cloud is still at rev. This
   * prevents a device with an old copy (such as a phone tab left open since
   * yesterday) from overwriting newer data. If rejected, fetch the cloud save,
   * merge it, and upload again (the only case that requires an extra read).
   */
  const K_REV = 'ps.rev.';
  let rev = 0, lastCheck = 0;
  const setRev = r => { rev = Number.isInteger(r) && r > 0 ? r : 0; write(K_REV + uid, rev); };
  // At most one upload every 30 minutes (with thousands of players, every
  // 5 minutes meant tens of thousands of writes per hour); purchases and gacha
  // were uploaded after 30 seconds. The local copy was always saved immediately
  // (and merged with the cloud on return); pending data uploaded when hiding or
  // closing the tab.
  // After pulls and purchases, upload after 3 minutes (previously 30 seconds:
  // frequent pulls caused two saves per minute and millions of writes per day).
  // Changes still reached the browser copy immediately and uploaded on exit.
  // Since 2026-10-13, routine uploads were every 2 hours (previously 30 minutes:
  // 216,000 players/day caused about 12 million saves); always upload on tab
  // close and on tab switch if more than 30 minutes have passed.
  // Valuable changes (pulls, purchases, new Pokémon, shinies, rewards, and
  // records entering a top list) uploaded immediately, as did run completion,
  // at most every 30 minutes. With a 2-hour interval, opening the game on
  // another device (or in another app's browser) showed an old cloud copy and
  // made players think their progress was lost.
  // Since 2026-10-18, urgent uploads are at most every 30 minutes (previously
  // 15 seconds; with a 65-second minimum between uploads, pulls/upgrades caused
  // saves almost every minute). Pending data is uploaded when the tab closes;
  // the top-bar Save button (saveNow) is available if that fails.
  // Since 2026-10-20 (saves were ~1/4 of Firestore writes), cloud uploads happen
  // ONLY:
  //   - when the player clicks Save
  //   - before an update reload (updater.js, G.DB.flush)
  //   - on sign-out
  // No periodic uploads, sign-in uploads, or tab-close uploads.
  // The browser copy is still saved immediately and merged with the cloud on
  // sign-in. Writes no longer read first (previously a transaction used
  // 1 read + 1 write); if playing on two devices at once, the last save wins.
  let syncState = 'local';           // 'ok' | 'syncing' | 'pending' | 'offline' | 'local'
  const listeners = new Set();

  function setSync(s) { syncState = s; listeners.forEach(fn => { try { fn(s); } catch (e) { /* ignored */ } }); }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = res; el.onerror = () => rej(new Error('No se pudo cargar ' + src));
      document.head.appendChild(el);
    });
  }

  /*
   * Cloud mode (Firebase) is restricted to the official website: the source is
   * on GitHub, and an unchanged copy hosted elsewhere would store its accounts
   * and saves in OUR project (at our expense). Such copies use local mode.
   * The actual restriction is the API key limited to these domains in Google
   * Cloud; this blocks copies that ignore this check (2026-10-14).
   */
  const HOSTS = ['ptminh96.github.io'];

  async function initCloud() {
    const cfg = G.FIREBASE_CONFIG;
    if (!/^https?:$/.test(location.protocol)) { localReason = 'file'; return false; }
    if (cfg && !cfg.emulator && !HOSTS.includes(location.hostname)) { localReason = 'host'; return false; }
    if (!cfg || !cfg.apiKey || !cfg.projectId) { localReason = 'config'; return false; }
    await loadScript(SDK + 'firebase-app-compat.js');
    await loadScript(SDK + 'firebase-auth-compat.js');
    await loadScript(SDK + 'firebase-firestore-compat.js');
    // Realtime Database: online friends, invitations, and rooms.
    if (cfg.databaseURL) await loadScript(SDK + 'firebase-database-compat.js');
    firebase.initializeApp(cfg);
    auth = firebase.auth();
    fs = firebase.firestore();
    // Some networks and antivirus software block real-time updates (friends,
    // invitations): Firebase tries another delivery method if needed.
    try { fs.settings({ experimentalAutoDetectLongPolling: true }); } catch (e) { /* ya estaba */ }
    rtdb = cfg.databaseURL ? firebase.database() : null;
    // Testing only: { ..., emulator: true } uses the local Firebase emulator.
    if (cfg.emulator) {
      auth.useEmulator('http://127.0.0.1:9099');
      fs.useEmulator('127.0.0.1', 8080);
      if (rtdb) rtdb.useEmulator('127.0.0.1', 9000);
    }
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    auth.languageCode = 'es';
    // Nothing uploads when leaving the tab anymore; use Save (see CLOUD MODE).
    // Since 2026-10-20, returning also does not read the cloud: data from another
    // device is loaded on page reload; pullSoon is unused.
    return true;
  }

  /*
   * When returning to the game after more than 30 minutes away (for example,
   * a phone tab left open overnight), download the cloud save and merge it with
   * the local one (one read) so progress from the other device is visible.
   * During a run, wait until the player returns to the menu.
   */
  const PULL_GAP = 30 * 60 * 1000;
  let lastPull = 0, pullT = 0;
  function pullSoon() {
    clearTimeout(pullT);
    if (mode !== 'cloud' || guest || !save || !uid || Date.now() - lastPull < PULL_GAP) return;
    if (pushing || (G.Game && G.Game.state && G.Game.state !== 'ui')) { pullT = setTimeout(pullSoon, 20000); return; }
    lastPull = Date.now();
    const u = uid;
    docRef().get().then(snap => {
      if (!snap.exists || !save || uid !== u) return;
      applyInPlace(merge(plain(fold(save)), migrate(snap.data().save)));
      setRev(snap.data().rev);
      write(K_CLOUD + uid, save);
      if (G.UI && G.UI.refreshCoins) G.UI.refreshCoins();
    }).catch(e => console.warn('[DB] no se pudo bajar la partida:', e.code || e.message));
  }

  /** Firebase requires an email, so encode the username as a unique valid internal address. */
  function nameToEmail(name) {
    const hex = [...new TextEncoder().encode(name.trim().toLowerCase())].map(b => b.toString(16).padStart(2, '0')).join('');
    return hex + '@' + NAME_DOMAIN;
  }

  function displayNameOf(u) {
    const n = ((u && u.displayName) || 'Entrenador').trim().split(/\s+/)[0].replace(/[^A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]/g, '');
    return (n || 'Entrenador').slice(0, 16);
  }

  const docRef = () => fs.collection('saves').doc(uid);
  const plain = s => JSON.parse(JSON.stringify(s));      // Firestore no admite undefined

  /** Open the cloud save for a newly authenticated user. */
  async function openCloud(u, opts = {}) {
    uid = u.uid;
    const cached = read(K_CLOUD + uid);
    let remote = null, online = true;
    try {
      const snap = await docRef().get();
      remote = snap.exists ? snap.data().save : null;
      setRev(snap.exists ? snap.data().rev : 0);
    } catch (e) {
      if (!cached) throw e;                // no connection or cached copy: nothing to open
      online = false;
      setRev(+read(K_REV + uid) || 0);     // revision from the last read or upload
    }
    let s = merge(cached && fold(migrate(cached)), remote && migrate(remote));
    if (!s) s = newSave(opts.name || displayNameOf(u));
    if (opts.legacy) {
      s = merge(s, opts.legacy.save);
      write(K_MIGRATED + opts.legacy.key, uid);
    }
    save = fold(migrate(s, s.name));
    key = uid; user = save.name; guest = false;
    write(K_CLOUD + uid, save);
    lastPull = Date.now();
    // If this copy has data missing from the cloud (new account or unsaved
    // progress), keep it pending until Save is clicked (no automatic upload on entry).
    const same = remote && !opts.legacy && (!cached || (cached.updated || 0) <= (remote.updated || 0));
    lastPush = Date.now();
    if (!online) { pending = true; setSync('offline'); }
    else if (same) setSync('ok');
    else { pending = true; setSync('pending'); }
  }

  /*
   * The document is no longer listened to in real time (each change cost a read).
   * If you play on two computers, saves are merged on sign-in and each upload
   * (transaction with merge()).
   */
  function stopListening() { if (unlisten) { unlisten(); unlisten = null; } }

  /*
   * If the admin has banned the leaderboard account (ban = true in the cloud;
   * see firestore.rules), every save must preserve it: only save, updatedAt,
   * and v are written (mergeFields), leaving the rest of the document (ban)
   * unchanged. Uploads are never sent more than once every 65 seconds; until
   * then, everything stays in the browser.
   */
  const K_OK = 'ps.cloudok.', MIN_GAP = 65000;
  const sinceOk = () => Date.now() - (+read(K_OK + uid) || 0);

  /** Upload the save as-is (without reading the cloud first; cloud data was merged on sign-in). */
  function pushNow() {
    if (mode !== 'cloud' || guest || !save || !uid) return Promise.resolve();
    // If an upload is in progress, start another immediately afterward for changes made meanwhile.
    if (pushing) { pending = true; return pushing.then(() => (pending ? pushNow() : undefined)); }
    clearTimeout(pushT); pushT = 0; pushDue = 0;
    if (navigator.onLine === false) {
      pending = true; setSync('offline'); scheduleRetry();
      return Promise.resolve();
    }
    if (sinceOk() < MIN_GAP) {
      pending = true; setSync('pending');
      schedulePush(MIN_GAP - sinceOk() + 500);
      return Promise.resolve();
    }
    pending = false;
    lastPush = Date.now();
    setSync('syncing');
    // If the network drops mid-request, Firestore may hang: cap the wait at 12 s.
    const u = uid, send = r => Promise.race([
      docRef().set({ save: plain(fold(save)), updatedAt: firebase.firestore.FieldValue.serverTimestamp(), v: VERSION, rev: r },
        { mergeFields: ['save', 'updatedAt', 'v', 'rev'] }).then(() => r),
      new Promise((_, rej) => setTimeout(() => rej({ code: 'unavailable' }), 12000))
    ]);
    pushing = send(rev + 1).catch(async e => {
      // On rejection because another device uploaded first (different revision),
      // merge its data and retry. At most one read every 5 minutes.
      if (e.code !== 'permission-denied' || Date.now() - lastCheck < 5 * 60e3) throw e;
      lastCheck = Date.now();
      const snap = await docRef().get();
      if (!snap.exists || uid !== u || !save || (+snap.data().rev || 0) === rev) throw e;
      applyInPlace(merge(plain(fold(save)), migrate(snap.data().save)));
      setRev(snap.data().rev);
      write(K_CLOUD + uid, save);
      if (G.UI && G.UI.refreshCoins) G.UI.refreshCoins();
      return send(rev + 1);
    }).then(r => {
      fails = 0;
      if (uid === u) setRev(r);
      write(K_OK + uid, Date.now());
      // Changes made during the upload remain pending for the next Save.
      setSync(pending ? 'pending' : 'ok');
      if (G.UI && G.UI.refreshCoins) G.UI.refreshCoins();
    }).catch(e => {
      console.warn('[DB] no se pudo sincronizar:', e.code || e.message);
      pending = true;
      setSync(navigator.onLine === false || e.code === 'unavailable' ? 'offline' : 'pending');
      // User-requested (Save or update): retry automatically with increasing delays.
      scheduleRetry();
    }).finally(() => { pushing = null; });
    return pushing;
  }

  /**
   * Save button: upload pending data now. If nothing is pending, do nothing;
   * if the last upload was less than 65 s ago (MIN_GAP), upload as soon as
   * possible. → { ok, why?: 'local'|'guest'|'done'|'wait'|'offline'|'fail', secs? }
   */
  async function saveNow() {
    if (guest || !save) return { ok: false, why: 'guest' };
    if (mode !== 'cloud') return { ok: true, why: 'local' };
    if (!pending && !pushing && syncState === 'ok') return { ok: true, why: 'done' };
    if (navigator.onLine === false) { pushNow(); return { ok: false, why: 'offline' }; }
    const wait = MIN_GAP - sinceOk();
    if (!pushing && wait > 0) { pending = true; setSync('pending'); schedulePush(wait + 500); return { ok: true, why: 'wait', secs: Math.ceil(wait / 1000) + 1 }; }
    await pushNow();
    if (pushing) await pushing;          // (if another upload was in progress, this also waits for the next one)
    if (syncState === 'ok') return { ok: true };
    // Changes made during upload go into the next one, which waits 65 s.
    if (syncState === 'pending' && pushT) return { ok: true, why: 'wait', secs: Math.max(1, Math.ceil((pushDue - Date.now()) / 1000)) };
    return { ok: false, why: syncState === 'offline' ? 'offline' : 'fail' };
  }

  // Keep any previously scheduled upload (a purchase should not wait until the next run).
  let pushDue = 0;
  function schedulePush(ms) {
    const due = Date.now() + ms;
    if (pushT && pushDue && pushDue <= due) return;
    clearTimeout(pushT); pushDue = due;
    pushT = setTimeout(() => { pushT = 0; pushDue = 0; pushNow(); }, ms);
  }
  /**
   * Retry with increasing delays: 15 s, 30 s, 1 min, 2 min... up to 10 min.
   * With many players, retrying every 15 s when Firebase fails (quota exceeded,
   * outage) multiplied reads (observed 2026-10-10).
   */
  let fails = 0;
  function scheduleRetry() {
    const ms = Math.min(10 * 60e3, 15e3 * Math.pow(2, fails)) * (0.8 + Math.random() * 0.4);
    fails = Math.min(fails + 1, 8);
    clearTimeout(retryT);
    retryT = setTimeout(() => { if (pending) pushNow(); }, ms);
  }

  function authError(e) {
    const c = (e && e.code) || '';
    const M = {
      'auth/email-already-in-use': 'Ese nombre ya existe.',
      'auth/invalid-credential': 'Usuario o contraseña incorrectos.',
      'auth/invalid-login-credentials': 'Usuario o contraseña incorrectos.',
      'auth/wrong-password': 'Usuario o contraseña incorrectos.',
      'auth/user-not-found': 'Usuario o contraseña incorrectos.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/too-many-requests': 'Demasiados intentos seguidos. Espera un poco.',
      'auth/network-request-failed': 'Sin conexión a internet.',
      'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes.',
      'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication > Configuración > Dominios autorizados).',
      'auth/operation-not-allowed': 'Ese método de inicio de sesión no está activado en Firebase.',
      // New account registration disabled in Firebase (Authentication > Settings).
      'auth/admin-restricted-operation': 'Ahora mismo no se pueden crear cuentas nuevas. Si ya tienes cuenta, entra normal; si no, puedes jugar como invitado.',
      'auth/requires-recent-login': 'Por seguridad, vuelve a iniciar sesión y repite la operación.',
      'permission-denied': 'La base de datos rechazó el acceso (revisa las reglas de Firestore).',
      'unavailable': 'Sin conexión con la base de datos.'
    };
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return '';
    return M[c] || ('Error: ' + (c || (e && e.message) || 'desconocido'));
  }

  // =====================================================================
  //                           PUBLIC API
  // =====================================================================

  let readyP = null;

  /** Start the database and restore the previous session. → true if a session exists. */
  function ready() {
    if (readyP) return readyP;
    readyP = (async () => {
      try { if (await initCloud()) mode = 'cloud'; }
      catch (e) { console.warn('[DB] sin nube:', e.message); localReason = 'error'; mode = 'local'; }
      if (mode === 'local') { setSync('local'); return restoreLocal(); }
      const u = await new Promise(res => { const off = auth.onAuthStateChanged(x => { off(); res(x); }); });
      if (!u) return false;
      try { await openCloud(u); return true; }
      catch (e) { console.warn('[DB] no se pudo abrir la partida:', e.code || e.message); return false; }
    })();
    return readyP;
  }

  async function register(name, pass) {
    name = (name || '').trim();
    if (!VALID.test(name)) return { ok: false, error: 'El nombre debe tener 3-16 letras, números o _.' };
    const min = mode === 'cloud' ? 6 : 4;
    if ((pass || '').length < min) return { ok: false, error: `La contraseña debe tener al menos ${min} caracteres.` };
    if (mode === 'local') return registerLocal(name, pass);
    // Monthly account cap (Firebase charges above 50,000 per month).
    try {
      const legacy = await legacySave(name, pass);
      const cred = await auth.createUserWithEmailAndPassword(nameToEmail(name), pass);
      await openCloud(cred.user, { name, legacy });
      return { ok: true, isNew: !save.partner, imported: !!legacy };
    } catch (e) { return { ok: false, error: authError(e) }; }
  }

  async function login(name, pass) {
    name = (name || '').trim();
    if (mode === 'local') return loginLocal(name, pass);
    try {
      const legacy = await legacySave(name, pass);
      const cred = await auth.signInWithEmailAndPassword(nameToEmail(name), pass || '');
      await openCloud(cred.user, { name, legacy });
      return { ok: true, isNew: !save.partner, imported: !!legacy };
    } catch (e) { return { ok: false, error: authError(e) }; }
  }

  async function loginWithGoogle() {
    if (mode !== 'cloud') return { ok: false, error: 'Entrar con Google necesita la versión publicada del juego.' };
    try {
      const cred = await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      await openCloud(cred.user, { name: displayNameOf(cred.user) });
      return { ok: true, isNew: !save.partner };
    } catch (e) { return { ok: false, error: authError(e) }; }
  }

  /** Change the name shown in the run (when choosing a nickname). */
  function setName(n) {
    if (!save || guest) return;
    save.name = n; user = n;
    commit();
  }

  function playAsGuest() {
    user = 'Invitado'; key = null; guest = true; uid = null;
    save = newSave('Invitado');
    if (mode === 'local') remove(K_SES);
    return { ok: true, isNew: true };
  }

  /**
   * Save the current run (does nothing in guest mode). Saves immediately in
   * the browser, or when Save is clicked in the cloud (pending until then; see
   * CLOUD MODE above). urgent no longer changes anything (kept in case it is
   * needed again).
   */
  function commit(urgent = false) {
    if (guest || !key || !save) return false;
    save.updated = Date.now();
    fold(save);
    if (mode === 'local') return write(K_SAVE + key, save);
    write(K_CLOUD + uid, save);
    pending = true;
    setSync('pending');                // uploaded when Save is clicked
    return true;
  }

  /** Functions run on sign-out or account deletion (friends, rooms, etc.). */
  const leaveHooks = [];

  async function logout() {
    for (const fn of leaveHooks) { try { await fn('logout'); } catch (e) { /* ignored */ } }
    if (mode === 'cloud' && !guest && save) {
      if (pending) { try { await pushNow(); } catch (e) { /* local copy remains */ } }
      stopListening();
      try { await auth.signOut(); } catch (e) { /* ignored */ }
    } else if (mode === 'local' && !guest) {
      commit();
      remove(K_SES);
    }
    clearTimeout(pushT); clearTimeout(retryT);
    user = key = save = uid = null; guest = false; pending = false;
    setSync(mode === 'cloud' ? 'ok' : 'local');
  }

  function nameAccount() { return !!(auth && auth.currentUser && (auth.currentUser.email || '').endsWith('@' + NAME_DOMAIN)); }

  /*
   * Account recovery: username/password accounts do not have a real email
   * address (a recovery link cannot be sent), so users can LINK their Gmail.
   * If they forget their password, signing in with Google opens the same
   * account. Firebase's account system does this for free, with no database
   * reads or writes.
   */
  function hasGoogle() {
    const u = auth && auth.currentUser;
    return !!(u && u.providerData.some(p => p.providerId === 'google.com'));
  }
  async function linkGoogle() {
    if (!auth || !auth.currentUser) return { ok: false, error: 'Inicia sesión primero.' };
    try {
      await auth.currentUser.linkWithPopup(new firebase.auth.GoogleAuthProvider());
      return { ok: true };
    } catch (e) {
      const c = (e && e.code) || '';
      if (c === 'auth/provider-already-linked') return { ok: true };
      if (c === 'auth/credential-already-in-use' || c === 'auth/email-already-in-use')
        return { ok: false, error: 'Ese Gmail ya tiene su propia cuenta del juego. Usa otro Gmail.' };
      return { ok: false, error: authError(e) };
    }
  }

  /**
   * Delete the account and save (in the cloud or in this browser).
   * @param pass  password (username/password accounts)
   */
  async function deleteAccount(pass) {
    if (guest || !key) return { ok: false, error: 'No hay cuenta que borrar.' };
    if (mode === 'local') {
      const accs = read(K_ACC) || {};
      delete accs[key];
      write(K_ACC, accs);
      remove(K_SAVE + key); remove(K_SES);
      user = key = save = null;
      return { ok: true };
    }
    try {
      // Verify the user first: Firebase only allows account deletion after a
      // recent sign-in. Previously, data was deleted before that final check
      // failed, leaving an empty account whose username could not be reused.
      const cu = auth.currentUser;
      if (nameAccount()) {
        if (!pass) return { ok: false, error: 'Escribe tu contraseña.' };
        await cu.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(cu.email, pass));
      } else {
        await cu.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
      }
      clearTimeout(pushT); clearTimeout(retryT); pending = false;
      stopListening();
      for (const fn of leaveHooks) await fn('delete');
      // A banned account cannot delete its save (see firestore.rules); keep it.
      await docRef().delete().catch(() => {});
      remove(K_CLOUD + uid);
      await auth.currentUser.delete();
      user = key = save = uid = null;
      return { ok: true };
    } catch (e) { return { ok: false, error: authError(e) }; }
  }

  // ---------------- save helpers ----------------

  function owns(dex) { return !!(save && save.owned[dex]); }

  function grant(dex, from) {
    if (!save.owned[dex]) save.owned[dex] = { at: Date.now(), from };
  }

  function ownsShiny(dex) { return !!(save && save.shiny && save.shiny[dex]); }

  /** Collection favorites. */
  function isFav(dex) { return !!(save && save.dfav && +save.dfav[dex] > 0); }
  function setFav(dex, on) {
    if (!save) return;
    save.dfav = save.dfav || {};
    save.dfav[dex] = on ? Date.now() : -Date.now();
    commit();
  }

  /** Upgrades purchased for a Pokémon: { id -> level }. */
  function upgradesOf(dex) {
    if (!save) return {};
    save.pupg = save.pupg || {};
    return save.pupg[dex] || (save.pupg[dex] = {});
  }

  /** Grant the shiny version (and the regular one if not owned). Returns true if it is new. */
  function grantShiny(dex, from) {
    grant(dex, from);
    if (save.shiny[dex]) return false;
    save.shiny[dex] = { at: Date.now(), from };
    return true;
  }

  return {
    ready, register, login, loginWithGoogle, playAsGuest, logout, commit, deleteAccount, flush: pushNow, saveNow,
    owns, grant, ownsShiny, grantShiny, merge, setName, upgradesOf, isFav, setFav,
    onSync(fn) { listeners.add(fn); },
    onLeave(fn) { leaveHooks.push(fn); },
    /** Low-level access for networking modules (cloud mode only). */
    get fb() { return mode === 'cloud' ? { auth, fs, rtdb, uid, emulator: !!(G.FIREBASE_CONFIG || {}).emulator } : null; },
    /** Is online play available (friends, leaderboard, multiplayer)? */
    get online() { return mode === 'cloud' && !guest && !!uid && !!save; },
    /** Is this a username-and-password account (not Google)? */
    get nameAccount() { return nameAccount(); },
    get hasGoogle() { return hasGoogle(); }, linkGoogle,
    get mode() { return mode; },
    get localReason() { return localReason; },
    get syncState() { return syncState; },
    get user() { return user; },
    get guest() { return guest; },
    get save() { return save; },
    get loggedIn() { return !!save; },
    get storageOk() { return storageOk; },
    START_COINS
  };
})();

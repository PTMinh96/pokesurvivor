/* ============ ranking.js — survival time and damage to Arceus ============
 * Firestore (designed to minimize usage on the free plan):
 *
 *   lbs/{board}       SUMMARY: both top 50 lists for the board in ONE document
 *                      { top:  { id: { t, uids, names, dex, shiny, lv, kills } },   time
 *                        dtop: { id: { d, uids, names, dex, shiny } },               damage to Arceus
 *                        me, ev, dev }
 *                      Viewing one leaderboard tab (both lists) = 1 read.
 *   lb/{board}/e/{id}  each player's or team's record: their best time and
 *                      best damage to Arceus (dmg), each from its own run (used
 *                      to calculate your time rank if you are outside the top 50)
 *
 *   Damage to Arceus (2026-10-23): only the top 50 in each board, and not on
 *   Pokémon-specific boards. It is stored in the same summary and record as
 *   time: improving both in one run requires the same number of writes as before.
 *
 *   board = mode + period:
 *     s_d20261008   solo, today                g_...   group
 *     s_w2026-41    ISO week                   s_m202610  month
 *     s_all2        all-time (annual board removed 2026-10-10)
 *     s_all2_p25    all-time, Pikachu only (Pokémon filters exist only on the
 *                   all-time board, halving the writes per run)
 *                   (all2 since Arceus's Judgment: the run ends at minute 30,
 *                    so the all-time board restarted; old s_all and s_all_pN
 *                    boards remain unused on the server)
 *                   (all3 and other boards with an "r" since 2026-10-18:
 *                    fleeing Arceus by running and using poison was fixed, so
 *                    ALL boards restarted)
 *                   (all4 and other boards with an "a" since 2026-10-23: the
 *                    45-minute cap was removed, Arceus deals damage, and props
 *                    break at minute 35; ALL boards restarted again)
 *   id = your uid (solo) or the team's uids sorted and joined with "_".
 *
 * Savings:
 *   - Read data is cached in the browser for 2 hours (switching tabs costs 0 reads).
 *   - Your best records are remembered in the browser: after a run, no read is
 *     needed to tell whether you improved, and writes happen only for improvements.
 *   - The summary is updated only if your record enters the top 50.
 *   - Daily, weekly, and monthly boards store only top-50 records: if you do
 *     not make the top 50, nothing is written and your rank shows "outside top 50".
 *     Your exact rank, even if you are 3,000th, is available only on the all-time
 *     board. With many players, this saves about 6 out of 10 leaderboard writes.
 *
 * Periods use Spanish local time (Europe/Madrid).
 */
G.Ranking = (() => {
  const TZ = 'Europe/Madrid';
  const PERIODS = [['d', 'Diario'], ['w', 'Semanal'], ['m', 'Mensual'], ['a', 'Histórico']];
  // Periods that store only the top 50 (see above).
  // ('p' = all-time board for one Pokémon: nearly every run used to qualify
  //  and write; now it also stores only the top 50.)
  const TOP_ONLY = new Set(['d', 'w', 'm', 'p']);
  const TOP = 50;
  // Runs shorter than 2 minutes are not uploaded (they never reach a meaningful
  // top and caused many wasted reads and writes; new players often die in the
  // first minute; the threshold was 1 minute until 2026-10-14).
  const MIN_T = 120;
  // On each Pokémon's all-time board, require 5 minutes: with nearly a thousand
  // boards, most have fewer than 50 records and used to accept every run (2
  // writes each; leaderboard was about 1/5 of Firestore writes on 2026-10-20).
  const MIN_T_MON = 300;
  // Cache reads for 2 hours (was 30 min until 2026-10-20). Your new record is
  // still shown immediately by putting the uploaded value in the cache.
  const TTL = 2 * 3600 * 1000;

  const fbx = () => G.DB.online ? G.DB.fb : null;

  // ---------------- periods ----------------

  function madridDate(date) {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)) p[x.type] = x.value;
    return { y: +p.year, m: +p.month, d: +p.day };
  }

  /** ISO week (Monday through Sunday) for a y-m-d date. */
  function isoWeek(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
  }

  const ALL = 'all4';                     // all-time (see above)
  function periodIds(date = new Date()) {
    const { y, m, d } = madridDate(date);
    const w = isoWeek(y, m, d);
    const p2 = n => String(n).padStart(2, '0');
    return { d: 'd' + y + p2(m) + p2(d), w: 'w' + w.year + '-' + p2(w.week), m: 'm' + y + p2(m), y: 'y' + y, a: ALL };
  }

  /*
   * Board names: periodIds() values with an "a" suffix (2026-10-23: all reset
   * with damage to Arceus; "r" from 2026-10-18 and "j" before that, since
   * 2026-10-14). periodIds() remains unchanged because missions also use it
   * (progress.js). The all-time board has its own name (ALL).
   */
  const GEN = 'a';
  function boardIds(date) {
    const p = periodIds(date);
    return Object.assign({}, p, { d: p.d + GEN, w: p.w + GEN, m: p.m + GEN, y: p.y + GEN });
  }

  /** Pokémon filters exist only on the all-time board. */
  function board(mode, period, dex) {
    return mode + '_' + boardIds()[period] + (dex && period === 'a' ? '_p' + dex : '');
  }

  const col = b => fbx().fs.collection('lb').doc(b).collection('e');
  const sumRef = b => fbx().fs.collection('lbs').doc(b);

  // ---------------- browser cache ----------------

  const mem = new Map();                 // clave -> { at, v }
  // Your exact rank (outside the top 50) costs 1 read per 1,000 records ahead of
  // you; cache it for 6 hours and refresh sooner if you improve.
  const RANK_TTL = 6 * 3600 * 1000;
  const ttlOf = k => (k.startsWith('r:') ? RANK_TTL : TTL);
  function cacheGet(k) {
    let c = mem.get(k);
    if (!c) { try { c = JSON.parse(localStorage.getItem('ps.rk.c.' + k) || 'null'); } catch (e) { c = null; } if (c) mem.set(k, c); }
    return c && Date.now() - c.at < ttlOf(k) ? c.v : undefined;
  }
  function cacheSet(k, v) {
    const c = { at: Date.now(), v };
    mem.set(k, c);
    try { localStorage.setItem('ps.rk.c.' + k, JSON.stringify(c)); } catch (e) { /* full */ }
  }
  /** Remove expired entries (the browser cache does not grow without limit). */
  function cachePrune() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('ps.rk.c.')) continue;
        const c = JSON.parse(localStorage.getItem(k) || 'null');
        if (!c || Date.now() - c.at > ttlOf(k.slice(8))) localStorage.removeItem(k);
      }
    } catch (e) { /* ignored */ }
  }
  cachePrune();

  // Best record per board (avoid reading before writing): "board:id" for time
  // and "board:id#d" for damage to Arceus.
  // (best2 since 2026-10-12: invalid records were removed from the leaderboard,
  //  so affected players recheck their actual records and can qualify again.)
  const bestKey = () => 'ps.rk.best2.' + (fbx() ? fbx().uid : '');
  function bests() { try { return JSON.parse(localStorage.getItem(bestKey()) || '{}'); } catch (e) { return {}; } }
  function saveBests(b) {
    // Keep only boards for current periods and all-time records.
    const cur = Object.values(boardIds());
    for (const k of Object.keys(b)) if (!cur.some(p => k.split(':')[0].split('_')[1] === p)) delete b[k];
    try { localStorage.setItem(bestKey(), JSON.stringify(b)); } catch (e) { /* full */ }
  }

  // ---------------- per-board thresholds ----------------
  /*
   * The lowest record in each full top 50. It can only increase over time, so
   * an old value remains useful: if your record does not beat it, you cannot
   * qualify and no read is needed (each summary is about 30 KB and up to 5 were
   * checked at the end of a run; 2026-10-13).
   * "board" is for time and "board#d" is for damage to Arceus.
   */
  const THR = 'ps.rk.thr';
  function thresholds() { try { return JSON.parse(localStorage.getItem(THR) || '{}'); } catch (e) { return {}; } }
  function noteTop(b, sum) {
    const t = thresholds();
    let changed = false;
    for (const [k, rows, f] of [[b, sum.top, v => v.t], [b + '#d', sum.dtop, v => v.d]]) {
      const vals = Object.values(rows || {});
      if (vals.length < TOP) continue;
      const low = Math.min(...vals.map(f));
      if ((t[k] || 0) < low) { t[k] = low; changed = true; }
    }
    if (!changed) return;
    // Only boards for current periods (and all-time boards).
    const cur = Object.values(boardIds());
    for (const k of Object.keys(t)) if (!cur.some(p => k.split('#')[0].split('_')[1] === p)) delete t[k];
    try { localStorage.setItem(THR, JSON.stringify(t)); } catch (e) { /* full */ }
  }

  // ---------------- saving ----------------

  // Another player's row, sanitized (see G.U.int / str) regardless of database contents.
  const rowOf = (id, v) => {
    const U = G.U; v = v || {};
    return { id: U.str(String(id), 200), t: U.int(v.t, 86400), d: U.int(v.d != null ? v.d : v.dmg, 1e15), uids: U.list(v.uids, 4).map(x => U.str(x, 128)),
             names: U.list(v.names, 4).map(x => U.str(x, 24)), dex: U.list(v.dex, 4).map(x => U.int(x, 2000)),
             shiny: U.list(v.shiny, 4).map(x => x === true), lv: U.int(v.lv, 999) || 1, kills: U.int(v.kills, 1e9) };
  };
  const sorted = top => Object.entries(top || {}).map(([id, v]) => rowOf(id, v)).sort((a, b) => b.t - a.t);
  const sortedD = dtop => Object.entries(dtop || {}).map(([id, v]) => rowOf(id, v)).sort((a, b) => b.d - a.d);
  // Summary rows exactly mirror the record (verified by firestore.rules).
  // Omit "shiny" when none are shiny to keep the summary smaller.
  const shinyOf = (e, row) => { if (e.shiny.some(Boolean)) row.shiny = e.shiny; return row; };
  const rowT = e => shinyOf(e, { t: e.t, uids: e.uids, names: e.names, dex: e.dex, lv: e.lv, kills: e.kills });
  const rowD = e => shinyOf(e, { d: e.dmg, uids: e.uids, names: e.names, dex: e.dex });
  /** Rebuild the summary while preserving the other list. */
  const sumOut = (top, dtop, me, ev, dev) => (dtop && Object.keys(dtop).length ? { top, dtop, me, ev, dev: dev || '' } : { top, me, ev });
  const now = () => firebase.firestore.FieldValue.serverTimestamp();

  // ---------------- anti-cheat ----------------

  /*
   * Until 2026-10-20, starting a run stored its start time in runs/{uid}, and
   * no record could exceed the real time elapsed since then. This was the
   * biggest Firestore write source (1/3), and the rule read it for every record
   * as protection that could be bypassed by waiting once, so it was removed.
   * Meaningful levels, kills, and bans remain (firestore.rules; the 45-minute
   * cap was removed on 2026-10-23 because Arceus breaks props at minute 35).
   */
  let busy = Promise.resolve();
  /** At run start, upload pending all-time records (see DEFER). */
  function runStarted() { flushDeferred(); }

  /*
   * Your all-time record OUTSIDE the top 50 (2026-10-20): nobody sees it; it is
   * only used for your exact rank, which is checked every 6 hours (RANK_TTL).
   * So it is uploaded at most once per DEFER; until then, the best value waits
   * in the browser and is uploaded after the delay at the end or start of a run.
   * If you enter the top 50, it is uploaded immediately as before.
   */
  const DEFER = 6 * 3600 * 1000, DEF = 'ps.rk.def';
  const defKey = () => DEF + '.' + (fbx() ? fbx().uid : '');
  function deferred() { try { return JSON.parse(localStorage.getItem(defKey()) || '{}'); } catch (e) { return {}; } }
  function saveDeferred(d) { try { localStorage.setItem(defKey(), JSON.stringify(d)); } catch (e) { /* lleno */ } }
  /** Should it be uploaded now (DEFER prevents this) or left pending? → true if it should be uploaded. */
  function dueOrDefer(b, id, entry) {
    const d = deferred(), k = b + ':' + id, up = (d[k] && d[k].up) || 0;
    if (Date.now() - up >= DEFER) { d[k] = { up: Date.now() }; saveDeferred(d); return true; }
    d[k] = { up, e: entry }; saveDeferred(d);
    return false;
  }
  function flushDeferred() {
    const fb = fbx();
    if (!fb) return;
    const d = deferred();
    let changed = false;
    for (const [k, v] of Object.entries(d)) {
      if (!v || !v.e) { if (v && Date.now() - (v.up || 0) > DEFER) { delete d[k]; changed = true; } continue; }
      if (Date.now() - (v.up || 0) < DEFER) continue;
      const i = k.indexOf(':'), b = k.slice(0, i), id = k.slice(i + 1);
      d[k] = { up: Date.now() }; changed = true;
      // If the cloud already has a better record, the rules reject this update; that's fine.
      col(b).doc(id).set(Object.assign({}, v.e, { at: now() })).catch(() => {});
      mem.delete('r:' + b); try { localStorage.removeItem('ps.rk.c.r:' + b); } catch (e) { /* ignored */ }
    }
    if (changed) saveDeferred(d);
  }
  /** Already uploaded another way (entered the top); nothing to defer. */
  function clearDeferred(b, id) {
    const d = deferred(), k = b + ':' + id;
    if (d[k] && d[k].e) { d[k] = { up: Date.now() }; saveDeferred(d); }
  }
  /** Track a record upload so the next run can wait for it to finish. */
  function track(p) { busy = p.catch(() => {}); return p; }

  /** Save the entry to each board it improves (time or damage). → improved periods */
  async function store(boards, id, entry) {
    const fb = fbx();
    const better = [];
    const known = bests();
    const thr = thresholds();
    await Promise.all(boards.map(async ([b, period]) => {
      const key = b + ':' + id, dkey = key + '#d';
      try {
        const topOnly = TOP_ONLY.has(period);
        // Damage to Arceus: only on period boards (not Pokémon-specific boards).
        const dmg = period === 'p' ? 0 : entry.dmg || 0;
        // If you do not beat the 50th record known to this browser, you cannot
        // enter that top 50 (daily, weekly, monthly, or Pokémon-specific); do not read.
        const thrT = thr[b] || 0, thrD = thr[b + '#d'] || 0;
        const cached = cacheGet('S:' + b);
        const canT = !thrT || entry.t > thrT || !!(cached && cached.top && id in cached.top);
        const canD = dmg > 0 && (!thrD || dmg > thrD || !!(cached && cached.dtop && id in cached.dtop));
        if (topOnly && !canT && !canD) return;
        // In the all-time board, if this browser does not know your record yet,
        // read it once (one small read). For other boards, read the record in
        // the transaction below.
        if (known[key] === undefined && !topOnly) {
          const old = await col(b).doc(id).get();
          known[key] = old.exists ? old.data().t : 0;
          known[dkey] = old.exists ? old.data().dmg || 0 : 0;
        }
        const upT = entry.t > (known[key] || 0), upD = dmg > (known[dkey] || 0);
        if (!upT && !upD) return;
        const stamp = e => Object.assign({}, e, { at: firebase.firestore.FieldValue.serverTimestamp() });
        let waiting = false, wrote = false;
        if (!canT && !canD) {
          // Outside both all-time top 50 lists, only time counts (for your exact
          // rank), and it is uploaded at most once per DEFER (see above).
          if (!upT) return;
          const e = Object.assign({}, entry, { dmg: Math.max(dmg, known[dkey] || 0) });
          if (dueOrDefer(b, id, e)) { await col(b).doc(id).set(stamp(e)); wrote = true; } else waiting = true;
        } else {
          let newSum = null;
          await fb.fs.runTransaction(async tx => {
            const s = await tx.get(sumRef(b));
            const old = await tx.get(col(b).doc(id));
            const sd = s.exists ? s.data() : {};
            const top = Object.assign({}, sd.top || {}), dtop = Object.assign({}, sd.dtop || {});
            newSum = { top: sd.top || {}, dtop: sd.dtop || {} };
            const o = old.exists ? old.data() : null, ot = o ? o.t || 0 : 0, od = o ? o.dmg || 0 : 0;
            const bt = entry.t > ot, bd = dmg > od;
            // You already had a better record (on another device); nothing to write.
            if (!bt && !bd) return;
            // Record the best of each value (level and kills come from the best time).
            const e = Object.assign({}, entry, { dmg: Math.max(dmg, od) }, bt ? {} : { t: ot, lv: o.lv, kills: o.kills });
            let ev = '', dev = '', inT = false, inD = false;
            if (bt) {
              if (id in top || Object.keys(top).length < TOP) inT = true;
              else { const low = sorted(top).pop(); if (low.t < e.t) { ev = low.id; delete top[ev]; inT = true; } }
              if (inT) top[id] = rowT(e);
            }
            if (bd) {
              if (id in dtop || Object.keys(dtop).length < TOP) inD = true;
              else { const low = sortedD(dtop).pop(); if (low.d < e.dmg) { dev = low.id; delete dtop[dev]; inD = true; } }
              if (inD) dtop[id] = rowD(e);
            }
            // Does not enter any top: save the record on the all-time board (for rank), but nowhere else.
            if (!inT && !inD) { if (!topOnly && bt) { tx.set(col(b).doc(id), stamp(e)); wrote = true; } return; }
            tx.set(col(b).doc(id), stamp(e));
            tx.set(sumRef(b), sumOut(top, dtop, id, ev, dev));
            newSum = { top, dtop };
            wrote = true;
          });
          if (newSum) { cacheSet('S:' + b, newSum); noteTop(b, newSum); }
          if (!topOnly && wrote) clearDeferred(b, id);
        }
        known[key] = Math.max(known[key] || 0, entry.t);
        known[dkey] = Math.max(known[dkey] || 0, dmg);
        if (!wrote && !waiting) return;
        if (b.startsWith('g_')) known[b + ':*'] = Math.max(known[b + ':*'] || 0, entry.t);
        // If the record is waiting to upload, your cloud rank has not changed yet.
        if (!waiting) { mem.delete('r:' + b); try { localStorage.removeItem('ps.rk.c.r:' + b); } catch (e) { /* ignored */ } }
        if (period && period !== 'p' && !better.includes(period)) better.push(period);
      } catch (e) { console.warn('[Ranking] no se pudo guardar en', b, e.code || e.message); }
    }));
    saveBests(known);
    return better;
  }

  function announce(better) {
    if (!better.length) return;
    const names = { d: 'de hoy', w: 'de la semana', m: 'del mes', a: 'histórico' };
    const best = PERIODS.map(p => p[0]).filter(p => better.includes(p)).pop();
    G.UI.toast('¡Nueva mejor marca ' + names[best] + ' en el ranking!', 3400);
  }

  function submitSolo(r) { return track(submitSoloNow(r)); }
  async function submitSoloNow(r) {
    const fb = fbx();
    if (!fb || !G.Social.me || r.t < MIN_T) return [];
    flushDeferred();
    const ids = boardIds();
    const entry = { t: r.t, uids: [fb.uid], names: [G.Social.me.name], dex: [r.dex], shiny: [!!r.shiny], lv: r.lv, kills: r.kills, dmg: Math.max(0, Math.floor(r.dmg || 0)) };
    const boards = PERIODS.map(([p]) => ['s_' + ids[p], p]);
    if (r.t >= MIN_T_MON) boards.push(['s_' + ALL + '_p' + r.dex, 'p']);
    const better = await store(boards, fb.uid, entry);
    announce(better);
    return better;
  }

  /** Uploaded by the host, with the entire team. */
  function submitGroup(r) { return track(submitGroupNow(r)); }
  async function submitGroupNow(r) {
    const fb = fbx();
    if (!fb || r.t < MIN_T || !r.members || r.members.length < 2) return [];
    const ms = r.members.slice().sort((a, b) => (a.uid < b.uid ? -1 : 1));
    const id = ms.map(m => m.uid).join('_');
    const entry = { t: r.t, uids: ms.map(m => m.uid), names: ms.map(m => m.name), dex: ms.map(m => m.dex),
                    shiny: ms.map(m => !!m.shiny), lv: r.lv, kills: r.kills, dmg: Math.max(0, Math.floor(r.dmg || 0)) };
    const ids = boardIds();
    const boards = PERIODS.map(([p]) => ['g_' + ids[p], p]);
    if (r.t >= MIN_T_MON) for (const d of new Set(entry.dex)) boards.push(['g_' + ALL + '_p' + d, 'p']);
    const better = await store(boards, id, entry);
    announce(better);
    return better;
  }

  // ---------------- reading ----------------

  /** Both top-50 lists for a board, { top, dtop } (1 read, or 0 if cached for under 2 h). */
  const inflight = new Map();             // board -> in-flight read (shared by lists and your rank)
  async function sumOf(b) {
    const c = cacheGet('S:' + b);
    if (c !== undefined) return c;
    if (!inflight.has(b)) {
      inflight.set(b, sumRef(b).get().then(s => {
        const d = s.exists ? s.data() : {};
        const sum = { top: d.top || {}, dtop: d.dtop || {} };
        cacheSet('S:' + b, sum);
        noteTop(b, sum);
        return sum;
      }).finally(() => inflight.delete(b)));
    }
    return inflight.get(b);
  }
  /** The top 50 times for a board. */
  async function summary(b) { return (await sumOf(b)).top; }

  /** You and your friends with records (up to 30). */
  async function circleOf(fb) {
    await G.Social.ensureFriends();          // (the friends list is no longer loaded on sign-in)
    return [fb.uid, ...G.Social.friends.filter(f => f.status === 'ok').map(f => f.uid)].slice(0, 30);
  }

  /**
   * Damage to Arceus: a board's top 50 (from the same read as the time list)
   * and your rank in it. No Pokémon-specific boards. → { rows, me: { pos, d } | { out } | null }
   */
  async function topDmg(mode, period, friendsOnly) {
    const fb = fbx();
    if (!fb) return { rows: [], me: null };
    let rows = sortedD((await sumOf(board(mode, period))).dtop);
    const i = rows.findIndex(r => r.uids.includes(fb.uid));
    const me = !G.Social.me ? null : i >= 0 ? { pos: i + 1, d: rows[i].d } : { out: true };
    if (friendsOnly) { const circle = await circleOf(fb); rows = rows.filter(r => r.uids.some(u => circle.includes(u))); }
    return { rows: rows.slice(0, TOP), me };
  }

  /**
   * Best records on a board.
   * @param friendsOnly  only you and your friends
   */
  async function top(mode, period, dex, friendsOnly) {
    const fb = fbx();
    if (!fb) return [];
    const b = board(mode, period, dex);
    const rows = sorted(await summary(b));
    if (!friendsOnly) return rows.slice(0, TOP);
    const circle = await circleOf(fb);
    const inTop = rows.filter(r => r.uids.some(u => circle.includes(u)));
    // Daily, weekly, monthly, and Pokémon-specific boards have no records outside the top 50.
    if (TOP_ONLY.has(period) || dex) return inTop;
    // Find friends outside the top 50 separately (and cache them for 2 hours).
    const ck = 'f:' + b + ':' + circle.slice().sort().join(',');
    let extra = cacheGet(ck);
    if (extra === undefined) {
      if (mode === 's') {
        const missing = circle.filter(u => !inTop.some(r => r.id === u));
        const docs = await Promise.all(missing.map(u => col(b).doc(u).get().catch(() => null)));
        extra = docs.filter(d => d && d.exists).map(d => rowOf(d.id, d.data()));
      } else {
        const s = await col(b).where('uids', 'array-contains-any', circle).get();
        extra = s.docs.map(d => rowOf(d.id, d.data()));
      }
      cacheSet(ck, extra);
    }
    const all = new Map();
    for (const r of [...inTop, ...extra]) all.set(r.id, r);
    return [...all.values()].sort((a, c) => c.t - a.t).slice(0, TOP);
  }

  /** Your rank on the board (even if you are not in the top list). → { pos, t, row } | null */
  async function myRank(mode, period, dex) {
    const fb = fbx();
    if (!fb) return null;
    const b = board(mode, period, dex);
    // Are you in the top 50? Then the rank comes from the summary without using any reads.
    const rows = sorted(await summary(b));
    const i = rows.findIndex(r => r.uids.includes(fb.uid));
    if (i >= 0) return { pos: i + 1, t: rows[i].t, row: rows[i] };
    if (TOP_ONLY.has(period) || dex) return { out: true };
    const ck = 'r:' + b;
    const c = cacheGet(ck);
    if (c !== undefined) return c;
    // If this browser already knows you have no record on this board, skip the read.
    const kb = bests(), mk = b + ':' + (mode === 's' ? fb.uid : '*');
    if (kb[mk] === 0) { cacheSet(ck, null); return null; }
    let mine = null;
    if (mode === 's') {
      const d = await col(b).doc(fb.uid).get();
      if (d.exists) mine = rowOf(d.id, d.data());
    } else {
      const s = await col(b).where('uids', 'array-contains', fb.uid).get();
      for (const d of s.docs) { const r = rowOf(d.id, d.data()); if (!mine || r.t > mine.t) mine = r; }
    }
    kb[mk] = mine ? mine.t : 0;
    saveBests(kb);
    let res = null;
    if (mine) { const above = await countAbove(b, mine.t); res = { pos: above + 1, capped: above >= RANK_CAP, t: mine.t, row: mine }; }
    cacheSet(ck, res);
    return res;
  }

  // Count cap: count() costs 1 read per 1,000 records counted (about 40 per
  // query on the all-time board). Above the cap, show "#1000+".
  const RANK_CAP = 1000;
  /**
   * Count entries with a longer time. The SDK's "compat" version has no count(),
   * so use the REST aggregation API (1 read per 1,000 entries instead of reading
   * them all). Used only when you are outside the top 50.
   */
  async function countAbove(b, t) {
    const fb = fbx();
    const cfg = G.FIREBASE_CONFIG;
    const base = fb.emulator ? 'http://127.0.0.1:8080/v1' : 'https://firestore.googleapis.com/v1';
    const url = `${base}/projects/${cfg.projectId}/databases/(default)/documents/lb/${encodeURIComponent(b)}:runAggregationQuery`;
    const token = await fb.auth.currentUser.getIdToken();
    const body = { structuredAggregationQuery: {
      structuredQuery: { from: [{ collectionId: 'e' }],
        where: { fieldFilter: { field: { fieldPath: 't' }, op: 'GREATER_THAN', value: { integerValue: String(t) } } } },
      aggregations: [{ alias: 'n', count: { upTo: String(RANK_CAP) } }] } };
    try {
      const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      const n = j && j[0] && j[0].result && j[0].result.aggregateFields && j[0].result.aggregateFields.n;
      return n ? +n.integerValue : 0;
    } catch (e) {
      console.warn('[Ranking] puesto:', e.message);
      return 0;
    }
  }

  /** On account deletion, remove your rows from summaries known to this browser. */
  async function removeMine() {
    const fb = fbx();
    if (!fb) return;
    const ids = boardIds();
    const boards = new Set();
    for (const m of ['s', 'g']) for (const [p] of PERIODS) boards.add(m + '_' + ids[p]);
    for (const k of Object.keys(bests())) boards.add(k.split(':')[0]);
    // One row per write (the rules allow only one removal at a time); repeat
    // while any of your time or damage records remain.
    const once = b => fb.fs.runTransaction(async tx => {
      const s = await tx.get(sumRef(b));
      if (!s.exists) return false;
      const top = s.data().top || {}, dtop = s.data().dtop || {};
      for (const [id, v] of Object.entries(top)) {
        if (!(v.uids || []).includes(fb.uid)) continue;
        const next = Object.assign({}, top); delete next[id];
        tx.set(sumRef(b), sumOut(next, dtop, '', id, ''));
        return true;
      }
      for (const [id, v] of Object.entries(dtop)) {
        if (!(v.uids || []).includes(fb.uid)) continue;
        const next = Object.assign({}, dtop); delete next[id];
        tx.set(sumRef(b), Object.assign(sumOut(top, next, '', '', id), { dtop: next, dev: id }));
        return true;
      }
      return false;
    }).catch(() => false);
    await Promise.all([...boards].map(async b => { for (let i = 0; i < 8 && await once(b); i++) { /* repeat */ } }));
    try { localStorage.removeItem(bestKey()); } catch (e) { /* ignored */ }
  }

  // ---------------- reportes y moderación ----------------

  /** Report a suspicious record (once per record and player). → true if submitted */
  const repKey = () => 'ps.rk.rep.' + (fbx() ? fbx().uid : '');
  function reported() { try { return new Set(JSON.parse(localStorage.getItem(repKey()) || '[]')); } catch (e) { return new Set(); } }
  async function report(b, row) {
    const fb = fbx();
    if (!fb) return false;
    const key = b + '__' + row.id;
    const done = reported();
    if (!done.has(key)) {
      // If you already reported it from another device, the server rejects the duplicate; that is fine.
      await fb.fs.collection('reports').doc(key + '__' + fb.uid)
        .set({ board: b, e: row.id, names: row.names.slice(0, 4), t: row.t | 0, by: fb.uid, at: now() }).catch(() => {});
      done.add(key);
      try { localStorage.setItem(repKey(), JSON.stringify([...done].slice(-300))); } catch (e) { /* full */ }
    }
    return true;
  }

  // Moderator account (firestore.rules, admin()): hidden screen in js/ui/mod-ui.js.
  const ADMINS = ['rshaa5gKD3fXw6lE4PPXITbowaG2'];
  const isAdmin = () => !!fbx() && ADMINS.includes(fbx().uid);

  /** Admin: reports grouped by record (most-reported first). */
  async function reports() {
    const s = await fbx().fs.collection('reports').orderBy('at', 'desc').limit(400).get();
    const by = new Map();
    for (const d of s.docs) {
      const v = d.data(), k = v.board + '__' + v.e;
      if (!by.has(k)) by.set(k, { board: G.U.str(v.board, 40), e: G.U.str(v.e, 160), names: G.U.list(v.names, 4).map(x => G.U.str(x, 24)),
                                  t: G.U.int(v.t, 86400), n: 0, ids: [], at: v.at && v.at.toMillis ? v.at.toMillis() : 0 });
      const g = by.get(k); g.n++; g.ids.push(d.id);
    }
    return [...by.values()].sort((a, b) => b.n - a.n || b.at - a.at);
  }

  /** Admin: a record's row in its board's top 50 (or null if it is no longer there). */
  async function entryInfo(b, e) {
    const sum = await sumOf(b);
    return sum.top[e] ? rowOf(e, sum.top[e]) : sum.dtop[e] ? rowOf(e, sum.dtop[e]) : null;
  }

  /** Admin: remove a record from a board (the record and its rows from both top-50 lists). */
  async function removeEntry(b, e) {
    const fb = fbx();
    await col(b).doc(e).delete().catch(() => {});
    await fb.fs.runTransaction(async tx => {
      const s = await tx.get(sumRef(b));
      const d = s.exists ? s.data() : {};
      const top = Object.assign({}, d.top || {}), dtop = Object.assign({}, d.dtop || {});
      if (!(e in top) && !(e in dtop)) return;
      delete top[e]; delete dtop[e];
      tx.set(sumRef(b), Object.assign(sumOut(top, dtop, '', e, e), d.dtop ? { dtop } : {}));
    }).catch(err => console.warn('[Ranking] quitar', b, err.code || err.message));
    mem.delete('S:' + b); try { localStorage.removeItem('ps.rk.c.S:' + b); } catch (err) { /* ignored */ }
  }

  /** Admin: remove a player's or team's record from all current boards (and `also`). */
  async function removeEverywhere(e, mode, dexes = [], also = null) {
    const ids = boardIds();
    const boards = new Set(PERIODS.map(([p]) => mode + '_' + ids[p]));
    for (const d of dexes) boards.add(mode + '_' + ALL + '_p' + d);
    if (also) boards.add(also);
    await Promise.all([...boards].map(b => removeEntry(b, e)));
  }

  /**
   * Admin: remove records longer than `maxT` seconds from ALL boards (rows in
   * each top 50 and standalone all-time records). With Arceus's Judgment, no
   * legitimate run exceeds about 32 minutes. → { rows, boards }
   */
  async function purgeAbove(maxT, onProgress) {
    const fs = fbx().fs;
    const all = await fs.collection('lbs').get();
    let rows = 0, boards = 0, n = 0;
    for (const d of all.docs) {
      n++;
      if (onProgress && n % 50 === 0) onProgress(n, all.size);
      const top = d.data().top || {};
      const bad = Object.keys(top).filter(id => (top[id].t || 0) > maxT);
      if (!bad.length) continue;
      await fs.runTransaction(async tx => {
        const s = await tx.get(d.ref);
        const cur = Object.assign({}, (s.exists && s.data().top) || {});
        const gone = Object.keys(cur).filter(id => (cur[id].t || 0) > maxT);
        if (!gone.length) return;
        for (const id of gone) delete cur[id];
        tx.set(d.ref, sumOut(cur, s.data().dtop, '', gone[0], ''));
      });
      await Promise.all(bad.map(id => fs.collection('lb').doc(d.id).collection('e').doc(id).delete().catch(() => {})));
      rows += bad.length; boards++;
      mem.delete('S:' + d.id); try { localStorage.removeItem('ps.rk.c.S:' + d.id); } catch (e) { /* ignored */ }
    }
    // All-time records outside the top 50 (used to calculate exact rank).
    for (const b of ['s_' + ALL, 'g_' + ALL]) {
      const q = await col(b).where('t', '>', maxT).get();
      await Promise.all(q.docs.map(e => e.ref.delete().catch(() => {})));
      rows += q.size;
    }
    return { rows, boards };
  }

  /** Admin: ban or unban a leaderboard account (banned = cannot upload records). */
  function setMarked(uid, on) { return fbx().fs.collection('saves').doc(uid).update({ ban: !!on }); }
  /** Admin: delete reports that have already been reviewed. */
  function dismiss(ids) { return Promise.all(ids.map(id => fbx().fs.collection('reports').doc(id).delete().catch(() => {}))); }
  /** Admin: accounts banned from the leaderboard. */
  async function markedAccounts() {
    const s = await fbx().fs.collection('saves').where('ban', '==', true).limit(100).get();
    return s.docs.map(d => { const v = d.data().save || {}; return { uid: d.id, name: v.name || '?', coins: v.coins || 0,
      t1: (v.tickets || {}).t1 || 0, t10: (v.tickets || {}).t10 || 0, owned: Object.keys(v.owned || {}).length }; });
  }

  return { PERIODS, periodIds, board, runStarted, submitSolo, submitGroup, top, topDmg, myRank, removeMine,
           report, reported, isAdmin, reports, entryInfo, removeEntry, purgeAbove, removeEverywhere, setMarked, dismiss, markedAccounts };
})();

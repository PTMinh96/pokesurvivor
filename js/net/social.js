/* ============ social.js — nicknames, friends, online status, invites, and rooms ============
 * Requires a cloud account (G.DB.online). Uses:
 *
 *   Firestore
 *     names/{lowercase nickname}  { uid }               unique nicknames
 *     profiles/{uid}               { name, lower, at }   public nickname
 *     friendships/{uidA_uidB}      { users, from, to, status: 'pending'|'ok', names, at }
 *
 *     pres/{uid}                   { on, at, room, play } approximate online status
 *     inv/{to_from}                { to, from, room, name, at } invitations
 *
 *   Realtime Database: ONLY while in a room or group run
 *     rooms/{id}          { host, open, at, m: { uid: { name, dex, shiny } }, q: ... }
 *                         the room; q/ contains net.js messages
 *
 * Why: Firebase's free plan allows only 100 simultaneous Realtime Database
 * connections. If everyone stayed connected for online status, that would be
 * the player limit. Now only room members count; online status uses Firestore
 * with a heartbeat every 10 minutes and is read only when Friends or a room
 * opens (the result is cached for 1 minute).
 *
 * The rest of the game listens for changes with G.Social.on(fn).
 */
G.Social = (() => {
  const VALID = /^[A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]{3,16}$/;
  const MAX_PLAYERS = 4;
  const INVITE_TTL = 3 * 60 * 1000;
  /*
   * Use the website server's time (the Date header from version.json, free).
   * If the device clock was ahead (for example, due to an incorrect time zone),
   * invitations looked expired and were deleted before being shown, and friends
   * always appeared offline (observed in 2026-10).
   */
  let skew = 0;
  const now = () => Date.now() + skew;
  function measureSkew() {
    const t0 = Date.now();
    fetch('version.json?t=' + t0, { method: 'HEAD', cache: 'no-store' }).then(r => {
      const d = Date.parse(r.headers.get('date') || '');
      if (!d) return;
      const s = d + 500 - (t0 + Date.now()) / 2;          // (the header has one-second precision)
      skew = Math.abs(s) > 60000 ? s : 0;
      if (skew) console.warn('[Social] this device clock is off by', Math.round(skew / 60000), 'min; correcting');
    }).catch(() => {});
  }
  // Presence heartbeat: every 30 min (was 15, previously 10). 57,000 players
  // with friends wrote it 4 times per hour (2026-10-13; reduced Firestore usage).
  const BEAT = 30 * 60 * 1000;
  const ONLINE = 40 * 60 * 1000;        // online if the last heartbeat is more recent
  const PRES_TTL = 60 * 1000;           // cached friend presence lasts 1 min

  let fb = null, uid = null;
  let me = null;                    // { uid, name }
  let friends = new Map();          // otherUid -> { uid, name, pid, status: 'ok'|'in'|'out', online, play }
  let unFriends = null;
  let beatT = 0, presAt = 0, unInv = null;
  const pres = new Map();           // otherUid -> { online, play, room, seen } (last read)
  const sentInv = new Set();        // invitees (to retract when leaving)
  let room = null;                  // { id, host, isHost, members: [{ uid, name, dex, shiny }] }
  let roomRefs = [];
  const invites = new Map();        // fromUid -> { from, name, room, at }
  const listeners = new Set();
  let started = false;

  function emit(what) { listeners.forEach(fn => { try { fn(what); } catch (e) { console.warn(e); } }); }
  const ts = () => firebase.database.ServerValue.TIMESTAMP;
  const fts = () => firebase.firestore.FieldValue.serverTimestamp();
  const msOf = v => (v && v.toMillis ? v.toMillis() : +v || 0);
  const pidOf = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

  // ---------------- startup ----------------

  /** After signing in. → 'ok' | 'need-nick' | 'off' (no cloud account) */
  async function start() {
    if (!G.DB.online) return 'off';
    if (started) return me ? 'ok' : 'need-nick';
    fb = G.DB.fb; uid = fb.uid;
    started = true;
    measureSkew();
    // Nicknames never change: cache them in this browser to avoid reading the
    // profile on every visit (one fewer read per player per session).
    const NICK = 'ps.nick.' + uid;
    let cachedNick = null;
    try { cachedNick = localStorage.getItem(NICK); } catch (e) { /* ignored */ }
    const prof = cachedNick ? { name: cachedNick }
      : await fb.fs.collection('profiles').doc(uid).get().then(s => s.exists ? s.data() : null).catch(() => null);
    if (prof) {
      me = { uid, name: prof.name };
      if (G.DB.user !== prof.name) G.DB.setName(prof.name);
      try { localStorage.setItem(NICK, prof.name); } catch (e) { /* ignored */ }
    }
    else if (G.DB.nameAccount) {
      // Username/password accounts already have a unique name, used as the nickname.
      const r = await claimNick(G.DB.save.name);
      if (!r.ok) return 'need-nick';
    } else return 'need-nick';
    online();
    return 'ok';
  }

  /** Reserve a unique nickname and create the public profile. */
  async function claimNick(name) {
    name = (name || '').trim();
    if (!VALID.test(name)) return { ok: false, error: 'El apodo debe tener 3-16 letras, números o _.' };
    const lower = name.toLowerCase();
    try {
      await fb.fs.runTransaction(async tx => {
        const nref = fb.fs.collection('names').doc(lower);
        const n = await tx.get(nref);
        if (n.exists && n.data().uid !== uid) throw { code: 'taken' };
        if (!n.exists) tx.set(nref, { uid });
        tx.set(fb.fs.collection('profiles').doc(uid),
          { name, lower, at: firebase.firestore.FieldValue.serverTimestamp() });
      });
    } catch (e) {
      if (e && e.code === 'taken') return { ok: false, error: 'Ese apodo ya lo tiene otro jugador.' };
      return { ok: false, error: 'No se pudo guardar el apodo (' + ((e && e.code) || 'error') + ').' };
    }
    me = { uid, name };
    try { localStorage.setItem('ps.nick.' + uid, name); } catch (e) { /* ignored */ }
    G.DB.setName(name);
    if (started && !beatT) online();
    publishProfile(true);
    return { ok: true };
  }

  /*
   * Friends and invitations do not use the Realtime Database.
   * Since 2026-10-20, the friends list is NOT loaded on sign-in (one read per
   * friend per page load for everyone); it loads only when Friends, a room, or
   * the friends leaderboard opens (ensureFriends). Invitations are listened for
   * immediately if this browser knows you have friends (hasFrKey); the server
   * already verifies that the sender is a friend.
   */
  const hasFrKey = () => 'ps.hasfr.' + uid;
  function online() {
    if (beatT) return;                        // already running
    beatT = 1;
    if (fb.rtdb) fb.rtdb.goOffline();         // connect only when entering a room
    let known = false;
    try { known = localStorage.getItem(hasFrKey()) === '1'; } catch (e) { /* ignored */ }
    if (known) listenInvites();
  }

  /** Load and listen to the friends list the first time it is needed. */
  let friendsReady = null;
  function ensureFriends() {
    if (!fb || !me) return Promise.resolve();
    if (!friendsReady) friendsReady = new Promise(res => listenFriends(res));
    return friendsReady;
  }

  /** Room invites can only come from friends, so do not listen when there are no friends (reads). */
  function listenInvites() {
    if (unInv || !fb) return;
    unInv = fb.fs.collection('inv').where('to', '==', uid).onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        const v = ch.doc.data();
        if (ch.type === 'removed') { invites.delete(v.from); emit('invites'); return; }
        onInvite(ch.doc.ref, v);
      });
    }, e => console.warn('[Social] invitaciones:', e.code || e.message));
  }

  let playing = false, lastBeat = 0;
  /** Is anyone allowed to see your "online" status? (confirmed friends only) */
  const hasFriends = () => [...friends.values()].some(f => f.status === 'ok');
  // Friend "online" status was removed on 2026-10-20: it caused 1/4 of all
  // Firestore writes (about 2 million per day). pres/{uid} is no longer read or
  // written; any friend can be invited (invitations expire automatically).
  // Keep writeStatus and refreshPresence as no-ops for their existing callers.
  const presKey = () => 'ps.pres.' + uid;
  function writeStatus() {}
  function setPlaying(p) {
    playing = !!p;
    // Recheck the room when the run ends (players who left are removed).
    if (!playing && room) { if (room.lost) room.tries = 0; emit('room'); }
  }

  async function stop(why) {
    if (!started) return;
    await leaveRoom().catch(() => {});
    if (unFriends) { unFriends(); unFriends = null; }
    if (unInv) { unInv(); unInv = null; }
    clearInterval(beatT); beatT = 0; friendsReady = null;
    try { localStorage.removeItem(presKey()); } catch (e) { /* ignored */ }
    if (why === 'delete') {
      try { localStorage.removeItem('ps.nick.' + uid); } catch (e) { /* ignored */ }
      await deleteAll().catch(e => console.warn('[Social] borrar:', e));
    }
    friends.clear(); invites.clear(); sentInv.clear(); pres.clear(); presAt = 0;
    me = null; started = false; fb = null; uid = null; playing = false;
    emit('stop');
  }

  /** Delete friendships, leaderboard records, profile, and nickname with the account. */
  async function deleteAll() {
    // Run each step separately so a failure does not prevent the others.
    const step = async (what, fn) => { try { await fn(); } catch (e) { console.warn('[Social] no se pudo borrar ' + what + ':', e.code || e.message); } };
    const del = async q => { const s = await q.get(); await Promise.all(s.docs.map(d => d.ref.delete().catch(() => {}))); };
    await step('amistades', () => del(fb.fs.collection('friendships').where('users', 'array-contains', uid)));
    await step('filas del ranking', () => G.Ranking.removeMine());
    await step('invitaciones', () => del(fb.fs.collection('inv').where('to', '==', uid)));
    await step('marcas', () => del(fb.fs.collectionGroup('e').where('uids', 'array-contains', uid)));
    await step('partida en curso', () => fb.fs.collection('runs').doc(uid).delete());
    await step('en línea', () => fb.fs.collection('pres').doc(uid).delete());
    await step('apodo', async () => {
      const prof = await fb.fs.collection('profiles').doc(uid).get();
      const lower = prof.exists ? prof.data().lower : me && me.name.toLowerCase();
      if (lower) await fb.fs.collection('names').doc(lower).delete().catch(() => {});
      if (prof.exists) await fb.fs.collection('profiles').doc(uid).delete();
    });
  }

  // ---------------- friends ----------------

  function listenFriends(ready) {
    unFriends = fb.fs.collection('friendships').where('users', 'array-contains', uid).onSnapshot(snap => {
      const next = new Map();
      snap.forEach(d => {
        const f = d.data();
        const other = f.users[0] === uid ? f.users[1] : f.users[0];
        next.set(other, Object.assign({
          uid: other, pid: d.id, name: (f.names && f.names[other]) || '???',
          status: f.status === 'ok' ? 'ok' : f.to === uid ? 'in' : 'out',
          online: false, play: false, room: '', seen: 0
        }, pres.get(other) || {}));
      });
      friends = next;
      emit('friends');
      // Friends can now invite you; remember this in the browser for next time.
      try { if (hasFriends()) localStorage.setItem(hasFrKey(), '1'); else localStorage.removeItem(hasFrKey()); } catch (e) { /* ignored */ }
      if (hasFriends()) listenInvites();
      if (ready) { ready(); ready = null; }
    }, e => { console.warn('[Social] amigos:', e.code || e.message); if (ready) { ready(); ready = null; } });
  }

  /** Removed with online status on 2026-10-20; no longer reads anything. */
  async function refreshPresence() {}

  /** Send a friend request (or accept an existing request from them). */
  async function request(name) {
    name = (name || '').trim();
    if (!me) return { ok: false, error: 'Primero elige tu apodo.' };
    if (!VALID.test(name)) return { ok: false, error: 'Escribe el apodo exacto de tu amigo.' };
    const n = await fb.fs.collection('names').doc(name.toLowerCase()).get().catch(() => null);
    if (!n || !n.exists) return { ok: false, error: 'No hay ningún jugador con ese apodo.' };
    const other = n.data().uid;
    if (other === uid) return { ok: false, error: 'Ese eres tú.' };
    const f = friends.get(other);
    if (f && f.status === 'ok') return { ok: false, error: 'Ya sois amigos.' };
    if (f && f.status === 'out') return { ok: false, error: 'Ya le enviaste una solicitud.' };
    if (f && f.status === 'in') return accept(other);
    const prof = await fb.fs.collection('profiles').doc(other).get().catch(() => null);
    const otherName = prof && prof.exists ? prof.data().name : name;
    const users = [uid, other].sort();
    try {
      await fb.fs.collection('friendships').doc(users[0] + '_' + users[1]).set({
        users, from: uid, to: other, status: 'pending',
        names: { [uid]: me.name, [other]: otherName },
        at: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { ok: true, msg: 'Solicitud enviada a ' + otherName };
    } catch (e) { return { ok: false, error: 'No se pudo enviar (' + (e.code || 'error') + ').' }; }
  }

  async function accept(other) {
    const f = friends.get(other);
    if (!f || f.status !== 'in') return { ok: false, error: 'No hay solicitud.' };
    try {
      await fb.fs.collection('friendships').doc(f.pid).update({
        status: 'ok', at: firebase.firestore.FieldValue.serverTimestamp(), ['names.' + uid]: me.name
      });
      return { ok: true, msg: 'Ahora eres amigo de ' + f.name };
    } catch (e) { return { ok: false, error: 'No se pudo aceptar (' + (e.code || 'error') + ').' }; }
  }

  async function remove(other) {
    const f = friends.get(other);
    if (!f) return { ok: false };
    try { await fb.fs.collection('friendships').doc(f.pid).delete(); return { ok: true }; }
    catch (e) { return { ok: false, error: 'No se pudo borrar (' + (e.code || 'error') + ').' }; }
  }

  // ---------------- rooms ----------------

  function memberInfo() {
    const s = G.DB.save;
    return { name: me.name, dex: s.partner, shiny: !!s.partnerShiny && G.DB.ownsShiny(s.partner), at: ts() };
  }

  /**
   * The Realtime Database connects only while you are in a room: each open
   * connection consumes downloads (charged above 360 MB per day).
   * (An online player counter kept it connected continuously on 2026-10-11;
   * it was removed for that reason.)
   */
  function rtOn() { if (fb.rtdb) fb.rtdb.goOnline(); }
  function rtOff() { if (fb && fb.rtdb && !room) fb.rtdb.goOffline(); }

  async function createRoom() {
    if (room) return room;
    rtOn();
    const id = fb.rtdb.ref('rooms').push().key;
    await fb.rtdb.ref('rooms/' + id).set({ host: uid, open: true, at: ts(), m: { [uid]: memberInfo() } });
    enterRoom(id, uid);
    return room;
  }

  async function joinRoom(id) {
    if (room && room.id === id) return { ok: true };
    if (room) await leaveRoom();
    rtOn();
    let open = null, host = null;
    try {
      open = (await fb.rtdb.ref('rooms/' + id + '/open').get()).val();
      host = (await fb.rtdb.ref('rooms/' + id + '/host').get()).val();
    } catch (e) { /* room deleted */ }
    if (!host) { rtOff(); return { ok: false, error: 'Esa sala ya no existe.' }; }
    if (open !== true) { rtOff(); return { ok: false, error: 'La partida de esa sala ya ha empezado.' }; }
    try { await fb.rtdb.ref('rooms/' + id + '/m/' + uid).set(memberInfo()); }
    catch (e) { rtOff(); return { ok: false, error: 'No se pudo entrar en la sala.' }; }
    const n = (await fb.rtdb.ref('rooms/' + id + '/m').get()).numChildren();
    if (n > MAX_PLAYERS) {
      await fb.rtdb.ref('rooms/' + id + '/m/' + uid).remove();
      rtOff();
      return { ok: false, error: 'La sala está llena (máximo ' + MAX_PLAYERS + ').' };
    }
    enterRoom(id, host);
    return { ok: true };
  }

  function enterRoom(id, host) {
    room = { id, host, isHost: host === uid, members: [], open: true, lost: false };
    watchRoom(id);
    writeStatus();
    emit('room');
  }

  function watchRoom(id) {
    detachRoom();
    const mref = fb.rtdb.ref('rooms/' + id + '/m');
    mref.on('value', s => {
      if (!room || room.id !== id) return;
      const m = s.val() || {};
      if (!m[uid]) { lostRoom(id); return; }          // your slot is gone (disconnect)
      const prev = room.members;
      // Host first; other members in arrival order.
      room.members = Object.keys(m).map(k => Object.assign({ uid: k }, m[k]))
        .sort((a, b) => (a.uid === room.host ? -1 : b.uid === room.host ? 1 : (a.at || 0) - (b.at || 0)));
      if (room.isHost && playing) keepMates(id, prev);
      emit('room');
    }, () => lostRoom(id));
    const href = fb.rtdb.ref('rooms/' + id + '/host');
    href.on('value', s => { if (room && room.id === id && !s.val()) lostRoom(id); }, () => lostRoom(id));
    const oref = fb.rtdb.ref('rooms/' + id + '/open');
    oref.on('value', s => { if (room && room.id === id) { room.open = s.val() === true; emit('room'); } }, () => {});
    // After a disconnect, the server has run onDisconnect; register it again.
    const cref = fb.rtdb.ref('.info/connected');
    cref.on('value', s => { if (s.val() === true && room && room.id === id) watchRoomDisconnect(); });
    roomRefs = [mref, href, oref, cref];
  }

  /** On browser close, the room (host) or your slot (guest) is automatically deleted. */
  function watchRoomDisconnect() {
    if (!room) return;
    const ref = room.isHost ? fb.rtdb.ref('rooms/' + room.id) : fb.rtdb.ref('rooms/' + room.id + '/m/' + uid);
    ref.onDisconnect().remove();
  }

  function detachRoom() {
    for (const r of roomRefs) r.off();
    roomRefs = [];
  }

  /*
   * Realtime Database disconnects (2026-10-22). Any connection interruption
   * (mobile network, sleeping tab, or the free-plan limit of 100 connections
   * during reconnect) triggers onDisconnect on the server: it removes the
   * guest's slot (preventing them from reading the room when they return) or
   * the entire room if they are the host. Previously this showed "Room closed"
   * and ended the run, even if the direct channel to other players still worked.
   * The room is no longer considered closed after the first interruption: it is
   * restored (the host rewrites it with existing members; the guest restores
   * their slot) and is never closed during a run, which uses the direct channel.
   */
  const REJOIN_MS = 4000, REJOIN_TRIES = 3;

  function lostRoom(id) {
    if (!room || room.id !== id || room.lost) return;
    detachRoom();
    room.lost = true;
    room.tries = 0;
    rejoin(id);
  }

  const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Error('timeout')), ms))]);

  async function rejoin(id) {
    if (!room || room.id !== id || !room.lost) return;
    const base = fb.rtdb.ref('rooms/' + id);
    try {
      const host = (await within(base.child('host').get(), 5000)).val();
      if (!room || room.id !== id) return;
      if (room.isHost) {
        // The server deleted your room: recreate it with the same ID and members.
        if (host !== uid) {
          if (host) throw Error('otra');
          const m = {};
          for (const x of room.members) m[x.uid] = { name: x.name, dex: x.dex, shiny: !!x.shiny, at: x.at || 0 };
          m[uid] = Object.assign(memberInfo(), m[uid] ? { at: m[uid].at } : {});
          await within(base.set({ host: uid, open: playing ? false : room.open, at: ts(), m }), 5000);
        }
      } else {
        if (!host) throw Error('sin anfitrión');
        const mine = room.members.find(x => x.uid === uid);
        // If that fails, others keep playing and the room stays closed to new
        // members until the run ends; wait and retry.
        await within(base.child('m/' + uid).set(Object.assign(memberInfo(), mine && mine.at ? { at: mine.at } : {})), 5000)
          .catch(e => { throw Object.assign(e, { wait: e.message !== 'timeout' }); });
      }
    } catch (e) {
      if (!room || room.id !== id) return;
      // Keep retrying during a run. Otherwise, consider the room closed after a
      // few attempts (unless the host is still running the game in it).
      if (!playing && !e.wait && ++room.tries >= REJOIN_TRIES) { closedRoom(); return; }
      setTimeout(() => rejoin(id), playing || e.wait ? 2 * REJOIN_MS : REJOIN_MS);
      return;
    }
    if (!room || room.id !== id) return;
    room.lost = false;
    watchRoom(id);
    watchRoomDisconnect();
  }

  /**
   * Host during a run: if a guest's slot disappears while they are still in the
   * run (even while reconnecting; see coop.js), their database connection was
   * interrupted, so restore the slot. Without it, they could not read the room
   * or respond to the host to reconnect.
   */
  function keepMates(id, prev) {
    for (const x of prev) {
      if (x.uid === uid || room.members.some(m => m.uid === x.uid)) continue;
      setTimeout(() => {
        if (!room || room.id !== id || !playing || room.members.some(m => m.uid === x.uid)) return;
        if (!G.Coop.keeps(x.uid)) return;
        fb.rtdb.ref('rooms/' + id + '/m/' + x.uid).set({ name: x.name, dex: x.dex, shiny: !!x.shiny, at: x.at || 0 }).catch(() => {});
      }, 3000);
    }
  }

  /** Host: remove someone from the room (they disconnected during a run and did not return). */
  function dropMember(u) {
    if (room && room.isHost && u !== uid) fb.rtdb.ref('rooms/' + room.id + '/m/' + u).remove().catch(() => {});
  }

  function closedRoom() {
    if (!room) return;
    detachRoom();
    room = null;
    retractInvites();
    writeStatus();
    rtOff();
    emit('room-closed');
  }

  async function leaveRoom() {
    if (!room) return;
    const r = room;
    detachRoom();
    room = null;
    const ref = r.isHost ? fb.rtdb.ref('rooms/' + r.id) : fb.rtdb.ref('rooms/' + r.id + '/m/' + uid);
    ref.onDisconnect().cancel().catch(() => {});
    await ref.remove().catch(() => {});
    retractInvites();
    writeStatus();
    rtOff();
    emit('room');
  }

  /** The host closes the room to new players when the run starts. */
  function setOpen(open) {
    if (room && room.isHost) fb.rtdb.ref('rooms/' + room.id + '/open').set(!!open).catch(() => {});
  }

  /** Update your Pokémon in the room (if you change partners). */
  function refreshMember() {
    if (room && me) fb.rtdb.ref('rooms/' + room.id + '/m/' + uid).update(
      { dex: G.DB.save.partner, shiny: !!G.DB.save.partnerShiny && G.DB.ownsShiny(G.DB.save.partner) }).catch(() => {});
  }

  // ---------------- invitations ----------------

  async function invite(other) {
    const f = friends.get(other);
    if (!f || f.status !== 'ok') return { ok: false, error: 'Sólo puedes invitar a tus amigos.' };
    if (room && room.members.length >= MAX_PLAYERS) return { ok: false, error: 'La sala está llena.' };
    if (room && !room.isHost) return { ok: false, error: 'Sólo el anfitrión de la sala puede invitar.' };
    if (!room) await createRoom();
    try {
      await fb.fs.collection('inv').doc(other + '_' + uid).set({ to: other, from: uid, room: room.id, name: me.name, at: fts() });
    } catch (e) { return { ok: false, error: 'No se pudo invitar (' + (e.code || 'error') + ').' }; }
    sentInv.add(other);
    return { ok: true, msg: 'Invitación enviada a ' + f.name };
  }

  /** Retract invitations you sent (when leaving the room). */
  function retractInvites() {
    if (!fb) return;
    for (const o of sentInv) fb.fs.collection('inv').doc(o + '_' + uid).delete().catch(() => {});
    sentInv.clear();
  }

  function onInvite(ref, v) {
    // Expired invites are deleted; accept invites only from confirmed friends.
    if (!v || (v.at && now() - msOf(v.at) > INVITE_TTL)) { ref.delete().catch(() => {}); return; }
    const f = friends.get(v.from);
    if (f && f.status !== 'ok') return;
    invites.set(v.from, { from: v.from, name: v.name, room: v.room, at: msOf(v.at) || now() });
    emit('invites');
  }

  const invDoc = from => fb.fs.collection('inv').doc(uid + '_' + from);

  async function acceptInvite(from) {
    const inv = invites.get(from);
    if (!inv || now() - inv.at > INVITE_TTL) { invites.delete(from); emit('invites'); return { ok: false, error: 'La invitación ha caducado.' }; }
    invites.delete(from);
    invDoc(from).delete().catch(() => {});
    emit('invites');
    return joinRoom(inv.room);
  }

  function declineInvite(from) {
    invites.delete(from);
    invDoc(from).delete().catch(() => {});
    emit('invites');
  }

  // ---------------- public profile ----------------

  /** Data shown about you (also used for your preview, without uploading it). */
  function profileData() {
    const s = G.DB.save, st = s.stats, prof = s.profile || {};
    const unlocked = G.AchDefs.LIST.filter(a => s.ach && s.ach[a.id]);
    const medals = unlocked.slice().sort((a, b) => (b.tier - a.tier) || (s.ach[b.id] - s.ach[a.id])).slice(0, 8).map(a => a.id);
    return {
      name: me ? me.name : G.DB.user,
      favs: (prof.favs || []).slice(0, 3).map(f => ({ dex: f.dex | 0, shiny: !!f.shiny })),
      title: prof.title || '',
      best: { solo: st.bestTime | 0, group: st.bestGroupTime | 0, level: st.bestLevel | 0, bosses: st.bossesTotal | 0,
              legends: Object.keys(s.legends || {}).length, kills: st.totalKills | 0, medals: unlocked.length },
      medals
    };
  }

  let pubT = 0, pubAt = 0, pubLast = '';
  /**
   * Upload your profile after a short delay in case several things change in
   * quick succession, but ONLY if a visible field changed: time and level
   * records, Legendaries, medals, title, or favorites.
   * Bosses and kills (which change every run) are uploaded with the rest when
   * appropriate, not by themselves: the profile was written 200,000 times per
   * day (2026-10-13). Favorite or title changes (force) upload immediately.
   */
  function publishProfile(force = false) {
    if (!me || !fb) return;
    if (!force && Date.now() - pubAt < 2 * 3600 * 1000) return;    // at most every 2 h (was 30 min)
    clearTimeout(pubT);
    pubT = setTimeout(() => {
      if (!me || !fb) return;
      const d = profileData();
      // Used to decide whether to upload (persists between sessions): omit bosses and kills.
      const key = JSON.stringify(Object.assign({}, d, { best: Object.assign({}, d.best, { kills: 0, bosses: 0 }) }));
      const lsKey = 'ps.pub.' + uid;
      if (!pubLast) { try { pubLast = localStorage.getItem(lsKey) || ''; } catch (e) { /* ignored */ } }
      if (key === pubLast) return;
      pubLast = key; pubAt = Date.now();
      try { localStorage.setItem(lsKey, key); } catch (e) { /* ignored */ }
      fb.fs.collection('profiles').doc(uid).set(Object.assign(d, {
        name: me.name, lower: me.name.toLowerCase(), at: firebase.firestore.FieldValue.serverTimestamp()
      })).catch(e => { pubLast = ''; console.warn('[Social] perfil:', e.code || e.message); });
    }, 800);
  }

  /** Another player's sanitized profile (see G.U.int / str): only fields the game can render. */
  function cleanProfile(d) {
    const U = G.U, b = d.best || {};
    return {
      name: U.str(d.name, 24), title: U.str(d.title, 40),
      favs: U.list(d.favs, 3).filter(f => f && G.DEX_BY[U.int(f.dex)]).map(f => ({ dex: U.int(f.dex), shiny: f.shiny === true })),
      best: { solo: U.int(b.solo, 86400), group: U.int(b.group, 86400), level: U.int(b.level, 999), bosses: U.int(b.bosses, 1e9),
              legends: U.int(b.legends, 999), kills: U.int(b.kills, 1e12), medals: U.int(b.medals, 999) },
      medals: U.list(d.medals, 8).map(x => U.str(x, 40))
    };
  }

  /** Another player's public profile. */
  const profCache = new Map();
  async function getProfile(other) {
    if (!fb) return null;
    // Your own profile comes from your save (no read required, always up to date).
    if (other === uid && me) return Object.assign(profileData(), { name: me.name });
    const c = profCache.get(other);
    if (c && Date.now() - c.at < 10 * 60 * 1000) return c.v;     // cached reads last 10 min
    const d = await fb.fs.collection('profiles').doc(other).get().catch(() => null);
    const v = d && d.exists ? cleanProfile(d.data()) : null;
    profCache.set(other, { at: Date.now(), v });
    return v;
  }

  // On sign-out or account deletion.
  G.DB.onLeave(why => stop(why));

  return {
    start, stop, claimNick, request, accept, remove, publishProfile, getProfile, profileData,
    createRoom, joinRoom, leaveRoom, setOpen, refreshMember, dropMember, setPlaying, refreshPresence, ensureFriends,
    invite, acceptInvite, declineInvite,
    on(fn) { listeners.add(fn); }, off(fn) { listeners.delete(fn); },
    get me() { return me; },
    get started() { return started; },
    get friends() { return [...friends.values()]; },
    get invites() { return [...invites.values()]; },
    get room() { return room; },
    get uid() { return uid; },
    /** Server time (corrects for a device clock that is out of sync). */
    now,
    VALID, MAX_PLAYERS
  };
})();

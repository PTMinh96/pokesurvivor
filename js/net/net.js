/* ============ net.js — connection between room players ============
 * Star topology: the HOST communicates with each guest; guests only
 * communicate with the host (who forwards anything necessary).
 *
 * Two paths, at the same time:
 *   direct   WebRTC (data channel between browsers). Negotiation (signaling)
 *            uses the database. Use Google's free STUN and, if the network
 *            blocks a direct connection (some routers and mobile networks),
 *            the project's TURN server at turn.pokesurvivor.com as a relay.
 *            Credentials expire and are requested from ice.pokesurvivor.com
 *            using the Firebase session; if unavailable, use STUN only. TURN
 *            is used only when retrying a pair that failed to connect directly,
 *            and the browser still prefers the direct route.
 *   relay    (DISABLED) messages would use the Realtime Database:
 *            rooms/{room}/q/{recipient}/{id}, at $1 per GB.
 *
 * Send over the direct channel when open, otherwise via the relay. Receivers
 * listen on both, so no coordination is needed.
 *
 * API:  open(roomId, isHost, hostUid) · close() · send(to, msg) · toHost(msg)
 *       broadcast(msg) · on(fn(from, msg)) · onPeer(fn(uid, state))
 *       peers() · mode(uid) -> 'connecting' | 'direct' | 'relay' | 'closed'
 */
G.Net = (() => {
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const TURN_API = 'https://ice.pokesurvivor.com/v1/ice';
  // Try without TURN first (direct connection is the normal path), and retry
  // immediately with it only if that fails. The browser reserves a TURN
  // allocation for every connection configured with TURN, even if it later
  // connects directly, so this leaves allocations available for everyone.
  const DIRECT_TIMEOUT = 9000, TURN_TIMEOUT = 15000;   // ms to establish a channel
  // Realtime Database relay DISABLED (2026-10-12): at $1/GB, it was the most
  // expensive part of co-op. Without a direct connection, that pair cannot
  // play together ('failed'); the host retries every RETRY_MS. Only signaling
  // (a few small connection setup messages) passes through the database.
  const ALLOW_RELAY = false, RETRY_MS = 15000;


  let rtdb = null, uid = null, roomId = null, isHost = false, hostUid = null;
  let qref = null;
  const peers = new Map();         // uid -> { pc, dc, mode, timer }
  // Host: guests for whom direct connection has already failed. Remember for
  // the whole session (not just the room) to avoid repeating the wait without
  // TURN; after failures with 2 or more guests, the local network is likely
  // the issue, so use TURN from the start.
  const needTurn = new Set();
  const handlers = new Set(), peerHandlers = new Set();
  const stats = { sent: 0, recv: 0, relaySent: 0,
    // Successfully sent game data only (excludes ICE/SCTP/DTLS/TURN).
    sentBytes: 0, jsonBytes: 0, recvBytes: 0, binarySent: 0, binaryRecv: 0, invalidBinary: 0 };

  // ---------------- custom TURN ----------------
  // Temporary credentials (2 h) per account. A TURN connection stops working
  // when its credentials expire (the server no longer renews the allocation),
  // so reuse them only if they last longer than a long run (TURN_KEEP). If the
  // server does not issue them (unauthorized account, outage, offline), do not
  // ask again for a while; play with STUN only.
  let turn = null, turnUid = null, turnAsk = null, turnRetry = 0;
  const TURN_KEEP = 80 * 60000;

  function cleanIce(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 4).map(s => ({
      urls: (Array.isArray(s && s.urls) ? s.urls : []).filter(x => typeof x === 'string' &&
        /^turns?:turn\.pokesurvivor\.com:\d{2,5}(\?transport=(udp|tcp))?$/.test(x)).slice(0, 4),
      username: String(s && s.username || '').slice(0, 200),
      credential: String(s && s.credential || '').slice(0, 200)
    })).filter(s => s.urls.length && s.username && s.credential);
  }

  function turnUser() {
    const fb = G.DB.fb, user = fb && !fb.emulator && fb.auth && fb.auth.currentUser;
    return user && !user.isAnonymous ? user : null;
  }

  /** Cached result, if available: the list (possibly empty), or null if it must be requested. */
  function turnNow() {
    const user = turnUser();
    if (!user) return [];
    if (turn && turnUid === user.uid && turn.expiresAt * 1000 - Date.now() > TURN_KEEP) return turn.iceServers;
    return Date.now() < turnRetry ? [] : null;
  }

  function turnServers() {
    const now = turnNow(), user = turnUser();
    if (now) return Promise.resolve(now);
    if (!turnAsk) {
      turnAsk = (async () => {
        const ctl = new AbortController(), stop = setTimeout(() => ctl.abort(), 4000);
        try {
          const token = await user.getIdToken();
          const r = await fetch(TURN_API, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, signal: ctl.signal });
          // 403: this account does not have TURN access yet; do not retry for 30 minutes.
          if (!r.ok) { turnRetry = Date.now() + (r.status === 403 ? 1800000 : 60000); return; }
          const j = await r.json(), iceServers = cleanIce(j && j.iceServers);
          if (!iceServers.length || !(j.expiresAt * 1000 > Date.now())) { turnRetry = Date.now() + 60000; return; }
          turn = { iceServers, expiresAt: j.expiresAt }; turnUid = user.uid;
        } catch (e) { turnRetry = Date.now() + 60000; }
        finally { clearTimeout(stop); turnAsk = null; }
      })();
    }
    return turnAsk.then(() => turn && turnUid === user.uid ? turn.iceServers : []);
  }

  /** Did the connection to u end up using TURN? (for the room) */
  async function checkTurn(u, p) {
    try {
      const st = await p.pc.getStats();
      let pair = null;
      st.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId); });
      if (!pair) st.forEach(r => { if (!pair && r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      const local = pair && st.get(pair.localCandidateId), remote = pair && st.get(pair.remoteCandidateId);
      const via = !!((local && local.candidateType === 'relay') || (remote && remote.candidateType === 'relay'));
      if (via !== !!p.viaTurn && peers.get(u) === p) { p.viaTurn = via; emitPeer(u); }
    } catch (e) { /* Only used for the room text. */ }
  }

  function emitPeer(u) {
    const p = peers.get(u);
    peerHandlers.forEach(fn => { try { fn(u, p ? p.mode : 'closed'); } catch (e) { console.warn(e); } });
  }

  // ---------------- opening ----------------

  function open(id, host, hostId) {
    if (roomId === id) return;
    close();
    const fb = G.DB.fb;
    rtdb = fb.rtdb; uid = fb.uid;
    roomId = id; isHost = host; hostUid = hostId;
    qref = rtdb.ref('rooms/' + id + '/q/' + uid);
    qref.on('child_added', s => {
      const raw = s.val();
      s.ref.remove().catch(() => {});
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }
      if (!m || !m.f) return;
      if (m.sig) onSignal(m.f, m.sig);
      else deliver(m.f, m.d);
    });
    // Guest: reserve a slot for the host immediately (replace it when their
    // offer arrives). If it never arrives, use the relay and detect when they leave.
    if (!isHost) {
      const p = { pc: null, dc: null, mode: 'connecting', timer: 0 };
      p.timer = setTimeout(() => { if (p.mode === 'connecting') { p.mode = ALLOW_RELAY ? 'relay' : 'failed'; emitPeer(hostId); } }, DIRECT_TIMEOUT + TURN_TIMEOUT + 3000);
      peers.set(hostId, p);
    }
  }

  function close() {
    for (const u of [...peers.keys()]) drop(u);
    if (qref) { qref.off(); qref = null; }
    roomId = null; isHost = false; hostUid = null;
  }

  const turnFirst = u => needTurn.has(u) || needTurn.size >= 2;

  /** The host calls this when the room members change. */
  function syncMembers(uids) {
    if (!roomId) return;
    if (isHost) {
      for (const u of uids) if (u !== uid && !peers.has(u)) connect(u);
      for (const u of [...peers.keys()]) if (!uids.includes(u)) drop(u);
    } else if (!uids.includes(hostUid)) {
      drop(hostUid);
    }
  }

  // ---------------- WebRTC ----------------

  function newPeer(u, turnIce) {
    const p = { pc: null, dc: null, mode: 'connecting', timer: 0, viaTurn: false, turn: !!(turnIce && turnIce.length) };
    peers.set(u, p);
    // Without WebRTC (old or restricted browser), use the relay directly.
    let pc;
    try { pc = p.pc = new RTCPeerConnection({ iceServers: ICE.concat(turnIce || []) }); }
    catch (e) { p.mode = 'relay'; emitPeer(u); return p; }
    pc.onicecandidate = e => { if (e.candidate) signal(u, { c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && p.mode !== 'closed') useRelay(u);
    };
    // If there is no direct channel after a few seconds, continue through the relay.
    p.timer = setTimeout(() => { if (p.mode === 'connecting') useRelay(u); }, p.turn ? TURN_TIMEOUT : DIRECT_TIMEOUT);
    emitPeer(u);
    return p;
  }

  function wireChannel(u, p, dc) {
    p.dc = dc;
    p.binaryVersion = 0;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      clearTimeout(p.timer); p.mode = 'direct';
      if (p.pc) checkTurn(u, p);
      // Announce binary support (older versions ignore this). Continue using
      // JSON until the peer sends its own capability message.
      try { dc.send(JSON.stringify({ k: 'net-cap', binary: G.NetCodec.version })); } catch (e) { /* JSON still works. */ }
      emitPeer(u);
    };
    dc.onclose = () => { if (p.mode === 'direct') { p.mode = 'connecting'; useRelay(u); } };
    dc.onmessage = e => {
      let m;
      if (typeof e.data === 'string') {
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m && m.k === 'net-cap') {
          p.binaryVersion = m.binary === G.NetCodec.version ? m.binary : 0;
          return;
        }
        stats.recvBytes += G.NetCodec.size(e.data);
      } else {
        try {
          if (p.binaryVersion !== G.NetCodec.version) throw Error('unnegotiated binary');
          m = G.NetCodec.decode(e.data);
          if (!m || m.k !== 'f') throw Error('not a frame');
        } catch (err) { stats.invalidBinary++; return; }
        stats.recvBytes += e.data.byteLength; stats.binaryRecv++;
      }
      deliver(u, m);
    };
  }

  function useRelay(u) {
    const p = peers.get(u);
    if (!p || p.mode === 'direct' || p.mode === 'closed' || p.mode === 'failed') return;
    if (ALLOW_RELAY) { p.mode = 'relay'; emitPeer(u); return; }
    // Without a relay, this peer cannot join for now. The host will retry.
    clearTimeout(p.timer);
    p.mode = 'failed';
    try { if (p.pc) p.pc.close(); } catch (e) { /* ignored */ }
    emitPeer(u);
    if (!isHost) return;
    // First failure without TURN: retry immediately with TURN (if the account has access).
    const withTurn = !p.turn && !needTurn.has(u) && !!turnUser();
    if (withTurn) needTurn.add(u);
    p.timer = setTimeout(() => { if (peers.get(u) === p && p.mode === 'failed' && roomId) { drop(u, true); connect(u); } }, withTurn ? 0 : RETRY_MS);
  }

  /** Host: open a connection to a guest. */
  async function connect(u) {
    if (!roomId || peers.has(u)) return;
    let turnIce = turnFirst(u) ? turnNow() : [];
    if (!turnIce) {
      const room = roomId; turnIce = await turnServers();
      if (roomId !== room || peers.has(u)) return;
    }
    const p = newPeer(u, turnIce);
    if (!p.pc) return;
    wireChannel(u, p, p.pc.createDataChannel('g', { ordered: true }));
    try {
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      // t: the guest also uses TURN for this attempt (older versions ignore it).
      signal(u, p.turn ? { sdp: p.pc.localDescription.toJSON(), t: 1 } : { sdp: p.pc.localDescription.toJSON() });
    } catch (e) { useRelay(u); }
  }

  const pendingIce = new Map();     // Candidates that arrive before the offer.

  async function onSignal(from, sig) {
    let p = peers.get(from);
    try {
      if (sig.sdp && sig.sdp.type === 'offer') {
        if (isHost) return;
        let turnIce = sig.t ? turnNow() : [];
        if (!turnIce) {
          const room = roomId; turnIce = await turnServers();
          if (roomId !== room) return;
          p = peers.get(from);
        }
        if (p) drop(from, true);
        p = newPeer(from, turnIce);
        if (!p.pc) return;
        p.pc.ondatachannel = e => wireChannel(from, p, e.channel);
        await p.pc.setRemoteDescription(sig.sdp);
        const ans = await p.pc.createAnswer();
        await p.pc.setLocalDescription(ans);
        signal(from, { sdp: p.pc.localDescription.toJSON() });
        for (const c of pendingIce.get(from) || []) await p.pc.addIceCandidate(c).catch(() => {});
        pendingIce.delete(from);
      } else if (sig.sdp && sig.sdp.type === 'answer') {
        if (p && p.pc) await p.pc.setRemoteDescription(sig.sdp);
      } else if (sig.c) {
        if (p && p.pc && p.pc.remoteDescription) await p.pc.addIceCandidate(sig.c).catch(() => {});
        else { if (!pendingIce.has(from)) pendingIce.set(from, []); pendingIce.get(from).push(sig.c); }
      }
    } catch (e) {
      console.warn('[Net] señalización:', e.message);
      useRelay(from);
    }
  }

  function signal(to, sig) { relayPush(to, { f: uid, sig }); }

  function drop(u, silent) {
    const p = peers.get(u);
    if (!p) return;
    clearTimeout(p.timer);
    p.mode = 'closed';
    try { if (p.dc) p.dc.close(); } catch (e) { /* ignored */ }
    try { if (p.pc) p.pc.close(); } catch (e) { /* ignored */ }
    peers.delete(u);
    if (!silent) emitPeer(u);
  }

  // ---------------- send / receive ----------------

  function relayPush(to, env) {
    if (!rtdb || !roomId) return;
    rtdb.ref('rooms/' + roomId + '/q/' + to).push(JSON.stringify(env)).catch(e => console.warn('[Net] relé:', e.code || e.message));
  }

  function send(to, msg) {
    if (!roomId) return;
    const p = peers.get(to);
    stats.sent++;
    if (p && p.dc && p.dc.readyState === 'open') {
      try {
        const json = JSON.stringify(msg), jsonBytes = G.NetCodec.size(json);
        const packed = p.binaryVersion === G.NetCodec.version && msg && msg.k === 'f'
          ? G.NetCodec.encode(msg) : null;
        const binary = packed && packed.byteLength < jsonBytes;
        p.dc.send(binary ? packed : json);
        stats.sentBytes += binary ? packed.byteLength : jsonBytes;
        stats.jsonBytes += jsonBytes;
        if (binary) stats.binarySent++;
        return;
      } catch (e) { /* Fall back to the relay. */ }
    }
    // Without a relay, game data does not go through the database (it would be
    // lost because the pair is not connected). Only the start notice is sent.
    if (!ALLOW_RELAY && !(msg && msg.k === 'start')) return;
    stats.relaySent++;
    relayPush(to, { f: uid, d: msg });
  }

  function toHost(msg) { if (!isHost && hostUid) send(hostUid, msg); }
  function broadcast(msg, except) { for (const u of peers.keys()) if (u !== except) send(u, msg); }

  function deliver(from, msg) {
    stats.recv++;
    handlers.forEach(fn => { try { fn(from, msg); } catch (e) { console.error('[Net] mensaje:', e); } });
  }

  return {
    open, close, syncMembers, send, toHost, broadcast,
    on(fn) { handlers.add(fn); }, off(fn) { handlers.delete(fn); },
    onPeer(fn) { peerHandlers.add(fn); },
    mode(u) { const p = peers.get(u); return p ? p.mode : 'closed'; },
    /** Connected, but using our own TURN server? */
    viaTurn(u) { const p = peers.get(u); return !!(p && p.mode === 'direct' && p.viaTurn); },
    /** Is it using the relay (or is there no connection)? If so, send less often. */
    slow(u) { const p = peers.get(u); return !p || p.mode !== 'direct'; },
    peers() { return [...peers.keys()]; },
    get open_() { return !!roomId; },
    get isHost() { return isHost; },
    get uid() { return uid; },
    get hostUid() { return hostUid; },
    stats
  };
})();

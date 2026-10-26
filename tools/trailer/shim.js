/* ============ shim.js — virtual clock for recording the trailer ============
 * record.mjs injects this into the page BEFORE any other script.
 * Everything that measures time (performance.now, Date, setTimeout/setInterval,
 * requestAnimationFrame, and CSS animations) uses a clock that advances only
 * when requested by the recorder (__advance), so every frame lasts exactly
 * 1/60 s regardless of how long the computer takes to draw it.
 * Math.random is seeded so every recording is identical.
 *
 * Sound: AudioContext is replaced by an OfflineAudioContext that renders
 * alongside the image (it pauses at each frame with suspend). When finished,
 * __audioWav() returns the complete track as a WAV.
 */
(() => {
  const realSetTimeout = window.setTimeout.bind(window);
  let now = 0;                                   // Virtual milliseconds
  const BASE = Date.UTC(2026, 9, 20, 10, 0, 0);  // 2026-10-20, 12:00 in Madrid

  // ---- seeded randomness (mulberry32) ----
  let seed = 20261020;
  Math.random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ---- clock ----
  performance.now = () => now;
  const RealDate = Date;
  class VDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(BASE + now); }
    static now() { return BASE + now; }
  }
  window.Date = VDate;

  const timers = new Map();
  let tid = 1;
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = tid++;
    timers.set(id, { at: now + Math.max(0, +ms || 0), fn, args, every: 0, n: id });
    return id;
  };
  window.setInterval = (fn, ms = 0, ...args) => {
    const id = tid++, every = Math.max(4, +ms || 0);
    timers.set(id, { at: now + every, fn, args, every, n: id });
    return id;
  };
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };

  const rafs = new Map();
  let rid = 1;
  window.requestAnimationFrame = fn => { const id = rid++; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = id => { rafs.delete(id); };

  function runTimers(until) {
    for (let guard = 0; guard < 20000; guard++) {
      let best = null;
      for (const [id, t] of timers) if (t.at <= until && (!best || t.at < best[1].at || (t.at === best[1].at && t.n < best[1].n))) best = [id, t];
      if (!best) return;
      const [id, t] = best;
      if (t.at > now) now = t.at;
      if (t.every) t.at += t.every; else timers.delete(id);
      try { typeof t.fn === 'function' ? t.fn(...t.args) : eval(t.fn); } catch (e) { console.error('[shim] timer', e); }
    }
  }

  // ---- CSS / Web Animations: use the virtual clock ----
  const born = new WeakMap();
  function syncAnims() {
    let list;
    try { list = document.getAnimations(); } catch (e) { return; }
    for (const a of list) {
      if (!born.has(a)) { born.set(a, now - (a.currentTime || 0)); try { a.pause(); } catch (e) { /* ignored */ } }
      const t = now - born.get(a);
      try {
        const end = a.effect && a.effect.getComputedTiming().endTime;
        if (end !== Infinity && end != null && t >= end) { a.finish(); continue; }
        a.currentTime = t;
      } catch (e) { /* ignored */ }
    }
  }

  // ---- sound ----
  const RATE = 48000;
  let off = null, rec0 = 0, rendering = null, started = false, audioLen = 0;
  const realResume = window.OfflineAudioContext && OfflineAudioContext.prototype.resume;
  window.__realAudioContext = window.AudioContext;
  window.AudioContext = window.webkitAudioContext = undefined;     // Until __enableAudio
  /** The recorder activates this at startup; until then, the game is silent. */
  window.__enableAudio = seconds => {
    audioLen = seconds;
    rec0 = now;
    window.AudioContext = window.webkitAudioContext = function () {
      off = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
      Object.defineProperty(off, 'state', { get: () => 'running' });
      off.resume = () => Promise.resolve();
      off.suspend = OfflineAudioContext.prototype.suspend.bind(off);
      window.__audioCtx = off;
      return off;
    };
  };
  async function stepAudio() {
    if (!off) return;
    const t = (now - rec0) / 1000;
    if (t <= 0 || t >= audioLen - 0.05) return;
    const done = off.suspend(t).catch(() => null);
    if (!started) { started = true; rendering = off.startRendering(); }
    else await realResume.call(off).catch(() => null);
    await done;
  }
  window.__audioDone = async () => {
    if (!off) return 0;
    if (!started) { started = true; rendering = off.startRendering(); }
    else realResume.call(off).catch(() => null);
    const buf = await rendering;
    // Floating-point WAV (32-bit): values above 1 are not clipped here;
    // encode.mjs limits and normalizes them with ffmpeg.
    const n = buf.length, ch = [buf.getChannelData(0), buf.getChannelData(1)];
    const out = new DataView(new ArrayBuffer(44 + n * 8));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + n * 8, true); w(8, 'WAVEfmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 3, true); out.setUint16(22, 2, true);
    out.setUint32(24, RATE, true); out.setUint32(28, RATE * 8, true); out.setUint16(32, 8, true); out.setUint16(34, 32, true);
    w(36, 'data'); out.setUint32(40, n * 8, true);
    let o = 44, peak = 0;
    for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) {
      const v = ch[c][i]; if (Math.abs(v) > peak) peak = Math.abs(v);
      out.setFloat32(o, v, true); o += 4;
    }
    const bytes = new Uint8Array(out.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    window.__wav = btoa(s);
    return { len: window.__wav.length, peak };
  };
  window.__wavChunk = (i, size) => window.__wav.slice(i * size, (i + 1) * size);

  // ---- images still loading (the recorder waits for them to finish) ----
  let pending = 0;
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    get() { return srcDesc.get.call(this); },
    set(v) {
      if (!this.__track) {
        this.__track = true;
        const done = () => { if (this.__busy) { this.__busy = false; pending--; } };
        this.addEventListener('load', done); this.addEventListener('error', done);
      }
      if (!this.__busy) { this.__busy = true; pending++; }
      srcDesc.set.call(this, v);
    }
  });
  window.__pending = () => pending;
  window.__realWait = ms => new Promise(r => realSetTimeout(r, ms));
  window.__waitImages = async (max = 4000) => {
    let t = 0;
    for (; pending > 0 && t < max; t += 10) await window.__realWait(10);
    if (pending > 0) {
      const busy = [...document.images].filter(i => i.__busy).map(i => i.src.slice(-60));
      console.warn('[shim] imágenes sin cargar:', pending, busy.slice(0, 3).join(' | '));
      pending = 0;
    }
  };

  /**
   * Run the game for ms without recording or sound, to start a scene with
   * enemies already around. The sound does not advance (rec0 is shifted).
   */
  window.__preroll = async ms => {
    const step = 1000 / 60, sv = window.G && G.Audio && G.Audio.settings, was = sv ? sv.sfx : 0;
    if (sv) sv.sfx = 0;
    for (let k = 0; k * step < ms; k++) {
      runTimers(now + step);
      now += step; rec0 += step;
      const cbs = [...rafs.values()];
      rafs.clear();
      for (const f of cbs) { try { f(now); } catch (e) { console.error('[shim] raf', e); } }
      if (k % 8 === 0) await window.__waitImages(3000);
    }
    if (sv) sv.sfx = was;
    await window.__waitImages(5000);
  };

  /** Advance the clock by ms: timers, one frame, and sound up to that point. */
  window.__advance = async ms => {
    const target = now + ms;
    runTimers(target);
    now = target;
    const cbs = [...rafs.values()];
    rafs.clear();
    for (const f of cbs) { try { f(now); } catch (e) { console.error('[shim] raf', e); } }
    syncAnims();
    await stepAudio();
    return now;
  };
  window.__now = () => now;
})();

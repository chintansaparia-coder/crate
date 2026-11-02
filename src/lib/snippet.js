// "Best bit" finder + player.
//
// Spotify retired its audio-analysis endpoint for new apps, so we analyse the
// 30s preview ourselves: decode it, build a loudness envelope, and pick the
// window with the most sustained energy + rhythmic activity. That's usually
// the chorus or drop. It's a heuristic, not magic.

let ctx = null;
export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}
// A tiny silent WAV. Playing it through an <audio> element on the first tap moves
// iOS into "playback" mode so sound works even with the ring/silent switch on.
function silentWav() {
  const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, str) => [...str].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

let unlocked = false;
export async function unlockAudio() {
  const c = audioContext();
  if (!unlocked) {
    unlocked = true;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    try { const el = new Audio(silentWav()); el.setAttribute('playsinline', ''); await el.play(); } catch { /* fine */ }
  }
  if (c.state !== 'running') await c.resume();
}

// Phones suspend audio when you switch apps or lock the screen; wake it on return.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  });
}

const cache = new Map(); // trackId -> Promise<analysis>

export function analyse(track, length = 8) {
  const key = `${track.id}:${length}`;
  if (!cache.has(key)) {
    const p = (async () => {
      const res = await fetch(`/api/audio?url=${encodeURIComponent(track.preview)}`);
      if (!res.ok) throw new Error('preview unavailable');
      const buffer = await audioContext().decodeAudioData(await res.arrayBuffer());
      return { buffer, ...findBestBit(buffer, length) };
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 40) cache.delete(cache.keys().next().value); // keep memory bounded
  }
  return cache.get(key);
}

export function findBestBit(buffer, length) {
  const sr = buffer.sampleRate;
  const hop = Math.floor(sr * 0.05); // 50ms frames
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const frames = Math.floor(buffer.length / hop);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (const ch of chans) for (let i = f * hop; i < (f + 1) * hop; i += 2) sum += ch[i] * ch[i];
    rms[f] = Math.sqrt(sum / (hop / 2) / chans.length);
  }
  // Onset strength = positive change in loudness (drums, vocal entries).
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, rms[f] - rms[f - 1]);

  const win = Math.min(frames, Math.round(length / 0.05));
  const maxR = Math.max(...rms) || 1;
  const maxO = Math.max(...onset) || 1;
  let best = 0, bestScore = -Infinity;
  let sR = 0, sO = 0;
  for (let f = 0; f < win; f++) { sR += rms[f]; sO += onset[f]; }
  for (let s = 0; s + win <= frames; s++) {
    if (s > 0) { sR += rms[s + win - 1] - rms[s - 1]; sO += onset[s + win - 1] - onset[s - 1]; }
    const loud = sR / win / maxR;
    const busy = sO / win / maxO;
    const fadeInPenalty = s < 20 ? 0.15 : 0; // previews often fade in for the first second
    const score = loud + 0.6 * busy - fadeInPenalty;
    if (score > bestScore) { bestScore = score; best = s; }
  }

  // Envelope downsampled for the on-card waveform (64 bars).
  const bars = 64;
  const envelope = Array.from({ length: bars }, (_, i) => {
    const a = Math.floor((i / bars) * frames), b = Math.floor(((i + 1) / bars) * frames);
    let m = 0; for (let f = a; f < b; f++) m = Math.max(m, rms[f]);
    return m / maxR;
  });

  // Rough 0..1 "energy" of the track: loudness × activity. Used to learn your taste.
  const meanR = rms.reduce((s, v) => s + v, 0) / frames;
  const meanO = onset.reduce((s, v) => s + v, 0) / frames;
  const energy = Math.max(0, Math.min(1, (meanR - 0.04) / 0.22 * 0.7 + (meanO / (meanR || 1)) * 4 * 0.3));

  return { start: (best * hop) / sr, length: (win * hop) / sr, total: buffer.duration, envelope, energy };
}

// ---- Player ---------------------------------------------------------------
let current = null; // { source, gain, startedAt, offset, duration, id }
const listeners = new Set();
export const onPlayback = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn(current));

export function stop() {
  if (!current) return;
  const { source, gain } = current;
  const c = audioContext();
  gain.gain.cancelScheduledValues(c.currentTime);
  gain.gain.setTargetAtTime(0, c.currentTime, 0.05);
  setTimeout(() => { try { source.stop(); } catch { /* already stopped */ } }, 200);
  current = null;
  emit();
}

/** Play [offset, offset+duration) of an analysed buffer with smooth fades. */
export function playSegment(id, buffer, offset, duration, volume = 0.9) {
  stop();
  const c = audioContext();
  const source = c.createBufferSource();
  source.buffer = buffer;
  const gain = c.createGain();
  source.connect(gain).connect(c.destination);
  const now = c.currentTime;
  const fade = Math.min(0.6, duration / 5);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + fade);
  gain.gain.setValueAtTime(volume, now + duration - fade);
  gain.gain.linearRampToValueAtTime(0, now + duration);
  source.start(now, offset, duration);
  const me = { source, gain, startedAt: now, offset, duration, id };
  source.onended = () => { if (current === me) { current = null; emit(); } };
  current = me;
  emit();
}

export function playback() {
  if (!current) return null;
  const elapsed = audioContext().currentTime - current.startedAt;
  return { id: current.id, position: current.offset + elapsed, progress: Math.min(1, elapsed / current.duration) };
}

export async function playBestBit(track, length = 8) {
  const a = await analyse(track, length);
  playSegment(track.id, a.buffer, a.start, a.length);
  return a;
}
export async function playFull(track) {
  const a = await analyse(track, 8);
  playSegment(track.id, a.buffer, 0, a.total);
  return a;
}

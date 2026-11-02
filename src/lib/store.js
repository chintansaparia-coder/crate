import { useCallback, useEffect, useState } from 'react';

// Everything is kept per-device in localStorage. Wrapped in try/catch because
// storage can be unavailable (private windows, blocked site data).
const PREFIX = 'crate.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
export function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent('crate-store', { detail: key }));
}

/** useState backed by localStorage, synced across components. */
export function useStored(key, fallback) {
  const [value, setValue] = useState(() => load(key, fallback));
  useEffect(() => {
    const onChange = (e) => { if (e.detail === key) setValue(load(key, fallback)); };
    window.addEventListener('crate-store', onChange);
    return () => window.removeEventListener('crate-store', onChange);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = useCallback((next) => {
    const v = typeof next === 'function' ? next(load(key, fallback)) : next;
    save(key, v);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, update];
}

export const DEFAULT_PROFILE = {
  onboarded: false,
  id: Math.random().toString(36).slice(2, 10),
  name: '',
  emoji: '🎧',
  seedArtists: [],      // [{id, name, picture}] Deezer artists
  genres: [],           // Deezer genre ids
  blockedArtists: [],   // [{id, name}]
  energy: 0.6,          // 0 calm … 1 intense
  mood: 0.5,            // 0 dark/moody … 1 bright/euphoric
  discovery: 0.6,       // 0 familiar … 1 deep cuts
  explicit: true,
  snippetLength: 8,     // seconds of "best bit"
  vibes: [],            // free-form tags e.g. "late night", "gym"
  dealbreakers: '',
};

export const DEFAULT_HISTORY = {
  likes: [],    // [track + {likedAt, energy, super, spotifyUri, synced}]
  nopes: [],    // [{id, artistId, at}]
  seen: [],     // track ids
};

export const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Request failed (${r.status})`);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Request failed (${r.status})`);
    return r.json();
  },
};

/** Taste profile in the shape the server's discovery engine expects. */
export function tasteFor(profile, history) {
  return {
    seedArtists: profile.seedArtists.map((a) => a.id),
    likedArtists: history.likes.slice(0, 40).map((t) => t.artist.id),
    dislikedArtists: history.nopes.slice(0, 80).map((n) => n.artistId),
    blockedArtists: profile.blockedArtists.map((a) => a.id),
    genres: profile.genres,
    discovery: profile.discovery,
    explicit: profile.explicit,
    exclude: history.seen.slice(-600),
  };
}

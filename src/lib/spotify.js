// Spotify Web API via Authorization Code + PKCE (no backend secret needed).
// Uses the post-Feb-2026 endpoints: POST /me/playlists, POST /playlists/{id}/items,
// PUT /me/library, and search limit <= 10.

import { load, save } from './store.js';

const SCOPES = [
  'user-top-read',
  'user-read-private',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-library-modify',
].join(' ');

export const redirectUri = () => `${window.location.origin}/callback`;
// Crate's Spotify app. A Client ID is public (it appears in every login URL), so it's fine in code.
// Everyone logs in with their own Spotify account; this only identifies the app.
export const BUILT_IN_CLIENT_ID = 'b3cc073deff1491cbfc2403eb1144140';
export const getClientId = () => import.meta.env.VITE_SPOTIFY_CLIENT_ID || BUILT_IN_CLIENT_ID || load('spotifyClientId', '');
export const hasBuiltInClientId = () => !!(import.meta.env.VITE_SPOTIFY_CLIENT_ID || BUILT_IN_CLIENT_ID);
export const setClientId = (id) => save('spotifyClientId', id.trim());

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Log in with Spotify in a pop-up so Crate itself never navigates away.
 * The pop-up's /callback page relays the code through our server (see server/authrelay.js),
 * which works even when iOS opens it with separate storage. Resolves once connected.
 * Falls back to a full-page redirect if pop-ups are blocked.
 */
export function login() {
  const clientId = getClientId();
  if (!clientId) return Promise.reject(new Error('Add your Spotify Client ID in Me → Spotify first.'));
  // Must open synchronously inside the tap, before any await, or Safari blocks it.
  const popup = window.open('', 'crate-spotify', 'popup,width=480,height=760');
  return (async () => {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    save('pkce', { verifier, state, mode: popup ? 'popup' : 'redirect', at: Date.now() });
    const url = `https://accounts.spotify.com/authorize?${new URLSearchParams({
      response_type: 'code', client_id: clientId, scope: SCOPES,
      redirect_uri: redirectUri(), code_challenge_method: 'S256', code_challenge: challenge, state,
    })}`;
    if (!popup) { window.location.assign(url); return new Promise(() => {}); }
    popup.location.href = url;

    // Wait for the pop-up to relay the code (up to 10 minutes).
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(`/api/auth/relay/${state}`).catch(() => null);
      if (!res || res.status === 204) continue;
      const { code, error } = await res.json();
      try { popup.close(); } catch { /* iOS may not allow it */ }
      if (error) throw new Error(error === 'access_denied' ? 'Spotify login was cancelled' : `Spotify: ${error}`);
      await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier });
      save('pkce', null);
      save('spotifyUser', null);
      return me().catch(() => null);
    }
    throw new Error('Spotify login timed out. Please try again.');
  })();
}

async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: getClientId(), ...body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || 'Spotify auth failed');
  const prev = load('spotifyToken', {});
  const token = {
    access: json.access_token,
    refresh: json.refresh_token || prev.refresh,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
  save('spotifyToken', token);
  return token;
}

/**
 * Runs on boot. On /callback it either finishes a full-page (redirect) login and
 * returns 'connected', or relays the code to the waiting app and returns 'relayed'
 * (this window is the login pop-up and should just say "go back to Crate").
 */
export async function handleCallback() {
  if (window.location.pathname !== '/callback') return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code'), error = params.get('error'), state = params.get('state');
  window.history.replaceState({}, '', '/');
  const pkce = load('pkce', {});
  if (pkce.mode === 'redirect' && pkce.state === state) {
    if (error) throw new Error(`Spotify: ${error}`);
    await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: pkce.verifier });
    save('pkce', null);
    return 'connected';
  }
  await fetch('/api/auth/relay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, code, error }),
  });
  setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 600);
  return 'relayed';
}

export const isConnected = () => !!load('spotifyToken', null)?.refresh;
export function logout() {
  save('spotifyToken', null);
  save('spotifyUser', null);
}

async function accessToken() {
  let t = load('spotifyToken', null);
  if (!t) throw new Error('Not connected to Spotify');
  if (Date.now() > t.expiresAt) t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
  return t.access;
}

async function api(path, { method = 'GET', body, query } = {}) {
  const url = new URL(`https://api.spotify.com/v1${path}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, (Number(res.headers.get('Retry-After')) || 2) * 1000)); continue; }
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error?.message || `Spotify ${res.status}`);
    return json;
  }
  throw new Error('Spotify rate limit, try again shortly');
}

export async function me() {
  const cached = load('spotifyUser', null);
  if (cached) return cached;
  const u = await api('/me');
  const slim = { id: u.id, name: u.display_name, image: u.images?.[0]?.url };
  save('spotifyUser', slim);
  return slim;
}

export async function topArtists(limit = 20) {
  const r = await api('/me/top/artists', { query: { limit, time_range: 'medium_term' } });
  return (r.items || []).map((a) => ({ name: a.name, genres: a.genres || [] }));
}

/** Find the Spotify URI for a Deezer track: ISRC first (exact), then text search. */
export async function findTrackUri({ isrc, title, artist }) {
  if (isrc) {
    const r = await api('/search', { query: { q: `isrc:${isrc}`, type: 'track', limit: 1 } });
    if (r.tracks?.items?.[0]) return r.tracks.items[0].uri;
  }
  const clean = title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  const r = await api('/search', { query: { q: `track:${clean} artist:${artist}`, type: 'track', limit: 3 } });
  return r.tracks?.items?.[0]?.uri || null;
}

export async function createPlaylist(name, description) {
  const p = await api('/me/playlists', { method: 'POST', body: { name, description, public: false } });
  return { id: p.id, url: p.external_urls?.spotify };
}

/** The main "Crate Likes" playlist, created on first use. */
/** The main "Crate ♥ Swipes" playlist of whoever is logged in, created on first use.
 *  Remembers its owner, so a different Spotify account on this device (or a profile
 *  copied from someone else) gets its own playlist instead of writing into another person's. */
export async function ensureLikesPlaylist() {
  const user = await me();
  const existing = load('spotifyPlaylist', null);
  if (existing && (!existing.owner || existing.owner === user.id)) {
    if (!existing.owner) save('spotifyPlaylist', { ...existing, owner: user.id });
    return existing;
  }
  const p = await createPlaylist('Crate ♥ Swipes', 'Songs I swiped right on in Crate.');
  const saved = { ...p, owner: user.id };
  save('spotifyPlaylist', saved);
  return saved;
}

export async function addToPlaylist(playlistId, uris) {
  for (let i = 0; i < uris.length; i += 100) {
    await api(`/playlists/${playlistId}/items`, { method: 'POST', body: { uris: uris.slice(i, i + 100) } });
  }
}

export async function saveToLibrary(uris) {
  await api('/me/library', { method: 'PUT', query: { uris: uris.join(',') } });
}

export async function removeFromPlaylist(playlistId, uris) {
  await api(`/playlists/${playlistId}/items`, { method: 'DELETE', body: { items: uris.map((uri) => ({ uri })) } });
}

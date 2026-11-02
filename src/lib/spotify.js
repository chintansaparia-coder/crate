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
export const getClientId = () => load('spotifyClientId', '') || import.meta.env.VITE_SPOTIFY_CLIENT_ID || '';
export const setClientId = (id) => save('spotifyClientId', id.trim());

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function login() {
  const clientId = getClientId();
  if (!clientId) throw new Error('Add your Spotify Client ID in Me → Spotify first.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  save('pkce', { verifier, state, at: Date.now() });
  const params = new URLSearchParams({
    response_type: 'code', client_id: clientId, scope: SCOPES,
    redirect_uri: redirectUri(), code_challenge_method: 'S256', code_challenge: challenge, state,
  });
  window.location.assign(`https://accounts.spotify.com/authorize?${params}`);
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

/** Call once on boot. Returns true if we just finished logging in. */
export async function handleCallback() {
  if (window.location.pathname !== '/callback') return false;
  const params = new URLSearchParams(window.location.search);
  const { verifier, state } = load('pkce', {});
  window.history.replaceState({}, '', '/');
  if (params.get('error')) throw new Error(`Spotify: ${params.get('error')}`);
  if (!params.get('code') || params.get('state') !== state) throw new Error('Spotify login state mismatch, please try again.');
  await tokenRequest({ grant_type: 'authorization_code', code: params.get('code'), redirect_uri: redirectUri(), code_verifier: verifier });
  save('pkce', null);
  return true;
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
export async function ensureLikesPlaylist() {
  const existing = load('spotifyPlaylist', null);
  if (existing) return existing;
  const p = await createPlaylist('Crate ♥ Swipes', 'Songs I swiped right on in Crate.');
  save('spotifyPlaylist', p);
  return p;
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

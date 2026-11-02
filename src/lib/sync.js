// Pushes liked tracks to Spotify: Deezer track -> ISRC -> Spotify URI -> playlist.
import { api, load, save } from './store.js';
import * as spotify from './spotify.js';

export async function resolveUri(track) {
  if (track.spotifyUri) return track.spotifyUri;
  let isrc = track.isrc;
  if (!isrc) {
    try { isrc = (await api.get(`/api/track/${track.id}`)).isrc; } catch { /* fall back to text search */ }
  }
  return spotify.findTrackUri({ isrc, title: track.title, artist: track.artist.name });
}

function patchLike(id, patch) {
  const h = load('history', null);
  if (!h) return;
  save('history', { ...h, likes: h.likes.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
}

/** Add one liked track to the Crate playlist (and Liked Songs if super-liked). */
export async function syncLike(track) {
  if (!spotify.isConnected()) return { skipped: true };
  const uri = await resolveUri(track);
  if (!uri) { patchLike(track.id, { syncError: 'Not on Spotify' }); return { notFound: true }; }
  const playlist = await spotify.ensureLikesPlaylist();
  await spotify.addToPlaylist(playlist.id, [uri]);
  if (track.super) await spotify.saveToLibrary([uri]).catch(() => {});
  patchLike(track.id, { spotifyUri: uri, synced: true, syncError: null });
  return { uri, playlist };
}

export async function unsyncLike(track) {
  const playlist = load('spotifyPlaylist', null);
  if (!playlist || !track.spotifyUri || !spotify.isConnected()) return;
  await spotify.removeFromPlaylist(playlist.id, [track.spotifyUri]).catch(() => {});
}

/** Create a fresh playlist from a list of tracks (used for Blend room matches). */
export async function exportPlaylist(name, description, tracks) {
  const uris = [];
  for (const t of tracks) {
    try { const u = await resolveUri(t); if (u) uris.push(u); } catch { /* skip */ }
  }
  const p = await spotify.createPlaylist(name, description);
  if (uris.length) await spotify.addToPlaylist(p.id, uris);
  return { ...p, added: uris.length, missing: tracks.length - uris.length };
}

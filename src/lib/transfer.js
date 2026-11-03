// Move a profile between devices with a one-time code.
// Spotify login tokens are deliberately NOT included: the new device connects to Spotify itself.
import { api, load, save, DEFAULT_PROFILE, DEFAULT_HISTORY } from './store.js';

export async function createTransferCode() {
  return api.post('/api/transfer', {
    profile: load('profile', DEFAULT_PROFILE),
    history: load('history', DEFAULT_HISTORY),
    spotifyClientId: load('spotifyClientId', ''),
    spotifyPlaylist: load('spotifyPlaylist', null), // keep adding to the same playlist
  });
}

export async function importTransfer(code) {
  const data = await api.get(`/api/transfer/${encodeURIComponent(code.trim())}`);
  save('history', { ...DEFAULT_HISTORY, ...data.history });
  if (data.spotifyClientId) save('spotifyClientId', data.spotifyClientId);
  if (data.spotifyPlaylist) save('spotifyPlaylist', data.spotifyPlaylist);
  save('profile', { ...DEFAULT_PROFILE, ...data.profile, onboarded: true });
  return data.profile;
}

export const transferLink = (code) => `${window.location.origin}/?transfer=${code}`;

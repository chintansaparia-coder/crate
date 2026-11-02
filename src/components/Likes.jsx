import { useState } from 'react';
import { useStored, load, DEFAULT_HISTORY, DEFAULT_PROFILE } from '../lib/store.js';
import { playBestBit, stop } from '../lib/snippet.js';
import { syncLike, unsyncLike } from '../lib/sync.js';
import { isConnected } from '../lib/spotify.js';

const spotifyLink = (t) => (t.spotifyUri
  ? `https://open.spotify.com/track/${t.spotifyUri.split(':').pop()}`
  : `https://open.spotify.com/search/${encodeURIComponent(`${t.title} ${t.artist.name}`)}`);

export default function Likes({ toast }) {
  const [history, setHistory] = useStored('history', DEFAULT_HISTORY);
  const [profile, setProfile] = useStored('profile', DEFAULT_PROFILE);
  const [filter, setFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const playlist = load('spotifyPlaylist', null);

  const list = history.likes.filter((t) => filter === 'all' || (filter === 'super' ? t.super : !t.synced));
  const unsynced = history.likes.filter((t) => !t.synced && !t.syncError);

  const remove = (t) => {
    unsyncLike(t);
    setHistory((h) => ({ ...h, likes: h.likes.filter((x) => x.id !== t.id) }));
  };
  const block = (t) => {
    if (profile.blockedArtists.some((a) => a.id === t.artist.id)) return;
    setProfile((p) => ({ ...p, blockedArtists: [...p.blockedArtists, { id: t.artist.id, name: t.artist.name, picture: t.artist.picture }] }));
    toast(`You won't see ${t.artist.name} again`);
  };
  const syncAll = async () => {
    setSyncing(true);
    let ok = 0;
    for (const t of [...unsynced].reverse()) {
      try { const r = await syncLike(t); if (r.uri) ok++; } catch (e) { toast(e.message); break; }
    }
    setSyncing(false);
    toast(`Synced ${ok} song${ok === 1 ? '' : 's'} to Spotify`);
  };

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1>Your likes</h1>
          <p className="muted">{history.likes.length} songs · {history.likes.filter((t) => t.super).length} super-likes</p>
        </div>
        <div className="row">
          {playlist?.url && <a className="btn btn--spotify" href={playlist.url} target="_blank" rel="noreferrer">Open playlist</a>}
          {isConnected() && unsynced.length > 0 && <button className="btn" onClick={syncAll} disabled={syncing}>{syncing ? 'Syncing…' : `Sync ${unsynced.length} to Spotify`}</button>}
        </div>
      </header>

      <div className="dials">
        {[['all', 'All'], ['super', '★ Super'], ['unsynced', 'Not in Spotify yet']].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'chip--on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {list.length === 0 && <p className="empty">Nothing here yet. Go swipe right on something.</p>}
      <ul className="tracks">
        {list.map((t) => (
          <li key={t.id} className="track">
            <button className="track__art" onClick={() => playBestBit(t, profile.snippetLength).catch(() => toast('Preview unavailable'))} aria-label={`Play ${t.title}`}>
              <img src={t.album.cover} alt="" loading="lazy" /><span>▶</span>
            </button>
            <div className="track__meta">
              <strong>{t.super && <span className="star">★ </span>}{t.title}</strong>
              <span className="muted">{t.artist.name}</span>
              <span className="tiny">
                {t.synced ? <span className="ok">✓ In Spotify playlist</span> : t.syncError ? <span className="warn">{t.syncError}</span> : <span className="muted">Saved locally</span>}
              </span>
            </div>
            <div className="track__actions">
              <a className="icon" href={spotifyLink(t)} target="_blank" rel="noreferrer" title="Open in Spotify">↗</a>
              <button className="icon" onClick={() => block(t)} title={`Block ${t.artist.name}`}>⊘</button>
              <button className="icon" onClick={() => { stop(); remove(t); }} title="Remove">✕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

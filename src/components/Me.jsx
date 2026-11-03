import { useState } from 'react';
import { ArtistPicker, GenrePicker, Slider, PersonalityCard, VIBES } from './Pickers.jsx';
import { useStored, DEFAULT_PROFILE, DEFAULT_HISTORY, load } from '../lib/store.js';
import { tasteStats, archetypeFor } from '../lib/personality.js';
import * as spotify from '../lib/spotify.js';
import InstallCard from './InstallCard.jsx';

export default function Me({ toast }) {
  const [profile, setProfile] = useStored('profile', DEFAULT_PROFILE);
  const [history, setHistory] = useStored('history', DEFAULT_HISTORY);
  const [clientId, setClientIdState] = useState(spotify.getClientId());
  const [, force] = useState(0);
  const set = (patch) => setProfile((p) => ({ ...p, ...patch }));
  const stats = tasteStats(profile, history);
  const user = load('spotifyUser', null);

  const share = async () => {
    const a = archetypeFor(profile);
    const text = `${a.emoji} I'm "${a.name}" on Crate.\n${a.blurb}\nInto: ${profile.seedArtists.slice(0, 5).map((x) => x.name).join(', ')}\nTop finds: ${history.likes.slice(0, 3).map((t) => `${t.title} by ${t.artist.name}`).join(' · ')}`;
    try { await navigator.clipboard.writeText(text); toast('Personality card copied, paste it anywhere'); } catch { toast('Copy failed'); }
  };

  return (
    <div className="page">
      <header className="page__head"><h1>Your music personality</h1></header>
      <div className="me-grid">
        <div>
          <PersonalityCard profile={profile} stats={stats} />
          <button className="btn btn--ghost wide" onClick={share}>Share my card</button>
        </div>
        <div className="panel">
          <h3>Taste DNA</h3>
          <div className="stats">
            <div><b>{stats.total}</b><span>swipes</span></div>
            <div><b>{Math.round(stats.likeRate * 100)}%</b><span>like rate</span></div>
            <div><b>{stats.obscurity == null ? '–' : `${Math.round(stats.obscurity * 100)}`}</b><span>obscurity</span></div>
          </div>
          <p>{stats.pickiness}</p>
          {stats.insights.map((i) => <p key={i} className="insight">{i}</p>)}
          {stats.topArtists.length > 0 && (<>
            <h4>Most liked finds</h4>
            <ol className="toplist">{stats.topArtists.map(([n, c]) => <li key={n}>{n} <span className="muted">×{c}</span></li>)}</ol>
          </>)}
        </div>
      </div>

      <section className="panel">
        <h3>Use it on your phone</h3>
        <InstallCard />
      </section>

      <section className="panel">
        <h3>Spotify</h3>
        {spotify.isConnected() ? (
          <div className="row">
            <span>Connected{user?.name ? ` as ${user.name}` : ''} ✓</span>
            <button className="btn btn--ghost" onClick={() => { spotify.logout(); force((n) => n + 1); }}>Disconnect</button>
          </div>
        ) : (
          <>
            <p className="small muted">
              Create an app at developer.spotify.com/dashboard, add this exact Redirect URI, then paste the Client ID here.
              Crate works without Spotify too. Likes are kept here on this device.
            </p>
            <div className="row copyrow">
              <code className="code">{spotify.redirectUri()}</code>
              <button className="btn btn--ghost btn--sm" onClick={() => navigator.clipboard?.writeText(spotify.redirectUri())
                .then(() => toast('Redirect URI copied. Paste it into your Spotify app → Settings → Redirect URIs, then Save'))
                .catch(() => toast('Copy failed. Select the address and copy it manually'))}>Copy</button>
            </div>
            <div className="row">
              <input className="input" value={clientId} onChange={(e) => setClientIdState(e.target.value)} placeholder="Spotify Client ID" aria-label="Spotify Client ID" />
              <button className="btn btn--spotify" onClick={() => { spotify.setClientId(clientId); spotify.login().catch((e) => toast(e.message)); }} disabled={!clientId.trim()}>Connect</button>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h3>Vibe</h3>
        <Slider label="Energy" left="Calm" right="Intense" value={profile.energy} onChange={(energy) => set({ energy })} />
        <Slider label="Mood" left="Moody & dark" right="Bright & euphoric" value={profile.mood} onChange={(mood) => set({ mood })} />
        <Slider label="Discovery" left="Familiar hits" right="Deep cuts" value={profile.discovery} onChange={(discovery) => set({ discovery })} />
        <label className="slider">
          <span className="slider__label">Snippet length: {profile.snippetLength}s</span>
          <input type="range" min="5" max="10" step="1" value={profile.snippetLength} onChange={(e) => set({ snippetLength: Number(e.target.value) })} />
        </label>
        <div className="chips">{VIBES.map((v) => (
          <button key={v} className={`chip ${profile.vibes.includes(v) ? 'chip--on' : ''}`}
            onClick={() => set({ vibes: profile.vibes.includes(v) ? profile.vibes.filter((x) => x !== v) : [...profile.vibes, v] })}>{v}</button>
        ))}</div>
        <label className="toggle"><input type="checkbox" checked={profile.explicit} onChange={(e) => set({ explicit: e.target.checked })} /><span>Allow explicit lyrics</span></label>
      </section>

      <section className="panel">
        <h3>Artists you love</h3>
        {spotify.isConnected() && <p className="small muted">Re-run onboarding (Reset below) to import from Spotify again.</p>}
        <ArtistPicker value={profile.seedArtists} onChange={(seedArtists) => set({ seedArtists })} />
      </section>
      <section className="panel"><h3>Genres</h3><GenrePicker value={profile.genres} onChange={(genres) => set({ genres })} /></section>
      <section className="panel">
        <h3>Never show me</h3>
        <ArtistPicker value={profile.blockedArtists} onChange={(blockedArtists) => set({ blockedArtists })} placeholder="Block an artist…" tone="bad" />
      </section>

      <section className="panel danger">
        <h3>Start over</h3>
        <div className="row">
          <button className="btn btn--ghost" onClick={() => set({ onboarded: false })}>Redo onboarding</button>
          <button className="btn btn--danger" onClick={() => { if (confirm('Clear all likes and swipe history on this device?')) setHistory(DEFAULT_HISTORY); }}>Clear swipe history</button>
        </div>
      </section>
    </div>
  );
}

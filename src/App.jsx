import { useCallback, useEffect, useState } from 'react';
import Onboarding from './components/Onboarding.jsx';
import Discover from './components/Discover.jsx';
import Blend from './components/Blend.jsx';
import Likes from './components/Likes.jsx';
import Me from './components/Me.jsx';
import { useStored, DEFAULT_PROFILE, DEFAULT_HISTORY } from './lib/store.js';
import { audioContext, unlockAudio, stop } from './lib/snippet.js';
import * as spotify from './lib/spotify.js';
import InstallCard from './components/InstallCard.jsx';
import { isMobile, isStandalone } from './lib/install.js';

const TABS = [
  { id: 'discover', label: 'Discover', icon: '🔥' },
  { id: 'blend', label: 'Blend', icon: '💞' },
  { id: 'likes', label: 'Likes', icon: '♥' },
  { id: 'me', label: 'Me', icon: '✦' },
];

export default function App() {
  const [profile] = useStored('profile', DEFAULT_PROFILE);
  const [history] = useStored('history', DEFAULT_HISTORY);
  const [tab, setTab] = useState(() => (new URLSearchParams(location.search).get('room') ? 'blend' : 'discover'));
  const [toasts, setToasts] = useState([]);
  const [needsTap, setNeedsTap] = useState(true);
  const [installDismissed, setInstallDismissed] = useStored('installDismissed', false);

  const toast = useCallback((text) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  useEffect(() => {
    spotify.handleCallback()
      .then(async (done) => {
        if (!done) return;
        const u = await spotify.me().catch(() => null);
        toast(`Connected to Spotify${u?.name ? ` as ${u.name}` : ''} 🎉`);
      })
      .catch((e) => toast(e.message));
  }, [toast]);

  useEffect(() => { stop(); }, [tab]);

  // Browsers block audio until the first tap; show a one-time gate.
  useEffect(() => { if (audioContext().state === 'running') setNeedsTap(false); }, []);
  const start = async () => { await unlockAudio().catch(() => {}); setNeedsTap(false); };

  if (!profile.onboarded) {
    return <div className="app"><Onboarding toast={toast} /><Toasts toasts={toasts} /></div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand__logo">◉</span> crate</div>
        <nav className="tabs" aria-label="Main">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'tab--on' : ''}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
              <span className="tab__icon">{t.icon}</span><span className="tab__label">{t.label}</span>
              {t.id === 'likes' && history.likes.length > 0 && <span className="badge">{history.likes.length}</span>}
            </button>
          ))}
        </nav>
        <div className="topbar__right">
          {spotify.isConnected() ? <span className="spot spot--on" title="Spotify connected">● Spotify</span>
            : <button className="spot" onClick={() => setTab('me')}>Connect Spotify</button>}
        </div>
      </header>

      <main className="main">
        {!installDismissed && isMobile() && !isStandalone() && tab === 'likes' && <InstallCard compact onDismiss={() => setInstallDismissed(true)} />}
        {needsTap && tab !== 'me' && tab !== 'likes' ? (
          <div className="gate">
            <div className="gate__emoji">{profile.emoji}</div>
            <h2>Ready, {profile.name}?</h2>
            <p className="muted">Turn your sound up.</p>
            <button className="btn btn--big" onClick={start}>Tap to start listening</button>
          </div>
        ) : (
          <>
            {tab === 'discover' && <Discover toast={toast} />}
            {tab === 'blend' && <Blend toast={toast} />}
            {tab === 'likes' && <Likes toast={toast} />}
            {tab === 'me' && <Me toast={toast} />}
          </>
        )}
      </main>
      <Toasts toasts={toasts} />
    </div>
  );
}

function Toasts({ toasts }) {
  return <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>;
}

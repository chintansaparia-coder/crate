import { useInstall } from '../lib/install.js';

export default function InstallCard({ onDismiss, compact = false }) {
  const { installed, canPrompt, ios, prompt } = useInstall();
  if (installed) return compact ? null : <p className="small muted">✓ Crate is installed on this device.</p>;
  if (!canPrompt && !ios && compact) return null;
  return (
    <div className={`install ${compact ? 'install--compact' : ''}`}>
      <img src="/apple-touch-icon.png" alt="" />
      <div className="install__text">
        <strong>Put Crate on your home screen</strong>
        {canPrompt ? <span>Opens full-screen, like a normal app.</span>
          : ios ? <span>In Safari, tap <b>Share</b> <ShareIcon /> then <b>Add to Home Screen</b>.</span>
            : <span>Open this page on your phone, then use your browser's menu → <b>Install app</b> / <b>Add to Home screen</b>.</span>}
      </div>
      {canPrompt && <button className="btn btn--sm" onClick={prompt}>Install</button>}
      {onDismiss && <button className="install__x" onClick={onDismiss} aria-label="Dismiss">×</button>}
    </div>
  );
}

const ShareIcon = () => (
  <svg width="14" height="16" viewBox="0 0 14 18" aria-label="Share icon" style={{ verticalAlign: '-2px' }}>
    <path d="M7 1v11M3.5 4.5 7 1l3.5 3.5M2 8H1v9h12V8h-1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

import { useEffect, useState } from 'react';
import { createTransferCode, importTransfer, transferLink } from '../lib/transfer.js';

/** "Send" side: shown in Me on the device that has the profile. */
export function TransferSend({ toast }) {
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!t) return;
    const tick = () => setLeft(Math.max(0, Math.round((t.expiresAt - Date.now()) / 60000)));
    tick();
    const i = setInterval(tick, 10000);
    return () => clearInterval(i);
  }, [t]);
  const make = async () => {
    setBusy(true);
    try { setT(await createTransferCode()); } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const copy = () => navigator.clipboard?.writeText(transferLink(t.code)).then(() => toast('Link copied. Open it on your other device')).catch(() => toast('Copy failed'));
  if (!t) return <button className="btn" onClick={make} disabled={busy}>{busy ? 'Creating…' : 'Create a transfer code'}</button>;
  return (
    <div className="transfer">
      <div className="transfer__code" aria-label="Transfer code">{t.code}</div>
      <p className="small muted">On your other device, open Crate and enter this code (Me → "Have a code?", or on the welcome screen). Or send yourself the link below.
        Works once and expires in {left} min.</p>
      <div className="row copyrow"><code className="code">{transferLink(t.code)}</code><button className="btn btn--ghost btn--sm" onClick={copy}>Copy link</button></div>
      <button className="btn btn--ghost btn--sm" onClick={make}>New code</button>
    </div>
  );
}

/** "Receive" side: enter a code. `confirmOverwrite` when this device already has a profile. */
export function TransferReceive({ toast, confirmOverwrite = false, initialCode = '' }) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e?.preventDefault();
    if (!code.trim()) return;
    if (confirmOverwrite && !confirm('Replace the profile and likes on this device with the ones from your other device?')) return;
    setBusy(true);
    try {
      const p = await importTransfer(code);
      toast(`Welcome back${p?.name ? `, ${p.name}` : ''}! Connect Spotify under Me to keep syncing likes.`);
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="row" onSubmit={go}>
      <input className="input code-input code-input--wide" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" maxLength={8} aria-label="Transfer code" />
      <button className="btn btn--ghost" type="submit" disabled={busy || !code.trim()}>{busy ? 'Importing…' : 'Import'}</button>
    </form>
  );
}

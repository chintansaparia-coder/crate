import { useState } from 'react';
import { ArtistPicker, GenrePicker, Slider, VIBES, EMOJIS, PersonalityCard } from './Pickers.jsx';
import { api, useStored, DEFAULT_PROFILE } from '../lib/store.js';
import * as spotify from '../lib/spotify.js';
import { unlockAudio } from '../lib/snippet.js';
import { TransferReceive } from './Transfer.jsx';

const STEPS = ['Hello', 'Artists', 'Genres', 'Vibe', 'Dealbreakers', 'You'];

export default function Onboarding({ toast }) {
  const [profile, setProfile] = useStored('profile', DEFAULT_PROFILE);
  const [step, setStep] = useState(0);
  const [importing, setImporting] = useState(false);
  const set = (patch) => setProfile((p) => ({ ...p, ...patch }));

  const importSpotify = async () => {
    setImporting(true);
    try {
      const top = await spotify.topArtists(20);
      const resolved = await api.post('/api/artists/resolve', { names: top.map((a) => a.name) });
      const ids = new Set(profile.seedArtists.map((a) => a.id));
      set({ seedArtists: [...profile.seedArtists, ...resolved.filter((a) => !ids.has(a.id))].slice(0, 25) });
      toast(`Imported ${resolved.length} of your top Spotify artists`);
    } catch (e) {
      toast(e.message);
    } finally { setImporting(false); }
  };

  const canNext = [
    profile.name.trim().length > 0,
    profile.seedArtists.length >= 1,
    true,
    true,
    true,
    true,
  ][step];

  const finish = async () => {
    await unlockAudio().catch(() => {});
    set({ onboarded: true });
  };

  return (
    <div className="onboard">
      <div className="progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => <i key={s} className={i <= step ? 'on' : ''} />)}
      </div>

      {step === 0 && (
        <section>
          <h1 className="hero">Swipe your way to<br /><em>new favourite songs.</em></h1>
          <p className="lede">Crate plays the best few seconds of a song. Swipe right to keep it, left to skip. Your likes go straight into a Spotify playlist.</p>
          <label className="field">What should we call you?
            <input className="input" value={profile.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" autoFocus maxLength={24} />
          </label>
          <div className="field">Pick an avatar
            <div className="emojis">{EMOJIS.map((e) => (
              <button key={e} className={profile.emoji === e ? 'on' : ''} onClick={() => set({ emoji: e })} aria-pressed={profile.emoji === e}>{e}</button>
            ))}</div>
          </div>
          <details className="already">
            <summary>Already set up Crate on another device?</summary>
            <p className="small muted">On that device go to Me → Move this profile → Create a transfer code, then enter it here.</p>
            <TransferReceive toast={toast} />
          </details>
        </section>
      )}

      {step === 1 && (
        <section>
          <h2>Who do you love?</h2>
          <p className="lede">Pick a few artists you already like. We use them as a starting point and look for similar music you haven't heard.</p>
          {spotify.isConnected()
            ? <button className="btn btn--spotify" onClick={importSpotify} disabled={importing}>{importing ? 'Importing…' : 'Import my top Spotify artists'}</button>
            : <p className="muted small">Tip: connect Spotify in Me later to import your top artists automatically.</p>}
          <ArtistPicker value={profile.seedArtists} onChange={(seedArtists) => set({ seedArtists })} />
        </section>
      )}

      {step === 2 && (
        <section>
          <h2>Genres you're into</h2>
          <p className="lede">Optional. These widen the net beyond your artists.</p>
          <GenrePicker value={profile.genres} onChange={(genres) => set({ genres })} />
        </section>
      )}

      {step === 3 && (
        <section>
          <h2>Set your vibe</h2>
          <Slider label="Energy" left="Calm" right="Intense" value={profile.energy} onChange={(energy) => set({ energy })} />
          <Slider label="Mood" left="Moody & dark" right="Bright & euphoric" value={profile.mood} onChange={(mood) => set({ mood })} />
          <Slider label="Discovery" left="Familiar hits" right="Deep cuts" value={profile.discovery} onChange={(discovery) => set({ discovery })} />
          <label className="slider">
            <span className="slider__label">Snippet length: {profile.snippetLength}s</span>
            <input type="range" min="5" max="10" step="1" value={profile.snippetLength} onChange={(e) => set({ snippetLength: Number(e.target.value) })} />
          </label>
          <div className="field">When do you listen?
            <div className="chips">{VIBES.map((v) => (
              <button key={v} className={`chip ${profile.vibes.includes(v) ? 'chip--on' : ''}`}
                onClick={() => set({ vibes: profile.vibes.includes(v) ? profile.vibes.filter((x) => x !== v) : [...profile.vibes, v] })}>{v}</button>
            ))}</div>
          </div>
        </section>
      )}

      {step === 4 && (
        <section>
          <h2>Dealbreakers</h2>
          <p className="lede">Artists you never want to see. You can also block artists later from your Likes.</p>
          <ArtistPicker value={profile.blockedArtists} onChange={(blockedArtists) => set({ blockedArtists })} placeholder="Block an artist…" tone="bad" />
          <label className="toggle">
            <input type="checkbox" checked={profile.explicit} onChange={(e) => set({ explicit: e.target.checked })} />
            <span>Allow explicit lyrics</span>
          </label>
        </section>
      )}

      {step === 5 && (
        <section>
          <h2>Your music personality</h2>
          <PersonalityCard profile={profile} />
          <p className="muted small center">This updates as you swipe. Crate learns what you really like.</p>
        </section>
      )}

      <div className="onboard__nav">
        {step > 0 && <button className="btn btn--ghost" onClick={() => setStep(step - 1)}>Back</button>}
        {step < STEPS.length - 1
          ? <button className="btn" disabled={!canNext} onClick={() => setStep(step + 1)}>{step === 2 && !profile.genres.length ? 'Skip' : 'Next'}</button>
          : <button className="btn btn--big" onClick={finish}>Start swiping →</button>}
      </div>
    </div>
  );
}

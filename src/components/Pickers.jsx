import { useEffect, useState } from 'react';
import { api } from '../lib/store.js';
import { archetypeFor } from '../lib/personality.js';

export function ArtistPicker({ value, onChange, placeholder = 'Search artists…', max = 25, tone = 'on' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => api.get(`/api/search/artists?q=${encodeURIComponent(q)}`).then(setResults).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  const has = (id) => value.some((a) => a.id === id);
  const add = (a) => { if (!has(a.id) && value.length < max) onChange([...value, { id: a.id, name: a.name, picture: a.picture }]); setQ(''); };
  return (
    <div className="picker">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {results.length > 0 && (
        <ul className="results">
          {results.map((a) => (
            <li key={a.id}><button onClick={() => add(a)} disabled={has(a.id)}>
              <img src={a.picture} alt="" /><span>{a.name}</span><small>{a.fans ? `${Intl.NumberFormat('en', { notation: 'compact' }).format(a.fans)} fans` : ''}</small>
            </button></li>
          ))}
        </ul>
      )}
      <div className="chips">
        {value.map((a) => (
          <span key={a.id} className={`chip chip--${tone} chip--artist`}>
            {a.picture && <img src={a.picture} alt="" />}{a.name}
            <button onClick={() => onChange(value.filter((x) => x.id !== a.id))} aria-label={`Remove ${a.name}`}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

export function GenrePicker({ value, onChange }) {
  const [genres, setGenres] = useState([]);
  useEffect(() => { api.get('/api/genres').then(setGenres).catch(() => {}); }, []);
  const toggle = (id) => onChange(value.includes(id) ? value.filter((g) => g !== id) : [...value, id]);
  return (
    <div className="genres">
      {genres.map((g) => (
        <button key={g.id} className={`genre ${value.includes(g.id) ? 'genre--on' : ''}`} onClick={() => toggle(g.id)}
          style={{ backgroundImage: `linear-gradient(transparent, rgba(0,0,0,.75)), url(${g.picture})` }} aria-pressed={value.includes(g.id)}>
          {g.name}
        </button>
      ))}
    </div>
  );
}

export function Slider({ label, left, right, value, onChange }) {
  return (
    <label className="slider">
      <span className="slider__label">{label}</span>
      <input type="range" min="0" max="1" step="0.01" value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="slider__ends"><span>{left}</span><span>{right}</span></span>
    </label>
  );
}

export const VIBES = ['late night', 'gym', 'focus', 'road trip', 'rainy day', 'party', 'heartbreak', 'sunday morning', 'cooking', 'sunset', 'main character', 'chaos'];
export const EMOJIS = ['🎧', '🦊', '🐸', '👽', '🌈', '🔥', '🌙', '🍄', '🦄', '🐙', '💿', '🪩'];

export function PersonalityCard({ profile, stats }) {
  const a = archetypeFor(profile);
  const bar = (label, v) => (
    <div className="pbar"><span>{label}</span><i><b style={{ width: `${Math.round(v * 100)}%` }} /></i></div>
  );
  return (
    <div className="pcard" style={{ '--c1': a.colors[0], '--c2': a.colors[1] }}>
      <div className="pcard__emoji">{a.emoji}</div>
      <p className="pcard__kicker">{profile.emoji} {profile.name ? `${profile.name}, you're…` : "You're…"}</p>
      <h2 className="pcard__name">{a.name}</h2>
      <p className="pcard__blurb">{a.blurb}</p>
      {bar('Energy', profile.energy)}
      {bar('Brightness', profile.mood)}
      {bar('Adventure', profile.discovery)}
      {stats?.learnedEnergy != null && bar('Energy you actually like', stats.learnedEnergy)}
      {profile.vibes.length > 0 && <div className="chips">{profile.vibes.map((v) => <span key={v} className="chip chip--glass">{v}</span>)}</div>}
      {profile.seedArtists.length > 0 && <p className="pcard__artists">Into {profile.seedArtists.slice(0, 4).map((x) => x.name).join(', ')}{profile.seedArtists.length > 4 ? ' & more' : ''}</p>}
    </div>
  );
}

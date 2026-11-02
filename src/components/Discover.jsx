import { useCallback, useEffect, useRef, useState } from 'react';
import SwipeCard from './SwipeCard.jsx';
import { api, tasteFor, useStored, DEFAULT_PROFILE, DEFAULT_HISTORY } from '../lib/store.js';
import { analyse, stop, playBestBit } from '../lib/snippet.js';
import { syncLike, unsyncLike } from '../lib/sync.js';
import { isConnected } from '../lib/spotify.js';

const DIALS = [
  { label: 'Comfort zone', value: 0.15 },
  { label: 'Balanced', value: 0.55 },
  { label: 'Deep cuts', value: 0.9 },
];

export default function Discover({ toast }) {
  const [profile, setProfile] = useStored('profile', DEFAULT_PROFILE);
  const [history, setHistory] = useStored('history', DEFAULT_HISTORY);
  const [deck, setDeck] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exit, setExit] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const energies = useRef({});
  const busy = useRef(false);

  const loadMore = useCallback(async (replace = false, overrides = {}) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const taste = { ...tasteFor(profile, history), ...overrides };
      const inDeck = replace ? [] : deck.map((t) => t.id);
      const more = await api.post('/api/deck', { ...taste, exclude: [...taste.exclude, ...inDeck] });
      setDeck((d) => {
        const base = replace ? d.slice(0, 1) : d; // keep the card you're on
        const ids = new Set(base.map((t) => t.id));
        return [...base, ...more.filter((t) => !ids.has(t.id))];
      });
      if (!more.length) setError('Ran out of fresh music for this profile. Try adding more artists or genres in Me.');
    } catch (e) {
      setError(e.message);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [profile, history, deck]);

  useEffect(() => { if (deck.length < 5 && !loading && !error) loadMore(); }, [deck.length, loading, error]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preload & analyse the next two cards so swipes feel instant.
  useEffect(() => {
    deck.slice(1, 3).forEach((t) => analyse(t, profile.snippetLength).catch(() => {}));
  }, [deck, profile.snippetLength]);

  const swipe = useCallback((dir) => {
    const top = deck[0];
    if (!top || exit) return;
    stop();
    setExit({ id: top.id, dir });
    setTimeout(() => {
      setExit(null);
      setDeck((d) => d.slice(1));
      setUndoStack((s) => [{ track: top, dir }, ...s].slice(0, 20));
      const energy = energies.current[top.id];
      setHistory((h) => {
        const seen = [...h.seen, top.id].slice(-2000);
        if (dir === 'nope') return { ...h, seen, nopes: [{ id: top.id, artistId: top.artist.id, at: Date.now() }, ...h.nopes].slice(0, 500) };
        return { ...h, seen, likes: [{ ...top, likedAt: Date.now(), super: dir === 'super', energy }, ...h.likes.filter((t) => t.id !== top.id)] };
      });
      if (dir !== 'nope') {
        if (isConnected()) {
          syncLike({ ...top, super: dir === 'super' })
            .then((r) => toast(r.notFound ? `Couldn't find "${top.title}" on Spotify. Saved in Likes.` : `${dir === 'super' ? '⭐ Saved to Liked Songs and' : '♥ Added to'} your Crate playlist`))
            .catch((e) => toast(`Spotify: ${e.message}`));
        } else if (dir === 'super') toast('⭐ Super-liked!');
      }
    }, 280);
  }, [deck, exit, setHistory, toast]);

  const undo = useCallback(() => {
    const [last, ...rest] = undoStack;
    if (!last || exit) return;
    stop();
    setUndoStack(rest);
    setDeck((d) => [last.track, ...d]);
    setHistory((h) => {
      const liked = h.likes.find((t) => t.id === last.track.id);
      if (liked) unsyncLike(liked);
      return {
        ...h,
        seen: h.seen.filter((id) => id !== last.track.id),
        likes: h.likes.filter((t) => t.id !== last.track.id),
        nopes: h.nopes.filter((n) => n.id !== last.track.id),
      };
    });
  }, [undoStack, exit, setHistory]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowRight') swipe('like');
      else if (e.key === 'ArrowLeft') swipe('nope');
      else if (e.key === 'ArrowUp') { e.preventDefault(); swipe('super'); }
      else if (e.key === 'Backspace' || e.key === 'z') undo();
      else if (e.key === ' ' && deck[0]) { e.preventDefault(); playBestBit(deck[0], profile.snippetLength); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [swipe, undo, deck, profile.snippetLength]);

  const setDial = (value) => {
    setProfile((p) => ({ ...p, discovery: value }));
    setError(null);
    loadMore(true, { discovery: value });
  };

  const visible = deck.slice(0, 3);

  return (
    <div className="discover">
      <div className="dials" role="radiogroup" aria-label="Discovery level">
        {DIALS.map((d) => (
          <button key={d.label} role="radio" aria-checked={Math.abs(profile.discovery - d.value) < 0.2}
            className={`chip ${Math.abs(profile.discovery - d.value) < 0.2 ? 'chip--on' : ''}`} onClick={() => setDial(d.value)}>
            {d.label}
          </button>
        ))}
      </div>

      <div className="stack">
        {visible.length === 0 && (
          <div className="stack__empty">
            {loading ? <><div className="spinner" /><p>Digging through the crates…</p></> : (
              <><p>{error || 'No cards right now.'}</p><button className="btn" onClick={() => { setError(null); loadMore(); }}>Try again</button></>
            )}
          </div>
        )}
        {visible.map((t, i) => (
          <SwipeCard
            key={t.id}
            track={t}
            depth={i}
            active={i === 0}
            exitDir={exit?.id === t.id ? exit.dir : null}
            snippetLength={profile.snippetLength}
            onSwipe={swipe}
            onAnalysed={(tr, a) => { energies.current[tr.id] = a.energy; }}
          />
        )).reverse()}
      </div>

      <div className="actions">
        <button className="action action--undo" onClick={undo} disabled={!undoStack.length} aria-label="Undo" title="Undo (Z)">↺</button>
        <button className="action action--nope" onClick={() => swipe('nope')} aria-label="Nope" title="Nope (←)">✕</button>
        <button className="action action--super" onClick={() => swipe('super')} aria-label="Super like" title="Super like (↑)">★</button>
        <button className="action action--like" onClick={() => swipe('like')} aria-label="Like" title="Like (→)">♥</button>
      </div>
      <p className="hint">Drag the card or use ← → ↑ · Space replays · Z undoes</p>
    </div>
  );
}

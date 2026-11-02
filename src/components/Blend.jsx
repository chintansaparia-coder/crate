import { useEffect, useRef, useState } from 'react';
import SwipeCard from './SwipeCard.jsx';
import { api, useStored, DEFAULT_PROFILE, DEFAULT_HISTORY, tasteFor } from '../lib/store.js';
import { compatibility } from '../lib/personality.js';
import { exportPlaylist } from '../lib/sync.js';
import { isConnected } from '../lib/spotify.js';
import { stop, playBestBit } from '../lib/snippet.js';
import { buzz } from '../lib/install.js';

const REACTIONS = ['🔥', '😍', '💀', '🕺', '😴', '🤯'];

function useRoom(code, profile, history) {
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);
  const [events, setEvents] = useState([]);
  const ws = useRef(null);

  useEffect(() => {
    if (!code) return;
    let closed = false, retry = 0, timer;
    const connect = () => {
      const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.current = sock;
      sock.onopen = () => {
        retry = 0;
        const taste = tasteFor(profile, history);
        sock.send(JSON.stringify({
          t: 'join', code,
          member: { id: profile.id, name: profile.name, emoji: profile.emoji },
          taste: { ...taste, exclude: undefined, energy: profile.energy, mood: profile.mood },
        }));
      };
      sock.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === 'state') { setRoom(msg.room); setError(null); }
        else if (msg.t === 'error') { setError(msg.error); closed = true; sock.close(); }
        else setEvents((ev) => [...ev.slice(-20), { ...msg, key: Math.random() }]);
      };
      sock.onclose = () => { if (!closed) timer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++)); };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); };
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (msg) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(msg));
  return { room, error, events, send };
}

export default function Blend({ toast }) {
  const [profile] = useStored('profile', DEFAULT_PROFILE);
  const [history] = useStored('history', DEFAULT_HISTORY);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() || '');
  const [joinInput, setJoinInput] = useState('');
  const { room, error, events, send } = useRoom(code, profile, history);

  useEffect(() => {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code); else url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    try { setCode((await api.post('/api/rooms', {})).code); } catch (e) { toast(e.message); }
  };
  const leave = () => { stop(); setCode(''); };

  if (!code || error) {
    return (
      <div className="page blend-intro">
        <h1>Blend Rooms</h1>
        <p className="lede">Swipe with friends in real time. Everyone hears the same song at the same moment.
          If everybody swipes right, it's a <b>match</b> and goes into a shared playlist. The deck mixes all your tastes together.</p>
        {error && <p className="warn">{error}</p>}
        <div className="blend-actions">
          <button className="btn btn--big" onClick={create}>Start a room</button>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (joinInput.trim()) setCode(joinInput.trim().toUpperCase()); }}>
            <input className="input code-input" value={joinInput} onChange={(e) => setJoinInput(e.target.value.toUpperCase())} maxLength={4} placeholder="CODE" aria-label="Room code" />
            <button className="btn btn--ghost" type="submit">Join</button>
          </form>
        </div>
        <ul className="howto">
          <li>🎲 <b>Taste blend</b>: the deck mixes everyone's favourite artists</li>
          <li>🫣 <b>Blind votes</b>: you only see how others voted once everyone has voted</li>
          <li>💞 <b>Matches</b>: export them as a shared Spotify playlist</li>
          <li>🔥 <b>Live reactions</b>: react to every drop</li>
        </ul>
      </div>
    );
  }

  return <Room code={code} room={room} events={events} send={send} profile={profile} leave={leave} toast={toast} />;
}

function Room({ code, room, events, send, profile, leave, toast }) {
  const [exporting, setExporting] = useState(false);
  const [floaters, setFloaters] = useState([]);
  const lastEvent = useRef(null);

  useEffect(() => {
    const ev = events[events.length - 1];
    if (!ev || ev.key === lastEvent.current) return;
    lastEvent.current = ev.key;
    if (ev.t === 'react') {
      const f = { id: ev.key, emoji: ev.emoji, left: 10 + Math.random() * 80 };
      setFloaters((x) => [...x, f]);
      setTimeout(() => setFloaters((x) => x.filter((y) => y.id !== f.id)), 2200);
    } else if (ev.t === 'match') {
      buzz([30, 60, 30, 60, 30]);
      toast(`💞 It's a match! "${ev.track.title}"`);
    }
  }, [events, toast]);

  if (!room) return <div className="page center"><div className="spinner" /><p>Joining {code}…</p></div>;

  const me = room.members.find((m) => m.id === profile.id);
  const online = room.members.filter((m) => m.online);
  const myVote = room.votes[profile.id];
  const allVoted = online.length > 0 && online.every((m) => room.votes[m.id]);
  const isHost = room.hostId === profile.id;
  const shareUrl = `${location.origin}/?room=${code}`;

  const vote = (v) => { if (!room.current || myVote) return; stop(); buzz(12); send({ t: 'vote', trackId: room.current.id, vote: v }); };

  const doExport = async () => {
    setExporting(true);
    try {
      const r = await exportPlaylist(`Crate Blend · ${room.members.map((m) => m.name).join(' + ')}`, `Songs everyone swiped right on in Blend room ${code}.`, room.matches);
      toast(`Playlist created with ${r.added} songs${r.missing ? ` (${r.missing} not on Spotify)` : ''}`);
      if (r.url) window.open(r.url, '_blank');
    } catch (e) { toast(e.message); } finally { setExporting(false); }
  };

  return (
    <div className="room">
      <div className="room__head">
        <div>
          <span className="muted small">Room</span>
          <button className="room__code" onClick={() => navigator.clipboard?.writeText(shareUrl).then(() => toast('Invite link copied'))} title="Copy invite link">{code} ⧉</button>
        </div>
        <div className="members">
          {room.members.map((m) => {
            const compat = m.id !== profile.id && m.taste && me?.taste ? compatibility(me.taste, m.taste) : null;
            return (
              <div key={m.id} className={`member ${m.online ? '' : 'member--off'} ${room.votes[m.id] ? 'member--voted' : ''}`} title={m.name}>
                <span className="member__emoji">{m.emoji}</span>
                {allVoted && room.votes[m.id] && <span className={`member__vote v-${room.votes[m.id]}`}>{room.votes[m.id] === 'nope' ? '✕' : room.votes[m.id] === 'super' ? '★' : '♥'}</span>}
                <small>{m.id === profile.id ? 'You' : m.name}{m.id === room.hostId ? ' 👑' : ''}</small>
                {compat != null && <small className="compat">{compat}% match</small>}
              </div>
            );
          })}
        </div>
        <button className="btn btn--ghost" onClick={leave}>Leave</button>
      </div>

      <div className="room__main">
        <div className="room__stage">
          <div className="stack stack--room">
            {floaters.map((f) => <span key={f.id} className="floater" style={{ left: `${f.left}%` }}>{f.emoji}</span>)}
            {room.current ? (
              <SwipeCard key={room.current.id} track={room.current} active snippetLength={profile.snippetLength}
                draggable={!myVote} onSwipe={vote} exitDir={null}>
                <p className="room__status">
                  {allVoted
                    ? (online.every((m) => room.votes[m.id] !== 'nope') ? '💞 Match!' : 'No match this time')
                    : myVote ? `Waiting for ${online.filter((m) => !room.votes[m.id]).map((m) => m.name).join(', ')}…` : `${Object.keys(room.votes).length}/${online.length} voted`}
                </p>
              </SwipeCard>
            ) : (
              <div className="stack__empty"><div className="spinner" /><p>{room.building ? 'Blending everyone\'s taste…' : 'Waiting for the deck…'}</p></div>
            )}
          </div>
          <div className="actions">
            <button className="action action--nope" onClick={() => vote('nope')} disabled={!!myVote} aria-label="Nope">✕</button>
            <button className="action action--super" onClick={() => vote('super')} disabled={!!myVote} aria-label="Super like">★</button>
            <button className="action action--like" onClick={() => vote('like')} disabled={!!myVote} aria-label="Like">♥</button>
          </div>
          <div className="reactions">
            {REACTIONS.map((r) => <button key={r} onClick={() => send({ t: 'react', emoji: r })} aria-label={`React ${r}`}>{r}</button>)}
            {isHost && <button className="pill pill--ghost" onClick={() => send({ t: 'skip' })}>Skip ⏭</button>}
          </div>
          {online.length < 2 && <p className="hint">Send the invite link to a friend: <code>{shareUrl}</code></p>}
        </div>

        <aside className="panel room__matches">
          <div className="row between">
            <h3>Matches ({room.matches.length})</h3>
            {isConnected() && room.matches.length > 0 && <button className="btn btn--spotify btn--sm" onClick={doExport} disabled={exporting}>{exporting ? 'Saving…' : 'Save to Spotify'}</button>}
          </div>
          {room.matches.length === 0 && <p className="muted small">Songs everyone likes land here.</p>}
          <ul className="tracks tracks--compact">
            {room.matches.map((t) => (
              <li key={t.id} className="track">
                <button className="track__art" onClick={() => playBestBit(t, profile.snippetLength)}><img src={t.album.cover} alt="" /><span>▶</span></button>
                <div className="track__meta"><strong>{t.supers > 0 && <span className="star">★ </span>}{t.title}</strong><span className="muted">{t.artist.name}</span></div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

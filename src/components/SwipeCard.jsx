import { useEffect, useRef, useState } from 'react';
import { analyse, playBestBit, playFull, playback, onPlayback, stop } from '../lib/snippet.js';

const THRESHOLD = 110;

export default function SwipeCard({
  track, active, snippetLength = 8, exitDir, onSwipe, onAnalysed, draggable = true, children, depth = 0,
}) {
  const [drag, setDrag] = useState({ x: 0, y: 0, dragging: false });
  const [analysis, setAnalysis] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | playing | idle | error
  const [progress, setProgress] = useState(null);
  const start = useRef(null);

  // Analyse + autoplay the best bit when this card becomes the top card.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    analyse(track, snippetLength).then((a) => {
      if (cancelled) return;
      setAnalysis(a);
      onAnalysed?.(track, a);
      if (active) playBestBit(track, snippetLength).then(() => !cancelled && setStatus('playing'));
      else setStatus('idle');
    }).catch(() => !cancelled && setStatus('error'));
    return () => { cancelled = true; };
  }, [track.id, active, snippetLength]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (active) stop(); }, [active]);

  // Progress bar driven by the audio clock.
  useEffect(() => {
    if (!active) return;
    let raf;
    const tick = () => {
      const p = playback();
      setProgress(p && p.id === track.id ? p : null);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const off = onPlayback((cur) => setStatus(cur?.id === track.id ? 'playing' : (s) => (s === 'loading' ? s : 'idle')));
    return () => { cancelAnimationFrame(raf); off(); };
  }, [active, track.id]);

  const onPointerDown = (e) => {
    if (!active || !draggable || e.target.closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    setDrag({ x: 0, y: 0, dragging: true });
  };
  const onPointerMove = (e) => {
    if (!start.current) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, dragging: true });
  };
  const onPointerUp = () => {
    if (!start.current) return;
    start.current = null;
    const { x, y } = drag;
    if (x > THRESHOLD) onSwipe?.('like');
    else if (x < -THRESHOLD) onSwipe?.('nope');
    else if (y < -THRESHOLD) onSwipe?.('super');
    setDrag({ x: 0, y: 0, dragging: false });
  };

  let transform;
  if (exitDir === 'like') transform = 'translate(150%, -40px) rotate(28deg)';
  else if (exitDir === 'nope') transform = 'translate(-150%, -40px) rotate(-28deg)';
  else if (exitDir === 'super') transform = 'translate(0, -150%) scale(.9)';
  else if (active) transform = `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 18}deg)`;
  else transform = `translateY(${depth * 14}px) scale(${1 - depth * 0.05})`;

  const likeOpacity = exitDir === 'like' ? 1 : Math.max(0, Math.min(1, drag.x / THRESHOLD));
  const nopeOpacity = exitDir === 'nope' ? 1 : Math.max(0, Math.min(1, -drag.x / THRESHOLD));
  const superOpacity = exitDir === 'super' ? 1 : Math.max(0, Math.min(1, -drag.y / THRESHOLD)) * (Math.abs(drag.x) < 60 ? 1 : 0);

  const togglePlay = () => {
    if (status === 'playing') stop();
    else playBestBit(track, snippetLength);
  };

  return (
    <div
      className={`card ${active ? 'card--active' : ''} ${drag.dragging ? 'card--dragging' : ''}`}
      style={{ transform, zIndex: 10 - depth, '--cover': `url(${track.album.cover})` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="card__art" style={{ backgroundImage: `url(${track.album.cover})` }} />
      <div className="card__shade" />
      <div className="stamp stamp--like" style={{ opacity: likeOpacity }}>LIKE</div>
      <div className="stamp stamp--nope" style={{ opacity: nopeOpacity }}>NOPE</div>
      <div className="stamp stamp--super" style={{ opacity: superOpacity }}>SUPER</div>

      <div className="card__body">
        {track.reason && <span className="chip chip--glass">{track.reason}</span>}
        <h2 className="card__title">{track.title}{track.explicit && <span className="explicit">E</span>}</h2>
        <p className="card__artist">{track.artist.name} · <span className="muted">{track.album.title}</span></p>

        <Waveform analysis={analysis} progress={progress} status={status} />

        <div className="card__controls">
          <button className="pill" onClick={togglePlay} disabled={status === 'loading' || status === 'error'}>
            {status === 'loading' ? 'Finding the best bit…' : status === 'error' ? 'No preview' : status === 'playing' ? '❚❚ Pause' : '▶ Best bit'}
          </button>
          <button className="pill pill--ghost" onClick={() => playFull(track)} disabled={!analysis}>Full 30s</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Waveform({ analysis, progress, status }) {
  if (!analysis) {
    return <div className="wave wave--loading">{Array.from({ length: 64 }, (_, i) => <span key={i} style={{ height: `${20 + 30 * Math.abs(Math.sin(i * 0.6))}%` }} />)}</div>;
  }
  const { envelope, start, length, total } = analysis;
  const a = start / total, b = (start + length) / total;
  const head = progress ? progress.position / total : null;
  return (
    <div className="wave" title="Highlighted = the best bit we found">
      {envelope.map((v, i) => {
        const pos = (i + 0.5) / envelope.length;
        const inBest = pos >= a && pos <= b;
        const played = head != null && pos <= head;
        return <span key={i} className={`${inBest ? 'best' : ''} ${played ? 'played' : ''}`} style={{ height: `${8 + v * 92}%` }} />;
      })}
      {status === 'playing' && head != null && <i className="wave__head" style={{ left: `${head * 100}%` }} />}
    </div>
  );
}

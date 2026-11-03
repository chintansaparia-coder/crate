import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { dz, slimTrack, pic } from './deezer.js';
import { buildDeck } from './discovery.js';
import { createRoomCode, handleSocket } from './rooms.js';
import { createTransfer, takeTransfer } from './transfer.js';
import { putAuth, takeAuth } from './authrelay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const isProd = process.env.NODE_ENV === 'production';
// Hosts like Render need 0.0.0.0; locally stay on 127.0.0.1 (Spotify requires that loopback address).
const HOST = process.env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1');

const app = express();
// Profile transfers carry your likes, so they get a bigger body limit than other routes.
app.post('/api/transfer', express.json({ limit: '3mb' }), (req, res) => {
  const { profile, history } = req.body || {};
  if (!profile || !history) return res.status(400).json({ error: 'Nothing to transfer' });
  res.json(createTransfer(req.body));
});
app.get('/api/transfer/:code', (req, res) => {
  const data = takeTransfer(req.params.code);
  if (!data) return res.status(404).json({ error: 'That code is wrong or has expired (codes last 15 minutes and work once).' });
  res.json(data);
});
app.use(express.json({ limit: '200kb' }));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(req.path, e.message);
  res.status(502).json({ error: e.message });
});

app.get('/api/search/artists', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const r = await dz(`/search/artist?q=${encodeURIComponent(q)}&limit=8`);
  res.json((r.data || []).map((a) => ({ id: a.id, name: a.name, picture: pic(a.picture_medium), fans: a.nb_fan })));
}));

// Map artist names (e.g. your Spotify top artists) to Deezer artist IDs.
app.post('/api/artists/resolve', wrap(async (req, res) => {
  const names = (req.body.names || []).slice(0, 20);
  const out = await Promise.all(names.map(async (name) => {
    const r = await dz(`/search/artist?q=${encodeURIComponent(name)}&limit=1`);
    const a = r.data?.[0];
    return a ? { id: a.id, name: a.name, picture: pic(a.picture_medium) } : null;
  }));
  res.json(out.filter(Boolean));
}));

app.get('/api/genres', wrap(async (_req, res) => {
  const r = await dz('/genre');
  res.json((r.data || []).filter((g) => g.id !== 0).map((g) => ({ id: g.id, name: g.name, picture: g.picture_medium })));
}));

app.post('/api/deck', wrap(async (req, res) => {
  res.json(await buildDeck(req.body || {}, Math.min(30, Number(req.body?.size) || 20)));
}));

app.get('/api/track/:id', wrap(async (req, res) => {
  const t = await dz(`/track/${Number(req.params.id)}`);
  res.json({ ...slimTrack(t), isrc: t.isrc, bpm: t.bpm, release: t.release_date });
}));

// Audio proxy so the browser can decode previews (needed to find the best bit).
// Locked to Deezer's preview CDN so it can't be used as an open proxy.
app.get('/api/audio', async (req, res) => {
  try {
    const url = new URL(String(req.query.url));
    if (url.protocol !== 'https:' || !/(^|\.)dzcdn\.net$/.test(url.hostname)) return res.status(400).end();
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(upstream.status).end();
    res.set('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    res.status(502).end();
  }
});

app.post('/api/auth/relay', (req, res) => {
  const { state, code, error } = req.body || {};
  if (!putAuth(state, code, error)) return res.status(400).json({ error: 'bad state' });
  res.json({ ok: true });
});
app.get('/api/auth/relay/:state', (req, res) => {
  const e = takeAuth(req.params.state);
  if (!e) return res.status(204).end(); // not there yet
  res.json(e);
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/rooms', (_req, res) => res.json({ code: createRoomCode() }));

const server = http.createServer(app);
// Only claim /ws upgrades so Vite's live-reload socket can share the server.
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', handleSocket);
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') return;
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

if (isProd) {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist, {
    setHeaders: (res, file) => {
      if (/(sw\.js|manifest\.webmanifest|index\.html)$/.test(file)) res.set('Cache-Control', 'no-cache');
      else if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: path.join(__dirname, '..'),
    server: { middlewareMode: true, hmr: { server, path: '/__vite_hmr' } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

server.listen(PORT, HOST, () => {
  console.log(`\n  🎧 Crate running at http://${HOST}:${PORT}\n`);
});

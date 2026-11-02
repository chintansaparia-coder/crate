// Thin, cached, rate-limited client for the public Deezer API.
// Deezer allows ~50 requests / 5 seconds per IP and has no CORS, so the
// browser talks to it through this server.

const BASE = 'https://api.deezer.com';
const cache = new Map(); // url -> { at, data }
const TTL = 1000 * 60 * 30;

let inFlight = 0;
const queue = [];
const MAX_CONCURRENT = 6;

function schedule(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}
function pump() {
  while (inFlight < MAX_CONCURRENT && queue.length) {
    const { fn, resolve, reject } = queue.shift();
    inFlight++;
    fn().then(resolve, reject).finally(() => { inFlight--; pump(); });
  }
}

export async function dz(path) {
  const url = path.startsWith('http') ? path : BASE + path;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await schedule(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url);
      const json = await res.json();
      // Deezer signals quota errors inside a 200 body
      if (json?.error?.code === 4) { await new Promise(r => setTimeout(r, 1200 * (attempt + 1))); continue; }
      if (json?.error) throw new Error(json.error.message || 'Deezer error');
      return json;
    }
    throw new Error('Deezer rate limited');
  });
  cache.set(url, { at: Date.now(), data });
  return data;
}

// Deezer returns a broken URL (empty hash) for artists without a photo.
export const pic = (url) => (url && !url.includes('/artist//') ? url : null);

export function slimTrack(t, extra = {}) {
  if (!t || !t.preview) return null;
  return {
    id: t.id,
    title: t.title_short || t.title,
    version: t.title_version || '',
    duration: t.duration,
    rank: t.rank || 0,
    explicit: !!t.explicit_lyrics,
    preview: t.preview,
    link: t.link,
    artist: { id: t.artist?.id, name: t.artist?.name, picture: pic(t.artist?.picture_medium) },
    album: {
      id: t.album?.id,
      title: t.album?.title,
      cover: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium,
    },
    ...extra,
  };
}

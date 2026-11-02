import { dz, slimTrack } from './deezer.js';

// Builds a deck of fresh tracks from a taste profile.
//
// profile = {
//   seedArtists: [deezerArtistId],   // from onboarding + Spotify top artists
//   likedArtists: [deezerArtistId],  // learned from right swipes (weighted)
//   genres: [deezerGenreId],
//   blockedArtists: [id], dislikedArtists: [id],
//   discovery: 0..1,  // 0 = familiar hits, 1 = deep cuts / unknowns
//   explicit: bool,
//   exclude: [trackId] // already seen
// }

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function weightedSample(entries, n) {
  // entries: [[key, weight]] -> n distinct keys
  const pool = entries.filter(([, w]) => w > 0).map(([k, w]) => ({ k, w }));
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, e) => s + e.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) { r -= pool[idx].w; if (r <= 0) break; }
    out.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0].k);
  }
  return out;
}

export async function buildDeck(profile, size = 20) {
  const {
    seedArtists = [], likedArtists = [], genres = [],
    blockedArtists = [], dislikedArtists = [],
    discovery = 0.6, explicit = true, exclude = [],
  } = profile;

  const blocked = new Set(blockedArtists.map(Number));
  const seeds = new Set(seedArtists.map(Number));
  const seen = new Set(exclude.map(Number));
  const dislikeCount = {};
  for (const a of dislikedArtists) dislikeCount[a] = (dislikeCount[a] || 0) + 1;

  // 1. Candidate artists, scored by how many of your seeds point at them.
  const score = new Map();
  const bump = (id, w) => {
    if (!id || blocked.has(id)) return;
    score.set(id, (score.get(id) || 0) + w);
  };

  const seedList = shuffle([...seeds]).slice(0, 6);
  const likedList = shuffle([...new Set(likedArtists.map(Number))]).slice(0, 4);

  const relatedFor = async (id, weight) => {
    try {
      const r = await dz(`/artist/${id}/related?limit=25`);
      r.data?.forEach((a, i) => bump(a.id, weight * (1 - i / 40)));
    } catch { /* artist without related list */ }
  };
  await Promise.all([
    ...seedList.map((id) => relatedFor(id, 1)),
    ...likedList.map((id) => relatedFor(id, 1.4)), // things you swiped right on count more
    ...shuffle([...genres]).slice(0, 3).map(async (g) => {
      try {
        const r = await dz(`/genre/${g}/artists`);
        shuffle(r.data || []).slice(0, 15).forEach((a) => bump(a.id, 0.7));
      } catch { /* ignore */ }
    }),
  ]);

  // Seed artists themselves: rarely shown when discovery is high.
  for (const id of seeds) bump(id, (1 - discovery) * 0.8);

  // Dislikes push artists down; repeated dislikes knock them out.
  for (const [id, n] of Object.entries(dislikeCount)) {
    const k = Number(id);
    if (score.has(k)) score.set(k, score.get(k) * Math.pow(0.35, n));
  }

  if (score.size === 0) {
    // Cold start: global chart artists
    const chart = await dz('/chart/0/artists?limit=50');
    chart.data?.forEach((a) => bump(a.id, 1));
  }

  // Discovery flattens the weighting so long-tail artists get picked too.
  const flatten = 1 - discovery * 0.7;
  const entries = [...score.entries()].map(([k, w]) => [k, Math.pow(w, flatten)]);
  const picked = weightedSample(entries, Math.min(14, Math.ceil(size / 1.5)));

  // 2. Tracks from picked artists.
  const perArtist = await Promise.all(picked.map(async (id) => {
    try {
      const r = await dz(`/artist/${id}/top?limit=25`);
      return (r.data || []).map((t) => slimTrack(t)).filter(Boolean);
    } catch { return []; }
  }));

  const deck = [];
  for (const tracks of perArtist) {
    let pool = tracks.filter((t) => !seen.has(t.id) && (explicit || !t.explicit));
    if (!pool.length) continue;
    // Sort by popularity; discovery chooses where in the list we dig.
    pool.sort((a, b) => b.rank - a.rank);
    const center = Math.floor(discovery * (pool.length - 1));
    const window = pool.slice(Math.max(0, center - 3), center + 4);
    shuffle(window).slice(0, 2).forEach((t) => deck.push({
      ...t,
      reason: seeds.has(t.artist.id) ? 'From an artist you love' : 'Because of your taste',
    }));
  }

  // Interleave so the same artist never appears back to back.
  const shuffled = shuffle(deck);
  for (let i = 1; i < shuffled.length; i++) {
    if (shuffled[i].artist.id === shuffled[i - 1].artist.id) {
      const j = shuffled.findIndex((t, k) => k > i && t.artist.id !== shuffled[i].artist.id);
      if (j > 0) [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }
  return shuffled.slice(0, size);
}

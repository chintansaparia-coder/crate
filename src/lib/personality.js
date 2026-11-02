// Music personality: 8 archetypes from three axes you set yourself
// (energy, mood, discovery), refined by what you actually swipe right on.

const ARCHETYPES = {
  // key: E(nergy) hi/lo · M(ood) bright/dark · D(iscovery) explorer/loyal
  'hi-bright-explore': { name: 'The Festival Scout', emoji: '🎪', blurb: 'First in line for the side stage. You hunt big, joyful sounds before anyone else hears them.', colors: ['#ff6b6b', '#ffd93d'] },
  'hi-bright-loyal':   { name: 'The Main Character', emoji: '🌟', blurb: 'Every song is your entrance music. You know what you love and you play it loud.', colors: ['#ff8fab', '#ffc6ff'] },
  'hi-dark-explore':   { name: 'The Night Driver', emoji: '🌃', blurb: 'Heavy bass, neon, 2am. You go looking for the darker, harder edges.', colors: ['#7b2ff7', '#f107a3'] },
  'hi-dark-loyal':     { name: 'The Mosh Pit Poet', emoji: '⚡', blurb: 'Intensity is the point. Loyal to the bands that hit hardest.', colors: ['#e63946', '#3a0ca3'] },
  'lo-bright-explore': { name: 'The Sunday Digger', emoji: '☀️', blurb: 'Warm, curious and unhurried. Your record bag is full of gentle surprises.', colors: ['#f9c74f', '#90be6d'] },
  'lo-bright-loyal':   { name: 'The Cozy Classicist', emoji: '☕', blurb: 'Comfort listening done right. Timeless songs, soft light, good company.', colors: ['#ffb4a2', '#e5989b'] },
  'lo-dark-explore':   { name: 'The Midnight Archivist', emoji: '🕯️', blurb: 'Lo-fi, ambient, slow-burning. You find the beautiful sad songs nobody else knows.', colors: ['#4361ee', '#4cc9f0'] },
  'lo-dark-loyal':     { name: 'The Rainy Window', emoji: '🌧️', blurb: 'Melancholy is your comfort zone, and you return to the songs that understand you.', colors: ['#577590', '#43aa8b'] },
};

export function archetypeFor({ energy, mood, discovery }) {
  const key = `${energy >= 0.5 ? 'hi' : 'lo'}-${mood >= 0.5 ? 'bright' : 'dark'}-${discovery >= 0.5 ? 'explore' : 'loyal'}`;
  return { key, ...ARCHETYPES[key] };
}

export function tasteStats(profile, history) {
  const likes = history.likes;
  const total = likes.length + history.nopes.length;
  const likeRate = total ? likes.length / total : 0;

  const withEnergy = likes.filter((t) => typeof t.energy === 'number');
  const learnedEnergy = withEnergy.length >= 5
    ? withEnergy.reduce((s, t) => s + t.energy, 0) / withEnergy.length
    : null;

  const counts = {};
  for (const t of likes) counts[t.artist.name] = (counts[t.artist.name] || 0) + 1;
  const topArtists = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const avgRank = likes.length ? likes.reduce((s, t) => s + (t.rank || 0), 0) / likes.length : 0;
  // Deezer rank ~0..1M. Lower average rank means you like less mainstream picks.
  const obscurity = likes.length ? Math.max(0, Math.min(1, 1 - avgRank / 900000)) : null;

  let pickiness = 'Still getting to know you';
  if (total >= 10) {
    if (likeRate > 0.6) pickiness = 'Open-hearted: you like most of what you hear';
    else if (likeRate > 0.3) pickiness = 'Balanced: discerning but curious';
    else pickiness = 'Ruthless curator: only the best survive';
  }

  const insights = [];
  if (learnedEnergy != null && Math.abs(learnedEnergy - profile.energy) > 0.2) {
    insights.push(learnedEnergy > profile.energy
      ? 'You say you like it chill, but you keep swiping right on bangers 🔥'
      : 'You say you like it intense, but your likes are softer than you think 🌙');
  }
  if (obscurity != null && likes.length >= 8 && Math.abs(obscurity - profile.discovery) > 0.3) {
    insights.push(obscurity > profile.discovery
      ? 'You\'re more of a crate-digger than you admit. Try raising Discovery.'
      : 'You gravitate to the hits. Nothing wrong with that!');
  }
  const supers = likes.filter((t) => t.super).length;
  if (supers >= 3) insights.push(`${supers} super-likes. You know what you want.`);

  return { total, likeRate, learnedEnergy, topArtists, obscurity, pickiness, insights };
}

/** Taste overlap between two people (0..100), used for Blend compatibility. */
export function compatibility(a, b) {
  const sa = new Set(a.seedArtists || []), sb = new Set(b.seedArtists || []);
  const ga = new Set(a.genres || []), gb = new Set(b.genres || []);
  const jac = (x, y) => (x.size + y.size === 0 ? 0 : [...x].filter((v) => y.has(v)).length / new Set([...x, ...y]).size);
  const axes = 1 - (Math.abs((a.energy ?? 0.5) - (b.energy ?? 0.5)) + Math.abs((a.mood ?? 0.5) - (b.mood ?? 0.5))) / 2;
  return Math.round((jac(sa, sb) * 0.4 + jac(ga, gb) * 0.3 + axes * 0.3) * 100);
}

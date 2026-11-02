import { buildDeck } from './discovery.js';

// Blend Rooms: friends join with a 4-letter code. The room's deck is built from
// everyone's taste combined. Everyone sees the same card at the same time and
// it moves on once all online members have voted. If everyone likes it, it's a match.

const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function createRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  } while (rooms.has(code));
  rooms.set(code, newRoom(code));
  return code;
}

function newRoom(code) {
  return {
    code, hostId: null, members: new Map(), deck: [], pointer: 0,
    votes: {}, matches: [], building: false, createdAt: Date.now(), advancing: false,
  };
}

function publicState(room) {
  const online = [...room.members.values()].filter((m) => m.online);
  return {
    code: room.code,
    hostId: room.hostId,
    members: [...room.members.values()].map(({ id, name, emoji, online, likes, taste }) => ({
      id, name, emoji, online, likes,
      taste: { seedArtists: taste?.seedArtists || [], genres: taste?.genres || [], energy: taste?.energy, mood: taste?.mood },
    })),
    current: room.deck[room.pointer] || null,
    upNext: room.deck.slice(room.pointer + 1, room.pointer + 3),
    pointer: room.pointer,
    votes: room.votes[room.deck[room.pointer]?.id] || {},
    matches: room.matches,
    building: room.building,
    onlineCount: online.length,
  };
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const m of room.members.values()) if (m.online && m.ws.readyState === 1) m.ws.send(data);
}
const sync = (room) => broadcast(room, { t: 'state', room: publicState(room) });

function blendProfile(room) {
  const ms = [...room.members.values()];
  const all = (k) => ms.flatMap((m) => m.taste?.[k] || []);
  const discovery = ms.reduce((s, m) => s + (m.taste?.discovery ?? 0.6), 0) / Math.max(1, ms.length);
  return {
    seedArtists: [...new Set(all('seedArtists'))],
    likedArtists: room.matches.map((t) => t.artist.id),
    genres: [...new Set(all('genres'))],
    blockedArtists: all('blockedArtists'),
    discovery,
    explicit: ms.every((m) => m.taste?.explicit !== false),
    exclude: room.deck.map((t) => t.id),
  };
}

async function topUp(room) {
  if (room.building || room.deck.length - room.pointer > 4) return;
  room.building = true;
  sync(room);
  try {
    const more = await buildDeck(blendProfile(room), 15);
    room.deck.push(...more);
  } catch (e) {
    console.error('room deck build failed', e.message);
  } finally {
    room.building = false;
    sync(room);
  }
}

function maybeAdvance(room) {
  const track = room.deck[room.pointer];
  if (!track || room.advancing) return;
  const votes = room.votes[track.id] || {};
  const online = [...room.members.values()].filter((m) => m.online);
  if (!online.length || !online.every((m) => votes[m.id])) return;

  const allLike = online.length > 0 && online.every((m) => votes[m.id] !== 'nope');
  if (allLike && !room.matches.find((t) => t.id === track.id)) {
    room.matches.unshift({ ...track, matchedAt: Date.now(), supers: online.filter((m) => votes[m.id] === 'super').length });
    broadcast(room, { t: 'match', track });
  }
  room.advancing = true;
  setTimeout(() => { // short pause so everyone sees how the group voted
    room.advancing = false;
    room.pointer++;
    sync(room);
    topUp(room);
  }, 1600);
}

export function handleSocket(ws) {
  let room = null;
  let memberId = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'join') {
      const code = String(msg.code || '').toUpperCase();
      if (!rooms.has(code)) return ws.send(JSON.stringify({ t: 'error', error: `Room ${code} doesn't exist (yet). Check the code?` }));
      room = rooms.get(code);
      memberId = String(msg.member?.id || Math.random());
      const prev = room.members.get(memberId);
      room.members.set(memberId, {
        id: memberId,
        name: String(msg.member?.name || 'Anon').slice(0, 24),
        emoji: String(msg.member?.emoji || '🎧').slice(0, 4),
        taste: msg.taste || {},
        likes: prev?.likes || 0,
        online: true,
        ws,
      });
      if (!room.hostId) room.hostId = memberId;
      sync(room);
      topUp(room);
      return;
    }
    if (!room) return;
    const me = room.members.get(memberId);

    if (msg.t === 'vote') {
      const track = room.deck[room.pointer];
      if (!track || track.id !== msg.trackId) return;
      room.votes[track.id] = { ...(room.votes[track.id] || {}), [memberId]: msg.vote };
      if (msg.vote !== 'nope' && me) me.likes++;
      sync(room);
      maybeAdvance(room);
    } else if (msg.t === 'react') {
      broadcast(room, { t: 'react', from: me?.emoji || '🎧', name: me?.name, emoji: String(msg.emoji).slice(0, 4) });
    } else if (msg.t === 'skip' && memberId === room.hostId) {
      room.pointer++;
      sync(room);
      topUp(room);
    }
  });

  ws.on('close', () => {
    if (!room) return;
    const m = room.members.get(memberId);
    if (m) m.online = false;
    if (room.hostId === memberId) {
      const next = [...room.members.values()].find((x) => x.online);
      room.hostId = next?.id || null;
    }
    sync(room);
    maybeAdvance(room); // someone leaving may complete a vote
  });
}

// Clean up rooms that have been empty for a while.
setInterval(() => {
  for (const [code, r] of rooms) {
    const anyOnline = [...r.members.values()].some((m) => m.online);
    if (!anyOnline && Date.now() - r.createdAt > 1000 * 60 * 60 * 6) rooms.delete(code);
  }
}, 1000 * 60 * 10).unref();

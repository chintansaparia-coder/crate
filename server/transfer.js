// One-time codes for moving a profile between devices (laptop → phone).
// Kept in memory for 15 minutes and deleted as soon as they're used.
const transfers = new Map(); // code -> { data, exp }
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TTL = 15 * 60 * 1000;

export function createTransfer(data) {
  let code;
  do code = Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  while (transfers.has(code));
  transfers.set(code, { data, exp: Date.now() + TTL });
  return { code, expiresAt: Date.now() + TTL };
}

export function takeTransfer(code) {
  const key = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const t = transfers.get(key);
  if (!t || t.exp < Date.now()) { transfers.delete(key); return null; }
  transfers.delete(key); // one-time use
  return t.data;
}

setInterval(() => {
  for (const [k, t] of transfers) if (t.exp < Date.now()) transfers.delete(k);
}, 60 * 1000).unref();

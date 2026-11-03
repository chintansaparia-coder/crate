// Spotify login relay.
//
// On iPhone, a home-screen app that sends you to Spotify often comes back in a
// *separate* browser window with its own storage. So the login window can't hand
// the result to the app directly. Instead it drops the one-time authorization
// code here under the random `state`, and the app (which holds the secret PKCE
// verifier needed to use the code) picks it up. The code alone is useless without
// that verifier, and entries expire after 10 minutes and are deleted when read.
const pending = new Map(); // state -> { code, error, exp }
const TTL = 10 * 60 * 1000;

export function putAuth(state, code, error) {
  if (typeof state !== 'string' || state.length < 10 || state.length > 100) return false;
  pending.set(state, { code: code ? String(code).slice(0, 2000) : null, error: error ? String(error).slice(0, 200) : null, exp: Date.now() + TTL });
  return true;
}

export function takeAuth(state) {
  const e = pending.get(state);
  if (!e || e.exp < Date.now()) return null;
  pending.delete(state);
  return e;
}

setInterval(() => {
  for (const [k, e] of pending) if (e.exp < Date.now()) pending.delete(k);
}, 60 * 1000).unref();

# Crate 🎧

Swipe-to-discover music: like Tinder, but for songs. Each card shows the cover art and plays the **best 5–10 seconds** of a track. Swipe right and it goes into your Spotify playlist.

## Features

- **Swipe deck**: drag or use ← → ↑. Like, Nope, ★ Super-like (also saves to Liked Songs) and ↺ Undo (removes the song from the playlist again).
- **Best-bit player**: the 30s preview is decoded in the browser and the loudest, busiest window is picked. That's usually the chorus or the drop. The waveform on the card highlights the window it chose.
- **Spotify sync**: likes go into a "Crate ♥ Swipes" playlist. Tracks are matched by ISRC, which is exact, with a title and artist search as a fallback.
- **Music personality**: onboarding covers artists you love (or an import of your Spotify top artists), genres, energy, mood, discovery level, listening vibes, snippet length, blocked artists and an explicit-lyrics filter. You get one of 8 archetypes.
- **Taste DNA**: like rate, obscurity score, and your most-liked finds. It also compares what you *say* you like with what you actually swipe right on ("you say chill, but you keep liking bangers").
- **Learning**: artists you like boost similar artists. Artists you dislike twice drop out.
- **Discovery dial**: Comfort zone, Balanced or Deep cuts, changed live on the deck.
- **Blend Rooms (collaboration)**: start a room and share the 4-letter code or link. Everyone hears the same song at the same moment. Votes stay hidden until everyone has voted, and if everyone likes a song it's a **match**. The deck blends all members' tastes. You also get live emoji reactions, a taste-compatibility % per friend, and a one-click export of the matches as a shared Spotify playlist.

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Production: `npm run build && npm start`.

Crate works without Spotify. Likes are stored on your device.

## Hosting (GitHub + Render)

The code lives on GitHub. [Render](https://render.com) runs it, using the `render.yaml` blueprint, and **redeploys automatically on every push to `main`**. GitHub Actions (`.github/workflows/ci.yml`) builds the app and smoke-tests it on every push.

One-time setup:
1. Go to render.com and sign in with GitHub. Choose **New → Blueprint**, pick this repo, then **Apply**.
2. Your app will be live at `https://crate-XXXX.onrender.com` (Render shows the exact URL).
3. Spotify: add `https://<your-render-url>/callback` as a Redirect URI in your Spotify app. Then either paste the Client ID in the app (Me → Spotify), or set `VITE_SPOTIFY_CLIENT_ID` in Render → Environment and redeploy.

Free-tier notes: the server sleeps after 15 minutes without traffic, so the first visit after that takes about 30–50s. Blend Rooms are kept in memory and reset when it sleeps or redeploys.

## Connect Spotify

1. Go to https://developer.spotify.com/dashboard and create an app. Choose the **Web API**.
2. Add this Redirect URI: `http://127.0.0.1:5173/callback`. Spotify doesn't accept `localhost`; it must be `127.0.0.1`. For a deployed app, use `https://your-domain/callback`.
3. Copy the Client ID into Crate under **Me → Spotify**, or put it in `.env` as `VITE_SPOTIFY_CLIENT_ID`.

Spotify Development Mode limits (as of 2026): the app owner needs Premium, and **up to 5 users** can log in. Add them under *User Management* in the dashboard. To open it to more people, you'd need to apply for Extended Quota.

## Why Deezer for the audio?

Spotify no longer gives new apps preview clips, recommendations or audio analysis. Crate therefore uses Deezer's free public API for discovery (related artists, top tracks, genre charts) and for the 30-second previews. Spotify is used for what it's still good at: your top artists and saving to playlists. The server proxies Deezer because Deezer doesn't allow browser (CORS) requests. The audio proxy only fetches from Deezer's CDN.

## Architecture

```
server/
  index.js       Express: API routes, audio proxy, WebSocket upgrade, Vite in dev
  deezer.js      cached + rate-limited Deezer client
  discovery.js   builds a deck: seed/liked artists → related artists (scored) → top tracks, filtered by discovery level
  rooms.js       Blend Rooms (in-memory, WebSocket)
src/
  lib/snippet.js       best-bit detection + Web Audio player
  lib/spotify.js       PKCE OAuth + Spotify endpoints (post-Feb-2026 paths)
  lib/sync.js          Deezer track → ISRC → Spotify URI → playlist
  lib/personality.js   archetypes, taste stats, compatibility
  components/          Onboarding, Discover/SwipeCard, Blend, Likes, Me
```

## Ideas for next steps

- Accounts and a database, so profiles, likes and rooms sync across devices. Rooms are in-memory right now and reset when the server restarts.
- Async "Blend decks": friends swipe the same deck at different times, and you see the matches later.
- "Taste battles": guess which of two songs your friend liked.
- A mobile wrapper (Capacitor/PWA) with haptics on swipe.
- Better chorus detection using repetition (chroma self-similarity) on top of loudness.

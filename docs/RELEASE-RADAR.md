# Release Radar

Release Radar sits at the top of **Discover → New releases**. It has two lists:

| List | Needs | Where it comes from |
|---|---|---|
| **Following** | a Hub | Artists you follow. The Hub looks them up on Deezer in the background and keeps their new releases (`hub/src/radar.ts`). |
| **Artists you play** | nothing | Your ~60 most played and starred artists, looked up on Deezer by this device once a day (`src/sources/releaseRadar.ts`). |

Without a Hub (or with a Hub older than Release Radar) only **Artists you play** shows, as before, and the
Follow buttons are hidden.

## For listeners

### Following an artist

- **Follow** on any artist page: your library's artist pages (the Hub finds the artist on Deezer by name) and
  Deezer artist pages under **Downloads → Deezer**.
- **Manage N followed** under the Release Radar heading lists everyone you follow with a × to stop following,
  and a box to follow an artist by name. The name has to match Deezer's (case, accents and "The" don't matter).
- Following is per person and follows you to every device, like your playlists. Kids can follow artists too;
  anything a kid profile mustn't see is hidden from them as everywhere else.

### What shows up

- Albums, EPs, singles and compilations from the artists you follow that came out in the **last 6 weeks**,
  newest first. Each card has a 30-second preview, **Get** (sends it to deemix) or **Request** (asks your Hub
  admin, for people without Autodownload), or **In library** when you already have it.
- The Hub looks each followed artist up about **every 12 hours**. **Refresh** asks it to look up your artists
  now (any looked up in the last 10 minutes are skipped).
- When an artist you follow puts something new out, you get a notification: **New from Daft Punk — Title
  (single)**. In a browser, clicking it opens Release Radar. Releases the Hub finds more than two weeks after
  they came out are listed, but don't notify. Nothing notifies for the releases already out when you follow
  someone.

### Artists you might like

Below the releases, **Artists you might like** suggests who to follow:

- **"You played them N times"**: artists you've played at least 3 times in the last 90 days but don't follow.
- **"Like A and B"**: artists Deezer lists as related to ones you follow (these count double) and to your
  most played artists. An artist related to several of yours ranks higher.

**Follow** adds them straight away; **×** (Not interested) means they're never suggested to you again, unless
you follow them later. Suggestions are worked out again when you follow or unfollow someone, and otherwise
every 6 hours.

## How it works

```
app (Follow)  ──POST /api/radar/follows──▶  Hub: follows table
                                             │  (first look right away, then every 12 h, one artist at a time)
                                             ▼
                                          Deezer /artist/:id/albums  ──▶  radar_releases
                                             │   new release, out < 14 days, followed before the last look
                                             ▼
                                          notifications ("New from …") ──▶ every device (lib/notify.ts)
app (Discover) ──GET /api/radar────────────▶ follows + releases from the last 42 days
app (Discover) ──GET /api/radar/suggestions▶ Deezer /artist/:id/related (cached 7 days) + plays table
```

- **One lookup per artist, not per person.** The Hub keeps when it last looked at each Deezer artist
  (`radar_artists`); ten people following the same artist cost one Deezer call per round.
- **Gentle on Deezer.** Lookups run one at a time, 250 ms apart, at most 300 per 30-minute round. Deezer
  allows 50 requests per 5 seconds. Its rate limit answer (`200 {"error": "Quota limit exceeded"}`) counts as
  a failure: the artist's releases already kept stay, the artist shows as "couldn't be looked up" and is
  tried again next round.
- **Stored in the Hub's database** (migration 16): `follows`, `radar_artists`, `radar_releases` (kept 120
  days, so a release doesn't count as new twice), `radar_hidden` (Not interested). Releases and lookups for
  artists nobody follows any more are dropped. Everything is in the Hub's backups.
- **Kept in memory:** Deezer's related artists and name lookups (7 days), each person's suggestions (6 hours).
  A Hub restart just asks Deezer again.
- **Suggestions use Rewind's `plays` table**, so they need the app to report plays to the Hub (it does when
  signed in). Feature credits are folded in: "Drake feat. Future" counts as Drake.

### Files

| File | What |
|---|---|
| `hub/src/radar.ts` | `ReleaseRadar`: follow/unfollow, background lookups, notifications, suggestions |
| `hub/src/routes/radar.ts` | the API below |
| `hub/test/radar.test.ts` | tests, with a pretend Deezer |
| `src/lib/follows.ts` | the app's follows store (`useFollows`), `follow()`, `unfollow()`, `loadRadar()` |
| `src/components/FollowButton.tsx` | Follow / ✓ Following |
| `src/components/ReleaseRadar.tsx` | the Discover section: both lists, Manage, suggestions |
| `src/sources/releaseRadar.ts` | **Artists you play** (no Hub needed) |

### API

All signed in; everything is the caller's own.

| Route | Does |
|---|---|
| `GET /api/radar` | `{ follows: [{ id, name, picture, followedAt }], releases: [{ id, artistId, artist, title, type, released, cover, link, explicit, foundAt }], windowDays, checkedAt, pending, failed }` |
| `POST /api/radar/follows` | `{ id, name, picture? }` (Deezer artist id) or `{ name }` (the Hub finds an exact match on Deezer; 404 if none) → 201 `{ follow }`. Up to 1000 per person |
| `DELETE /api/radar/follows/:id` | stop following (404 if you weren't) |
| `POST /api/radar/check` | look your artists up now (skips ones looked at in the last 10 minutes) → `{ releases, checkedAt, pending, failed }` |
| `GET /api/radar/suggestions[?fresh=1]` | `{ suggestions: [{ id, name, picture, fans, because: [names], plays? }] }` |
| `POST /api/radar/suggestions/:id/hide` | Not interested |

Notifications from Release Radar have `kind: "radar"`.

## Changing it

- The numbers (6-week window, 12-hour lookups, 14 days for "news", 120 days kept, pacing) are constants at
  the top of `hub/src/radar.ts`.
- `ReleaseRadar` takes `{ now, gapMs }` so tests can move the clock and skip the pauses; see
  `hub/test/radar.test.ts` for faking Deezer with a stub `fetch`.
- Deezer is reached through `fetchAllowed()` (`hub/src/routes/webfetch.ts`), so only `api.deezer.com` is
  ever called.

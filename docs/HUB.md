# Wavelength Hub

The Hub is the small server that gives Wavelength **user accounts, roles and admin-only controls**. It runs
as one Docker container next to Navidrome. The app keeps streaming straight from Navidrome, Plex and the
rest; the Hub only decides *who* is signed in and *what they're allowed to do*. Why it exists and what
comes next: [USERS-AND-ADMIN.md](USERS-AND-ADMIN.md).

> **Status: Phase 1.** Accounts, roles (admin, member, kid), sign-in (Hub password, tinyauth single
> sign-on, device pairing codes), linking tinyauth to a password account, devices, synced settings and the
> audit log work, and the app has Settings → Account and Settings → Users (see the
> [user guide](USER-GUIDE.md#profiles-with-a-wavelength-hub)). Service keys, SUB/WAVE admin through the Hub,
> requests and kids filtering follow in later phases.

- [Install on Unraid](#install-on-unraid)
- [Other Docker hosts](#other-docker-hosts)
- [First admin](#first-admin)
- [Nginx Proxy Manager and tinyauth](#nginx-proxy-manager-and-tinyauth)
- [Settings (environment variables)](#settings-environment-variables)
- [How signing in works](#how-signing-in-works)
- [Roles and permissions](#roles-and-permissions)
- [API](#api)
- [Security notes](#security-notes)
- [Backups](#backups)
- [Developing the Hub](#developing-the-hub)

## Install on Unraid

1. **Get the template.** Open Unraid's terminal (the `>_` icon, top right) and run:

   ```bash
   wget -O /boot/config/plugins/dockerMan/templates-user/my-wavelength-hub.xml \
     https://raw.githubusercontent.com/Spacegoose02/wavelength/main/hub/unraid/wavelength-hub.xml
   ```

2. **Docker → Add Container**, open the **Template** dropdown and pick **wavelength-hub** (under user templates).
3. Fill in:
   - **Appdata**: `/mnt/user/appdata/wavelength-hub` (the database and the secret key live here).
   - **Public URL**: the address people open in a browser, e.g. `https://hub.example.com`, the host
     you'll create in Nginx Proxy Manager.
   - **Single sign-on**: `true` if you use tinyauth (next sections), plus a long random **Proxy secret**
     (`openssl rand -hex 32`) and your tinyauth username under **SSO admins**.
   - **Music share** can stay as is; the Hub doesn't use it until Phase 3 (downloads, tag editing).
   - **PUID/PGID** default to Unraid's `99`/`100` (nobody:users); the container fixes appdata ownership on start.
4. Apply. The log says `No accounts yet. Open …/setup` on a fresh Hub.

The image is `ghcr.io/spacegoose02/wavelength-hub:latest`, built by the **Hub** GitHub workflow from `main`.
After its first publish, make the package public (GitHub → profile → Packages → wavelength-hub →
Package settings → Change visibility) so Unraid can pull it without a registry login.

## Other Docker hosts

`hub/docker-compose.example.yml` has the same settings for docker compose. Or build it yourself from the
repo root (the image includes the app's web build): `docker build -f hub/Dockerfile -t wavelength-hub .`.

## In a browser

The Hub serves Wavelength itself: open `https://hub.example.com` in any browser. It asks you to sign in to
that Hub (password, or **Sign in with a code** for single sign-on: open the link it shows in another tab).
Everything works as in the app except downloading songs for offline play and running yt-dlp on the device.

- Deezer, the charts in Discover and Release Radar can't be called from a browser directly, so the Hub
  fetches them for signed-in people (`GET /api/fetch`, limited to those few public sites). Discover's charts
  come from the Hub's own copy (`GET /api/discover/fetch`) in the browser and the apps alike.
- Radio song titles sent inside a station's stream can't be read by a browser either, so the Hub reads them
  (`GET /api/radio/now-playing`).
- Music servers you add under **Settings → Sources** are reached from the browser, so give them addresses
  the browser can reach. When the Hub is on `https://`, they need `https://` addresses too (for example
  through Nginx Proxy Manager), because browsers block `http://` content on a secure page. Navidrome and Plex
  allow requests from other sites; Audiobookshelf may need its allowed origins set.
- The page itself isn't behind tinyauth (only `/auth/sso/` is), the same as the app's API calls.

## First admin

Pick one:

- **Hub password:** open `https://hub.example.com/setup` and create the admin. This only works while the
  Hub has no accounts.
- **tinyauth:** put your tinyauth username in `WAVELENGTH_ADMINS` (or your admin group in
  `WAVELENGTH_ADMIN_GROUP`), then open `https://hub.example.com/auth/sso/link` once. tinyauth signs you
  in and the Hub creates your admin account.

Both can be used together; local passwords stay useful for kids without a tinyauth account and as a way
in if the proxy is down.

## Nginx Proxy Manager and tinyauth

Only **one path** of the Hub goes behind tinyauth: `/auth/sso/`. Everything else (the app's API calls,
which carry their own device token, and the password pages) must *not*, or the app would get a login
page instead of JSON.

In Nginx Proxy Manager:

1. **Hosts → Proxy Hosts → Add**: domain `hub.example.com`, forward to your Unraid IP, port `7780`,
   scheme `http`. On **SSL**, request a certificate and turn on Force SSL.
2. **Advanced** tab → Custom Nginx Configuration. Start from the tinyauth block you already use for your
   other apps and wrap it in a `location /auth/sso/` block, adding the four identity headers and the proxy
   secret. With tinyauth's standard nginx setup it looks like this (replace the tinyauth address, your
   auth domain, the Unraid IP and the secret):

```nginx
location /auth/sso/ {
    auth_request /tinyauth;
    error_page 401 = @tinyauth_login;

    # who tinyauth signed in, passed to the Hub (these replace anything the browser sent)
    auth_request_set $tinyauth_user   $upstream_http_remote_user;
    auth_request_set $tinyauth_name   $upstream_http_remote_name;
    auth_request_set $tinyauth_email  $upstream_http_remote_email;
    auth_request_set $tinyauth_groups $upstream_http_remote_groups;
    proxy_set_header Remote-User   $tinyauth_user;
    proxy_set_header Remote-Name   $tinyauth_name;
    proxy_set_header Remote-Email  $tinyauth_email;
    proxy_set_header Remote-Groups $tinyauth_groups;
    # must match WAVELENGTH_PROXY_SECRET
    proxy_set_header X-Wavelength-Proxy-Secret "paste-the-proxy-secret-here";

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://192.168.1.10:7780;
}

location = /tinyauth {
    internal;
    proxy_pass http://192.168.1.10:3000/api/auth/nginx;   # your tinyauth container
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Forwarded-Uri $request_uri;
}

location @tinyauth_login {
    return 302 https://auth.example.com/login?redirect_uri=$scheme://$http_host$request_uri;
}
```

If your existing tinyauth blocks differ (another tinyauth version, other paths), keep yours and only
add the `location /auth/sso/` wrapper, the `auth_request_set`/`proxy_set_header Remote-*` lines and the
proxy secret header.

**Check it:** open `https://hub.example.com/auth/sso/link?code=TEST-CODE`. You should be sent to the
tinyauth login, then see "That code is wrong or has expired" or "There's no Wavelength account for … yet"
(both good: the Hub knew who you were). "Single sign-on
did not identify you" means the headers or the secret aren't arriving.

Why the secret: the Hub's port is also reachable on your LAN. Without the secret, anyone on the LAN could
talk to port 7780 directly and claim `Remote-User: admin`. `WAVELENGTH_TRUSTED_PROXIES` (NPM's IP as the
Hub sees it) is an extra lock you can add.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `WAVELENGTH_PUBLIC_URL` | `http://localhost:7780` | Base URL in pairing links and QR codes. Set it to your NPM host. |
| `PORT` | `7780` | Port inside the container. |
| `WAVELENGTH_DATA_DIR` | `/data` (image) | Database (`hub.db`) and `secret.key`. |
| `WAVELENGTH_SECRET_KEY` | generated into `secret.key` | 32 bytes (64 hex chars or base64). Signs pairing forms; encrypts the saved server logins. |
| `WAVELENGTH_MUSIC_DIR` | `/music` (image) | The music library. yt-dlp downloads go into a folder inside it, and the tag editor writes the files in it. |
| `WAVELENGTH_NAVIDROME_MUSIC_DIR` | `/music` | Where Navidrome's container sees the same music. The tag editor maps Navidrome's file paths from here onto `WAVELENGTH_MUSIC_DIR`. |
| `WAVELENGTH_YTDLP` | `yt-dlp` | The yt-dlp command (the image includes it). |
| `WAVELENGTH_WEB_DIR` | `/app/web` (image) | The app's web build, served at `/`. Without one, `/` goes to the sign-in page. |
| `WAVELENGTH_FANART_KEY` | — | A [fanart.tv](https://fanart.tv/get-an-api-key/) API key (free). Adds fanart.tv artist pictures and album covers to the cover art picker. Without it the picker uses Deezer, Apple Music and the Cover Art Archive. |
| `WAVELENGTH_LASTFM_KEY` | — | A [Last.fm API account](https://www.last.fm/api/account/create)'s API key. With the secret below, people can connect Last.fm for scrobbling. ListenBrainz needs nothing here. |
| `WAVELENGTH_LASTFM_SECRET` | — | That API account's shared secret. |
| `WAVELENGTH_DOCKER_URL` | — | A Docker socket proxy, e.g. `http://docker-socket-proxy:2375`. Turns on Docker control (below). Never the Docker socket itself. |
| `WAVELENGTH_DOCKER_CONTAINERS` | — | Comma-separated container names admins may see, start, stop and restart, e.g. `navidrome,slskd`. Others stay invisible. |
| `WAVELENGTH_SSO` | `false` | Accept tinyauth identity headers on `/auth/sso/`. |
| `WAVELENGTH_PROXY_SECRET` | — | Value the proxy sends as `X-Wavelength-Proxy-Secret`. |
| `WAVELENGTH_TRUSTED_PROXIES` | — | Comma-separated IPs allowed to send identity headers. SSO refuses to start unless this or the secret is set. |
| `WAVELENGTH_ADMINS` | — | tinyauth usernames that are always admins. |
| `WAVELENGTH_ADMIN_GROUP` | — | tinyauth group whose members are admins. |
| `WAVELENGTH_SSO_AUTO_CREATE` | `false` | Create a member account for any tinyauth user on first sign-in. Off: an admin adds people first (with their SSO username). |
| `PUID` / `PGID` | `1000` (Unraid template: `99`/`100`) | User the Hub runs as. |

## How signing in works

**Device pairing** (TVs, phones, anything): the app asks the Hub for a code and shows it with a QR code.
You open `https://hub.example.com/link` on any phone or computer, type the code (the QR fills it in), and
sign in there, with tinyauth or a Hub password. You see "Sign in *Living room TV* as *you*?" and allow it.
The app was polling the Hub and now receives its own **device token**. Codes last 10 minutes and work once.

**Linking tinyauth to a password account**: someone with a Hub password can attach their tinyauth identity,
so single sign-on works for them from then on:

- from the app (Settings → Account → Link single sign-on): the app gets a one-time link
  (`POST /api/me/sso-link`, 10 minutes, single use) to `/auth/sso/connect`; opened in a browser, tinyauth
  identifies them and they press **Link**;
- from the browser: when tinyauth knows someone but no account is linked, `/auth/sso/link` asks for their
  Wavelength username and Hub password once (`POST /auth/sso/connect`), links them and continues the pairing.

An identity can only be linked to one account, and an account to one identity. Unlinking
(`DELETE /api/me/sso`) is refused for accounts without a Hub password, so nobody locks themselves out.
Admins can also set or clear anyone's tinyauth username in Settings → Users.

**Direct password sign-in**: the app can also send a Hub username and password straight to
`POST /auth/login`, handy for kids' accounts.

**Two-step sign-in** (`hub/src/totp.ts`): anyone with a Hub password can add an authenticator app (RFC 6238
TOTP: SHA-1, 6 digits, 30 s, one step of clock drift either way). Once it's on, every password sign-in
(`/auth/login`, the `/link` page, `/auth/sso/connect`) also needs `otp`: the current code, or one of 10
single-use recovery codes. A password that's right without a code answers `401 { twoFactor: true }`. A code
can't be used twice. The secret is sealed with the Hub's secret key, recovery codes are kept as SHA-256 hashes.
Sign-in through tinyauth is tinyauth's to protect.

Every device has its own token. Tokens are stored hashed on the Hub, so a database leak doesn't leak
working tokens. Signing a device out (from the device, from your profile, or by an admin) revokes just
that token; disabling a user signs out all their devices at once.

## Server logins

The Hub keeps the household's server logins so they don't have to be typed into, or stored on, every
device: **Plex**, **Audiobookshelf**, **SUB/WAVE**, **deemix** and **yt-dlp**, and each person's own
**Navidrome** login (Settings → Server → Navidrome accounts; the Navidrome admin login stays on the Hub).

- **Adding them:** in the app, an admin uses **Move to Hub** on a server in Settings → Sources, or on deemix /
  yt-dlp in Settings → Downloads. New Plex, Audiobookshelf and SUB/WAVE servers an admin adds while signed in
  go straight to the Hub.
- **Who gets what** (decided by the Hub, in `servicesFor` in `hub/src/services.ts`):

  | | Admin | Member | Kid |
  |---|---|---|---|
  | Plex, Audiobookshelf, SUB/WAVE listening (login sent to the device) | per the server's **Access**: Everyone, Admins only, or People I choose (admins always) | same | same |
  | SUB/WAVE admin controls (**the Hub** calls SUB/WAVE with the admin login) | ✓ | – | – |
  | deemix and yt-dlp downloads (**the Hub** runs them; the ARL stays on the Hub) | ✓ | only with **Autodownload** | – |
  | Their own Navidrome login | sent to the device, or relayed if **Send everyone through the Hub** is on | same | always relayed |

- **Navidrome through the Hub (relay):** kids' devices, and everyone's when an admin turns on **Send everyone
  through the Hub** (Settings → Server → Navidrome accounts), never get a Navidrome password. They get a
  login for the Hub's relay at `/nd/<server id>/rest/…` instead: the username is `<hub username>~<device id>`
  and the password is derived from the Hub's secret key and the device, so signing a device out ends its
  access at once. The Hub checks it, puts the person's real Navidrome login in its place and passes the call
  on (`hub/src/routes/relay.ts`), streams included, with seeking. Account and server calls (`changePassword`,
  user admin, `startScan`, shares, podcast and radio admin) are refused. For kids the Hub also refuses to
  stream or download a song that Navidrome tags as explicit, that the library check rated explicit (not on a
  "(Clean)" album), or that an admin flagged as not for kids (a flag on a song or album only covers the version
  it was set on, `hub/src/kidSafe.ts`), so another Subsonic app with the relay login gets no further than
  Wavelength would. The Hub must be able to reach the Navidrome address.

- **Logins that never leave the Hub:** the SUB/WAVE admin user and password and the deemix ARL aren't sent
  to any device, admins' included. The app sends those calls to the Hub (`/api/admin/subwave/…`,
  `/api/downloads/…`, in `hub/src/routes/proxy.ts`), which checks the permission and adds the login. SUB/WAVE
  changes and every download are written to the audit log, so admins see who queued what.
- **yt-dlp on the Hub:** the image ships yt-dlp (fetched fresh on each image build) and ffmpeg. It downloads
  into a folder inside the music folder (`/music`, set in Settings → Downloads; `yt-dlp` by default) as
  Artist / Album / Title, from any device, Android included. No network-share login is needed. Map your
  music share to `/music` read-write (the Unraid template does).
- **Own logins:** for Plex and Audiobookshelf an admin can give someone their own token or API key (Settings
  → Sources → Edit → **Own login**), so their listening progress and history are their own. They get that
  instead of the shared one.
- **At rest:** secrets are encrypted with AES-256-GCM using a key derived from `secret.key` /
  `WAVELENGTH_SECRET_KEY`, and bound to their row. Admins see which fields are set, never the values. The
  audit log names changed fields only.
- **On devices:** a signed-in device fetches its logins at start, on focus and every few minutes. Turning
  Autodownload off, changing Access or removing a server takes it away on the next check, and signing out
  removes everything that came from the Hub. ARLs and share logins typed into a device before are wiped
  from it once the Hub runs that downloader (and for anyone signed in without Autodownload).

## Your playlists and history

Wavelength's own playlists (Playlists in the sidebar) and its play history belong to the person, not the
device. They're kept on the Hub per profile (`hub/src/routes/mine.ts`, migration 10) and follow the person
to every device they sign in on (`src/lib/librarySync.ts`). On a shared device each profile keeps its own
copy, so whoever signs in sees only theirs. Playlists sync whole and the newest change to each one wins; a
deleted playlist is kept as a tombstone so the other devices drop it too. The Hub keeps the newest 1000
plays per person. Navidrome stream and cover links carry a device's login, so they're left out and each
device rebuilds them; tracks from servers added by hand on one device only play where that server is set up.
The first time a device signs in after this update, the playlists already on it become that person's.

**Rewind** (History → Rewind) adds up a person's year or month from the same plays: minutes, top artists,
songs and albums, new artists, busiest day, longest streak, and time of day (`hub/src/rewind.ts`). Every
song play is also kept in a `plays` table for three years (migration 13 copies the existing history in).
Only music counts, not radio, audiobooks or podcasts; a song counts once half of it was heard, and its
minutes are the song's length (capped at 30).

Navidrome's own playlists, favorites and play counts are separate: they're per person once everyone has
their own Navidrome account (Server logins above).

## Your devices: remote control and handoff

Each signed-in device waits on the Hub for commands (`GET /api/me/remote/wait`, a long poll of up to 25
seconds, well inside Nginx Proxy Manager's 60 second timeout) and reports what it's playing (`PUT
/api/me/remote/state`). The **Devices** button in the player shows the person's other open devices, with
play/pause, next, previous and volume, **Play here** (bring that device's queue and place to this one and
pause it there) and **Continue there** (send this device's queue and place there and pause here). Only a
person's own devices see each other. It's all kept in memory (`hub/src/routes/remote.ts`); nothing is
stored. **Settings → Account → Let my other devices see and control this one** turns it off per device.

## Listen together

**Listen together** (the party button by the volume, and on Now Playing) starts a party on one device, the
host, which keeps playing as usual and reports its queue and position (`hub/src/routes/together.ts`, in
memory only). Anyone signed in to the Hub sees it and can join; their devices play the same song at the same
spot and stay within a couple of seconds of the host. Guests' **+ Queue** and **Next** on a song send it to
the host's queue (the host can turn that off), and if the host allows it, their skip, pause and seek go to
the host too. Songs travel without their stream links: each guest plays them with their own login for that
server, found by the Hub's id for it, or by title and artist when they don't have that server. Kids skip
anything not for kids. The party ends when the host ends it or their device goes away for a minute.

## Docker control

Optional, and off unless you set it up. **Settings → Server → Containers** lists the containers you name,
with their state, and lets admins start, stop or restart them and read the last 200 lines of their logs
(`hub/src/routes/docker.ts`). Every start, stop and restart goes in the activity log.

The Hub never gets the Docker socket: mounting `/var/run/docker.sock` into a container gives it root on the
host. Instead, run a socket proxy that only lets container calls through, keep it off your LAN, and point the
Hub at it. Only containers named in `WAVELENGTH_DOCKER_CONTAINERS` are shown or touched, even though the
proxy could reach others.

```yaml
services:
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:latest
    container_name: docker-socket-proxy
    restart: unless-stopped
    environment:
      CONTAINERS: "1" # list containers and read logs
      POST: "1"       # start, stop, restart
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    # no ports: only the Hub reaches it, on the shared network
  wavelength-hub:
    environment:
      WAVELENGTH_DOCKER_URL: http://docker-socket-proxy:2375
      WAVELENGTH_DOCKER_CONTAINERS: navidrome,slskd
```

On Unraid, install **docker-socket-proxy** from Community Apps with `CONTAINERS=1` and `POST=1`, put it and the
Hub on the same custom network (e.g. `proxynet`), and fill in **Docker URL** and **Docker containers** in the
Hub's template. Leave the Hub's own container off the list: stopping it from the app would leave nothing to
start it again.

## Tag editor

Admins fix an album's tags from its page (**Edit tags**, on Navidrome albums). The Hub asks Navidrome for the
album's files (with the Navidrome admin login), reads their tags with ffprobe, and writes changes with ffmpeg:
the file is copied with the new tags (the audio is copied as is, never re-encoded) and swapped in, so a failed
write leaves the original untouched. **Find on Deezer and MusicBrainz** looks the album up on both and fills in
title, artist, track and disc numbers, album artist, year and genre for the admin to check before saving.
Every save is kept in an undo log (migration 11, `tag_edits`): **Undo** on the page, or under **Settings →
Server → Tag edits**, puts those tags back. After a save or an undo the Hub asks Navidrome to rescan.

It needs the music mounted read-write at `/music` (as for yt-dlp) and a Navidrome admin login on the Hub.
If Navidrome sees the music somewhere other than `/music`, set `WAVELENGTH_NAVIDROME_MUSIC_DIR` to that path.
Code: `hub/src/tags.ts`, `hub/src/routes/tags.ts`, `src/views/TagEditor.tsx`.

**Edit artist** (on artist pages, `src/views/ArtistTagEditor.tsx`) loads the songs of all the artist's Navidrome
albums at once and renames the artist in their Artist and Album artist tags, also inside credits like "A feat.
B" if asked, with an optional genre; it saves through the same `PUT /api/admin/tags`, so it's undone the same
way. The editors suggest artist and genre names from Navidrome (`GET /api/admin/tags/values`).


**Merging** (Albums or Artists → **Select → Merge**, `src/lib/merge.ts`) uses the same endpoints: it reads the
ticked albums' files with `GET /api/admin/tags/albums`, works out the new tags in the app, and writes them with one
`PUT /api/admin/tags`, labelled "Merge … into …". So a merge shows up under **Tag edits**, is undone in one go, and
is audited as `tags.edited`.

## Genres

The Hub keeps one genre per kind of music: "Hip Hop", "Trap", "Pop Rap" and Deezer's "Rap/Hip Hop" all become
**Rap; Hip-Hop**, "Dance Pop" and "Synth-pop" become **Pop**, "EDM", "House" and "Techno" become **Electronic**, and so
on. A list of rules (genre → what it becomes) decides; the defaults are in `DEFAULT_GENRES` in `hub/src/genres.ts`,
and admins change them under **Settings → Server → Genres** (kept in `hub_settings` as `genres`, no migration).
Names are compared without case, spaces or punctuation, so "hip-hop", "Hip Hop" and "HipHop" are one rule; "&" and
"and" count as the same. A tag with several genres ("Christmas; Dance Pop") takes the genre of the first one a rule
knows. A genre that is already a rule's result is left as it is.

**New downloads.** When a download finishes (deemix, Soulseek or yt-dlp), the Hub looks for music files in the
music folder that changed since it last looked (`genres.since` in `hub_settings`, set when the Hub first starts with
this feature, so the library already there isn't touched), gives each the tidy genre, and only then asks Navidrome
to scan. Genres no rule knows are left for the review. Files an admin edited by hand since are left alone. The
changes are one save in the tag editor's undo log ("Genres of new downloads"), so **Settings → Server → Tag edits**
undoes them. It can be turned off there (on by default). Code: `Library.onNewMusic` in `hub/src/library.ts`, set by
`hub/src/routes/genres.ts`.

**Review.** **Review library genres** asks Navidrome for every album and its genres and lists the albums whose
genre isn't the tidy one, with what it would become (editable). **Apply**, **Apply selected** or **Apply all** write
the genre into every song of those albums through the same save as the tag editor, so **Undo** (there, or under Tag
edits) puts them back; Navidrome rescans afterwards. **Keep** leaves an album as it is and stops suggesting it.
**Genres without a rule** lists the genres no rule knows, with how many albums have each: pick what one becomes
(**Save rule**), or **Keep** it as a genre of its own. Code: `src/views/GenreReview.tsx`.

It needs what the tag editor needs: the music read-write at `/music` and a Navidrome admin login on the Hub.

## Following deemix downloads

deemix only keeps a list of downloads; it never says one is stuck. The Hub reads that list
(`hub/src/deemixQueue.ts`) and turns it into something you can follow:

- **Every download** with its place in line ("Waiting · 3 in line"), songs done and failed ("Downloading · 5 of
  12 songs · 1 failed"), and deemix's reason for each song that failed, in words ("Not available in your Deezer
  country or account" rather than `notAvailable`).
- **Stuck downloads.** The Hub remembers when each download last moved. When deemix has had work to do and nothing
  has moved for 15 minutes, the one at the front is marked **stuck**. That's usually a download deemix hung on, or
  a deemix restart that left old items "in queue" without starting them.
- **Cancel, Retry, Clear finished** (the routes above). deemix refuses a link it still lists, even a failed one, so
  Retry and approving a failed request again take the old one off first.
- **Requests** carry a `progress` object while deemix has them (`label`, `percent`, `done`, `total`, `failed`,
  `stuck`, `errors`), so the Inbox shows a bar and reasons. A request deemix has no trace of an hour after it was
  handed over (its list was cleared, or deemix restarted and forgot it) becomes **failed** with that reason instead
  of saying "Downloading" for ever; approving it again retries.
- **Clean versions** (§6.5 in USERS-AND-ADMIN.md) wait until deemix's queue is empty, one at a time, because the
  Hub changes deemix's folder name for them. Their line is now kept in the database, so a Hub restart carries on
  where it left off. While one waits, it says what for ("3 downloads ahead in deemix"). If deemix is stuck, it
  says so and **keeps waiting**: going ahead would swap the folder name in under someone else's album. Cancel the
  stuck download (or restart deemix) and the line moves again. Each one still gives up after 12 hours.

The Hub reads deemix's queue every 30 seconds while a request is downloading (and for 6 hours after anyone starts
a download), and whenever someone has Downloads open.

**Unsticking things by hand.** Open deemix's own page and look at its queue panel: cancel anything that isn't
moving or clear the queue, or restart the deemix container. Clean versions marked "Waiting for deemix" start
within seconds of the queue being empty.

> **Not tested against a real deemix.** The routes for cancelling (`/api/removeFromQueue`) and clearing
> (`/api/removeFinishedDownloads`) are deemix-gui's, but versions differ on where they read the id, so the Hub
> sends it in both the query string and the body. The tests use a stand-in deemix. If Cancel does nothing on
> your deemix, use deemix's own page, and please report the version.

## Soulseek

The Hub can search and download from Soulseek through [slskd](https://github.com/slskd/slskd)
(`hub/src/slskd.ts`, `hub/src/routes/slskd.ts`). An admin adds it under **Settings → Downloads → Soulseek**
with slskd's address (as the Hub reaches it) and an API key from slskd's config:

```yaml
# slskd.yml
web:
  authentication:
    api_keys:
      wavelength:
        key: <a long random value>   # openssl rand -hex 24
directories:
  downloads: /music/slskd             # inside the music library Navidrome reads
```

The key stays on the Hub. Searches come back grouped into folders (one per album, usually) and ranked: the
words searched for, a free upload slot, speed, lossless, more songs. Downloads go to slskd's downloads folder;
the Hub follows slskd's transfers and asks Navidrome to scan when a download finishes, and an approved
request (Inbox → **Soulseek…** → **Use this**) shows *Ready* once its files are in.

## Deleting albums

**Delete album** (admins, on Navidrome albums) moves the album's files into `.wavelength-trash/<id>/` in the
music folder, keeping their paths: the album's whole folder when it holds nothing else (cover included),
otherwise just its songs. Empty folders left behind are removed. Navidrome skips hidden folders, and the Hub
puts a `.ndignore` there too. **Settings → Server → Deleted albums** puts an album back where it was, or removes
it at once; otherwise it's removed for good after 30 days. Every delete, restore and removal is audited.
Code: `hub/src/routes/trash.ts` (migration 14, `trash`).

## Cover art

Admins can change the picture of any album or artist for the whole household. The picture is kept on the
Hub and shows on every device and in the browser, in place of the one Navidrome or Plex sends.

- **Where:** open an album or artist in the app and press **Change cover** / **Change picture** (admins,
  `library.edit`).
- **Lookup:** the Hub searches **Deezer** (albums and artists), **Apple Music** (albums, up to 1200×1200),
  **MusicBrainz's Cover Art Archive** (albums) and, with `WAVELENGTH_FANART_KEY`, **fanart.tv** (artists and
  albums). The searches run on the Hub, so they work the same in the browser and on Android. A service that's
  down or slow is skipped and named under the results. The artist and album boxes can be edited to search
  for another spelling; the picture is still saved for the album you opened.
- **Your own picture:** **Upload a picture** (JPEG, PNG or WebP, 15 MB at most), or paste any image link.
- **Undo:** **Use the server's picture** removes the Hub's picture.
- **Storage:** the Hub downloads the picture once and keeps it in the data folder (`/data/artwork`), so it
  keeps working if the original link goes away. **Nothing is written to your music files or folders**, and
  Navidrome and Plex keep their own art (other apps such as Plexamp or Feishin still show that).
- **Matching:** like the kid-safe flags, pictures match by artist and album name on each device (ignoring
  case, "feat." and "(Remastered)"-style suffixes), because every device reaches the music through its own
  logins and ids differ between servers. Songs show their album's picture, in lists, the player, Now Playing
  and the lock screen / media controls. A song on a compilation (song artist ≠ album artist) still gets the
  album's picture when only one album has that title.
- **On devices:** each device fetches the list at start, when the profile changes and every ten minutes, and
  keeps it, so pictures still show offline once loaded. The images themselves (`/api/art/<file>`) load
  without the device token, because an `<img>` can't send one: their names are 128 random bits, only listed
  to signed-in people, and every new picture gets a new name.
- Every change is in the audit log (`artwork.set`, `artwork.reset`).

## Roles and permissions

| Role | Permissions today |
|---|---|
| **admin** | `users.manage`, `audit.view`, `keys.manage` (server logins), `subwave.control`, `downloads.run`, `requests.approve`, and the ones later phases use (`library.edit`, `server.view`). |
| **member** | `requests.create`; plus `downloads.run` while the admin has their **Autodownload** switch on. |
| **kid** | `requests.create`. Kids can never be given Autodownload. |

The Hub checks the permission on **every** request (`need(req, …)` in `hub/src/http.ts`); the app uses
the list from `GET /api/me` only to decide what to show. A role change applies on the user's next request,
no re-login. The Hub refuses to demote, disable or delete the last admin.

## API

JSON in and out. Authenticated calls send `Authorization: Bearer wlh_…`. Errors are `{ "error": "…" }`
with a 4xx status.

| Method & path | Who | What |
|---|---|---|
| `GET /api/health` | anyone | `{ ok, version, setupNeeded, sso }` |
| `POST /auth/setup` | anyone, empty Hub only | `{ username, password, displayName?, deviceName?, platform? }` → session |
| `POST /auth/login` | anyone | `{ username, password, deviceName?, platform? }` → session |
| `POST /auth/device` | anyone | `{ deviceName?, platform? }` → `{ deviceCode, userCode, verificationUrl, verificationUrlComplete, expiresIn, interval }` |
| `POST /auth/device/token` | the pairing device | `{ deviceCode }` → `202 {status:'pending'}`, `403 denied`, `410 expired`, or `200` session |
| `POST /auth/logout` | signed in | signs this device out |
| `GET /api/me` | signed in | `{ user, device, permissions, twoFactor, kids }` (`kids`: the kids this person is a parent of) |
| `GET /api/me/2fa` | signed in | `{ enabled, recoveryLeft }` |
| `POST /api/me/2fa/setup` | signed in, Hub-password users | `{ password }` → `{ secret, uri }` (`otpauth://`, for a QR code) |
| `POST /api/me/2fa/enable` | signed in | `{ code }` → `{ recovery: [10 codes] }`, shown once |
| `DELETE /api/me/2fa` | signed in | `{ password, otp }` turns it off |
| `DELETE /api/admin/users/:id/2fa` | `users.manage` | turn off someone's two-step sign-in |
| `PUT /api/admin/users/:id/guardians` | `users.manage` | `{ ids }`: a kid's parents (grown-up accounts) |
| `GET /api/household/playlists`, `POST …` | signed in, not kids | household playlists / start one `{ name, tracks? }` (everyone else is notified, kind `share`) |
| `GET /api/household/playlists/:id` | signed in, not kids | `{ playlist, tracks: [{ id, track: { title, artist, album?, duration?, coverUrl? }, addedBy, addedAt }] }` |
| `PATCH …/:id`, `DELETE …/:id` | its owner or `users.manage` | `{ name }` / delete it |
| `POST …/:id/tracks` | signed in, not kids | `{ tracks }` (up to 500 at a time, 2000 in all) → `{ added }` |
| `DELETE …/:id/tracks/:entry` | whoever added it, the owner, or `users.manage` | take a song off |
| `PUT …/:id/order` | signed in, not kids | `{ ids }`: entries in their new order; ones not listed follow |
| `PATCH /api/me` | signed in | `{ displayName }` |
| `PUT /api/me/password` | signed in, Hub-password users | `{ currentPassword, newPassword }` |
| `GET /api/me/devices`, `DELETE /api/me/devices/:id` | signed in | your devices |
| `POST /api/me/sso-link` | signed in, SSO on | `{ url, expiresIn }`: one-time link to attach a tinyauth identity |
| `DELETE /api/me/sso` | signed in, with a Hub password | unlink single sign-on |
| `GET /api/me/prefs` | signed in | `{ prefs: { key: { value, updatedAt } } }` |
| `GET /api/me/playlists`, `PUT …` | signed in | your own Wavelength playlists (`{ playlists: [{ id, name, tracks, createdAt, updatedAt, deleted? }] }`); a PUT keeps each one only if it's newer and answers with them all |
| `GET /api/me/history`, `POST …` | signed in | your play history, newest first (`?limit=`, up to 1000) / add plays `{ plays: [{ playedAt, track }] }` |
| `GET /api/me/remote/wait?timeout=` | signed in | wait (up to 25 s) for commands from your other devices: `{ commands: [{ id, action, value?, queue?, index?, position?, play?, from, at }] }` |
| `PUT /api/me/remote/state` | signed in | what this device is playing: `{ queue (up to 300), index, position, duration, playing, volume }` |
| `GET /api/me/remote/devices` | signed in | your devices that are open, each with `current`, `listening` and its `state` (position worked out to now) |
| `POST /api/me/remote/command` | signed in | `{ deviceId, action: toggle/play/pause/next/prev/seek/volume/jump/load, value?, index?, queue?, position?, play? }` to one of your own devices |
| `DELETE /api/me/remote` | signed in | this device stops showing up |
| `GET /api/together`, `POST …` | signed in | parties going on now / start one with this device as host (`{ name?, guestsAdd?, guestsControl? }`) |
| `POST /api/together/:id/join`, `…/leave` | signed in | join / leave (the host leaving ends it) |
| `PATCH /api/together/:id` | host | `{ guestsAdd?, guestsControl? }` |
| `PUT /api/together/:id/state` | host | `{ queue, index, position, duration, playing }`, which guests follow |
| `POST /api/together/:id/request` | member | `{ action: add/playNext/next/prev/toggle/seek/jump, tracks?, value?, index? }`, applied by the host's device |
| `GET /api/together/:id/wait?version=` | member | waits (up to 25 s) for a newer version; the host also gets requests. `{ party: null }` once it's over |
| `GET /api/me/rewind?year=&month=&tz=` | signed in | your Rewind for a year (or one month of it); `tz` is the device's `getTimezoneOffset()` so days and hours are local |
| `GET /api/me/rewind/periods?tz=` | signed in | `{ periods: [{ year, month, plays }] }`, newest first |
| `PUT /api/me/prefs` | signed in | `{ changes: { key: { value, updatedAt } } }` → `{ applied, stale, prefs }`. Newest `updatedAt` wins per key. |
| `GET/POST /api/admin/users` | `users.manage` | list / create `{ username, role, password?, ssoSubject?, displayName?, autodownload? }` |
| `PATCH/DELETE /api/admin/users/:id` | `users.manage` | change `{ displayName, role, password, ssoSubject, autodownload, disabled }` / delete |
| `GET /api/admin/devices`, `DELETE /api/admin/devices/:id` | `users.manage` | every signed-in device / sign one out |
| `GET /api/me/services` | signed in | `{ services: [{ id, kind, name, url, config, secrets, ownLogin }] }`: the server logins this user may use |
| `GET/POST /api/admin/services` | `keys.manage` | list (secrets shown as `secretsSet`, never values) / add `{ kind, name, url, access?, config?, secrets? }` |
| `PATCH/DELETE /api/admin/services/:id` | `keys.manage` | change (a secret set to `''` or `null` is cleared, a missing one kept) / remove |
| `PUT/DELETE /api/admin/services/:id/users/:userId` | `keys.manage` | let someone use a "chosen" server, with an optional own login `{ secrets: { token } }` / take it away |
| `GET/POST/PUT/DELETE /api/admin/subwave/:id/<path>` | `subwave.control` | a SUB/WAVE admin call, made by the Hub with its saved admin login (`<path>` is relative to SUB/WAVE's `/api`) |
| `GET /api/downloads/deemix` | `downloads.run` | `{ user }`: who deemix is logged in as (the Hub logs in with its ARL) |
| `GET/POST /api/downloads/deemix/queue` | `downloads.run` | deemix's queue / add `{ link, bitrate? }` (a Deezer link). A link deemix still lists as finished or failed is taken off and queued again; one still waiting or downloading is left alone |
| `GET /api/downloads/deemix/progress` | `downloads.run` | `{ items, clean }`: deemix's queue made readable (see "Following deemix downloads") and the clean versions the Hub is holding |
| `POST /api/downloads/deemix/queue/:uuid/cancel` | `downloads.run` | Cancel a download, or take a finished one off deemix's list |
| `POST /api/downloads/deemix/queue/:uuid/retry` | `downloads.run` | Take it off deemix's list and queue it again (a clean version goes back through the clean folder) |
| `POST /api/downloads/deemix/queue/clear` | `downloads.run` | Clear finished and failed downloads off deemix's list |
| `DELETE /api/downloads/deemix/clean` | `downloads.run` | `{ link }`: take a clean version out of the Hub's line before deemix gets it (409 once it's being handed over) |
| `POST /api/downloads/ytdlp/search` | `downloads.run` | `{ query }` → `{ results }` (YouTube search, or a link's contents) |
| `GET/POST/DELETE /api/downloads/ytdlp/jobs` | `downloads.run` | downloads (your own; admins see everyone's) / start `{ url, title?, channel? }` / clear finished |
| `POST /api/requests` | `requests.create` | ask for music `{ link, kind?, title, artist?, cover?, note? }` → `{ request }`. With `downloads.run` it is approved (downloaded) straight away |
| `GET /api/requests` | signed in | your requests, newest first; approved ones carry `downloadedAt` and `readyAt` (scanned into the library) |
| `GET /api/requests/counts` | signed in | `{ unseen, pending }`: your decided requests you haven't looked at, and (with `requests.approve`) how many wait |
| `POST /api/requests/seen`, `DELETE /api/requests/:id` | signed in | mark yours as seen / cancel one still waiting |
| `GET /api/admin/requests?status=` | `requests.approve` | everyone's requests, waiting ones first |
| `POST /api/admin/requests/:id/approve` | `requests.approve` | `{ bitrate? }`: the Hub downloads it (Deezer links with deemix, anything else with yt-dlp), or `{ slskd: { username, files: [{ filename, size }] } }` downloads a Soulseek folder for it; `failed` with the reason if that didn't work, and approving again retries |
| `POST /api/slskd/test` | `downloads.run` | `{ message }`: whether slskd is signed in to Soulseek |
| `POST /api/slskd/searches` | `downloads.run` | `{ query }` → `{ id }` |
| `GET /api/slskd/searches/:id` | `downloads.run` | `{ done, responses, folders: [{ username, folder, name, files, size, format, lossless, bitRate, freeSlot, speed, queue }] }`, best first |
| `POST /api/slskd/downloads` | `downloads.run` | `{ username, files: [{ filename, size }], label? }`, audited |
| `GET /api/slskd/downloads` | `downloads.run` | slskd's downloads by folder: `{ downloads: [{ username, name, files, done, failed, progress, state }] }` |
| `POST /api/admin/requests/:id/reject`, `/have`, `DELETE …/:id` | `requests.approve` | reject `{ reason? }` / "already in the library" / remove |
| `GET /api/people` | signed in | who you can share with: `{ people: [{ id, username, displayName, kid }] }` |
| `POST /api/shares` | signed in | `{ to: userId \| null (everyone), kind, title, subtitle?, cover?, note?, payload }`; `kind` is playlist, album, track, artist, station or favorites; `payload` is `{ tracks: [{ title, artist, album?, duration?, coverUrl? }] }`, `{ station: { name, streamUrl, … } }` or `{ artist }` (512 KB at most) |
| `GET /api/shares?sent=1` | signed in | shared with you (or `sent=1`: what you shared), newest first |
| `GET /api/shares/counts`, `POST /api/shares/seen` | signed in | `{ unseen }` / mark `{ ids? }` (or all) as seen |
| `POST /api/shares/:id/hide`, `DELETE /api/shares/:id` | signed in | take one off your list / unshare (the sender, or an admin) |
| `GET /api/me/push`, `POST …`, `DELETE …` | signed in | push through ntfy: `{ available, server, topic, subscribeUrl, webUrl }` / turn on (a new topic each time) / off |
| `POST /api/me/push/test` | signed in | send yourself a test push (`502` with ntfy's answer when it fails) |
| `GET /api/admin/push`, `PUT …` | `keys.manage` | the ntfy server: `{ server, hasToken }` / `{ server, token? }` (`server: ''` turns push off; `token: null` removes it) |
| `GET /api/notifications?after=<id>` | signed in | yours after `after`, oldest first (20 at most): `{ notifications: [{ id, kind, title, body, createdAt }], last }`; `kind` is request.new (admins), request.ready, request.rejected, request.have, request.failed, share or radar (a new release from an artist you follow). Without `after`: none, only `last` to start from. Kept 30 days |
| `GET /api/flags` | signed in | `{ flags: [{ id, kind, artist, title, version, verdict, setBy, createdAt }] }`: kid-safe flags. `version` is which version of the song or album it's for: `''` (the song or album, whatever its tags), `clean` ("(Clean)" in the album's or song's name) or `any` (artists, "every version"); `explicit`, from 0.17.2, counts as `''`; see `hub/src/kidSafe.ts` |
| `POST /api/admin/flags`, `DELETE /api/admin/flags/:id` | `library.edit` | set `{ kind: track/album/artist, artist, title?, version?, verdict: block/allow }` (the same item and version again replaces its verdict; without `version`, a title with "(Clean)" is the clean version and anything else `''`) / remove |
| `GET /api/ratings` | signed in | `{ ratings: [{ kind: album/track, artist, album, title, rating: explicit/clean/unknown, cleanLink, checkedAt }] }`: the library check's results |
| `POST /api/admin/ratings`, `DELETE /api/admin/ratings` | `library.edit` | save `{ albums: [{ artist, album, rating, cleanLink?, explicitTracks? }] }` (up to 200; an album sent again replaces its songs) / forget them all |
| `GET /api/artwork` | signed in | `{ artwork: [{ id, kind: album/artist, artist, album, url, source, setBy, updatedAt }] }`: the Hub's cover art (`album` is `''` for an artist, `url` is a path on the Hub) |
| `GET /api/art/:file` | anyone | one picture (see "Cover art" for why it needs no token) |
| `GET /api/admin/artwork/search?kind=&artist=&album=` | `library.edit` | `{ candidates: [{ source, title, subtitle?, thumb, url }], failed: [service names] }` from Deezer, Apple Music, the Cover Art Archive and fanart.tv |
| `PUT /api/admin/artwork` | `library.edit` | `{ kind, artist, album?, url, source? }` (the Hub downloads it) or `{ kind, artist, album?, image }` (base64 upload, 15 MB at most); JPEG, PNG or WebP. The same album or artist again replaces its picture |
| `DELETE /api/admin/artwork/:id` | `library.edit` | back to the server's own picture |
| `GET /api/admin/server` | `server.view` | the server page: version, uptime, disks, yt-dlp version, counts |
| `GET /api/admin/backup` | `server.view` | a copy of the database (`wavelength-hub-YYYY-MM-DD.db`), audited |
| `GET /api/admin/docker` | `server.view` | `{ enabled, containers: [{ name, image, state, status, created }] }` for the containers in `WAVELENGTH_DOCKER_CONTAINERS`; `state` is `missing` for a name Docker doesn't have |
| `POST /api/admin/docker/:name/start\|stop\|restart` | `server.view` | audited; `404` for a container not on the list, `501` when Docker control is off, `502` when Docker can't be reached |
| `GET /api/admin/docker/:name/logs?lines=` | `server.view` | `{ logs }`: the last `lines` (10–2000, default 200) of output, with timestamps |
| `POST /api/admin/restore[?force=1]` | `server.view` | body: a backup (`application/vnd.sqlite3`, 256 MB at most). Checked, staged, then the Hub restarts to swap it in (see "Backups"); `409` when its server logins were sealed with another secret key, unless `force=1` |
| `POST /api/admin/invites` | `users.manage` | `{ role, displayName?, autodownload?, days? (1–30, default 7) }` → `{ id, url, code, expiresAt }`; the code is only shown here |
| `GET /api/admin/invites`, `DELETE /api/admin/invites/:id` | `users.manage` | open invites and ones used in the last 30 days / cancel an unused one |
| `GET`, `POST /invite/:code` | anyone with the link | the invite page: pick a username and password; each link works once |
| `POST /auth/invite` | anyone with the link | `{ code (or the whole link), username, password, displayName?, deviceName, platform }` → a session, like `/auth/login` |
| `GET /api/admin/library` | `server.view` | rescans: `{ navidrome: { url, username } \| null, scanning, lastScanAt, lastError, scanQueued }` |
| `PUT /api/admin/library/navidrome`, `DELETE …` | `keys.manage` | the Navidrome admin login the Hub scans with (`{ url, username, password? }`, checked first, kept sealed) / remove |
| `POST /api/admin/library/scan` | `server.view` | start a Navidrome scan now |
| `POST /api/admin/services/:id/users/:userId/navidrome-account` | `keys.manage` | make a Navidrome account (their Hub username, random password) with the Navidrome server's admin login, saved as their own login |
| `POST /api/me/playing` | signed in | what this device is playing (`{ title, artist?, album?, source? }`, or `{ stopped: true }`); memory only |
| `GET /api/admin/listening` | `users.manage` | who is playing what right now, per device |
| `GET /nd/:id/rest/:method` | relay login | Navidrome through the Hub (Subsonic, `t`+`s` or `p`); see "Navidrome through the Hub" |
| `POST /nd/:id/auth/login`, `GET /nd/:id/api/song` | relay login | Navidrome's own API through the Hub, for play history only |
| `GET /api/fetch?url=` | signed in | for the browser: fetches a page from Deezer's API, iHeart, Billboard, Apple's charts feed, RadioWave Monitor or Spotify's public pages (https only, nothing else) |
| `GET /api/radio/now-playing?url=` | signed in | for the browser: the song title a radio station sends inside its stream (ICY metadata) → `{ icy, title }`; `icy: false` when the station sends none. Reads one metadata block (at most ~260 KB) and hangs up; one read per station is shared for 10 s. Only the title comes back, never the stream |
| `GET /api/discover/fetch?url=` | signed in | Discover's charts from the Hub's copy (same sites as `/api/fetch`). Kept in memory, fetched again every 30 minutes while anyone opened it in the last 3 days; a copy over 30 minutes old is sent at once and refreshed behind the scenes, and when the site fails the last good copy is sent. Headers: `x-wavelength-fetched-at` (ISO time), `x-wavelength-stale: 1` when the site failed or the copy is being refreshed |
| `GET /api/radar` | signed in | Release Radar: who you follow and their releases from the last 42 days, `{ follows, releases, windowDays, checkedAt, pending, failed }`. See [RELEASE-RADAR.md](RELEASE-RADAR.md) |
| `POST /api/radar/follows`, `DELETE /api/radar/follows/:id` | signed in | follow a Deezer artist (`{ id, name, picture? }`, or `{ name }` and the Hub finds them; 404 if Deezer has nobody by that name) / stop following |
| `POST /api/radar/check` | signed in | look your followed artists up now (ones looked at in the last 10 minutes are skipped) |
| `GET /api/radar/suggestions[?fresh=1]`, `POST /api/radar/suggestions/:id/hide` | signed in | artists you might like (`{ id, name, picture, fans, because, plays? }`) / never suggest this one again |
| `GET /api/admin/tags/album/:id` | `library.edit` | a Navidrome album's files (`path` relative to the music folder) and their tags |
| `GET /api/admin/tags/match?artist=&album=` | `library.edit` | matching albums on Deezer and MusicBrainz, with their songs |
| `PUT /api/admin/tags` | `library.edit` | `{ label, changes: [{ path, tags }] }` writes tags (only those given) → `{ batch, changed, failed }` |
| `GET /api/admin/tags/history`, `POST /api/admin/tags/undo/:batch` | `library.edit` | saved edits / put a save's files back |
| `GET /api/admin/tags/albums?ids=a,b` | `library.edit` | up to 200 Navidrome albums' files and tags at once, each with `albumId` (for Edit artist) → `{ songs, missing }` |
| `GET /api/admin/tags/values` | `library.edit` | `{ artists, genres }`: names in Navidrome and in recent edits, for suggestions |
| `GET /api/admin/genres`, `PUT /api/admin/genres` | `library.edit` | genre rules: `{ auto, rules: [{ from, to }], defaults, kept, genres }`; `PUT` takes `{ auto?, rules? }` (`rules: null` = the defaults) |
| `GET /api/admin/genres/review` | `library.edit` | `{ albums: [{ id, name, artist, songs, current, proposed }], unknown: [{ genre, albums, examples }], total, kept, genres }` |
| `POST /api/admin/genres/apply` | `library.edit` | `{ albums: [{ id, genre }] }` (up to 500) sets the genre in every song, as one undoable save → `{ batch, label, changed, failed, missing }` |
| `POST /api/admin/genres/keep` | `library.edit` | `{ ids, keep? }`: leave albums out of the review (`keep: false` puts them back) |
| `POST /api/admin/genres/check` | `library.edit` | run the weekly look now → `{ albums, unknown, notified }`; notifies `library.edit` people (kind `library`) only about albums and genres not told about before |
| `DELETE /api/admin/library/album/:id` | `library.edit` | move a Navidrome album's files to the trash → `{ batch, label, files, failed }` |
| `GET /api/admin/trash` | `library.edit` | deleted albums of the last 60 days: `{ albums: [{ batch, label, at, files, by, restoredAt, purgedAt, purgeAt }] }` |
| `POST /api/admin/trash/:batch/restore`, `DELETE /api/admin/trash/:batch` | `library.edit` | put a deleted album back / remove it for good now |
| `POST /api/import/youtube` | signed in | `{ url }` of a YouTube / YouTube Music playlist → `{ tracks: [{ title, artist, duration? }] }`, read with the Hub's yt-dlp (titles only, nothing downloaded) |
| `GET /*` | — | the app's web build (`WAVELENGTH_WEB_DIR`); unknown paths get `index.html` |
| `GET /api/me/kid?day=YYYY-MM-DD` | signed in | `{ kid, rules: { bedtimeFrom, bedtimeTo, dailyMinutes }, usedSeconds, pinSet }` |
| `POST /api/me/listened` | signed in | `{ day, seconds }` (5 minutes at most per call) → `{ usedSeconds }`, the total across devices |
| `POST /api/kid/unlock` | signed in | `{ pin }`: checks the grown-up PIN (rate limited, audited) |
| `GET /api/admin/kids?day=` | `users.manage` | `{ pinSet, kids: [{ userId, displayName, rules, usedSeconds }] }` |
| `PUT /api/admin/kids/:userId` | `users.manage` | `{ bedtimeFrom?, bedtimeTo?, dailyMinutes? }` ('HH:MM' device time; null clears) |
| `PUT /api/admin/kid-pin` | `users.manage` | `{ pin }` (4 to 8 digits, stored hashed) or `{ pin: null }` |
| `GET /api/admin/audit?limit=&before=` | `audit.view` | newest first |

**Parents** (`hub/src/family.ts`): a kid's requests notify the admins and the kid's parents. `GET
/api/admin/requests` and the approve / reject / already-have routes also answer a parent, for their own kids'
requests only (another request is a 404); picking Soulseek files and `DELETE` stay with `requests.approve`.

**Digests** (`hub/src/digests.ts`) run hourly: on Monday from 08:00 UTC each kid's last week (songs, minutes,
days, top artists) goes to their parents, or the admins when they have none (kind `report`); on the 1st everyone
who listened gets last month's summary (kind `rewind`). The first run only notes the date, so a new Hub doesn't
report a week it wasn't watching.

A **session** is `{ token, user, permissions, device }`. Browser pages: `/setup`, `/link`, `/auth/sso/link`,
`/auth/sso/connect` (the last two sit behind tinyauth).

## Push notifications

The Hub can post every notification it writes (`notify.ts`) to **ntfy** too, so it reaches a phone while Wavelength
is closed (`hub/src/push.ts`). Nothing is sent until an admin sets the ntfy server (Settings → Server → Push
notifications): `https://ntfy.sh` or your own, with an optional access token (sealed with the Hub's key). Each
person who turns it on gets a random topic (`wl-` and 20 letters); they subscribe to it in the ntfy app through
the `ntfy://` link or QR code the app shows. What's posted is the notification's title and text, with a tag and a
link to the Hub's web app. On ntfy.sh the topic is the only secret, and ntfy.sh can read the messages; use your
own server to keep them in the house. The person's topic list is kept in `hub_settings` (`push.topics`).

## Security notes

- Passwords are hashed with scrypt (N=2¹⁶); device tokens and pairing codes are stored as SHA-256 hashes.
- Sign-in endpoints are rate limited per IP (and per username for passwords).
- Identity headers are only trusted on `/auth/sso/` and only with the proxy secret / from a trusted IP.
- The SSO approve form carries a value signed with the Hub's secret key, so another site can't approve a
  pairing on your behalf.
- Every sign-in, failed sign-in and admin change is written to the audit log (never passwords).
- Only allow a pairing you just started yourself: the confirmation page names the device for that reason.
- In the app, the device token and server logins are kept in the OS keychain (Windows Credential Manager,
  Android Keystore), not in the app's own storage. A Wavelength opened in a browser keeps them in the browser.

## Backups

**Settings → Server → Download backup** (admins) saves a copy of the database. Keep `secret.key` from the
data folder next to it.

**Restore a backup…** on the same page sends a backup back. The Hub checks it (a Hub database, not damaged,
not from a newer Hub, with at least one admin, and server logins that open with this Hub's `secret.key`;
it asks before going on if they don't), stages it as `hub.db.restore`, and exits with code 75 so Docker
starts it again (`restart: unless-stopped` or `on-failure` both do). On start it swaps the backup in and
keeps the database it replaced as `hub.db.before-restore-<time>`. Devices signed in after the backup was
made have to sign in again.

By hand: stop the Hub, put the backup in the data folder as `hub.db` (deleting any `hub.db-wal` and
`hub.db-shm`), and start it again.

The backup doesn't hold the cover art pictures: those are files in the data folder's `artwork` folder.

Or back up the appdata folder (`hub.db*`, `secret.key` and `artwork/`). Keep `secret.key` with the database: it decrypts
the stored server logins. With a different key the Hub still starts, but shows those logins as unreadable
until an admin enters them again.

## Developing the Hub

```bash
cd hub
npm install
npm run dev          # http://localhost:7780, data in hub/data/
npm test             # node:test, in-memory database
npm run typecheck
```

- Node 22.18+ runs the TypeScript directly (type stripping), so there's no build step. That's why imports
  end in `.ts` and the code avoids enums and parameter properties (`erasableSyntaxOnly`).
- SQLite is Node's built-in `node:sqlite`; schema changes are appended to `MIGRATIONS` in `src/db.ts`.
- Layout: `src/app.ts` (server, auth hook), `src/routes/` (auth, me, admin), `src/roles.ts`
  (permissions), `src/pairing.ts`, `src/sso.ts`, `src/prefs.ts`, `src/pages.ts` (the HTML pages).
- New admin route? Start the handler with `need(req, '<permission>')`. `test/admin.test.ts` automatically
  checks that members, kids and anonymous callers are refused on every `/api/admin/*` route.

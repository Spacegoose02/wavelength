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
  fetches them for signed-in people (`GET /api/fetch`, limited to those few public sites).
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
| `WAVELENGTH_MUSIC_DIR` | `/music` (image) | The music library. yt-dlp downloads go into a folder inside it. |
| `WAVELENGTH_YTDLP` | `yt-dlp` | The yt-dlp command (the image includes it). |
| `WAVELENGTH_WEB_DIR` | `/app/web` (image) | The app's web build, served at `/`. Without one, `/` goes to the sign-in page. |
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

Every device has its own token. Tokens are stored hashed on the Hub, so a database leak doesn't leak
working tokens. Signing a device out (from the device, from your profile, or by an admin) revokes just
that token; disabling a user signs out all their devices at once.

## Server logins

The Hub keeps the household's server logins so they don't have to be typed into, or stored on, every
device: **Plex**, **Audiobookshelf**, **SUB/WAVE**, **deemix** and **yt-dlp**. **Navidrome logins stay on
each device** (everyone signs in to Navidrome as themselves).

- **Adding them:** in the app, an admin uses **Move to Hub** on a server in Settings → Sources, or on deemix /
  yt-dlp in Settings → Downloads. New Plex, Audiobookshelf and SUB/WAVE servers an admin adds while signed in
  go straight to the Hub.
- **Who gets what** (decided by the Hub, in `servicesFor` in `hub/src/services.ts`):

  | | Admin | Member | Kid |
  |---|---|---|---|
  | Plex, Audiobookshelf, SUB/WAVE listening (login sent to the device) | per the server's **Access**: Everyone, Admins only, or People I choose (admins always) | same | same |
  | SUB/WAVE admin controls (**the Hub** calls SUB/WAVE with the admin login) | ✓ | – | – |
  | deemix and yt-dlp downloads (**the Hub** runs them; the ARL stays on the Hub) | ✓ | only with **Autodownload** | – |

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
| `GET /api/me` | signed in | `{ user, device, permissions }` |
| `PATCH /api/me` | signed in | `{ displayName }` |
| `PUT /api/me/password` | signed in, Hub-password users | `{ currentPassword, newPassword }` |
| `GET /api/me/devices`, `DELETE /api/me/devices/:id` | signed in | your devices |
| `POST /api/me/sso-link` | signed in, SSO on | `{ url, expiresIn }`: one-time link to attach a tinyauth identity |
| `DELETE /api/me/sso` | signed in, with a Hub password | unlink single sign-on |
| `GET /api/me/prefs` | signed in | `{ prefs: { key: { value, updatedAt } } }` |
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
| `GET/POST /api/downloads/deemix/queue` | `downloads.run` | deemix's queue / add `{ link, bitrate? }` (a Deezer link) |
| `POST /api/downloads/ytdlp/search` | `downloads.run` | `{ query }` → `{ results }` (YouTube search, or a link's contents) |
| `GET/POST/DELETE /api/downloads/ytdlp/jobs` | `downloads.run` | downloads (your own; admins see everyone's) / start `{ url, title?, channel? }` / clear finished |
| `POST /api/requests` | `requests.create` | ask for music `{ link, kind?, title, artist?, cover?, note? }` → `{ request }`. With `downloads.run` it is approved (downloaded) straight away |
| `GET /api/requests` | signed in | your requests, newest first; approved ones carry `downloadedAt` and `readyAt` (scanned into the library) |
| `GET /api/requests/counts` | signed in | `{ unseen, pending }`: your decided requests you haven't looked at, and (with `requests.approve`) how many wait |
| `POST /api/requests/seen`, `DELETE /api/requests/:id` | signed in | mark yours as seen / cancel one still waiting |
| `GET /api/admin/requests?status=` | `requests.approve` | everyone's requests, waiting ones first |
| `POST /api/admin/requests/:id/approve` | `requests.approve` | `{ bitrate? }`: the Hub downloads it (Deezer links with deemix, anything else with yt-dlp); `failed` with the reason if that didn't work, and approving again retries |
| `POST /api/admin/requests/:id/reject`, `/have`, `DELETE …/:id` | `requests.approve` | reject `{ reason? }` / "already in the library" / remove |
| `GET /api/people` | signed in | who you can share with: `{ people: [{ id, username, displayName, kid }] }` |
| `POST /api/shares` | signed in | `{ to: userId \| null (everyone), kind, title, subtitle?, cover?, note?, payload }`; `kind` is playlist, album, track, artist, station or favorites; `payload` is `{ tracks: [{ title, artist, album?, duration?, coverUrl? }] }`, `{ station: { name, streamUrl, … } }` or `{ artist }` (512 KB at most) |
| `GET /api/shares?sent=1` | signed in | shared with you (or `sent=1`: what you shared), newest first |
| `GET /api/shares/counts`, `POST /api/shares/seen` | signed in | `{ unseen }` / mark `{ ids? }` (or all) as seen |
| `POST /api/shares/:id/hide`, `DELETE /api/shares/:id` | signed in | take one off your list / unshare (the sender, or an admin) |
| `GET /api/flags` | signed in | `{ flags: [{ id, kind, artist, title, verdict, setBy, createdAt }] }`: kid-safe flags |
| `POST /api/admin/flags`, `DELETE /api/admin/flags/:id` | `library.edit` | set `{ kind: track/album/artist, artist, title?, verdict: block/allow }` (the same item again replaces its verdict) / remove |
| `GET /api/ratings` | signed in | `{ ratings: [{ kind: album/track, artist, album, title, rating: explicit/clean/unknown, cleanLink, checkedAt }] }`: the library check's results |
| `POST /api/admin/ratings`, `DELETE /api/admin/ratings` | `library.edit` | save `{ albums: [{ artist, album, rating, cleanLink?, explicitTracks? }] }` (up to 200; an album sent again replaces its songs) / forget them all |
| `GET /api/admin/server` | `server.view` | the server page: version, uptime, disks, yt-dlp version, counts |
| `GET /api/admin/backup` | `server.view` | a copy of the database (`wavelength-hub-YYYY-MM-DD.db`), audited |
| `GET /api/admin/library` | `server.view` | rescans: `{ navidrome: { url, username } \| null, scanning, lastScanAt, lastError, scanQueued }` |
| `PUT /api/admin/library/navidrome`, `DELETE …` | `keys.manage` | the Navidrome admin login the Hub scans with (`{ url, username, password? }`, checked first, kept sealed) / remove |
| `POST /api/admin/library/scan` | `server.view` | start a Navidrome scan now |
| `GET /api/fetch?url=` | signed in | for the browser: fetches a page from Deezer's API, iHeart, Billboard, Apple's charts feed or RadioWave Monitor (https only, nothing else) |
| `GET /*` | — | the app's web build (`WAVELENGTH_WEB_DIR`); unknown paths get `index.html` |
| `GET /api/me/kid?day=YYYY-MM-DD` | signed in | `{ kid, rules: { bedtimeFrom, bedtimeTo, dailyMinutes }, usedSeconds, pinSet }` |
| `POST /api/me/listened` | signed in | `{ day, seconds }` (5 minutes at most per call) → `{ usedSeconds }`, the total across devices |
| `POST /api/kid/unlock` | signed in | `{ pin }`: checks the grown-up PIN (rate limited, audited) |
| `GET /api/admin/kids?day=` | `users.manage` | `{ pinSet, kids: [{ userId, displayName, rules, usedSeconds }] }` |
| `PUT /api/admin/kids/:userId` | `users.manage` | `{ bedtimeFrom?, bedtimeTo?, dailyMinutes? }` ('HH:MM' device time; null clears) |
| `PUT /api/admin/kid-pin` | `users.manage` | `{ pin }` (4 to 8 digits, stored hashed) or `{ pin: null }` |
| `GET /api/admin/audit?limit=&before=` | `audit.view` | newest first |

A **session** is `{ token, user, permissions, device }`. Browser pages: `/setup`, `/link`, `/auth/sso/link`,
`/auth/sso/connect` (the last two sit behind tinyauth).

## Security notes

- Passwords are hashed with scrypt (N=2¹⁶); device tokens and pairing codes are stored as SHA-256 hashes.
- Sign-in endpoints are rate limited per IP (and per username for passwords).
- Identity headers are only trusted on `/auth/sso/` and only with the proxy secret / from a trusted IP.
- The SSO approve form carries a value signed with the Hub's secret key, so another site can't approve a
  pairing on your behalf.
- Every sign-in, failed sign-in and admin change is written to the audit log (never passwords).
- Only allow a pairing you just started yourself: the confirmation page names the device for that reason.

## Backups

**Settings → Server → Download backup** (admins) saves a copy of the database. Keep `secret.key` from the
data folder next to it. To restore, stop the Hub, put the backup in the data folder as `hub.db` (deleting any
`hub.db-wal` and `hub.db-shm`), and start it again.

Or back up the appdata folder (`hub.db*` and `secret.key`). Keep `secret.key` with the database: it decrypts
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

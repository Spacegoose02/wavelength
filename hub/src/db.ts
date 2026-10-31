import { existsSync, renameSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { audit } from './audit.ts';
import { repairOldFlags } from './kidSafe.ts';

export type Db = DatabaseSync;

/**
 * Schema changes, applied in order and recorded in `PRAGMA user_version`.
 * Never edit a shipped migration: add a new one.
 */
const MIGRATIONS: (string | ((db: Db) => void))[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,          -- lower case
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'member', 'kid')),
    password_hash TEXT,                          -- null = SSO only
    sso_subject   TEXT UNIQUE,                   -- tinyauth Remote-User, lower case
    autodownload  INTEGER NOT NULL DEFAULT 0,    -- may download without approval (never for kids)
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE devices (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    platform     TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,           -- sha256 of the device token; the token itself is never stored
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at   INTEGER
  );
  CREATE INDEX devices_user ON devices(user_id);

  CREATE TABLE pairings (
    id               INTEGER PRIMARY KEY,
    device_code_hash TEXT NOT NULL UNIQUE,
    user_code        TEXT NOT NULL UNIQUE,
    device_name      TEXT NOT NULL,
    platform         TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
    user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at       INTEGER NOT NULL,
    expires_at       INTEGER NOT NULL
  );

  CREATE TABLE prefs (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,                    -- JSON
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
  );

  CREATE TABLE audit (
    id       INTEGER PRIMARY KEY,
    at       INTEGER NOT NULL,
    actor_id INTEGER,                            -- null = system / not signed in
    action   TEXT NOT NULL,
    target   TEXT,
    detail   TEXT,                               -- JSON
    ip       TEXT
  );
  CREATE INDEX audit_at ON audit(at);
  `,
  `
  -- One-time links a signed-in user opens in a browser to attach their tinyauth identity to their account.
  CREATE TABLE sso_links (
    id         INTEGER PRIMARY KEY,
    code_hash  TEXT NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  `,
  `
  -- Server logins kept by the Hub (Plex, Audiobookshelf, SUB/WAVE, deemix, yt-dlp). Secrets are sealed
  -- with AES-256-GCM (crypto.ts seal), never stored in the clear. See docs/HUB.md "Server logins".
  CREATE TABLE services (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL,
    name       TEXT NOT NULL,
    url        TEXT NOT NULL,
    access     TEXT NOT NULL CHECK (access IN ('everyone', 'admins', 'chosen')),
    config     TEXT NOT NULL,                    -- JSON, nothing secret
    secrets    TEXT,                             -- sealed JSON
    position   INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Who may use a 'chosen' service, and anyone's own login for a service (e.g. their Audiobookshelf key).
  CREATE TABLE service_users (
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    secrets    TEXT,                             -- sealed JSON, null = uses the shared login
    PRIMARY KEY (service_id, user_id)
  );
  `,
  `
  -- Music people asked for. An admin approves (the Hub downloads it), rejects, or marks it as already in
  -- the library. See routes/requests.ts.
  CREATE TABLE requests (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    link        TEXT NOT NULL,                   -- Deezer link, or any link yt-dlp understands
    kind        TEXT NOT NULL,                   -- track, album, playlist, artist, video
    title       TEXT NOT NULL,
    artist      TEXT NOT NULL,
    cover       TEXT,
    note        TEXT,
    status      TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'have', 'failed')),
    reason      TEXT,                            -- why it was rejected, or what failed
    via         TEXT,                            -- deemix / yt-dlp, once approved
    decided_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL,
    decided_at  INTEGER,
    seen        INTEGER NOT NULL DEFAULT 1       -- 0 = the requester hasn't seen the decision yet
  );
  CREATE INDEX requests_user ON requests(user_id, created_at);
  CREATE INDEX requests_status ON requests(status, created_at);

  -- Things people share with each other: a playlist, album, song, artist, station or a favorites list,
  -- stored as a snapshot so it plays on the other person's sources. See routes/shares.ts.
  CREATE TABLE shares (
    id          INTEGER PRIMARY KEY,
    from_user   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user     INTEGER REFERENCES users(id) ON DELETE CASCADE,   -- null = everyone in the household
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    subtitle    TEXT,
    cover       TEXT,
    note        TEXT,
    payload     TEXT NOT NULL,                   -- JSON: the tracks / station / album
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX shares_to ON shares(to_user, created_at);

  -- Who has opened (or dismissed) which share.
  CREATE TABLE share_seen (
    share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hidden   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (share_id, user_id)
  );
  `,
  `
  -- Kid-safe flags set by an admin: a song, album or artist that kids don't get ('block'), or something marked
  -- explicit that is fine for them after all ('allow'). Matched by name on each device, since every device
  -- reaches the music through its own logins. See routes/flags.ts.
  CREATE TABLE content_flags (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('track', 'album', 'artist')),
    artist     TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',     -- song or album title; '' for an artist
    verdict    TEXT NOT NULL CHECK (verdict IN ('block', 'allow')),
    set_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX content_flags_key ON content_flags(kind, artist COLLATE NOCASE, title COLLATE NOCASE);
  `,
  `
  -- Kid profiles: bedtime and a daily listening limit per kid (times are the device's local time), how long
  -- each kid listened per day across all their devices, and Hub-wide settings such as the grown-up PIN
  -- (stored hashed) that unlocks bedtime and signing out of a kid profile. See routes/kids.ts.
  CREATE TABLE kid_rules (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bedtime_from  TEXT,                        -- 'HH:MM' or null
    bedtime_to    TEXT,
    daily_minutes INTEGER,                     -- null = no limit
    updated_at    INTEGER NOT NULL
  );
  CREATE TABLE listening (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     TEXT NOT NULL,                     -- 'YYYY-MM-DD', the device's local date
    seconds INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)
  );
  CREATE TABLE hub_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  -- Explicit / clean ratings found by looking the library up on Deezer (for files without the tag, and for
  -- Plex, which doesn't report it). One row per checked album ('unknown' when Deezer didn't have it), plus a
  -- row for each explicit song. Matched by name on each device. See routes/ratings.ts.
  CREATE TABLE ratings (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('album', 'track')),
    artist      TEXT NOT NULL,
    album       TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',     -- song title; '' for an album
    rating      TEXT NOT NULL CHECK (rating IN ('explicit', 'clean', 'unknown')),
    clean_link  TEXT,                         -- explicit albums: the clean version on Deezer
    checked_at  INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX ratings_key ON ratings(kind, artist COLLATE NOCASE, album COLLATE NOCASE, title COLLATE NOCASE);
  `,
  `
  -- Following an approved request until it's in the library: which download it is, when that finished, and
  -- when Navidrome had scanned it in ("your song is ready"). See library.ts.
  ALTER TABLE requests ADD COLUMN job TEXT;              -- 'yt:<job id>', or deemix queue ids as JSON
  ALTER TABLE requests ADD COLUMN downloaded_at INTEGER;
  ALTER TABLE requests ADD COLUMN ready_at INTEGER;
  `,
  `
  -- Cover art an admin picked for an album or an artist, shown on every device instead of the server's own.
  -- The image is a file in <data>/artwork; nothing is written to the music. Matched by name on each device.
  -- See routes/artwork.ts.
  CREATE TABLE artwork (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('album', 'artist')),
    artist     TEXT NOT NULL,
    album      TEXT NOT NULL DEFAULT '',     -- '' for an artist
    file       TEXT NOT NULL,                -- <32 hex>.jpg/png/webp in <data>/artwork
    source     TEXT NOT NULL,                -- Deezer, Apple Music, Cover Art Archive, fanart.tv, link, upload
    set_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX artwork_key ON artwork(kind, artist COLLATE NOCASE, album COLLATE NOCASE);
  `,
  `
  -- Each person's own Wavelength playlists and play history, so they follow them to every device and stay
  -- apart on a shared one. A deleted playlist stays as a tombstone so other devices drop it too. Tracks are
  -- the app's JSON, without per-device stream links where the app can rebuild them. See routes/mine.ts.
  CREATE TABLE user_playlists (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,                -- made by the app (a UUID)
    name       TEXT NOT NULL,
    tracks     TEXT NOT NULL,                -- JSON array
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id)
  );
  CREATE TABLE play_history (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    played_at INTEGER NOT NULL,
    track     TEXT NOT NULL,                 -- JSON
    PRIMARY KEY (user_id, played_at)
  );
  `,
  `
  -- The tag editor's undo log: what each file's tags were before an edit, by batch (one Save is one batch).
  -- See routes/tags.ts.
  CREATE TABLE tag_edits (
    id        INTEGER PRIMARY KEY,
    batch     TEXT NOT NULL,
    path      TEXT NOT NULL,               -- relative to the music folder
    before    TEXT NOT NULL,               -- JSON: the tags that changed, as they were
    after     TEXT NOT NULL,               -- JSON: what they became
    label     TEXT NOT NULL,               -- "Artist – Album", for the list
    user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    at        INTEGER NOT NULL,
    undone_at INTEGER
  );
  CREATE INDEX tag_edits_batch ON tag_edits(batch);
  `,
  `
  -- Invite links: an admin picks the role, the person picks their own username and password.
  -- See routes/invites.ts.
  CREATE TABLE invites (
    id           INTEGER PRIMARY KEY,
    code_hash    TEXT NOT NULL UNIQUE,         -- sha256 of the code; the code itself is only in the link
    role         TEXT NOT NULL CHECK (role IN ('admin', 'member', 'kid')),
    display_name TEXT NOT NULL DEFAULT '',     -- a suggestion, the person can change it
    autodownload INTEGER NOT NULL DEFAULT 0,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    used_at      INTEGER,
    used_by      INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  `,
  `
  -- Every play, kept longer than play_history (which only holds the last 1000 for the app), for Rewind.
  -- See rewind.ts.
  CREATE TABLE plays (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    played_at INTEGER NOT NULL,
    title     TEXT NOT NULL,
    artist    TEXT NOT NULL,
    album     TEXT NOT NULL,
    seconds   INTEGER NOT NULL,            -- the song's length; plays count once half of it was heard
    track     TEXT NOT NULL,               -- JSON, so top songs can be played again
    PRIMARY KEY (user_id, played_at)
  );
  INSERT OR IGNORE INTO plays (user_id, played_at, title, artist, album, seconds, track)
    SELECT user_id, played_at, COALESCE(json_extract(track, '$.title'), ''), COALESCE(json_extract(track, '$.artist'), ''),
      COALESCE(json_extract(track, '$.album'), ''), COALESCE(CAST(json_extract(track, '$.duration') AS INTEGER), 0), track
    FROM play_history WHERE COALESCE(json_extract(track, '$.kind'), 'track') = 'track';
  `,
  `
  -- Albums an admin deleted: their files wait in a hidden folder in the music library (trash.ts) and can be
  -- put back until they're purged after 30 days. One row per moved file or folder.
  CREATE TABLE trash (
    id          INTEGER PRIMARY KEY,
    batch       TEXT NOT NULL,
    label       TEXT NOT NULL,
    path        TEXT NOT NULL,             -- where it was, relative to the music folder
    trash_path  TEXT NOT NULL,             -- where it is now, relative to the music folder
    files       INTEGER NOT NULL,          -- music files in it
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    at          INTEGER NOT NULL,
    restored_at INTEGER,
    purged_at   INTEGER
  );
  CREATE INDEX trash_batch ON trash(batch);
  `,
  `
  -- What each person's devices show as a system notification (notify.ts): a request that's ready or was
  -- turned down, something shared with them, (admins) a new request. Devices ask for the ones after the
  -- last id they saw. Kept for 30 days.
  CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX notifications_user ON notifications(user_id, id);
  `,
  `
  -- Release Radar (radar.ts): the artists each person follows (by Deezer artist id), the new releases the Hub
  -- found for them, when it last looked each artist up, and suggestions someone said no to.
  CREATE TABLE follows (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_id   INTEGER NOT NULL,              -- Deezer artist id
    name        TEXT NOT NULL,
    picture     TEXT,
    followed_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, artist_id)
  );
  CREATE INDEX follows_artist ON follows(artist_id);
  CREATE TABLE radar_artists (
    artist_id  INTEGER PRIMARY KEY,
    checked_at INTEGER NOT NULL,
    error      TEXT                            -- why the last look failed; null when it worked
  );
  CREATE TABLE radar_releases (
    id         INTEGER PRIMARY KEY,            -- Deezer album id
    artist_id  INTEGER NOT NULL,
    artist     TEXT NOT NULL,
    title      TEXT NOT NULL,
    type       TEXT NOT NULL,                  -- album, ep, single, compile
    released   TEXT NOT NULL,                  -- YYYY-MM-DD
    cover      TEXT,
    link       TEXT NOT NULL,
    explicit   INTEGER NOT NULL DEFAULT 0,
    found_at   INTEGER NOT NULL
  );
  CREATE INDEX radar_releases_artist ON radar_releases(artist_id, released);
  CREATE TABLE radar_hidden (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, artist_id)
  );
  `,
  `
  -- Release Radar extras (radar.ts): "Get new releases automatically" per followed artist, as the time it was
  -- turned on (only releases after that are fetched), and which releases were already fetched that way.
  ALTER TABLE follows ADD COLUMN auto_get_at INTEGER;
  CREATE TABLE radar_autoget (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    release_id INTEGER NOT NULL,
    at         INTEGER NOT NULL,
    PRIMARY KEY (user_id, release_id)
  );
  -- Scrobbling (scrobble.ts): each person's ListenBrainz / Last.fm account and the plays waiting to be sent.
  CREATE TABLE scrobble_accounts (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service    TEXT NOT NULL CHECK (service IN ('listenbrainz', 'lastfm')),
    username   TEXT NOT NULL,
    secret     TEXT NOT NULL,                  -- sealed (crypto.ts): ListenBrainz token or Last.fm session key
    created_at INTEGER NOT NULL,
    error      TEXT,                           -- why the last send failed for good (bad token), shown in the app
    PRIMARY KEY (user_id, service)
  );
  CREATE TABLE scrobble_queue (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service   TEXT NOT NULL,
    played_at INTEGER NOT NULL,
    artist    TEXT NOT NULL,
    title     TEXT NOT NULL,
    album     TEXT NOT NULL,
    seconds   INTEGER NOT NULL,
    tries     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX scrobble_queue_user ON scrobble_queue(user_id, service, id);
  `,
  `
  -- Two-step sign-in (totp.ts). enabled_at NULL while being set up; last_step stops a code being used twice;
  -- recovery holds sha256 hashes of the unused recovery codes.
  CREATE TABLE user_totp (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret     TEXT NOT NULL,
    enabled_at INTEGER,
    last_step  INTEGER NOT NULL DEFAULT 0,
    recovery   TEXT NOT NULL DEFAULT '[]'
  );
  -- Parents of kid accounts (family.ts): they approve the kid's requests and get the kid's weekly report.
  CREATE TABLE guardians (
    kid_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guardian_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (kid_id, guardian_id)
  );
  CREATE INDEX guardians_guardian ON guardians(guardian_id);
  -- Household playlists (routes/household.ts): everyone who isn't a kid adds songs to them. Songs are kept
  -- like shares are (title, artist, ...), so each person's app finds them in their own library.
  CREATE TABLE household_playlists (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE household_tracks (
    id          INTEGER PRIMARY KEY,
    playlist_id INTEGER NOT NULL REFERENCES household_playlists(id) ON DELETE CASCADE,
    pos         REAL NOT NULL,
    track       TEXT NOT NULL,
    added_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    added_at    INTEGER NOT NULL
  );
  CREATE INDEX household_tracks_playlist ON household_tracks(playlist_id, pos);
  `,
  (db) => {
    // Kid-safe flags say which version of a song or album they're for, so a flag set on the clean version
    // ("Loud (Clean)") no longer applies to the explicit one: '' (untagged), 'explicit', 'clean' or 'any'
    // (kidSafe.ts). Flags saved before this are sorted out by repairOldFlags.
    db.exec(`
      ALTER TABLE content_flags ADD COLUMN version TEXT NOT NULL DEFAULT '' CHECK (version IN ('', 'explicit', 'clean', 'any'));
      DROP INDEX content_flags_key;
      CREATE UNIQUE INDEX content_flags_key ON content_flags(kind, artist COLLATE NOCASE, title COLLATE NOCASE, version);
    `);
    const { moved, dropped } = repairOldFlags(db);
    if (moved || dropped) audit(db, { action: 'kids.flagsRepaired', detail: { okForKidsMovedToClean: moved, cleanRatingsDropped: dropped } });
  },
  `
  -- A song's or album's explicit tag doesn't make another version of it (an album holds songs tagged explicit and
  -- clean), so flags 0.17.2 saved as 'explicit' are for the album or song as a whole again (kidSafe.ts).
  UPDATE OR REPLACE content_flags SET version = '' WHERE version = 'explicit';
  `,
];

/** The schema version this Hub writes; a backup from a newer Hub can't be restored into it. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * A restore staged by POST /api/admin/restore (routes/server.ts) is swapped in here, before the database
 * is opened. The database it replaces is kept next to it as `hub.db.before-restore-<time>`.
 */
export function applyPendingRestore(file: string): string | null {
  const staged = `${file}.restore`;
  if (!existsSync(staged)) return null;
  const kept = `${file}.before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (existsSync(file)) {
    // fold the write-ahead log in first, so the kept copy is whole on its own
    const old = new DatabaseSync(file);
    old.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    old.close();
    renameSync(file, kept);
  }
  for (const x of ['-wal', '-shm']) rmSync(file + x, { force: true });
  renameSync(staged, file);
  return kept;
}

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const { user_version: from } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = from; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      const m = MIGRATIONS[v];
      if (typeof m === 'string') db.exec(m);
      else m(db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Run `fn` in a transaction. node:sqlite is synchronous, so nothing else interleaves. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/**
 * Schema changes, applied in order and recorded in `PRAGMA user_version`.
 * Never edit a shipped migration: add a new one.
 */
const MIGRATIONS: string[] = [
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
];

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
      db.exec(MIGRATIONS[v]);
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

-- Schema for the Prelegal database.
--
-- Applied in full on every startup against an empty file — see `db.reset_database`.
-- Nothing here needs to be migratable while that stays true.

CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    -- NOCASE so "Ada@example.com" and "ada@example.com" cannot both be
    -- registered; addresses are also lowercased before they are stored.
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    -- `scrypt$N$r$p$salt$hash`, salt and hash both hex — see `app/passwords.py`.
    -- Never the password, and never compared except in constant time.
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- One row per signed-in browser, not per account: signing in on a second device
-- opens a second session and leaves the first working, because nothing here can
-- tell the first device it was signed out.
--
-- `token_hash` is a SHA-256 digest of the bearer token, never the token itself —
-- same reasoning as the password above. A leaked table must not itself be a
-- working set of credentials.
CREATE TABLE sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    -- Fixed at issue and never extended by use: a token is good for
    -- `sessions.SESSION_LIFETIME` from the moment it was minted.
    expires_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);

-- One row per document a user has started drafting, autosaved after each turn.
--
-- `fields` and `transcript` are JSON rather than columns: what fields a document
-- has is defined by the compiled catalog (`documents/catalog.py`), not by
-- anything here, so adding a document needs no change to this file. Nothing in
-- the database enforces their shape — `documents/values.normalise` does, on
-- every read and every write, in `routers/documents.py`.
CREATE TABLE drafts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_slug TEXT NOT NULL,
    fields        TEXT NOT NULL DEFAULT '{}',
    transcript    TEXT NOT NULL DEFAULT '[]',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_drafts_user_id ON drafts(user_id);

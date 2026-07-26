-- Schema for the Prelegal database.
--
-- Applied in full on every startup against an empty file — see `db.reset_database`.
-- Nothing here needs to be migratable while that stays true.

CREATE TABLE users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    -- NOCASE so "Ada@example.com" and "ada@example.com" cannot both be
    -- registered; addresses are also lowercased before they are stored.
    email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- There is deliberately no password column. Sign-in does not authenticate yet
-- (PL-4), so a password reaching the database would be a stored secret that
-- protects nothing. The column arrives with real hashing and sessions.

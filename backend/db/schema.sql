-- ═══════════════════════════════════════════════════════════════════════
-- AlertLedger Engine — Database Schema
-- Compatible: SQLite (dev) | PostgreSQL | MySQL (prod)
-- Run: sqlite3 alertledger.db < schema.sql
-- ═══════════════════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── users ────────────────────────────────────────────────────────────
-- Multi-tenant root. Each institution is one user row.
CREATE TABLE IF NOT EXISTS users (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash    TEXT    NOT NULL,
    institution_name TEXT    NOT NULL,
    role             TEXT    NOT NULL DEFAULT 'admin'
                             CHECK(role IN ('admin','staff')),
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── records ──────────────────────────────────────────────────────────
-- Students / customers per institution (tenant-scoped via user_id).
CREATE TABLE IF NOT EXISTS records (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name        TEXT    NOT NULL,
    category_group   TEXT    NOT NULL DEFAULT 'General',
    contact_phone    TEXT    NOT NULL,
    secondary_phone  TEXT,
    current_balance  REAL    NOT NULL DEFAULT 0.00,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_records_user_id        ON records(user_id);
CREATE INDEX IF NOT EXISTS idx_records_category_group ON records(user_id, category_group);
CREATE INDEX IF NOT EXISTS idx_records_balance        ON records(user_id, current_balance);

-- ── alert_logs ───────────────────────────────────────────────────────
-- Immutable audit trail of every SMS dispatch.
CREATE TABLE IF NOT EXISTS alert_logs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id        INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    user_id          INTEGER NOT NULL REFERENCES users(id),
    message_body     TEXT    NOT NULL,
    phone_number     TEXT    NOT NULL,
    gateway_status   TEXT    NOT NULL DEFAULT 'pending'
                             CHECK(gateway_status IN ('pending','sent','delivered','failed')),
    gateway_msg_id   TEXT,           -- ID returned by SMS provider for DSR matching
    alert_type       TEXT    NOT NULL DEFAULT 'status'
                             CHECK(alert_type IN ('status','debt','custom')),
    sent_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    delivered_at     DATETIME,
    error_detail     TEXT
);

CREATE INDEX IF NOT EXISTS idx_logs_record_id ON alert_logs(record_id);
CREATE INDEX IF NOT EXISTS idx_logs_user_id   ON alert_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_msg_id    ON alert_logs(gateway_msg_id);

-- ── sessions ─────────────────────────────────────────────────────────
-- Lightweight server-side session store.
CREATE TABLE IF NOT EXISTS sessions (
    token            TEXT    PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at       DATETIME NOT NULL,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ── Trigger: auto-update records.updated_at ──────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_records_updated_at
    AFTER UPDATE ON records
    FOR EACH ROW
BEGIN
    UPDATE records SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- ── Seed: default demo admin (password: Admin@1234) ──────────────────
-- Hash generated with bcrypt cost=12. Replace in production.
INSERT OR IGNORE INTO users (username, password_hash, institution_name, role)
VALUES (
    'admin',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUyfAUfb9HqMkCQNFiQWAeQwi',
    'Demo School Uganda',
    'admin'
);

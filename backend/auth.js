'use strict';
/**
 * middleware/auth.js
 * Lightweight token-based session guard.
 * Token stored in HttpOnly cookie + validated against DB sessions table.
 */

const crypto   = require('crypto');
const { queryOne, run } = require('../db');

const SESSION_TTL_HOURS = 8;

// ── Generate a new session token ──────────────────────────────────────
function createSession(userId) {
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000)
        .toISOString().replace('T', ' ').slice(0, 19);

    run(
        `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
        [token, userId, expiresAt]
    );
    return token;
}

// ── Validate and hydrate session ──────────────────────────────────────
function requireAuth(req, res, next) {
    const token = req.cookies?.session;

    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { row } = queryOne(
        `SELECT s.token, s.user_id, s.expires_at,
                u.username, u.institution_name, u.role
         FROM   sessions s
         JOIN   users    u ON u.id = s.user_id
         WHERE  s.token = ?
           AND  datetime(s.expires_at) > datetime('now')`,
        [token]
    );

    if (!row) {
        res.clearCookie('session');
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    req.user = {
        id:              row.user_id,
        username:        row.username,
        institutionName: row.institution_name,
        role:            row.role,
    };

    next();
}

// ── Admin-only guard ──────────────────────────────────────────────────
function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    });
}

// ── Destroy session (logout) ──────────────────────────────────────────
function destroySession(token) {
    run(`DELETE FROM sessions WHERE token = ?`, [token]);
}

// ── Purge expired sessions (run periodically) ─────────────────────────
function purgeExpiredSessions() {
    const { changes } = run(`DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')`);
    if (changes > 0) console.log(`[Auth] Purged ${changes} expired sessions`);
}

module.exports = { createSession, requireAuth, requireAdmin, destroySession, purgeExpiredSessions };

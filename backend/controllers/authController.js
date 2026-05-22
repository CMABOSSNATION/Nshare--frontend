'use strict';
/**
 * controllers/authController.js
 */

const bcrypt  = require('bcrypt');
const { queryOne, run }         = require('../db');
const { createSession, destroySession } = require('../middleware/auth');
const { strip, requireFields }          = require('../middleware/sanitize');

const BCRYPT_ROUNDS = 12;

// ── POST /api/auth/login ──────────────────────────────────────────────
async function login(req, res) {
    const { username, password } = req.body || {};

    const missing = requireFields({ username, password }, ['username', 'password']);
    if (missing) return res.status(400).json({ error: `Field '${missing}' is required` });

    const { row: user } = queryOne(
        `SELECT id, username, password_hash, institution_name, role
         FROM   users WHERE username = ? COLLATE NOCASE`,
        [strip(username)]
    );

    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = createSession(user.id);

    res.cookie('session', token, {
        httpOnly: true,
        sameSite: 'Strict',
        secure:   process.env.NODE_ENV === 'production',
        maxAge:   8 * 3600 * 1000,   // 8 hours
    });

    return res.json({
        ok:              true,
        institutionName: user.institution_name,
        role:            user.role,
        username:        user.username,
    });
}

// ── POST /api/auth/logout ─────────────────────────────────────────────
function logout(req, res) {
    const token = req.cookies?.session;
    if (token) destroySession(token);
    res.clearCookie('session');
    return res.json({ ok: true });
}

// ── POST /api/auth/register ───────────────────────────────────────────
async function register(req, res) {
    const { username, password, institution_name } = req.body || {};

    const missing = requireFields({ username, password, institution_name },
                                  ['username', 'password', 'institution_name']);
    if (missing) return res.status(400).json({ error: `Field '${missing}' is required` });

    if (String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const { row: existing } = queryOne(
        `SELECT id FROM users WHERE username = ? COLLATE NOCASE`, [strip(username)]
    );
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    const { lastInsertRowid } = run(
        `INSERT INTO users (username, password_hash, institution_name, role)
         VALUES (?, ?, ?, 'admin')`,
        [strip(username), hash, strip(institution_name)]
    );

    const token = createSession(lastInsertRowid);
    res.cookie('session', token, {
        httpOnly: true, sameSite: 'Strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 3600 * 1000,
    });

    return res.status(201).json({ ok: true, userId: lastInsertRowid });
}

// ── GET /api/auth/me ──────────────────────────────────────────────────
function me(req, res) {
    return res.json({
        id:              req.user.id,
        username:        req.user.username,
        institutionName: req.user.institutionName,
        role:            req.user.role,
    });
}

module.exports = { login, logout, register, me };

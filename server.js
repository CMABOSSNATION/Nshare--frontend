'use strict';
/**
 * server.js — AlertLedger Engine Entry Point
 * ════════════════════════════════════════════
 * Start: node server.js
 * Dev:   SMS_SIMULATE=true NODE_ENV=development node server.js
 */

require('dotenv').config();

const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');
const { purgeExpiredSessions } = require('./backend/middleware/auth');
const { sanitizeBody }         = require('./backend/middleware/sanitize');
const routes                   = require('./backend/routes');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ──────────────────────────────────────────────────
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options',        'DENY');
    res.setHeader('X-XSS-Protection',       '1; mode=block');
    res.setHeader('Referrer-Policy',        'same-origin');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data:;"
    );
    next();
});

// ── Body parsing ──────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(sanitizeBody);

// ── Static frontend ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'frontend')));

// ── API routes ────────────────────────────────────────────────────────
app.use('/api', routes);

// ── SPA fallback (serve index.html for all non-API routes) ───────────
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
    } else {
        res.status(404).json({ error: 'Route not found' });
    }
});

// ── Global error handler ──────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('[ERROR]', err.message);
    const status = err.status || 500;
    const message = process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message;
    res.status(status).json({ error: message });
});

// ── Periodic housekeeping ─────────────────────────────────────────────
setInterval(purgeExpiredSessions, 30 * 60 * 1000);  // every 30 min

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║   AlertLedger Engine                         ║
║   http://localhost:${PORT}                       ║
║   SMS_SIMULATE: ${process.env.SMS_SIMULATE === 'true' ? 'ON  (dev mode)       ' : 'OFF (live gateway)   '} ║
╚══════════════════════════════════════════════╝`);
});

module.exports = app;

'use strict';
/**
 * middleware/sanitize.js
 * XSS/injection defence layer.
 * Strips dangerous characters from all user-supplied strings.
 */

// Strip HTML tags and control characters
function strip(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/<[^>]*>/g, '')            // strip HTML tags
        .replace(/[<>"'`]/g, '')            // strip remaining dangerous chars
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
        .trim();
}

// Sanitize phone number — Uganda format (+256XXXXXXXXX or 07XXXXXXXX)
function sanitizePhone(raw) {
    if (!raw) return '';
    // Keep only digits and leading +
    let p = String(raw).replace(/[^\d+]/g, '').trim();
    // Normalize 07x → +2567x
    if (/^0[37]\d{8}$/.test(p)) {
        p = '+256' + p.slice(1);
    }
    // Normalize 256... → +256...
    if (/^256\d{9}$/.test(p)) {
        p = '+' + p;
    }
    return p;
}

// Sanitize balance — must be non-negative number
function sanitizeBalance(raw) {
    const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
    return isNaN(n) || n < 0 ? 0 : Math.round(n * 100) / 100;
}

// Express middleware: sanitize req.body strings in place
function sanitizeBody(req, _res, next) {
    if (req.body && typeof req.body === 'object') {
        for (const key of Object.keys(req.body)) {
            if (typeof req.body[key] === 'string') {
                req.body[key] = strip(req.body[key]);
            }
        }
    }
    next();
}

// Validate required fields — returns first missing field name or null
function requireFields(obj, fields) {
    for (const f of fields) {
        if (!obj[f] || String(obj[f]).trim() === '') return f;
    }
    return null;
}

module.exports = { strip, sanitizePhone, sanitizeBalance, sanitizeBody, requireFields };

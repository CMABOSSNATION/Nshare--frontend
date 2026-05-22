'use strict';
/**
 * controllers/recordsController.js
 * Handles all student/customer record CRUD operations.
 * All queries are automatically tenant-scoped via req.user.id.
 */

const { query, queryOne, run, transaction } = require('../db');
const { strip, sanitizePhone, sanitizeBalance, requireFields } = require('../middleware/sanitize');

// ── GET /api/records ──────────────────────────────────────────────────
// Supports: ?group=ClassName  ?debt=1  ?search=name
function list(req, res) {
    const userId  = req.user.id;
    const { group, debt, search } = req.query;

    let sql    = `SELECT id, full_name, category_group, contact_phone, secondary_phone,
                         current_balance, created_at
                  FROM   records
                  WHERE  user_id = ?`;
    const args = [userId];

    if (group && strip(group) !== '') {
        sql += ` AND category_group = ?`;
        args.push(strip(group));
    }

    if (debt === '1') {
        sql += ` AND current_balance > 0`;
    }

    if (search && strip(search) !== '') {
        sql += ` AND (full_name LIKE ? OR contact_phone LIKE ?)`;
        const q = `%${strip(search)}%`;
        args.push(q, q);
    }

    sql += ` ORDER BY category_group, full_name`;

    const { rows } = query(sql, args);

    // Also return distinct groups for the filter dropdown
    const { rows: groups } = query(
        `SELECT DISTINCT category_group FROM records WHERE user_id = ? ORDER BY category_group`,
        [userId]
    );

    return res.json({
        records: rows,
        groups:  groups.map(g => g.category_group),
        total:   rows.length,
    });
}

// ── GET /api/records/:id ──────────────────────────────────────────────
function getOne(req, res) {
    const { row } = queryOne(
        `SELECT * FROM records WHERE id = ? AND user_id = ?`,
        [req.params.id, req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'Record not found' });
    return res.json(row);
}

// ── POST /api/records ─────────────────────────────────────────────────
function create(req, res) {
    const { full_name, category_group, contact_phone, secondary_phone, current_balance } = req.body;

    const missing = requireFields({ full_name, contact_phone }, ['full_name', 'contact_phone']);
    if (missing) return res.status(400).json({ error: `Field '${missing}' is required` });

    const { lastInsertRowid } = run(
        `INSERT INTO records (user_id, full_name, category_group, contact_phone, secondary_phone, current_balance)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            req.user.id,
            strip(full_name),
            strip(category_group || 'General'),
            sanitizePhone(contact_phone),
            sanitizePhone(secondary_phone || ''),
            sanitizeBalance(current_balance),
        ]
    );

    const { row } = queryOne(`SELECT * FROM records WHERE id = ?`, [lastInsertRowid]);
    return res.status(201).json(row);
}

// ── PUT /api/records/:id ──────────────────────────────────────────────
function update(req, res) {
    const { row: existing } = queryOne(
        `SELECT id FROM records WHERE id = ? AND user_id = ?`,
        [req.params.id, req.user.id]
    );
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    const { full_name, category_group, contact_phone, secondary_phone, current_balance } = req.body;

    run(
        `UPDATE records
         SET full_name = ?, category_group = ?, contact_phone = ?,
             secondary_phone = ?, current_balance = ?
         WHERE id = ? AND user_id = ?`,
        [
            strip(full_name),
            strip(category_group || 'General'),
            sanitizePhone(contact_phone),
            sanitizePhone(secondary_phone || ''),
            sanitizeBalance(current_balance),
            req.params.id,
            req.user.id,
        ]
    );

    const { row } = queryOne(`SELECT * FROM records WHERE id = ?`, [req.params.id]);
    return res.json(row);
}

// ── DELETE /api/records/:id ───────────────────────────────────────────
function remove(req, res) {
    const { changes } = run(
        `DELETE FROM records WHERE id = ? AND user_id = ?`,
        [req.params.id, req.user.id]
    );
    if (changes === 0) return res.status(404).json({ error: 'Record not found' });
    return res.json({ ok: true });
}

// ── POST /api/records/bulk-import (CSV/Excel parsed rows) ────────────
// Called by uploadController after parsing the file; receives clean array.
function bulkInsert(userId, parsedRows) {
    let inserted = 0, skipped = 0;
    const errors = [];

    transaction(() => {
        for (const row of parsedRows) {
            const name    = strip(row.name   || row.Name   || '');
            const group   = strip(row.group  || row.Group  || row.Class || 'General');
            const phone   = sanitizePhone(row.phone  || row.Phone  || '');
            const balance = sanitizeBalance(row.balance || row.Balance || 0);

            if (!name || !phone) {
                skipped++;
                errors.push({ row, reason: 'Missing name or phone' });
                continue;
            }

            try {
                run(
                    `INSERT OR IGNORE INTO records
                        (user_id, full_name, category_group, contact_phone, current_balance)
                     VALUES (?, ?, ?, ?, ?)`,
                    [userId, name, group, phone, balance]
                );
                inserted++;
            } catch (e) {
                skipped++;
                errors.push({ row, reason: e.message });
            }
        }
    });

    return { inserted, skipped, errors };
}

module.exports = { list, getOne, create, update, remove, bulkInsert };

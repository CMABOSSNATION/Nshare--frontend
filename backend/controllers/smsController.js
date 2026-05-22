'use strict';
/**
 * controllers/smsController.js
 * ═════════════════════════════
 * Three endpoints:
 *   POST /api/sms/status-alert  — Feature B: checkbox-triggered alert
 *   POST /api/sms/debt-blast    — Feature C: bulk debt reminder
 *   POST /api/sms/callback      — Feature D: DSR webhook from gateway
 */

const { query, queryOne, run } = require('../db');
const { bulkSend }             = require('../services/smsGateway');
const { strip }                = require('../middleware/sanitize');

// ── POST /api/sms/status-alert ────────────────────────────────────────
// Feature B: Send status alert to a specific set of checked record IDs.
// Body: { recordIds: [1, 2, 3] }
async function statusAlert(req, res) {
    const { recordIds } = req.body || {};
    if (!Array.isArray(recordIds) || recordIds.length === 0) {
        return res.status(400).json({ error: 'recordIds must be a non-empty array' });
    }

    // Sanitize: ensure all IDs are integers belonging to this tenant
    const safeIds = recordIds
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id) && id > 0);

    if (safeIds.length === 0) {
        return res.status(400).json({ error: 'No valid record IDs provided' });
    }

    // Fetch records (tenant-scoped — user_id check prevents cross-tenant access)
    const placeholders = safeIds.map(() => '?').join(',');
    const { rows: records } = query(
        `SELECT id, full_name, contact_phone, current_balance
         FROM   records
         WHERE  id IN (${placeholders}) AND user_id = ?`,
        [...safeIds, req.user.id]
    );

    if (records.length === 0) {
        return res.status(404).json({ error: 'No matching records found for this account' });
    }

    const result = await bulkSend(
        records,
        req.user.institutionName,
        'status',
        null,
        req.user.id
    );

    return res.json({
        ok:       true,
        sent:     result.sent,
        failed:   result.failed,
        total:    records.length,
        details:  result.details,
    });
}

// ── POST /api/sms/debt-blast ──────────────────────────────────────────
// Feature C: Broadcast debt reminders to ALL records with balance > 0.
// Body: { customTemplate?: string, groupFilter?: string }
async function debtBlast(req, res) {
    const { customTemplate, groupFilter } = req.body || {};

    let sql  = `SELECT id, full_name, contact_phone, current_balance
                FROM   records
                WHERE  user_id = ? AND current_balance > 0`;
    const args = [req.user.id];

    if (groupFilter && strip(groupFilter) !== '') {
        sql  += ` AND category_group = ?`;
        args.push(strip(groupFilter));
    }

    sql += ` ORDER BY category_group, full_name`;

    const { rows: records } = query(sql, args);

    if (records.length === 0) {
        return res.json({ ok: true, message: 'No outstanding balances found', sent: 0 });
    }

    const template = customTemplate ? strip(customTemplate) : null;

    const result = await bulkSend(
        records,
        req.user.institutionName,
        'debt',
        template,
        req.user.id
    );

    return res.json({
        ok:      true,
        sent:    result.sent,
        failed:  result.failed,
        total:   records.length,
        details: result.details,
    });
}

// ── POST /api/sms/callback ────────────────────────────────────────────
// Feature D: DSR (Delivery Status Report) webhook from SMS gateway.
// Africa's Talking, EgoSMS, and most providers POST to this URL.
//
// Expected payload (varies by provider — we normalise both):
//  AT:      { id, status, phoneNumber, ... }
//  EgoSMS:  { msgId, deliveryStatus, msisdn, ... }
//  Generic: { messageId, status, phone, ... }
function smsCallback(req, res) {
    // Acknowledge immediately (gateway expects 200 fast)
    res.status(200).json({ ok: true });

    const body = req.body || {};

    // Normalise across providers
    const gatewayMsgId = body.id        || body.msgId     || body.messageId  || null;
    const rawStatus    = body.status    || body.deliveryStatus || body.deliveryStatus || '';
    const phone        = body.phoneNumber || body.msisdn   || body.phone || '';

    if (!gatewayMsgId) {
        console.warn('[DSR] Callback received with no message ID', body);
        return;
    }

    // Map provider status strings to our internal enum
    let internalStatus = 'sent';
    const s = rawStatus.toString().toLowerCase();
    if (['delivered', 'delivrd', 'delivery_success', '1', 'success'].some(v => s.includes(v))) {
        internalStatus = 'delivered';
    } else if (['failed', 'undelivered', 'rejected', 'error', '2', '0'].some(v => s.includes(v))) {
        internalStatus = 'failed';
    }

    // Update the alert_log row matching this gateway message ID
    const { changes } = run(
        `UPDATE alert_logs
         SET    gateway_status = ?,
                delivered_at   = CASE WHEN ? = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END,
                error_detail   = CASE WHEN ? = 'failed'    THEN ? ELSE error_detail END
         WHERE  gateway_msg_id = ?`,
        [internalStatus, internalStatus, internalStatus, rawStatus, gatewayMsgId]
    );

    console.log(`[DSR] msgId=${gatewayMsgId} status=${internalStatus} rows=${changes}`);
}

// ── GET /api/sms/logs ─────────────────────────────────────────────────
// Return alert history for the logged-in institution
function getLogs(req, res) {
    const limit  = Math.min(parseInt(req.query.limit  || '50',  10), 200);
    const offset = Math.max(parseInt(req.query.offset || '0',   10), 0);

    const { rows } = query(
        `SELECT al.id, al.phone_number, al.message_body, al.gateway_status,
                al.alert_type, al.gateway_msg_id, al.sent_at, al.delivered_at,
                r.full_name, r.category_group
         FROM   alert_logs al
         JOIN   records    r  ON r.id = al.record_id
         WHERE  al.user_id = ?
         ORDER  BY al.sent_at DESC
         LIMIT  ? OFFSET ?`,
        [req.user.id, limit, offset]
    );

    const { row: countRow } = queryOne(
        `SELECT COUNT(*) as total FROM alert_logs WHERE user_id = ?`,
        [req.user.id]
    );

    return res.json({ logs: rows, total: countRow.total, limit, offset });
}

// ── GET /api/sms/stats ────────────────────────────────────────────────
function getStats(req, res) {
    const { row } = queryOne(
        `SELECT
            COUNT(*)                                           AS total,
            SUM(CASE WHEN gateway_status='sent'      THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN gateway_status='delivered' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN gateway_status='failed'    THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN gateway_status='pending'   THEN 1 ELSE 0 END) AS pending
         FROM alert_logs WHERE user_id = ?`,
        [req.user.id]
    );
    return res.json(row);
}

module.exports = { statusAlert, debtBlast, smsCallback, getLogs, getStats };

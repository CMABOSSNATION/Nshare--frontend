'use strict';
/**
 * services/smsGateway.js
 * ════════════════════════
 * Decoupled SMS dispatch service.
 * Supports: EgoSMS (Uganda), Africa's Talking, generic REST gateway.
 *
 * To switch providers, change SMS_PROVIDER env var and add a case block.
 * The rest of the app never touches this file.
 */

const https = require('https');
const http  = require('http');
const { run } = require('../db');

const PROVIDER      = (process.env.SMS_PROVIDER  || 'egosms').toLowerCase();
const API_KEY       = process.env.SMS_API_KEY     || 'DEMO_KEY';
const API_SECRET    = process.env.SMS_API_SECRET  || 'DEMO_SECRET';
const SENDER_ID     = process.env.SMS_SENDER_ID   || 'AlertLedger';
const AT_USERNAME   = process.env.AT_USERNAME     || 'sandbox';
const SIMULATE      = process.env.SMS_SIMULATE    === 'true' || process.env.NODE_ENV === 'development';

// ── Message Template ──────────────────────────────────────────────────

/**
 * Build dynamic message body.
 * Uses strict fallback structure for unregistered Sender IDs.
 *
 * @param {string} institutionName
 * @param {object} record  { full_name, current_balance }
 * @param {'status'|'debt'|'custom'} type
 * @param {string} [customBody]
 */
function buildMessage(institutionName, record, type = 'status', customBody = null) {
    const inst    = institutionName || 'Your Institution';
    const name    = record.full_name || 'Student/Customer';
    const balance = Number(record.current_balance || 0).toLocaleString('en-UG');

    if (customBody) {
        // Replace template variables in custom body
        return customBody
            .replace(/\{\{full_name\}\}/gi,         name)
            .replace(/\{\{current_balance\}\}/gi,   balance)
            .replace(/\{\{institution_name\}\}/gi,  inst);
    }

    if (type === 'debt') {
        return `${inst} Notice: Hello, the status of ${name} requires attention. ` +
               `Balance: ${balance} UGX. Please clear immediately.`;
    }

    // Default status alert
    return `${inst}: The status of ${name} has been updated. ` +
           `Current balance: ${balance} UGX. Contact us for details.`;
}

// ── Provider Payload Builders ─────────────────────────────────────────

function buildEgoSmsPayload(phone, message) {
    return {
        username: API_KEY,
        password: API_SECRET,
        to:       phone,
        message,
        sender:   SENDER_ID,
    };
}

function buildAfricasTalkingPayload(phone, message) {
    // Africa's Talking uses form-encoded body
    return new URLSearchParams({
        username: AT_USERNAME,
        to:       phone,
        message,
        from:     SENDER_ID === 'AlertLedger' ? undefined : SENDER_ID,
    }).toString();
}

function buildGenericPayload(phone, message) {
    return { apiKey: API_KEY, to: phone, message, from: SENDER_ID };
}

// ── HTTP POST helper ──────────────────────────────────────────────────

function httpPost(url, payload, headers = {}) {
    return new Promise((resolve, reject) => {
        const body       = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const parsed     = new URL(url);
        const transport  = parsed.protocol === 'https:' ? https : http;
        const defaultHdr = {
            'Content-Type':   typeof payload === 'string' ? 'application/x-www-form-urlencoded'
                                                          : 'application/json',
            'Content-Length': Buffer.byteLength(body),
            ...headers,
        };

        const options = {
            hostname: parsed.hostname,
            port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path:     parsed.pathname + parsed.search,
            method:   'POST',
            headers:  defaultHdr,
            timeout:  15000,
        };

        const req = transport.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end',  ()    => resolve({ status: res.statusCode, body: data }));
        });

        req.on('timeout', () => { req.destroy(); reject(new Error('Gateway timeout')); });
        req.on('error',   reject);
        req.write(body);
        req.end();
    });
}

// ── Core dispatch function ────────────────────────────────────────────

/**
 * Send a single SMS via the configured gateway.
 *
 * @param {string} phone        — E.164 format (+256XXXXXXXXX)
 * @param {string} message
 * @returns {{ success: boolean, gatewayMsgId: string|null, error: string|null }}
 */
async function sendSms(phone, message) {
    if (SIMULATE) {
        // Development mode — log and fake success
        const fakeId = 'SIM-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
        console.log(`[SMS SIM] → ${phone}: ${message.slice(0, 60)}… [msgId: ${fakeId}]`);
        return { success: true, gatewayMsgId: fakeId, error: null };
    }

    try {
        let url, payload, headers = {};

        switch (PROVIDER) {
            case 'africastalking':
                url     = 'https://api.africastalking.com/version1/messaging';
                payload = buildAfricasTalkingPayload(phone, message);
                headers = {
                    apiKey: API_KEY,
                    Accept: 'application/json',
                };
                break;

            case 'egosms':
                url     = 'https://www.egosms.co/api/v1/plain/';
                payload = buildEgoSmsPayload(phone, message);
                break;

            default:
                // Generic REST — set SMS_GATEWAY_URL for custom providers
                url     = process.env.SMS_GATEWAY_URL || 'https://sms.example.com/api/send';
                payload = buildGenericPayload(phone, message);
        }

        const res = await httpPost(url, payload, headers);

        // Parse response — normalise across providers
        let parsed = {};
        try { parsed = JSON.parse(res.body); } catch {}

        // Africa's Talking success
        if (PROVIDER === 'africastalking') {
            const recipients = parsed?.SMSMessageData?.Recipients?.[0];
            if (recipients?.status === 'Success' || recipients?.statusCode === 101) {
                return { success: true, gatewayMsgId: recipients.messageId, error: null };
            }
            return { success: false, gatewayMsgId: null, error: recipients?.status || 'AT error' };
        }

        // EgoSMS: status 200 + response code 1000 = success
        if (PROVIDER === 'egosms') {
            if (res.status === 200 && (parsed.code === 1000 || parsed.status === 'OK')) {
                return { success: true, gatewayMsgId: parsed.msgId || parsed.id || null, error: null };
            }
            return { success: false, gatewayMsgId: null, error: parsed.description || 'EgoSMS error' };
        }

        // Generic: treat 2xx as success
        if (res.status >= 200 && res.status < 300) {
            return { success: true, gatewayMsgId: parsed.id || parsed.msgId || null, error: null };
        }

        return { success: false, gatewayMsgId: null, error: `HTTP ${res.status}` };

    } catch (err) {
        console.error('[SMS] Dispatch error:', err.message);
        return { success: false, gatewayMsgId: null, error: err.message };
    }
}

// ── Bulk dispatch ─────────────────────────────────────────────────────

/**
 * Send SMS to multiple recipients and write to alert_logs.
 *
 * @param {Array<{id, full_name, contact_phone, current_balance}>} records
 * @param {string} institutionName
 * @param {'status'|'debt'|'custom'} alertType
 * @param {string|null} customTemplate
 * @param {number} userId
 * @returns {{ sent: number, failed: number, details: Array }}
 */
async function bulkSend(records, institutionName, alertType, customTemplate, userId) {
    let sent = 0, failed = 0;
    const details = [];

    // 50ms delay between each SMS to respect gateway rate limits
    const DELAY_MS = parseInt(process.env.SMS_DELAY_MS || '50', 10);

    for (const record of records) {
        const phone   = record.contact_phone;
        const message = buildMessage(institutionName, record, alertType, customTemplate);

        const result  = await sendSms(phone, message);

        const status  = result.success ? 'sent' : 'failed';

        // Write to audit log
        run(
            `INSERT INTO alert_logs
                (record_id, user_id, message_body, phone_number, gateway_status, gateway_msg_id, alert_type)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [record.id, userId, message, phone, status, result.gatewayMsgId, alertType]
        );

        if (result.success) sent++;
        else failed++;

        details.push({
            recordId:    record.id,
            name:        record.full_name,
            phone,
            status,
            gatewayMsgId: result.gatewayMsgId,
            error:       result.error,
        });

        if (DELAY_MS > 0) await sleep(DELAY_MS);
    }

    return { sent, failed, details };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { sendSms, bulkSend, buildMessage };

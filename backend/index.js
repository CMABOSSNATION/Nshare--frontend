'use strict';
/**
 * routes/index.js — Central router
 */

const express  = require('express');
const router   = express.Router();

const authCtrl    = require('../controllers/authController');
const recordsCtrl = require('../controllers/recordsController');
const smsCtrl     = require('../controllers/smsController');
const uploadCtrl  = require('../controllers/uploadController');
const { requireAuth } = require('../middleware/auth');

// ── Auth ──────────────────────────────────────────────────────────────
router.post('/auth/login',    authCtrl.login);
router.post('/auth/logout',   authCtrl.logout);
router.post('/auth/register', authCtrl.register);
router.get('/auth/me',        requireAuth, authCtrl.me);

// ── Records (all tenant-scoped) ───────────────────────────────────────
router.get('/records',          requireAuth, recordsCtrl.list);
router.get('/records/:id',      requireAuth, recordsCtrl.getOne);
router.post('/records',         requireAuth, recordsCtrl.create);
router.put('/records/:id',      requireAuth, recordsCtrl.update);
router.delete('/records/:id',   requireAuth, recordsCtrl.remove);

// ── Upload (Feature A) ────────────────────────────────────────────────
router.post('/upload',          requireAuth, uploadCtrl.handleUpload);

// ── SMS (Features B, C, D) ────────────────────────────────────────────
router.post('/sms/status-alert', requireAuth, smsCtrl.statusAlert);
router.post('/sms/debt-blast',   requireAuth, smsCtrl.debtBlast);
router.post('/sms/callback',     smsCtrl.smsCallback);   // No auth — public webhook
router.get('/sms/logs',          requireAuth, smsCtrl.getLogs);
router.get('/sms/stats',         requireAuth, smsCtrl.getStats);

module.exports = router;

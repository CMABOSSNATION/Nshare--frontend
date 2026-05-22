'use strict';
/**
 * controllers/uploadController.js
 * ════════════════════════════════
 * Handles CSV and Excel (.xlsx/.xls) file uploads.
 * Parses rows and delegates to recordsController.bulkInsert().
 *
 * Supported column headers (case-insensitive, any order):
 *   Name | Full Name | Student | Customer
 *   Group | Class | Category | Building Block
 *   Phone | Contact | Mobile | Tel
 *   Balance | Amount | Debt | Fee
 */

const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const csv     = require('csv-parse/sync');
const XLSX    = require('xlsx');
const { bulkInsert } = require('./recordsController');

// ── Multer disk storage ───────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename:    (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, `${Date.now()}-${safe}`);
    },
});

const fileFilter = (_req, file, cb) => {
    const allowed = [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/csv',
        'text/plain',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || ['.csv', '.xlsx', '.xls'].includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Only CSV and Excel files are accepted'));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
}).single('file');

// ── Column header aliases ─────────────────────────────────────────────
const COL_NAME    = ['name', 'full name', 'full_name', 'student', 'customer', 'pupil'];
const COL_GROUP   = ['group', 'class', 'category', 'category_group', 'building block', 'level', 'stream'];
const COL_PHONE   = ['phone', 'contact', 'mobile', 'tel', 'telephone', 'contact_phone', 'phone number'];
const COL_BALANCE = ['balance', 'amount', 'debt', 'fee', 'fees', 'current_balance', 'outstanding'];

function normalizeHeaders(rawRow) {
    const out = {};
    for (const [key, val] of Object.entries(rawRow)) {
        const k = key.trim().toLowerCase();
        if (COL_NAME.some(h => k.includes(h)))    out.name    = val;
        if (COL_GROUP.some(h => k.includes(h)))   out.group   = val;
        if (COL_PHONE.some(h => k.includes(h)))   out.phone   = val;
        if (COL_BALANCE.some(h => k.includes(h))) out.balance = val;
    }
    return out;
}

// ── Parse CSV ─────────────────────────────────────────────────────────
function parseCsv(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const records = csv.parse(content, {
        columns:          true,
        skip_empty_lines: true,
        trim:             true,
        bom:              true,   // handle Excel-generated BOM
    });
    return records.map(normalizeHeaders);
}

// ── Parse Excel ───────────────────────────────────────────────────────
function parseExcel(filePath) {
    const wb   = XLSX.readFile(filePath, { cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]]; // first sheet
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    return rows.map(normalizeHeaders);
}

// ── POST /api/upload ──────────────────────────────────────────────────
function handleUpload(req, res) {
    upload(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: `Upload error: ${err.message}` });
        }
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const filePath = req.file.path;
        const ext      = path.extname(req.file.originalname).toLowerCase();

        let parsedRows;
        try {
            parsedRows = ext === '.csv' || ext === '.txt'
                ? parseCsv(filePath)
                : parseExcel(filePath);
        } catch (parseErr) {
            fs.unlink(filePath, () => {});
            return res.status(422).json({
                error:   'Could not parse file',
                detail:  parseErr.message,
                hint:    'Ensure columns: Name, Group, Phone, Balance',
            });
        }

        // Clean up temp file
        fs.unlink(filePath, () => {});

        if (!parsedRows || parsedRows.length === 0) {
            return res.status(422).json({ error: 'File is empty or has no recognisable rows' });
        }

        // Delegate to bulk insert
        const result = bulkInsert(req.user.id, parsedRows);

        return res.json({
            ok:       true,
            parsed:   parsedRows.length,
            inserted: result.inserted,
            skipped:  result.skipped,
            errors:   result.errors.slice(0, 10), // cap error list
        });
    });
}

module.exports = { handleUpload };

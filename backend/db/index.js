'use strict';
/**
 * db/index.js — SQLite connection pool
 * Drop-in for PostgreSQL: swap `better-sqlite3` → `pg` Pool and
 * change `?` placeholders to `$1,$2…` in all queries.
 */

const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');

const DB_PATH  = process.env.DB_PATH  || path.join(__dirname, '..', '..', 'alertledger.db');
const SQL_PATH = path.join(__dirname, 'schema.sql');

let _db = null;

function getDb() {
    if (_db) return _db;

    _db = new Database(DB_PATH, {
        verbose: process.env.NODE_ENV === 'development' ? console.log : null,
    });

    // Performance pragmas
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('cache_size = -8000');   // 8 MB page cache
    _db.pragma('temp_store = MEMORY');

    // Run schema migrations on first boot
    const schema = fs.readFileSync(SQL_PATH, 'utf8');
    _db.exec(schema);

    console.log(`[DB] Connected → ${DB_PATH}`);
    return _db;
}

/**
 * Tiny query helpers that mirror pg's {rows} pattern so controllers
 * don't change when migrating to PostgreSQL.
 */
function query(sql, params = []) {
    const db   = getDb();
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    return { rows };
}

function queryOne(sql, params = []) {
    const db   = getDb();
    const stmt = db.prepare(sql);
    const row  = stmt.get(...params);
    return { row };
}

function run(sql, params = []) {
    const db   = getDb();
    const stmt = db.prepare(sql);
    const info = stmt.run(...params);
    return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
}

function transaction(fn) {
    return getDb().transaction(fn)();
}

module.exports = { getDb, query, queryOne, run, transaction };

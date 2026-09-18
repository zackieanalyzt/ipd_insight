// ─────────────────────────────────────────────────────────────
// auth.js — Authentication subsystem (OWASP Phase 2)
//
// Two backends:
//   1. PostgreSQL (Pool from server.js) — production DB
//   2. SQLite (local file) — dev/CSV-fallback mode
//
// Tables (run on production DB server):
//   ipd_auth_users, ipd_auth_audit_log
// ─────────────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const session = require('express-session');

const SQLITE_PATH = path.join(__dirname, 'auth.db');
const SALT_ROUNDS = 12;

let pgPool = null;       // Set by setPool()
let sqliteDb = null;     // Fallback when pgPool is unavailable
let activeBackend = 'sqlite'; // 'pg' | 'sqlite'

// ── Init (called from server.js with the pg Pool) ─────────────
function setPool(pool) {
    pgPool = pool;
}

async function initAuthDb() {
    // Try PostgreSQL first
    if (pgPool) {
        try {
            const client = await pgPool.connect();
            try {
                // Idempotent CREATE — safe to run even if tables already exist
                await client.query(`
                    CREATE TABLE IF NOT EXISTS ipd_auth_users (
                        id           SERIAL PRIMARY KEY,
                        username     VARCHAR(100) UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL,
                        display_name VARCHAR(200) NOT NULL DEFAULT '',
                        role         VARCHAR(20) NOT NULL DEFAULT 'viewer',
                        is_active    BOOLEAN NOT NULL DEFAULT true,
                        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                        last_login   TIMESTAMPTZ
                    );
                    CREATE TABLE IF NOT EXISTS ipd_auth_audit_log (
                        id         SERIAL PRIMARY KEY,
                         timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
                        ip         VARCHAR(45),
                        username   VARCHAR(100),
                        action     VARCHAR(50) NOT NULL,
                        resource   VARCHAR(200),
                        success    BOOLEAN NOT NULL DEFAULT true,
                        detail     TEXT
                    );
                `);
                activeBackend = 'pg';
                console.log('[auth] PostgreSQL backend ready');
                return;
            } finally {
                client.release();
            }
        } catch (err) {
            console.warn('[auth] PostgreSQL not available, falling back to SQLite:', err.message);
            // Fall through to SQLite
        }
    }

    // Fallback: SQLite local file
    sqliteDb = new Database(SQLITE_PATH);
    sqliteDb.pragma('journal_mode = WAL');

    sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS ipd_auth_users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name  TEXT NOT NULL DEFAULT '',
            role          TEXT NOT NULL DEFAULT 'viewer',
            is_active     INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            last_login    TEXT
        );
        CREATE TABLE IF NOT EXISTS ipd_auth_audit_log (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            ip        TEXT,
            username  TEXT,
            action    TEXT NOT NULL,
            resource  TEXT,
            success   INTEGER NOT NULL DEFAULT 1,
            detail    TEXT
        );
    `);

    // Seed default dev users if table is empty
    const row = sqliteDb.prepare('SELECT COUNT(*) AS cnt FROM ipd_auth_users').get();
    if (row.cnt === 0) {
        const hash1 = bcrypt.hashSync('admin123', SALT_ROUNDS);
        const hash2 = bcrypt.hashSync('viewer123', SALT_ROUNDS);
        const hash3 = bcrypt.hashSync('analyst123', SALT_ROUNDS);
        sqliteDb.prepare('INSERT INTO ipd_auth_users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')
            .run('admin', hash1, 'Admin', 'admin');
        sqliteDb.prepare('INSERT INTO ipd_auth_users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')
            .run('viewer', hash2, 'Viewer', 'viewer');
        sqliteDb.prepare('INSERT INTO ipd_auth_users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')
            .run('analyst', hash3, 'Analyst', 'analyst');
        console.log('[auth] Seeded SQLite with admin, viewer, analyst (pass = username+123)');
    }

    activeBackend = 'sqlite';
    console.log(`[auth] SQLite backend ready at ${SQLITE_PATH}`);
}

// ── Session middleware ───────────────────────────────────────
function createSessionMiddleware() {
    return session({
        name: 'ipd_insight.sid',
        secret: process.env.SESSION_SECRET || (() => {
            const crypto = require('crypto');
            const fallback = crypto.randomBytes(32).toString('hex');
            console.warn('[auth] WARNING: SESSION_SECRET not set; using random fallback (will invalidate on restart).');
            return fallback;
        })(),
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'strict',
            secure: false,   // Set true when HTTPS is enforced
            maxAge: 2 * 60 * 60 * 1000  // 2 hours
        }
    });
}

// ── Core: login ──────────────────────────────────────────────
async function login(username, password, ip) {
    // Try PostgreSQL first if the pool is available
    if (pgPool) {
        try {
            const { rows } = await pgPool.query(
                'SELECT id, username, password_hash, display_name, role FROM ipd_auth_users WHERE username = $1 AND is_active = true',
                [username]
            );
            const user = rows[0];
            if (!user) {
                await auditPg(ip, username, 'LOGIN_FAIL', '/login', false, 'user not found');
                return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
            }
            const match = bcrypt.compareSync(password, user.password_hash);
            if (!match) {
                await auditPg(ip, username, 'LOGIN_FAIL', '/login', false, 'wrong password');
                return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
            }
            await pgPool.query("UPDATE ipd_auth_users SET last_login = now() WHERE id = $1", [user.id]);
            await auditPg(ip, username, 'LOGIN', '/login', true);
            activeBackend = 'pg';
            return {
                success: true,
                user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role }
            };
        } catch (err) {
            console.warn('[auth] pg login failed, falling back to sqlite:', err.message);
            activeBackend = 'sqlite';
            // fall through to sqlite
        }
    }

    // Fallback: SQLite local file
    return directSqliteLogin(username, password, ip);
}

function directSqliteLogin(username, password, ip) {
    const user = sqliteDb.prepare(
        'SELECT id, username, password_hash, display_name, role FROM ipd_auth_users WHERE username = ? AND is_active = 1'
    ).get(username);

    if (!user) {
        auditSqlite(ip, username, 'LOGIN_FAIL', '/login', false, 'user not found');
        return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }

    const match = bcrypt.compareSync(password, user.password_hash);
    if (!match) {
        auditSqlite(ip, username, 'LOGIN_FAIL', '/login', false, 'wrong password');
        return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    }

    sqliteDb.prepare("UPDATE ipd_auth_users SET last_login = datetime('now') WHERE id = ?").run(user.id);
    auditSqlite(ip, username, 'LOGIN', '/login', true);
    activeBackend = 'sqlite';
    return {
        success: true,
        user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role }
    };
}

// ── Core: logout ─────────────────────────────────────────────
async function logout(ip, username) {
    await doAudit(ip, username, 'LOGOUT', '/logout', true);
}

// ── Middleware ───────────────────────────────────────────────
function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
    }
    next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
        }
        if (!roles.includes(req.session.user.role)) {
            doAudit(req.ip, req.session.user.username, 'FORBIDDEN', req.path, false,
                `role=${req.session.user.role} needs=${roles}`).catch(() => {});
            return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' });
        }
        next();
    };
}

// ── Audit ────────────────────────────────────────────────────
async function doAudit(ip, username, action, resource, success, detail) {
    if (activeBackend === 'pg' && pgPool) {
        try {
            await pgPool.query(
                'INSERT INTO ipd_auth_audit_log (ip, username, action, resource, success, detail) VALUES ($1, $2, $3, $4, $5, $6)',
                [ip || '', username || 'anonymous', action, resource || '', success, detail || '']
            );
        } catch (e) {
            console.error('[auth] audit pg error:', e.message);
        }
    } else if (sqliteDb) {
        auditSqlite(ip, username, action, resource, success, detail);
    }
}

// Direct wrappers for synchronous use (middleware / sqlite)
function auditSqlite(ip, username, action, resource, success, detail) {
    if (!sqliteDb) return;
    try {
        sqliteDb.prepare(
            'INSERT INTO ipd_auth_audit_log (ip, username, action, resource, success, detail) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(ip || '', username || 'anonymous', action, resource || '', success ? 1 : 0, detail || '');
    } catch (e) {
        console.error('[auth] audit sqlite error:', e.message);
    }
}

async function auditPg(ip, username, action, resource, success, detail) {
    try {
        await pgPool.query(
            'INSERT INTO ipd_auth_audit_log (ip, username, action, resource, success, detail) VALUES ($1, $2, $3, $4, $5, $6)',
            [ip || '', username || 'anonymous', action, resource || '', success, detail || '']
        );
    } catch (e) {
        console.error('[auth] audit pg error:', e.message);
    }
}

// ── API route helper ──────────────────────────────────────────
async function getAuditLog(req, res) {
    try {
        if (activeBackend === 'pg' && pgPool && pgPool.totalCount !== 0) {
            const { rows } = await pgPool.query(
                'SELECT * FROM ipd_auth_audit_log ORDER BY id DESC LIMIT 100'
            );
            return res.json(rows);
        }
        const rows = sqliteDb.prepare('SELECT * FROM ipd_auth_audit_log ORDER BY id DESC LIMIT 100').all();
        res.json(rows);
    } catch (err) {
        console.error('[auth] getAuditLog error:', err.message);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึง audit log' });
    }
}

// ── Export ────────────────────────────────────────────────────
module.exports = {
    setPool,
    initAuthDb,
    createSessionMiddleware,
    login,
    logout,
    requireAuth,
    requireRole,
    getAuditLog,
    audit: doAudit
};
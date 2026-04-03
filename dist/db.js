"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.generateId = generateId;
exports.createMessage = createMessage;
exports.updateMessage = updateMessage;
exports.getMessage = getMessage;
exports.listMessages = listMessages;
exports.createReceivedMessage = createReceivedMessage;
exports.getStats = getStats;
exports.getPendingMessages = getPendingMessages;
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("./config");
let db;
let dbPath;
const MIGRATIONS = [
    {
        version: 1,
        description: 'Create messages table',
        up: `
      CREATE TABLE IF NOT EXISTS messages (
        id          TEXT    PRIMARY KEY,
        phone       TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        body        TEXT,
        image_url   TEXT,
        caption     TEXT,
        status      TEXT    NOT NULL DEFAULT 'queued',
        whatsapp_id TEXT,
        error       TEXT,
        queued_at   INTEGER NOT NULL,
        sent_at     INTEGER,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_status  ON messages(status);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
    `,
    },
    {
        version: 2,
        description: 'Add direction column (outbound/inbound)',
        up: `
      ALTER TABLE messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'outbound';
      CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
    `,
    },
    {
        version: 3,
        description: 'Create contacts table for inbound tracking',
        up: `
      CREATE TABLE IF NOT EXISTS contacts (
        jid           TEXT    PRIMARY KEY,
        message_count INTEGER NOT NULL DEFAULT 0,
        first_seen    INTEGER NOT NULL,
        last_seen     INTEGER NOT NULL
      );
    `,
    },
];
function persist() {
    const data = db.export();
    fs_1.default.writeFileSync(dbPath, Buffer.from(data));
}
function runMigrations() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      description TEXT    NOT NULL,
      applied_at  INTEGER NOT NULL
    )
  `);
    const applied = new Set();
    const stmt = db.prepare('SELECT version FROM schema_migrations');
    while (stmt.step()) {
        const row = stmt.getAsObject();
        applied.add(row.version);
    }
    stmt.free();
    const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
    if (pending.length === 0)
        return;
    for (const migration of pending) {
        db.exec(migration.up);
        db.run('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)', [migration.version, migration.description, Date.now()]);
        console.log(`[DB] Migration ${migration.version} applied: ${migration.description}`);
    }
    persist();
}
async function initDb() {
    const dataDir = (0, config_1.getDataDir)();
    if (!fs_1.default.existsSync(dataDir))
        fs_1.default.mkdirSync(dataDir, { recursive: true });
    dbPath = path_1.default.join(dataDir, 'whatsbridge.db');
    // Use the asm.js build of sql.js — pure JavaScript, no WASM file needed,
    // which means it works in pkg binaries without any asset extraction tricks.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const initSqlJs = require('sql.js/dist/sql-asm.js');
    const SQL = await initSqlJs();
    if (fs_1.default.existsSync(dbPath)) {
        const fileBuffer = fs_1.default.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
    }
    else {
        db = new SQL.Database();
    }
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
    runMigrations();
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function generateId() {
    return 'wb_' + crypto_1.default.randomUUID().replace(/-/g, '');
}
function queryOne(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (!stmt.step()) {
        stmt.free();
        return null;
    }
    const row = stmt.getAsObject();
    stmt.free();
    return row;
}
function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step())
        rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}
// ── CRUD ──────────────────────────────────────────────────────────────────────
function createMessage(data) {
    const id = generateId();
    const now = Date.now();
    db.run(`INSERT INTO messages (id, phone, type, body, image_url, caption, status, queued_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`, [id, data.phone, data.type, data.body ?? null, data.imageUrl ?? null, data.caption ?? null, now, now]);
    persist();
    return getMessageOrThrow(id);
}
function updateMessage(id, status, whatsappId, error) {
    const sentAt = status === 'sent' ? Date.now() : null;
    db.run(`UPDATE messages SET status = ?, whatsapp_id = ?, error = ?, sent_at = ? WHERE id = ?`, [status, whatsappId ?? null, error ?? null, sentAt, id]);
    persist();
}
function getMessage(id) {
    const row = queryOne('SELECT * FROM messages WHERE id = ?', [id]);
    return row ? toMessage(row) : null;
}
function getMessageOrThrow(id) {
    const msg = getMessage(id);
    if (!msg)
        throw new Error(`Message ${id} not found`);
    return msg;
}
function listMessages(opts = {}) {
    const { limit = 50, offset = 0, status, phone } = opts;
    const conditions = [];
    const params = [];
    if (status) {
        conditions.push('status = ?');
        params.push(status);
    }
    if (phone) {
        conditions.push('phone = ?');
        params.push(phone);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countRow = queryOne(`SELECT COUNT(*) as n FROM messages ${where}`, params);
    const total = countRow ? countRow['n'] : 0;
    const messages = queryAll(`SELECT * FROM messages ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]).map(toMessage);
    return { messages, total };
}
function createReceivedMessage(data) {
    const id = generateId();
    const now = Date.now();
    db.run(`INSERT INTO messages (id, phone, type, body, status, direction, queued_at, created_at)
     VALUES (?, ?, 'text', ?, 'sent', 'inbound', ?, ?)`, [id, data.phone, data.body || null, now, now]);
    persist();
}
function getStats() {
    const row = queryOne(`
    SELECT
      SUM(CASE WHEN direction='outbound' AND status='sent'   THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN direction='outbound' AND status='queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN direction='outbound' AND status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN direction='inbound'                      THEN 1 ELSE 0 END) AS received
    FROM messages
  `);
    return {
        sent: Number(row?.['sent']) || 0,
        queued: Number(row?.['queued']) || 0,
        failed: Number(row?.['failed']) || 0,
        received: Number(row?.['received']) || 0,
    };
}
function getPendingMessages() {
    return queryAll(`SELECT * FROM messages WHERE status IN ('queued','sending') ORDER BY queued_at ASC`).map(toMessage);
}
function toMessage(row) {
    return {
        id: row['id'],
        phone: row['phone'],
        type: row['type'],
        body: row['body'],
        imageUrl: row['image_url'],
        caption: row['caption'],
        status: row['status'],
        whatsappId: row['whatsapp_id'],
        error: row['error'],
        direction: row['direction'] ?? 'outbound',
        queuedAt: row['queued_at'],
        sentAt: row['sent_at'],
        createdAt: row['created_at'],
    };
}

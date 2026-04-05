import { Database, SqlJsStatic } from 'sql.js';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { getDataDir } from './config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Param = any;

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed';
export type MessageType   = 'text' | 'image';
export type MessageDirection = 'outbound' | 'inbound';

export interface Message {
  id: string;
  phone: string;
  type: MessageType;
  body: string | null;
  imageUrl: string | null;
  caption: string | null;
  status: MessageStatus;
  whatsappId: string | null;
  error: string | null;
  direction: MessageDirection;
  queuedAt: number;
  sentAt: number | null;
  createdAt: number;
}

export interface Stats {
  sent: number;
  queued: number;
  failed: number;
  received: number;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  status?: MessageStatus;
  phone?: string;
}

// SQL is initialized once at startup; Database objects are opened per-operation.
let SQL: SqlJsStatic;
let dbPath: string;

// ── Migrations ────────────────────────────────────────────────────────────────

interface Migration {
  version: number;
  description: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
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

function openDb(): Database {
  const db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

function saveDb(db: Database): void {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function runMigrations(): void {
  const db = openDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        description TEXT    NOT NULL,
        applied_at  INTEGER NOT NULL
      )
    `);

    const applied = new Set<number>();
    const stmt = db.prepare('SELECT version FROM schema_migrations');
    while (stmt.step()) applied.add((stmt.getAsObject() as { version: number }).version);
    stmt.free();

    const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
    if (pending.length === 0) return;

    for (const migration of pending) {
      db.exec(migration.up);
      db.run(
        'INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)',
        [migration.version, migration.description, Date.now()],
      );
      console.log(`[DB] Migration ${migration.version} applied: ${migration.description}`);
    }
    saveDb(db);
  } finally {
    db.close();
  }
}

export async function initDb(): Promise<void> {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, 'whatsbridge.db');

  // Use the asm.js build of sql.js — pure JavaScript, no WASM file needed,
  // which means it works in pkg binaries without any asset extraction tricks.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs: (config?: object) => Promise<SqlJsStatic> = require('sql.js/dist/sql-asm.js');
  SQL = await initSqlJs();
  runMigrations();
}

// ── Per-operation helpers ─────────────────────────────────────────────────────
// Each helper opens a fresh Database from disk, executes, then closes.
// This keeps the asm.js heap bounded and eliminates long-running memory issues.

function withDb<T>(fn: (db: Database) => T): T {
  const db = openDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function withDbWrite<T>(fn: (db: Database) => T): T {
  const db = openDb();
  try {
    const result = fn(db);
    saveDb(db);
    return result;
  } finally {
    db.close();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function generateId(): string {
  return 'wb_' + crypto.randomUUID().replace(/-/g, '');
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function createMessage(data: {
  phone: string;
  type: MessageType;
  body?: string;
  imageUrl?: string;
  caption?: string;
}): Message {
  const id  = generateId();
  const now = Date.now();
  return withDbWrite((db) => {
    db.run(
      `INSERT INTO messages (id, phone, type, body, image_url, caption, status, queued_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
      [id, data.phone, data.type, data.body ?? null, data.imageUrl ?? null, data.caption ?? null, now, now],
    );
    const stmt = db.prepare('SELECT * FROM messages WHERE id = ?');
    stmt.bind([id]);
    stmt.step();
    const row = stmt.getAsObject() as Row;
    stmt.free();
    return toMessage(row);
  });
}

export function updateMessage(
  id: string,
  status: MessageStatus,
  whatsappId?: string,
  error?: string,
): void {
  const sentAt = status === 'sent' ? Date.now() : null;
  withDbWrite((db) => {
    db.run(
      `UPDATE messages SET status = ?, whatsapp_id = ?, error = ?, sent_at = ? WHERE id = ?`,
      [status, whatsappId ?? null, error ?? null, sentAt, id],
    );
  });
}

export function getMessage(id: string): Message | null {
  return withDb((db) => {
    const stmt = db.prepare('SELECT * FROM messages WHERE id = ?');
    stmt.bind([id]);
    if (!stmt.step()) { stmt.free(); return null; }
    const row = stmt.getAsObject() as Row;
    stmt.free();
    return toMessage(row);
  });
}

export function listMessages(opts: ListOptions = {}): { messages: Message[]; total: number } {
  const { limit = 50, offset = 0, status, phone } = opts;
  const conditions: string[] = [];
  const params: Param[]      = [];

  if (status) { conditions.push('status = ?'); params.push(status); }
  if (phone)  { conditions.push('phone = ?');  params.push(phone);  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  return withDb((db) => {
    const countStmt = db.prepare(`SELECT COUNT(*) as n FROM messages ${where}`);
    countStmt.bind(params);
    countStmt.step();
    const total = Number((countStmt.getAsObject() as { n: number }).n) || 0;
    countStmt.free();

    const msgStmt = db.prepare(
      `SELECT * FROM messages ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    );
    msgStmt.bind([...params, limit, offset]);
    const messages: Message[] = [];
    while (msgStmt.step()) messages.push(toMessage(msgStmt.getAsObject() as Row));
    msgStmt.free();

    return { messages, total };
  });
}

export function createReceivedMessage(data: { phone: string; body: string }): void {
  const id  = generateId();
  const now = Date.now();
  withDbWrite((db) => {
    db.run(
      `INSERT INTO messages (id, phone, type, body, status, direction, queued_at, created_at)
       VALUES (?, ?, 'text', ?, 'sent', 'inbound', ?, ?)`,
      [id, data.phone, data.body || null, now, now],
    );
  });
}

export function getStats(): Stats {
  return withDb((db) => {
    const stmt = db.prepare(`
      SELECT
        SUM(CASE WHEN direction='outbound' AND status='sent'   THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN direction='outbound' AND status='queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN direction='outbound' AND status='failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN direction='inbound'                      THEN 1 ELSE 0 END) AS received
      FROM messages
    `);
    stmt.step();
    const row = stmt.getAsObject() as Row;
    stmt.free();
    return {
      sent:     Number(row['sent'])     || 0,
      queued:   Number(row['queued'])   || 0,
      failed:   Number(row['failed'])   || 0,
      received: Number(row['received']) || 0,
    };
  });
}

export function getPendingMessages(): Message[] {
  return withDb((db) => {
    const stmt = db.prepare(
      `SELECT * FROM messages WHERE status IN ('queued','sending') ORDER BY queued_at ASC`,
    );
    const rows: Message[] = [];
    while (stmt.step()) rows.push(toMessage(stmt.getAsObject() as Row));
    stmt.free();
    return rows;
  });
}

function toMessage(row: Row): Message {
  return {
    id:         row['id'],
    phone:      row['phone'],
    type:       row['type'],
    body:       row['body'],
    imageUrl:   row['image_url'],
    caption:    row['caption'],
    status:     row['status'],
    whatsappId: row['whatsapp_id'],
    error:      row['error'],
    direction:  row['direction'] ?? 'outbound',
    queuedAt:   row['queued_at'],
    sentAt:     row['sent_at'],
    createdAt:  row['created_at'],
  };
}

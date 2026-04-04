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

let SQL: SqlJsStatic;
let db: Database;
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

function persist(): void {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      description TEXT    NOT NULL,
      applied_at  INTEGER NOT NULL
    )
  `);

  const applied = new Set<number>();
  const stmt = db.prepare('SELECT version FROM schema_migrations');
  while (stmt.step()) {
    const row = stmt.getAsObject() as { version: number };
    applied.add(row.version);
  }
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
  persist();
}

function loadDbFromDisk(): void {
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  runMigrations();
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
  loadDbFromDisk();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function generateId(): string {
  return 'wb_' + crypto.randomUUID().replace(/-/g, '');
}

function withRecovery<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error && e.message.includes('no such table')) {
      console.warn('[DB] Missing table detected, reloading database from disk...');
      loadDbFromDisk();
      return fn();
    }
    throw e;
  }
}

function queryOne(sql: string, params: Param[] = []): Row | null {
  return withRecovery(() => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (!stmt.step()) { stmt.free(); return null; }
    const row = stmt.getAsObject() as Row;
    stmt.free();
    return row;
  });
}

function queryAll(sql: string, params: Param[] = []): Row[] {
  return withRecovery(() => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows: Row[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as Row);
    stmt.free();
    return rows;
  });
}

function dbRun(sql: string, params: Param[] = []): void {
  withRecovery(() => db.run(sql, params));
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
  dbRun(
    `INSERT INTO messages (id, phone, type, body, image_url, caption, status, queued_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    [id, data.phone, data.type, data.body ?? null, data.imageUrl ?? null, data.caption ?? null, now, now],
  );
  persist();
  return getMessageOrThrow(id);
}

export function updateMessage(
  id: string,
  status: MessageStatus,
  whatsappId?: string,
  error?: string,
): void {
  const sentAt = status === 'sent' ? Date.now() : null;
  dbRun(
    `UPDATE messages SET status = ?, whatsapp_id = ?, error = ?, sent_at = ? WHERE id = ?`,
    [status, whatsappId ?? null, error ?? null, sentAt, id],
  );
  persist();
}

export function getMessage(id: string): Message | null {
  const row = queryOne('SELECT * FROM messages WHERE id = ?', [id]);
  return row ? toMessage(row) : null;
}

function getMessageOrThrow(id: string): Message {
  const msg = getMessage(id);
  if (!msg) throw new Error(`Message ${id} not found`);
  return msg;
}

export function listMessages(opts: ListOptions = {}): { messages: Message[]; total: number } {
  const { limit = 50, offset = 0, status, phone } = opts;
  const conditions: string[] = [];
  const params: unknown[]    = [];

  if (status) { conditions.push('status = ?'); params.push(status); }
  if (phone)  { conditions.push('phone = ?');  params.push(phone);  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const countRow = queryOne(`SELECT COUNT(*) as n FROM messages ${where}`, params);
  const total = countRow ? (countRow['n'] as number) : 0;

  const messages = queryAll(
    `SELECT * FROM messages ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).map(toMessage);

  return { messages, total };
}

export function createReceivedMessage(data: { phone: string; body: string }): void {
  const id  = generateId();
  const now = Date.now();
  dbRun(
    `INSERT INTO messages (id, phone, type, body, status, direction, queued_at, created_at)
     VALUES (?, ?, 'text', ?, 'sent', 'inbound', ?, ?)`,
    [id, data.phone, data.body || null, now, now],
  );
  persist();
}

export function getStats(): Stats {
  const row = queryOne(`
    SELECT
      SUM(CASE WHEN direction='outbound' AND status='sent'   THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN direction='outbound' AND status='queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN direction='outbound' AND status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN direction='inbound'                      THEN 1 ELSE 0 END) AS received
    FROM messages
  `);
  return {
    sent:     Number(row?.['sent'])     || 0,
    queued:   Number(row?.['queued'])   || 0,
    failed:   Number(row?.['failed'])   || 0,
    received: Number(row?.['received']) || 0,
  };
}

export function getPendingMessages(): Message[] {
  return queryAll(
    `SELECT * FROM messages WHERE status IN ('queued','sending') ORDER BY queued_at ASC`,
  ).map(toMessage);
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
